/**
 * Code.gs — 학원 문자 앱 (구글 시트 미니 LMS + Apps Script + Solapi)
 *
 * 준비: 같은 Apps Script 프로젝트에 'logic' 파일을 만들고 logic.js를 붙여 넣는다
 *       (fillTemplate·byteLength·messageType·dedupKey·isOnValue·hhmmToMinutes·
 *        isClassDay·buildVars·automationSentence·dueLate·dueScheduled·
 *        SYSTEM_VAR_NAMES·toDigits를 여기서 부른다).
 *       'Index' HTML 파일을 만들어 Index.html을 붙여 넣는다.
 *       실발송을 켜려면 프로젝트 설정 → 스크립트 속성에 2개를 넣고
 *       설정 탭의 'SOLAPI 사용'을 '예'로 바꾼다:
 *         SOLAPI_KEY     Solapi API 키
 *         SOLAPI_SECRET  Solapi API 시크릿
 *       둘 중 하나라도 빠지면 시험 모드: 문자는 나가지 않고
 *       발송기록에 '시험(미발송)'으로만 남는다.
 *
 * 탭(시트): 반·학생·출결·템플릿·변수·자동화·발송기록·설정 — 머리글은 sheet-template.md 참고.
 *   반       [반, 요일, 시작]
 *   학생     [이름, 반, 학부모번호, 메모, …독자가 더한 열]
 *   출결     [날짜, 이름, 반, 상태, 시각]
 *   템플릿   [이름, 내용, 메모]
 *   변수     [이름, 값, 메모]
 *   자동화   [켜기, 종류, 분, 시각, 요일, 반, 템플릿]
 *   발송기록 [시각, 이름, 번호, 템플릿, 내용, 결과, 키]
 *   설정     [항목, 값]  — 학원명·발신번호·SOLAPI 사용
 * 오류는 모두 한국어 Error로 던진다. 페이지는 이 메시지를 그대로 보여 준다.
 */

var SOLAPI_URL = 'https://api.solapi.com/messages/v4/send-many/detail';

var SHEET_CLASSES = '반';
var SHEET_STUDENTS = '학생';
var SHEET_ATTEND = '출결';
var SHEET_TEMPLATES = '템플릿';
var SHEET_VARIABLES = '변수';
var SHEET_AUTOMATIONS = '자동화';
var SHEET_LOG = '발송기록';
var SHEET_SETTINGS = '설정';

var ALL_SHEETS = [SHEET_CLASSES, SHEET_STUDENTS, SHEET_ATTEND, SHEET_TEMPLATES,
  SHEET_VARIABLES, SHEET_AUTOMATIONS, SHEET_LOG, SHEET_SETTINGS];

var TRIGGER_FN = 'runAutomations';
var LOCK_MS = 30000;

// 자동화 '종류' 열에 들어가는 네 가지(문자열 그대로 쓴다)
var AUTO_ABSENT = '결석 저장 즉시';
var AUTO_LATE_SAVE = '지각 저장 즉시';
var AUTO_LATE = '시작 후 미출석';
var AUTO_SCHEDULED = '예약 발송';
var AUTO_TYPES = [AUTO_ABSENT, AUTO_LATE_SAVE, AUTO_LATE, AUTO_SCHEDULED];

// 템플릿에 쓸 수 있는 시스템 변수 목록(getApp에서 화면에 보여 준다)
var SYSTEM_VARIABLES = [
  { name: '이름', desc: '학생 이름' },
  { name: '반', desc: '학생이 속한 반 이름' },
  { name: '날짜', desc: '보내는 날짜 (yyyy-MM-dd)' },
  { name: '시각', desc: '보내는 시각 (HH:mm)' },
  { name: '상태', desc: '출결 상태 — 출결 저장 자동 문자에서만 채워진다' },
  { name: '수업시작', desc: '반 탭의 수업 시작 시각' },
  { name: '학원명', desc: '설정 탭의 학원명' }
];

function onOpen() {
  rememberSheetId_(ss_());
  SpreadsheetApp.getUi().createMenu('학원 문자')
    .addItem('시트 준비(처음 한 번)', 'setupSheets')
    .addItem('자동 발송 켜기', 'installTriggers')
    .addItem('자동 발송 끄기', 'removeTriggers')
    .addToUi();
}

/**
 * 메뉴 '시트 준비(처음 한 번)': 없는 탭만 만들어 머리글(굵게·첫 행 고정)과
 * 예시 행을 넣는다. 이미 있는 탭은 내용을 절대 건드리지 않는다.
 */
