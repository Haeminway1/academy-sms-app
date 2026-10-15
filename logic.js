/**
 * logic.js — 학원 문자 앱 순수 함수 모음.
 * Apps Script 프로젝트에 그대로 붙여 Code.gs에서 부르고,
 * Node에서는 module.exports로 가져와 테스트한다(logic.test.js).
 * ES5만 쓴다(구형 런타임 호환).
 */

var SMS_BYTE_LIMIT = 90;

/** 미출석·예약 문자는 정한 시각 뒤 이 분 안에서만 보낸다(밤늦게 켜도 지난 문자가 몰려 나가지 않게). */
var CATCH_UP_MINUTES = 60;

/** 자동 규칙의 중복 방지 이름. 행 번호 대신 규칙 내용으로 만들어, 위 규칙을 지워도 바뀌지 않는다. */
function ruleKey(rule) {
  return '자동화 ' + [rule.type, rule.cls || '', rule.minutes || '', rule.time || '', rule.days || ''].join('|');
}

/** 요일 글자 '일월화수목금토' — 자릿수가 Date.getDay()(0=일 .. 6=토)와 같다. */
var WEEKDAY_CHARS = '일월화수목금토';

/** EUC-KR 근사 바이트 수: 비ASCII 2바이트, ASCII 1바이트. 90 초과면 LMS 과금. */
function byteLength(text) {
  var s = String(text == null ? '' : text);
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    n += s.charCodeAt(i) > 127 ? 2 : 1;
  }
  return n;
}

/** 90바이트 이하면 'SMS', 넘으면 'LMS'. */
function messageType(text) {
  return byteLength(text) > SMS_BYTE_LIMIT ? 'LMS' : 'SMS';
}

/**
 * {{이름}} 같은 자리표시자를 vars 값으로 치환한다.
 * @returns {{text: string, missing: string[]}}
 *   vars에 키가 없거나 값이 비어 있으면 {{키}}를 그대로 두고 missing에 모은다
 *   (빈 값으로 조용히 지우지 않는다). 같은 키는 missing에 한 번만 담는다.
 */
function fillTemplate(tpl, vars) {
  var missing = [];
  var text = String(tpl == null ? '' : tpl).replace(/\{\{([^{}]+)\}\}/g, function (m, key) {
    key = key.trim();
    if (!key) return m;
    if (vars && vars[key] != null && vars[key] !== '') {
      return String(vars[key]);
    }
    if (missing.indexOf(key) === -1) missing.push(key);
    return m;
  });
  return { text: text, missing: missing };
}

/**
 * 중복 발송 방지 키 '날짜|이름|템플릿|태그'. 발송기록 '키' 열에 쌓인다.
 * 태그는 발송 주체를 가린다: '수동'(직접 보내기)이나 '자동화<행번호>'.
 * 태그를 빼면 옛날 3조각 키 '날짜|이름|템플릿'과 같다.
 */
function dedupKey(date, name, template, tag) {
  var parts = [date, name, template];
  if (tag != null && String(tag) !== '') parts.push(String(tag));
  return parts.join('|');
}

/** '예'·체크박스(true/'TRUE')·y·1·on 을 켜짐으로 본다. */
function isOnValue(v) {
  if (v === true) return true;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '예' || s === 'true' || s === 'y' || s === '1' || s === 'on';
}

/**
 * 켜진 규칙 중 event에 맞는 것만 고른다.
 * @param {Array} rules 자동규칙 탭 한 줄: { on, when, status, minutes, template }
 * @param {string|Object} event '출결 저장'·'미등원' 문자열이거나 { when, status? }.
 *   status가 있으면 규칙의 상태까지 같은 것만 남긴다.
 * @returns {Array} 맞는 규칙 객체들
 */