function setupSheets() {
  var ss = ss_();
  rememberSheetId_(ss);
  var defs = [
    { name: SHEET_CLASSES,
      header: ['반', '요일', '시작'],
      rows: [
        ['중2A', '월수금', '16:00'],
        ['중3B', '화목', '17:00']
      ] },
    { name: SHEET_STUDENTS,
      header: ['이름', '반', '학부모번호', '메모', '다음시험'],
      rows: [
        ['홍길동', '중2A', '010-0000-0001', '', '11월 모의고사'],
        ['김해민', '중2A', '010-0000-0002', '', '11월 모의고사'],
        ['오태식', '중3B', '010-0000-0003', '', ''],
        ['장첸', '중3B', '010-0000-0004', '', '']
      ] },
    { name: SHEET_ATTEND,
      header: ['날짜', '이름', '반', '상태', '시각'],
      rows: [] },
    { name: SHEET_TEMPLATES,
      header: ['이름', '내용', '메모'],
      rows: [
        ['결석 안내', '[{{학원명}}] {{이름}} 학생이 오늘({{날짜}}) {{반}} 수업에 결석했습니다.', ''],
        ['지각 안내', '[{{학원명}}] {{이름}} 학생이 {{반}} {{수업시작}} 수업에 아직 오지 않았습니다. 확인 부탁드립니다.', ''],
        ['시험 안내', '[{{학원명}}] {{이름}} 학생 {{다음시험}} 일정을 알려 드립니다. 준비물을 챙겨 주세요.', ''],
        ['보강 안내', '[{{학원명}}] {{이름}} 학생 보강 일정입니다. {{보강안내}}', '변수 탭의 보강안내를 쓴다']
      ] },
    { name: SHEET_VARIABLES,
      header: ['이름', '값', '메모'],
      rows: [
        ['학원전화', '02-000-0000', ''],
        ['보강안내', '토요일 10시', '보강 안내 템플릿에서 쓴다']
      ] },
    { name: SHEET_AUTOMATIONS,
      header: ['켜기', '종류', '분', '시각', '요일', '반', '템플릿'],
      rows: [
        ['예', AUTO_ABSENT, '', '', '', '', '결석 안내'],
        ['아니오', AUTO_LATE, 10, '', '', '', '지각 안내'],
        ['아니오', AUTO_SCHEDULED, '', '18:00', '금', '', '시험 안내']
      ] },
    { name: SHEET_LOG,
      header: ['시각', '이름', '번호', '템플릿', '내용', '결과', '키'],
      rows: [] },
    { name: SHEET_SETTINGS,
      header: ['항목', '값'],
      rows: [
        ['학원명', '해민 영어학원'],
        ['발신번호', '(Solapi에 등록한 번호)'],
        ['SOLAPI 사용', '아니오']
      ] }
  ];
  var created = [];
  defs.forEach(function (d) {
    if (ss.getSheetByName(d.name)) return;
    var s = ss.insertSheet(d.name);
    s.getRange(1, 1, 1, d.header.length).setValues([d.header]).setFontWeight('bold');
    s.setFrozenRows(1);
    if (d.rows.length) {
      s.getRange(2, 1, d.rows.length, d.header.length).setValues(d.rows);
    }
    created.push(d.name);
  });
  toast_(created.length
    ? '탭을 만들었습니다: ' + created.join(', ')
    : '필요한 탭이 이미 모두 있습니다. 기존 탭은 바꾸지 않았습니다.');
}

/** 웹앱 진입점 — Index.html 한 장을 보여 준다. */
function doGet() {
  // 처음 여는 시트라면 없는 탭부터 만든다(있는 탭은 건드리지 않는다)
  var ss = ss_();
  for (var i = 0; i < ALL_SHEETS.length; i++) {
    if (!ss.getSheetByName(ALL_SHEETS[i])) { setupSheets(); break; }
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('학원 문자')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------- 날짜·셀 표현 ----------

function tz_() {
  return Session.getScriptTimeZone();
}

function todayStr_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function nowHHmm_() {
  return Utilities.formatDate(new Date(), tz_(), 'HH:mm');
}

function validDate_(s) {
  s = String(s == null ? '' : s).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function str_(v) {
  return String(v == null ? '' : v).trim();
}

/**
 * 셀 값을 사람이 읽는 문자열로. 시트가 시간·날짜를 Date로 돌려줄 때:
 * 1899년대(시간만 있는 셀)는 'HH:mm', 그 외 Date는 'yyyy-MM-dd'로 내린다.
 */
function cellText_(v) {
  if (v == null) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz_(), v.getFullYear() < 1900 ? 'HH:mm' : 'yyyy-MM-dd');
  }
  return String(v).trim();
}

/** 발송기록 '시각'처럼 날짜+시간 셀은 'yyyy-MM-dd HH:mm'으로. */
function dateTimeText_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm');
  }
  return String(v).trim();
}

/** '날짜' 열 값을 'yyyy-MM-dd'로 맞춘다. */
function dateStr_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  return String(v).trim().slice(0, 10);
}

/** 숫자형 셀에 앞 0이 떨어진 번호(1012345678)를 되살린다. */
function normalizePhone_(v) {
  var d = toDigits(v);
  if (d.length === 10 && d.charAt(0) === '1') d = '0' + d;
  return d;
}

function maskPhone_(phone) {
  var d = toDigits(phone);
  if (d.length >= 7) return d.slice(0, 3) + '****' + d.slice(-4);
  return d ? d.slice(0, 1) + '****' : '(번호 없음)';
}

// ---------- 시트 읽기 ----------

/**
 * 이 프로젝트의 스프레드시트를 연다. 메뉴처럼 활성 시트가 있으면 그것을 쓰고,
 * 웹앱·트리거처럼 활성 시트가 없는 실행에서는 스크립트 속성 SHEET_ID로 연다.
 * 둘 다 안 되면 메뉴 '학원 문자 > 시트 준비(처음 한 번)'를 실행하라는 오류를 던진다.
 */
function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) { /* 저장된 ID로 못 열면 아래 안내로 보낸다 */ }
  }
  throw new Error('스프레드시트를 찾지 못했습니다. 시트를 열고 학원 문자 > 시트 준비(처음 한 번)를 한 번 실행해 주세요.');
}

/** 스프레드시트 ID를 스크립트 속성에 저장해 웹앱·트리거도 같은 시트를 열게 한다. */
function rememberSheetId_(ss) {
  try {
    PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  } catch (e) { /* 못 저장해도 부른 쪽 메뉴·설정 작업은 계속한다 */ }
}

function sheet_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) {
    throw new Error('시트에 "' + name + '" 탭이 없습니다. sheet-template.md의 탭 이름·머리글을 확인해 주세요.');
  }
  return s;
}

/** 탭 첫 행의 머리글 배열 ['이름','반',...]. */
function headerValues_(sheetName) {
  var s = sheet_(sheetName);
  var last = s.getLastColumn();
  if (last < 1) return [];
  return s.getRange(1, 1, 1, last).getValues()[0].map(function (h) {
    return String(h).trim();
  });
}

/** 머리글 열이 없으면 맨 뒤에 추가하고 열 번호(1부터)를 돌려준다. */
function ensureColumn_(sheetName, headerName) {
  var s = sheet_(sheetName);
  var header = headerValues_(sheetName);
  var idx = header.indexOf(headerName);
  if (idx !== -1) return idx + 1;
  var col = header.length + 1;
  if (s.getMaxColumns() < col) {
    s.insertColumnsAfter(s.getMaxColumns(), col - s.getMaxColumns());
  }
  s.getRange(1, col).setValue(headerName).setFontWeight('bold');
  return col;
}

/** 탭을 [{ 열머리글: 값, ..., _row: 시트행번호 }] 배열로 읽는다. */
function rowsAsObjects_(sheetName) {
  var values = sheet_(sheetName).getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    for (var c = 0; c < header.length; c++) {
      if (header[c]) o[header[c]] = values[i][c];
    }
    rows.push(o);
  }
  return rows;
}

/** 머리글 열에서 key와 같은 행 번호(1부터)를 찾는다. 없으면 null. */
function findRow_(sheetName, header, key) {
  key = str_(key);
  if (!key) return null;
  var rows = rowsAsObjects_(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][header]) === key) return rows[i]._row;
  }
  return null;
}

// ---------- 탭별 읽기 ----------

/** 반 탭: [{ row, name, days, start }]. */
function readClasses_() {
  var out = [];
  rowsAsObjects_(SHEET_CLASSES).forEach(function (r) {
    var c = {
      row: r._row,
      name: str_(r['반']),
      days: cellText_(r['요일']),
      start: cellText_(r['시작'])
    };
    if (c.name) out.push(c);
  });
  return out;
}

function indexClasses_() {
  var map = {};
  readClasses_().forEach(function (c) { map[c.name] = c; });
  return map;
}

/**
 * 학생 탭: 고정 열은 이름·반·학부모번호. 그 외 열(메모·다음시험처럼
 * 독자가 더한 것까지)은 fields에 담겨 템플릿 변수가 된다.
 * @returns {Array} [{ row, name, cls, phone, fields: {열: 값} }]
 */
function readStudents_() {
  var header = headerValues_(SHEET_STUDENTS);
  var extra = header.filter(function (h) {
    return h && h !== '이름' && h !== '반' && h !== '학부모번호';
  });
  var out = [];
  rowsAsObjects_(SHEET_STUDENTS).forEach(function (r) {
    var fields = {};
    extra.forEach(function (h) { fields[h] = cellText_(r[h]); });
    var s = {
      row: r._row,
      name: str_(r['이름']),
      cls: str_(r['반']),
      phone: cellText_(r['학부모번호']),
      fields: fields
    };
    if (s.name) out.push(s);
  });
  return out;
}

function indexStudents_() {
  var map = {};
  readStudents_().forEach(function (s) { map[s.name] = s; });
  return map;
}

/** 출결 탭에서 특정 날짜 행만 [{ name, cls, status, at }]. */
function readAttendance_(date) {
  return rowsAsObjects_(SHEET_ATTEND)
    .filter(function (r) { return dateStr_(r['날짜']) === date; })
    .map(function (r) {
      return {
        name: str_(r['이름']),
        cls: str_(r['반']),
        status: str_(r['상태']),
        at: cellText_(r['시각'])
      };
    })
    .filter(function (a) { return a.name; });
}

/** 템플릿 탭 목록 [{ name, body, note }]. */
function listTemplates_() {
  return rowsAsObjects_(SHEET_TEMPLATES)
    .filter(function (r) { return str_(r['이름']); })
    .map(function (r) {
      return {
        name: str_(r['이름']),
        body: String(r['내용'] == null ? '' : r['내용']),
        note: str_(r['메모'])
      };
    });
}

/** 템플릿 탭: { 이름: 내용 }. */
function readTemplates_() {
  var map = {};
  listTemplates_().forEach(function (t) { map[t.name] = t.body; });
  return map;
}

/** 변수 탭 목록 [{ name, value, note }]. */
function listVariables_() {
  return rowsAsObjects_(SHEET_VARIABLES)
    .filter(function (r) { return str_(r['이름']); })
    .map(function (r) {
      return {
        name: str_(r['이름']),
        value: cellText_(r['값']),
        note: str_(r['메모'])
      };
    });
}

/** 변수 탭: { 이름: 값 }. */
function readVariables_() {
  var map = {};
  listVariables_().forEach(function (v) { map[v.name] = v.value; });
  return map;
}

/**
 * 자동화 탭: [{ row, on, type, minutes, time, days, cls, template }].
 * on은 '예'·체크박스·y 등을 boolean으로 바꾼 값이다.
 */
function readAutomations_() {
  return rowsAsObjects_(SHEET_AUTOMATIONS).map(function (r) {
    return {
      row: r._row,
      on: isOnValue(r['켜기']),
      type: str_(r['종류']),
      minutes: Number(r['분']) || 0,
      time: cellText_(r['시각']),
      days: cellText_(r['요일']),
      cls: str_(r['반']),
      template: str_(r['템플릿'])
    };
  });
}

/** 설정 탭: { 항목: 값 }. */
function settings_() {
  var map = {};
  rowsAsObjects_(SHEET_SETTINGS).forEach(function (r) {
    var k = str_(r['항목']);
    if (k) map[k] = str_(r['값']);
  });
  return map;
}