function matchRules(rules, event) {
  var ev = (event !== null && typeof event === 'object') ? event : { when: event };
  var when = String(ev.when == null ? '' : ev.when).trim();
  var hasStatus = ev.status != null && String(ev.status).trim() !== '';
  var want = hasStatus ? String(ev.status).trim() : null;
  return (rules || []).filter(function (r) {
    if (!r || !isOnValue(r.on)) return false;
    if (String(r.when == null ? '' : r.when).trim() !== when) return false;
    if (hasStatus && String(r.status == null ? '' : r.status).trim() !== want) return false;
    return true;
  });
}

/** 'HH:mm'을 0시 기준 분으로 바꾼다. 해석할 수 없으면 null. */
/** '17:00', '17:00:00', '오후 5:00', '5:00 PM'을 모두 '17:00'으로 맞춘다. 못 읽으면 ''. */
function normalizeHHmm(text) {
  var t = String(text == null ? '' : text).trim();
  var m = /(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return '';
  var h = +m[1];
  if (/오후|PM/i.test(t) && h < 12) h += 12;
  if (/오전|AM/i.test(t) && h === 12) h = 0;
  if (h > 23 || +m[2] > 59) return '';
  return ('0' + h).slice(-2) + ':' + m[2];
}

function hhmmToMinutes(hhmm) {
  var n = normalizeHHmm(hhmm);
  if (!n) return null;
  return (+n.slice(0, 2)) * 60 + (+n.slice(3));
}

/**
 * 수업요일 문자열('월수금'·'화목' 등)이 그 요일을 포함하는지 본다.
 * 비어 있으면 매일 수업으로 본다. weekdayIndex는 0=일 .. 6=토.
 */
function isClassDay(daysText, weekdayIndex) {
  var s = String(daysText == null ? '' : daysText);
  if (s.trim() === '') return true;
  var ch = WEEKDAY_CHARS.charAt(weekdayIndex);
  return ch !== '' && s.indexOf(ch) !== -1;
}

/**
 * 수업시작 + minutes 분이 now를 지났는데 오늘 출결 기록이 없는 학생을 고른다.
 * @param {Array} students [{ name, start, days? }] — start는 'HH:mm',
 *   days는 수업요일 문자열('월수금' 등, 비면 매일 수업)
 * @param {Array} attendanceToday 오늘 출결 행 — { name } 객체 또는 이름 문자열
 * @param {string} nowHHmm 'HH:mm'
 * @param {number} minutes 수업시작 후 기다리는 분
 * @param {number} [weekdayIndex] 오늘 요일(0=일 .. 6=토) — 주면 학생의
 *   수업요일에 그 요일이 없는 학생은 뺀다
 * @returns {Array} 학생 객체들(입력 순서 유지)
 */
function dueNoShows(students, attendanceToday, nowHHmm, minutes, weekdayIndex) {
  var now = hhmmToMinutes(nowHHmm);
  if (now == null) return [];
  var wait = Number(minutes) || 0;
  var attended = {};
  (attendanceToday || []).forEach(function (a) {
    var n = (a !== null && typeof a === 'object') ? a.name : a;
    n = String(n == null ? '' : n).trim();
    if (n) attended[n] = true;
  });
  return (students || []).filter(function (s) {
    if (!s) return false;
    var name = String(s.name == null ? '' : s.name).trim();
    var start = hhmmToMinutes(s.start);
    if (!name || start == null) return false;
    if (start + wait > now) return false;
    if (attended[name]) return false;
    if (weekdayIndex != null && !isClassDay(s.days, weekdayIndex)) return false;
    return true;
  });
}

/** 전화번호에서 숫자만 남긴다(010-1234-5678 → 01012345678). */
function toDigits(phone) {
  return String(phone == null ? '' : phone).replace(/[^0-9]/g, '');
}

/** 시트가 숫자로 바꿔 잃은 휴대폰 번호의 앞 0을 복원한다. */
function normalizePhone(phone) {
  var digits = toDigits(phone);
  if (/^1[0-9]{8,9}$/.test(digits)) digits = '0' + digits;
  return digits;
}

/** 실제 발송에 빠진 설정. 첫 사유는 발송 결과에, 전체는 설정 화면에 쓴다. */
function sendBlockers(solapiOn, keysSet, sender) {
  var blockers = [];
  if (!solapiOn) blockers.push('SOLAPI 사용 꺼짐');
  if (!keysSet) blockers.push('SOLAPI 키 없음');
  if (!/^[0-9]{8,11}$/.test(normalizePhone(sender))) blockers.push('발신번호 없음');
  return blockers;
}

/** 시스템 변수 이름 — 템플릿에서 {{이름}}처럼 쓰고 자동으로 채워진다. */
var SYSTEM_VAR_NAMES = {
  '이름': true, '반': true, '날짜': true, '시각': true,
  '상태': true, '수업시작': true, '학원명': true
};

/**
 * 템플릿 변수 모음: 학생 추가 열(fields) + 변수 탭(userVars) + 시스템 변수.
 * 시스템 변수는 마지막에 넣어 같은 이름의 사용자 변수보다 우선한다.
 * 빈 값은 넣지 않아 {{키}}가 missing 경고로 남는다.
 * @param {Object} [student] { name, cls, phone, fields: {추가열: 값} }
 * @param {Object} [cls] { name, days, start } — 학생이 속한 반(없으면 null)
 * @param {Object} [settings] 설정 탭 맵 { 학원명, ... } 또는 { academy }
 * @param {Object} [userVars] 변수 탭 맵 { 이름: 값 }
 * @param {string} [date] 'yyyy-MM-dd'
 * @param {string} [time] 'HH:mm'
 * @param {string} [status] 출결 상태(없으면 {{상태}}는 missing)
 * @returns {Object} { 변수이름: 값 }
 */
function buildVars(student, cls, settings, userVars, date, time, status) {
  var vars = {};
  function put(k, v) {
    if (k == null) return;
    var key = String(k).trim();
    if (!key) return;
    var s = v == null ? '' : String(v);
    if (s === '') return;
    vars[key] = s;
  }
  var fields = student && student.fields;
  if (fields) {
    for (var fk in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, fk)) put(fk, fields[fk]);
    }
  }
  if (userVars) {
    for (var uk in userVars) {
      if (Object.prototype.hasOwnProperty.call(userVars, uk)) put(uk, userVars[uk]);
    }
  }
  put('이름', student && student.name);
  put('반', (cls && cls.name) || (student && student.cls));
  put('수업시작', cls && cls.start);
  put('학원명', settings && (settings['학원명'] != null ? settings['학원명'] : settings.academy));
  put('날짜', date);
  put('시각', time);
  put('상태', status);
  return vars;
}