/** 설정 탭 항목을 고쳐 쓰거나 없으면 새 행으로 단다. */
function setSetting_(key, value) {
  var s = sheet_(SHEET_SETTINGS);
  var row = findRow_(SHEET_SETTINGS, '항목', key);
  if (row) s.getRange(row, 2).setValue(value);
  else s.appendRow([key, value]);
}

/** 발송기록의 '키' 열을 집합으로. 여기 있는 키는 다시 보내지 않는다. */
function sentKeys_() {
  var keys = {};
  rowsAsObjects_(SHEET_LOG).forEach(function (r) {
    var k = str_(r['키']);
    if (k) keys[k] = true;
  });
  return keys;
}

function appendLog_(name, phone, templateName, text, result, key) {
  sheet_(SHEET_LOG).appendRow([new Date(), name, phone, templateName, text, result, key]);
}

// ---------- 웹앱에서 부르는 함수 ----------

/**
 * 앱 전체 화면 데이터 한 번에.
 * @returns {{academy, today, weekday, classes, students, studentColumns,
 *   templates, variables, systemVariables, automations, automationRunning,
 *   settings}}
 */
function getApp() {
  var st = settings_();
  var props = PropertiesService.getScriptProperties();
  var keysSet = !!(props.getProperty('SOLAPI_KEY') && props.getProperty('SOLAPI_SECRET'));
  var studentColumns = headerValues_(SHEET_STUDENTS).filter(function (h) {
    return h && h !== '이름' && h !== '반' && h !== '학부모번호';
  });
  return {
    academy: st['학원명'] || '',
    today: todayStr_(),
    weekday: new Date().getDay(),
    classes: readClasses_().map(function (c) {
      return { name: c.name, days: c.days, start: c.start };
    }),
    students: readStudents_().map(function (s) {
      return {
        name: s.name,
        cls: s.cls,
        phone: s.phone, // 편집용으로 원래 번호를 준다
        phoneMasked: maskPhone_(s.phone),
        fields: s.fields
      };
    }),
    studentColumns: studentColumns,
    templates: listTemplates_(),
    variables: listVariables_(),
    systemVariables: SYSTEM_VARIABLES,
    automations: readAutomations_().map(function (r) {
      return {
        row: r.row, on: r.on, type: r.type, minutes: r.minutes, time: r.time,
        days: r.days, cls: r.cls, template: r.template,
        sentence: automationSentence(r)
      };
    }),
    automationRunning: automationRunning_(),
    settings: {
      academy: st['학원명'] || '',
      sender: st['발신번호'] || '',
      solapiOn: st['SOLAPI 사용'] === '예',
      keysSet: keysSet
    }
  };
}

/**
 * 반 저장·고치기: originalName이 있으면 그 행을 찾아 새 이름으로 바꾼다.
 * 이름이 바뀌면 학생 탭의 반도 같이 바꿔 준다.
 */
function saveClass(input) {
  input = input || {};
  var name = str_(input.name);
  if (!name) throw new Error('반 이름을 넣어 주세요.');
  var days = str_(input.days);
  var start = str_(input.start);
  if (start && hhmmToMinutes(start) == null) {
    throw new Error('수업 시작 시각은 HH:mm 형식으로 넣어 주세요.');
  }
  var original = str_(input.originalName) || name;
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var s = sheet_(SHEET_CLASSES);
    var row = findRow_(SHEET_CLASSES, '반', original);
    var dup = findRow_(SHEET_CLASSES, '반', name);
    if (dup && dup !== row) throw new Error('"' + name + '" 반이 이미 있습니다.');
    if (row) s.getRange(row, 1, 1, 3).setValues([[name, days, start]]);
    else s.appendRow([name, days, start]);
    if (original !== name) renameStudentClass_(original, name);
    return { ok: true, name: name, days: days, start: start };
  } finally {
    lock.releaseLock();
  }
}

/** 학생 탭의 반 값을 from에서 to로 바꾼다(반 이름 고칠 때 따라간다). */
function renameStudentClass_(from, to) {
  var s = sheet_(SHEET_STUDENTS);
  var header = headerValues_(SHEET_STUDENTS);
  var col = header.indexOf('반') + 1;
  if (col < 1) return;
  var last = s.getLastRow();
  if (last < 2) return;
  var vals = s.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (str_(vals[i][0]) === from) s.getRange(i + 2, col).setValue(to);
  }
}

/** 반 지우기(반 행만 지운다; 학생의 반 칸은 그대로 둔다). */
function deleteClass(name) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var row = findRow_(SHEET_CLASSES, '반', name);
    if (!row) throw new Error('반 탭에 "' + name + '" 반이 없습니다.');
    sheet_(SHEET_CLASSES).deleteRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 학생 저장·고치기: originalName이 있으면 그 행을 찾는다.
 * fields에 시트에 없는 열 이름이 있으면 학생 탭 맨 뒤에 열을 더한다.
 * fields에 없는 기존 열 값은 그대로 둔다.
 */
function saveStudent(input) {
  input = input || {};
  var name = str_(input.name);
  if (!name) throw new Error('학생 이름을 넣어 주세요.');
  var cls = str_(input.cls);
  var phone = str_(input.phone);
  var original = str_(input.originalName) || name;
  var fields = (input.fields !== null && typeof input.fields === 'object') ? input.fields : {};

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var s = sheet_(SHEET_STUDENTS);
    var header = headerValues_(SHEET_STUDENTS);
    if (header.indexOf('이름') === -1) {
      throw new Error('학생 탭 첫 행에 "이름" 머리글이 없습니다. 시트 준비를 다시 실행해 주세요.');
    }
    Object.keys(fields).forEach(function (k) {
      var key = str_(k);
      if (!key || key === '이름' || key === '반' || key === '학부모번호') return;
      if (header.indexOf(key) === -1) {
        ensureColumn_(SHEET_STUDENTS, key);
        header.push(key);
      }
    });
    var row = findRow_(SHEET_STUDENTS, '이름', original);
    var dup = findRow_(SHEET_STUDENTS, '이름', name);
    if (dup && dup !== row) throw new Error('"' + name + '" 학생이 이미 있습니다.');
    var existing = {};
    if (row) {
      s.getRange(row, 1, 1, header.length).getValues()[0].forEach(function (v, i) {
        existing[header[i]] = v;
      });
    }
    var values = header.map(function (h) {
      if (h === '이름') return name;
      if (h === '반') return cls;
      if (h === '학부모번호') return phone;
      if (Object.prototype.hasOwnProperty.call(fields, h)) return str_(fields[h]);
      return row ? cellText_(existing[h]) : '';
    });
    if (row) s.getRange(row, 1, 1, header.length).setValues([values]);
    else s.appendRow(values);
    return { ok: true, name: name };
  } finally {
    lock.releaseLock();
  }
}

/** 학생 지우기(출결·발송기록의 과거 행은 그대로 둔다). */
function deleteStudent(name) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var row = findRow_(SHEET_STUDENTS, '이름', name);
    if (!row) throw new Error('학생 탭에 "' + name + '" 학생이 없습니다.');
    sheet_(SHEET_STUDENTS).deleteRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 출결 화면 데이터: 그 날짜의 학생별 상태를 보여 준다.
 * @returns {Array} [{ name, cls, start, status|null, at }]
 */
function getAttendance(dateStr, cls) {
  var date = validDate_(dateStr) || todayStr_();
  var filter = str_(cls);
  var classesByName = indexClasses_();
  var byName = {};
  readAttendance_(date).forEach(function (a) { byName[a.name] = a; });
  // 그날 수업이 있는 반만 보인다. 반 요일이 비었거나 반이 없으면 매일 보인다.
  var dayChar = WEEKDAY_CHARS.charAt(new Date(date + 'T00:00:00').getDay());
  return readStudents_()
    .filter(function (s) { return !filter || s.cls === filter; })
    .filter(function (s) {
      var c = classesByName[s.cls];
      return !c || !c.days || c.days.indexOf(dayChar) > -1 || !!byName[s.name];
    })
    .map(function (s) {
      var a = byName[s.name];
      var c = classesByName[s.cls];
      return {
        name: s.name,
        cls: s.cls,
        start: c ? c.start : '',
        status: a ? a.status : null,
        at: a ? a.at : ''
      };
    });
}

/**
 * 출결 저장: 출결 탭에 한 줄씩 쓰고, 오늘이면 켜진 '결석/지각 저장 즉시'
 * 자동화를 바로 실행한다. 지난 날짜는 행만 쓰고 자동 문자를 건너뛴다.
 * @returns {{ok: boolean, sent: Array, note: (string|undefined)}}
 *   sent: [{ name, template, result }]
 */
function saveAttendance(dateStr, rows, status) {
  // 옛 호출법 saveAttendance(날짜, 이름, 상태)도 받는다
  var list;
  if (typeof rows === 'string') list = [{ name: rows, status: status }];
  else if (Array.isArray(rows)) list = rows;
  else list = [];
  if (!list.length) throw new Error('저장할 출결이 없습니다.');
  var date = validDate_(dateStr) || todayStr_();
  var byName = indexStudents_();
  var isToday = date === todayStr_();
  var hhmm = nowHHmm_();
  var st = settings_();
  var classesByName = indexClasses_();
  var userVars = readVariables_();
  var tplMap = readTemplates_();
  var rules = isToday ? readAutomations_().filter(function (r) {
    return r.on && (r.type === AUTO_ABSENT || r.type === AUTO_LATE_SAVE);
  }) : [];

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var attend = sheet_(SHEET_ATTEND);
    var keys = isToday ? sentKeys_() : {};
    var sent = [];
    list.forEach(function (r) {
      var s = byName[str_(r && r.name)];
      if (!s) throw new Error('학생 탭에 "' + (r && r.name) + '" 학생이 없습니다.');
      var st2 = str_(r.status);
      if (!st2) throw new Error('상태(등원·지각·결석)를 골라 주세요.');
      attend.appendRow([date, s.name, s.cls, st2, hhmm]);
      if (!isToday) return;
      var wantType = st2 === '결석' ? AUTO_ABSENT : st2 === '지각' ? AUTO_LATE_SAVE : null;
      if (!wantType) return;
      rules.forEach(function (rule) {
        if (rule.type !== wantType) return;
        if (rule.cls && rule.cls !== s.cls) return;
        if (tplMap[rule.template] == null) return;
        var key = dedupKey(date, s.name, rule.template, ruleKey(rule));
        if (keys[key]) {
          sent.push({ name: s.name, template: rule.template, result: '중복 건너뜀' });
          return;
        }
        var filled = fillTemplate(tplMap[rule.template],
          buildVars(s, classesByName[s.cls] || null, st, userVars, date, hhmm, st2));
        if (filled.missing.length) {
          var hold = '보류: 빈 변수 ' + filled.missing.join(', ');
          appendLog_(s.name, normalizePhone_(s.phone), rule.template, filled.text, hold, '');
          sent.push({ name: s.name, template: rule.template, result: hold });
          return;
        }
        var result = deliver_(s, st, rule.template, filled.text, key);
        keys[key] = true;
        sent.push({ name: s.name, template: rule.template, result: result });
      });
    });
    var out = { ok: true, sent: sent };
    if (!isToday) out.note = '지난 날짜는 자동 문자를 보내지 않습니다';
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** 템플릿 저장·고치기: originalName이 있으면 그 행을 새 이름으로 바꾼다. */
function saveTemplate(input) {
  input = input || {};
  var name = str_(input.name);
  if (!name) throw new Error('템플릿 이름을 넣어 주세요.');
  var body = input.body == null ? '' : String(input.body);
  var note = str_(input.note);
  var original = str_(input.originalName) || name;
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var s = sheet_(SHEET_TEMPLATES);
    var row = findRow_(SHEET_TEMPLATES, '이름', original);
    var dup = findRow_(SHEET_TEMPLATES, '이름', name);
    if (dup && dup !== row) throw new Error('"' + name + '" 템플릿이 이미 있습니다.');
    if (row) s.getRange(row, 1, 1, 3).setValues([[name, body, note]]);
    else s.appendRow([name, body, note]);
    return { ok: true, name: name };
  } finally {
    lock.releaseLock();
  }
}