/**
 * 자동화 규칙을 한국어 한 문장으로 설명한다.
 * @param {Object} rule { type, minutes?, time?, days?, cls?, template }
 * @returns {string} 예: '중2A 수업 시작 10분 뒤에도 출석이 없으면 「지각 안내」를 보냅니다'
 */
function automationSentence(rule) {
  rule = rule || {};
  var tpl = '「' + String(rule.template == null ? '' : rule.template) + '」를 보냅니다';
  var cls = String(rule.cls == null ? '' : rule.cls).trim();
  var type = String(rule.type == null ? '' : rule.type).trim();
  if (type === '결석 저장 즉시' || type === '지각 저장 즉시') {
    var status = type === '결석 저장 즉시' ? '결석' : '지각';
    return (cls ? cls + ' ' : '') + '출결을 ' + status + '으로 저장하면 바로 ' + tpl;
  }
  if (type === '시작 후 미출석') {
    return (cls ? cls + ' 수업' : '수업') + ' 시작 ' + (Number(rule.minutes) || 0) +
      '분 뒤에도 출석이 없으면 ' + tpl;
  }
  if (type === '예약 발송') {
    var days = String(rule.days == null ? '' : rule.days).trim();
    var time = String(rule.time == null ? '' : rule.time).trim();
    var who = cls ? cls + ' 학생에게' : '전체 학생에게';
    return (days ? '매주 ' + days : '매일') + (time ? ' ' + time : '') + ' ' + who + ' ' + tpl;
  }
  return tpl;
}

/**
 * '시작 후 미출석' 대상: 오늘 수업이 있는 반인데 시작+분이 지나도록
 * 오늘 출결 기록이 없는 학생을 고른다.
 * @param {Array} students [{ name, cls }] — cls는 반 이름
 * @param {Array} classes [{ name, days, start }] — 반 탭
 * @param {Array} attendanceToday 오늘 출결 행 — { name } 객체 또는 이름 문자열
 * @param {string} nowHHmm 'HH:mm'
 * @param {number} minutes 수업 시작 후 기다리는 분
 * @param {number} [weekday] 오늘 요일(0=일 .. 6=토) — 주면 반의 수업요일을 본다
 * @param {string} [clsFilter] 이 반만 본다. ''이면 전체
 * @returns {Array} 학생 객체들(입력 순서 유지)
 */
function dueLate(students, classes, attendanceToday, nowHHmm, minutes, weekday, clsFilter) {
  var now = hhmmToMinutes(nowHHmm);
  if (now == null) return [];
  var wait = Number(minutes) || 0;
  var filter = String(clsFilter == null ? '' : clsFilter).trim();
  var byName = {};
  (classes || []).forEach(function (c) {
    if (c && c.name != null && String(c.name).trim() !== '') {
      byName[String(c.name).trim()] = c;
    }
  });
  var attended = {};
  (attendanceToday || []).forEach(function (a) {
    var n = (a !== null && typeof a === 'object') ? a.name : a;
    n = String(n == null ? '' : n).trim();
    if (n) attended[n] = true;
  });
  return (students || []).filter(function (s) {
    if (!s) return false;
    var name = String(s.name == null ? '' : s.name).trim();
    var clsName = String(s.cls == null ? '' : s.cls).trim();
    if (!name || !clsName) return false;
    if (filter && clsName !== filter) return false;
    if (attended[name]) return false;
    var cls = byName[clsName];
    if (!cls) return false;
    if (weekday != null && !isClassDay(cls.days, weekday)) return false;
    var start = hhmmToMinutes(cls.start);
    if (start == null) return false;
    return start + wait <= now && now < start + wait + CATCH_UP_MINUTES;
  });
}

/**
 * '예약 발송'이 지금 돌 차례인지 본다: 요일이 맞고(rule.days 비면 매일)
 * now >= time이면 true. 하루 한 번 제한은 발송기록 중복 키가 맡는다.
 * @param {Object} rule { time: 'HH:mm', days?: '월수금' }
 * @param {string} nowHHmm 'HH:mm'
 * @param {number} [weekday] 오늘 요일(0=일 .. 6=토)
 * @returns {boolean}
 */
function dueScheduled(rule, nowHHmm, weekday) {
  if (!rule) return false;
  var t = hhmmToMinutes(rule.time);
  var now = hhmmToMinutes(nowHHmm);
  if (t == null || now == null) return false;
  if (now < t || now >= t + CATCH_UP_MINUTES) return false;
  if (weekday != null && !isClassDay(rule.days, weekday)) return false;
  return true;
}

if (typeof module !== 'undefined') {
  module.exports = {
    SMS_BYTE_LIMIT: SMS_BYTE_LIMIT,
    CATCH_UP_MINUTES: CATCH_UP_MINUTES,
    ruleKey: ruleKey,
    byteLength: byteLength,
    messageType: messageType,
    fillTemplate: fillTemplate,
    dedupKey: dedupKey,
    isOnValue: isOnValue,
    matchRules: matchRules,
    hhmmToMinutes: hhmmToMinutes,
    normalizeHHmm: normalizeHHmm,
    isClassDay: isClassDay,
    dueNoShows: dueNoShows,
    toDigits: toDigits,
    normalizePhone: normalizePhone,
    sendBlockers: sendBlockers,
    SYSTEM_VAR_NAMES: SYSTEM_VAR_NAMES,
    buildVars: buildVars,
    automationSentence: automationSentence,
    dueLate: dueLate,
    dueScheduled: dueScheduled
  };
}