/** 템플릿 지우기. */
function deleteTemplate(name) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var row = findRow_(SHEET_TEMPLATES, '이름', name);
    if (!row) throw new Error('템플릿 탭에 "' + name + '" 템플릿이 없습니다.');
    sheet_(SHEET_TEMPLATES).deleteRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 변수 저장·고치기: 시스템 변수와 같은 이름은 막는다(어차피 자동 값이 덮는다).
 * originalName이 있으면 그 행을 새 이름으로 바꾼다.
 */
function saveVariable(input) {
  input = input || {};
  var name = str_(input.name);
  if (!name) throw new Error('변수 이름을 넣어 주세요.');
  if (/[{}]/.test(name)) throw new Error('변수 이름에 { } 는 쓸 수 없습니다.');
  if (SYSTEM_VAR_NAMES[name]) {
    throw new Error('"' + name + '"은 자동으로 채워지는 변수라 다른 이름을 써 주세요.');
  }
  var value = input.value == null ? '' : String(input.value);
  var note = str_(input.note);
  var original = str_(input.originalName) || name;
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var s = sheet_(SHEET_VARIABLES);
    var row = findRow_(SHEET_VARIABLES, '이름', original);
    var dup = findRow_(SHEET_VARIABLES, '이름', name);
    if (dup && dup !== row) throw new Error('"' + name + '" 변수가 이미 있습니다.');
    if (row) s.getRange(row, 1, 1, 3).setValues([[name, value, note]]);
    else s.appendRow([name, value, note]);
    return { ok: true, name: name };
  } finally {
    lock.releaseLock();
  }
}

/** 변수 지우기. */
function deleteVariable(name) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var row = findRow_(SHEET_VARIABLES, '이름', name);
    if (!row) throw new Error('변수 탭에 "' + name + '" 변수가 없습니다.');
    sheet_(SHEET_VARIABLES).deleteRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 템플릿 편집기 미리보기: body를 학생 한 명(없으면 시스템 변수만)으로 채운다.
 * @returns {{text, bytes, type, missing}}
 */
function previewTemplate(body, studentName) {
  var st = settings_();
  var s = null;
  if (studentName != null && str_(studentName) !== '') {
    s = indexStudents_()[str_(studentName)];
    if (!s) throw new Error('학생 탭에 "' + studentName + '" 학생이 없습니다.');
  }
  var vars = buildVars(s || {}, s ? indexClasses_()[s.cls] || null : null,
    st, readVariables_(), todayStr_(), nowHHmm_(), null);
  var filled = fillTemplate(String(body == null ? '' : body), vars);
  return {
    text: filled.text,
    bytes: byteLength(filled.text),
    type: messageType(filled.text),
    missing: filled.missing
  };
}

/**
 * 문자 보내기 미리보기: 채운 문구·바이트 수·SMS/LMS·경고·중복 여부를 학생별로.
 * @returns {Array} [{ name, phoneMasked, text, bytes, type, missing, duplicate }]
 */
function previewMessages(templateName, names) {
  var tplMap = readTemplates_();
  if (tplMap[templateName] == null) {
    throw new Error('템플릿 탭에 "' + templateName + '" 템플릿이 없습니다.');
  }
  var st = settings_();
  var byName = indexStudents_();
  var classesByName = indexClasses_();
  var userVars = readVariables_();
  var keys = sentKeys_();
  var date = todayStr_();
  var hhmm = nowHHmm_();
  return (names || []).map(function (n) {
    var s = byName[str_(n)];
    if (!s) throw new Error('학생 탭에 "' + n + '" 학생이 없습니다.');
    var filled = fillTemplate(tplMap[templateName],
      buildVars(s, classesByName[s.cls] || null, st, userVars, date, hhmm, null));
    return {
      name: s.name,
      phoneMasked: maskPhone_(s.phone),
      text: filled.text,
      bytes: byteLength(filled.text),
      type: messageType(filled.text),
      missing: filled.missing,
      duplicate: !!keys[dedupKey(date, s.name, templateName, '수동')]
    };
  });
}

/**
 * 문자 보내기: 발송기록 키 '날짜|이름|템플릿|수동'으로 중복을 걸러 보낸다.
 * @returns {Array} [{ name, result }] — '시험(미발송)'·'접수'·'실패: …'·'중복 건너뜀'·'보류: 빈 변수 …'
 */
function sendMessages(templateName, names) {
  var tplMap = readTemplates_();
  if (tplMap[templateName] == null) {
    throw new Error('템플릿 탭에 "' + templateName + '" 템플릿이 없습니다.');
  }
  var st = settings_();
  var byName = indexStudents_();
  var classesByName = indexClasses_();
  var userVars = readVariables_();
  var date = todayStr_();
  var hhmm = nowHHmm_();
  var results = [];

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var keys = sentKeys_();
    (names || []).forEach(function (n) {
      var s = byName[str_(n)];
      if (!s) {
        results.push({ name: str_(n), result: '실패: 학생 탭에 없는 이름' });
        return;
      }
      var key = dedupKey(date, s.name, templateName, '수동');
      if (keys[key]) {
        results.push({ name: s.name, result: '중복 건너뜀' });
        return;
      }
      var filled = fillTemplate(tplMap[templateName],
        buildVars(s, classesByName[s.cls] || null, st, userVars, date, hhmm, null));
      if (filled.missing.length) {
        var hold = '보류: 빈 변수 ' + filled.missing.join(', ');
        appendLog_(s.name, normalizePhone_(s.phone), templateName, filled.text, hold, '');
        results.push({ name: s.name, result: hold });
        return;
      }
      var result = deliver_(s, st, templateName, filled.text, key);
      keys[key] = true;
      results.push({ name: s.name, result: result });
    });
  } finally {
    lock.releaseLock();
  }
  return results;
}

// ---------- 자동화 ----------

/**
 * 자동화 규칙 저장·고치기: row가 있으면 그 행을 덮어쓰고, 없으면 새 행.
 * @returns {Object} 저장된 규칙 { row, on, type, minutes, time, days, cls, template, sentence }
 */
function saveAutomation(input) {
  input = input || {};
  var type = str_(input.type);
  if (AUTO_TYPES.indexOf(type) === -1) {
    throw new Error('자동화 종류는 "' + AUTO_TYPES.join('"·"') + '" 중에서 골라 주세요.');
  }
  var template = str_(input.template);
  if (!template || readTemplates_()[template] == null) {
    throw new Error('템플릿 탭에 "' + template + '" 템플릿이 없습니다.');
  }
  var minutes = Number(input.minutes) || 0;
  var time = str_(input.time);
  if (type === AUTO_LATE && minutes <= 0) {
    throw new Error('수업 시작 몇 분 뒤에 보낼지 "분"을 넣어 주세요.');
  }
  if (type === AUTO_SCHEDULED && hhmmToMinutes(time) == null) {
    throw new Error('예약 발송 시각을 HH:mm 형식으로 넣어 주세요.');
  }
  var rule = {
    on: !!input.on,
    type: type,
    minutes: minutes,
    time: time,
    days: str_(input.days),
    cls: str_(input.cls),
    template: template
  };
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var s = sheet_(SHEET_AUTOMATIONS);
    var row = Number(input.row) || 0;
    var values = [rule.on ? '예' : '아니오', rule.type, rule.minutes || '',
      rule.time, rule.days, rule.cls, rule.template];
    if (row) {
      if (row < 2 || row > s.getLastRow()) {
        throw new Error('자동화 탭에서 ' + row + '행을 찾지 못했습니다.');
      }
      s.getRange(row, 1, 1, values.length).setValues([values]);
    } else {
      s.appendRow(values);
      row = s.getLastRow();
    }
    rule.row = row;
    rule.sentence = automationSentence(rule);
    return rule;
  } finally {
    lock.releaseLock();
  }
}

/** 자동화 규칙 행 지우기. */
function deleteAutomation(row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var s = sheet_(SHEET_AUTOMATIONS);
    row = Number(row) || 0;
    if (row < 2 || row > s.getLastRow()) {
      throw new Error('자동화 탭에서 ' + row + '행을 찾지 못했습니다.');
    }
    s.deleteRow(row);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 자동 발송 스위치: 켜면 5분마다 runAutomations를 도는 트리거를 하나 단다.
 * 끄면 그 트리거를 지운다.
 * @returns {{automationRunning: boolean}}
 */
function setAutomationRunning(on) {
  removeTriggers_();
  if (on) {
    ScriptApp.newTrigger(TRIGGER_FN).timeBased().everyMinutes(5).create();
  }
  return { automationRunning: !!on };
}

/** runAutomations 트리거가 달려 있는지 본다. */
function automationRunning_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === TRIGGER_FN) return true;
  }
  return false;
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_FN) ScriptApp.deleteTrigger(t);
  });
}

/** 메뉴 '자동 발송 켜기': 5분마다 자동화를 도는 트리거를 단다. */
function installTriggers() {
  setAutomationRunning(true);
  toast_('5분마다 자동 발송을 확인합니다.');
}

/** 메뉴 '자동 발송 끄기': 자동화 트리거를 지운다. */
function removeTriggers() {
  setAutomationRunning(false);
  toast_('자동 발송을 멈췄습니다.');
}

/**
 * 5분 트리거가 부른다: 켜진 '시작 후 미출석'·'예약 발송' 규칙을 돈다.
 * '시작 후 미출석'은 오늘 수업인 반에서 시작+분이 지났는데 출결 기록이 없는
 * 학생에게, '예약 발송'은 시각이 지난 뒤 처음 도는 순간에 반(또는 전체)에게
 * 보낸다. 같은 날 같은 규칙은 발송기록 키로 한 번만 나간다.
 */
function runAutomations() {
  var rules = readAutomations_().filter(function (r) {
    return r.on && (r.type === AUTO_LATE || r.type === AUTO_SCHEDULED);
  });
  if (!rules.length) return;
  var date = todayStr_();
  var hhmm = nowHHmm_();
  var weekday = new Date().getDay();
  var students = readStudents_();
  var classes = readClasses_();
  var classesByName = indexClasses_();
  var attendance = readAttendance_(date);
  var st = settings_();
  var userVars = readVariables_();
  var tplMap = readTemplates_();

  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    var keys = sentKeys_();
    rules.forEach(function (rule) {
      var tpl = tplMap[rule.template];
      if (tpl == null) return;
      var targets;
      var status = null;
      if (rule.type === AUTO_LATE) {
        targets = dueLate(students, classes, attendance, hhmm, rule.minutes, weekday, rule.cls);
        status = '미등원';
      } else {
        if (!dueScheduled(rule, hhmm, weekday)) return;
        targets = students.filter(function (s) {
          return !rule.cls || s.cls === rule.cls;
        });
      }
      targets.forEach(function (s) {
        var key = dedupKey(date, s.name, rule.template, ruleKey(rule));
        if (keys[key]) return;
        var filled = fillTemplate(tpl,
          buildVars(s, classesByName[s.cls] || null, st, userVars, date, hhmm, status));
        if (filled.missing.length) {
          // 보류도 하루 한 번만 기록한다(빈 변수를 고치면 실제 발송 키가 비어 있어 다시 나간다)
          var holdKey = dedupKey(date, s.name, rule.template, ruleKey(rule) + ' 보류');
          if (!keys[holdKey]) {
            appendLog_(s.name, normalizePhone_(s.phone), rule.template, filled.text,
              '보류: 빈 변수 ' + filled.missing.join(', '), holdKey);
            keys[holdKey] = true;
          }
          return;
        }
        deliver_(s, st, rule.template, filled.text, key);
        keys[key] = true;
      });
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * 발송기록 최근 limit행(기본 50)을 최신 것부터 보여 준다.
 * @returns {Array} [{ at, name, phoneMasked, template, text, result }]
 */
function getLog(limit) {
  var n = Number(limit) || 50;
  return rowsAsObjects_(SHEET_LOG).slice(-n).reverse().map(function (r) {
    return {
      at: dateTimeText_(r['시각']),
      name: str_(r['이름']),
      phoneMasked: maskPhone_(r['번호']),
      template: str_(r['템플릿']),
      text: String(r['내용'] == null ? '' : r['내용']),
      result: str_(r['결과'])
    };
  });
}

/** 설정 저장: 학원명·발신번호·SOLAPI 사용 토글. */
function saveSettings(input) {
  input = input || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try {
    setSetting_('학원명', str_(input.academy));
    setSetting_('발신번호', str_(input.sender));
    setSetting_('SOLAPI 사용', input.solapiOn ? '예' : '아니오');
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function toast_(msg) {
  try {
    ss_().toast(msg, '학원 문자');
  } catch (e) { /* 메뉴 밖에서 불려도 알림은 건너뛴다 */ }
}

// ---------- 발송 ----------

/** 설정 'SOLAPI 사용'이 '예'이고 스크립트 속성 키 2개가 있을 때만 실발송. */
function solapiOn_(st) {
  if (st['SOLAPI 사용'] !== '예') return false;
  var props = PropertiesService.getScriptProperties();
  return !!(props.getProperty('SOLAPI_KEY') && props.getProperty('SOLAPI_SECRET'));
}

/**
 * 한 명에게 보내고 발송기록에 남긴다.
 * @returns {string} '시험(미발송)' | '접수' | '실패: <이유>'
 */
function deliver_(s, st, templateName, text, key) {
  var phone = normalizePhone_(s.phone);
  if (!phone) {
    appendLog_(s.name, '', templateName, text, '실패: 학부모번호 없음', key);
    return '실패: 학부모번호 없음';
  }
  if (!solapiOn_(st)) {
    appendLog_(s.name, phone, templateName, text, '시험(미발송)', key);
    return '시험(미발송)';
  }
  var from = normalizePhone_(st['발신번호']);
  if (!from) {
    appendLog_(s.name, phone, templateName, text, '실패: 설정 탭에 발신번호 없음', key);
    return '실패: 설정 탭에 발신번호 없음';
  }
  var result;
  try {
    var resp = UrlFetchApp.fetch(SOLAPI_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': solapiAuthHeader_() },
      payload: JSON.stringify({ messages: [{ to: phone, from: from, text: text }] }),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      result = '실패: HTTP ' + code;
    } else {
      var failed = null;
      try {
        var body = JSON.parse(resp.getContentText() || '{}');
        var list = body.failedMessageList;
        if (list && list.length) {
          var f = list[0];
          failed = f.statusMessage || f.statusCode || 'Solapi 오류';
        }
      } catch (e2) { /* 응답 본문이 JSON이 아니어도 접수로 본다 */ }
      result = failed ? '실패: ' + failed : '접수';
    }
  } catch (e) {
    result = '실패: ' + (e && e.message ? e.message : e);
  }
  appendLog_(s.name, phone, templateName, text, result, key);
  return result;
}

/** Authorization: HMAC-SHA256 apiKey=..., date=..., salt=..., signature=hex(HMAC(secret, date+salt)) */
function solapiAuthHeader_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SOLAPI_KEY');
  var secret = props.getProperty('SOLAPI_SECRET');
  if (!key || !secret) {
    throw new Error('스크립트 속성 SOLAPI_KEY·SOLAPI_SECRET을 먼저 넣어 주세요.');
  }
  var date = new Date().toISOString(); // ISO8601 UTC
  var salt = Utilities.getUuid().replace(/-/g, ''); // 임의 32자
  var bytes = Utilities.computeHmacSha256Signature(date + salt, secret);
  var signature = bytes.map(function (b) {
    var h = (b < 0 ? b + 256 : b).toString(16);
    return (h.length === 1 ? '0' : '') + h;
  }).join('');
  return 'HMAC-SHA256 apiKey=' + key + ', date=' + date + ', salt=' + salt + ', signature=' + signature;
}
