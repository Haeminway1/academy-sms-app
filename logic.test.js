import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 이 패키지는 "type": "module"이라 logic.js를 require할 수 없다.
// GAS에 붙여 쓰는 파일 그대로를 module.exports 경로로 불러와 검증한다.
const src = readFileSync(new URL('./logic.js', import.meta.url), 'utf8');
const moduleStub = { exports: {} };
new Function('module', src)(moduleStub);
const {
  SMS_BYTE_LIMIT,
  byteLength,
  messageType,
  fillTemplate,
  dedupKey,
  isOnValue,
  matchRules,
  hhmmToMinutes,
  isClassDay,
  dueNoShows,
  toDigits,
  normalizePhone,
  sendBlockers,
  SYSTEM_VAR_NAMES,
  buildVars,
  automationSentence,
  dueLate,
  dueScheduled,
  ruleKey,
  normalizeHHmm
} = moduleStub.exports;

const students = [
  { name: '홍길동', cls: '중1 영어A', start: '19:00' },
  { name: '김해민', cls: '중2 수학B', start: '20:00' },
  { name: '오태식', cls: '중2 수학B', start: '20:30' }
];

test('byteLength: ASCII 1바이트, 한글 2바이트', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('홍길동'), 6);
  assert.equal(byteLength('2026-10-15 홍길동'), 17);
  assert.equal(byteLength(''), 0);
  assert.equal(byteLength(null), 0);
});

test('messageType: 정확히 90바이트는 SMS, 91바이트부터 LMS', () => {
  assert.equal(messageType('a'.repeat(90)), 'SMS');
  assert.equal(messageType('a'.repeat(91)), 'LMS');
  assert.equal(messageType('가'.repeat(45)), 'SMS'); // 45*2 = 90
  assert.equal(messageType('가'.repeat(46)), 'LMS'); // 92
});

test('fillTemplate: 알려진 키는 치환하고 missing은 비어 있다', () => {
  const r = fillTemplate('[{{학원명}}] {{이름}} 학생이 {{반}} 수업에 결석했습니다.', {
    '학원명': '해민영어', '이름': '홍길동', '반': '중1 영어A'
  });
  assert.equal(r.text, '[해민영어] 홍길동 학생이 중1 영어A 수업에 결석했습니다.');
  assert.deepEqual(r.missing, []);
});

test('fillTemplate: 모르는 키는 그대로 두고 missing에 한 번씩 담는다', () => {
  const r = fillTemplate('{{없는키}} {{없는키}} {{또없는키}}', { '이름': '홍길동' });
  assert.equal(r.text, '{{없는키}} {{없는키}} {{또없는키}}');
  assert.deepEqual(r.missing, ['없는키', '또없는키']);
});

test('fillTemplate: 괄호 안 공백은 다듬고, 값 0은 "0"으로 넣는다', () => {
  assert.equal(fillTemplate('{{ 이름 }}', { '이름': '김해민' }).text, '김해민');
  assert.equal(fillTemplate('{{벌점}}', { '벌점': 0 }).text, '0');
});

test('fillTemplate: 학생 탭에 추가한 열(교재·다음시험)도 변수로 쓴다', () => {
  const r = fillTemplate('{{이름}} {{교재}} p.{{쪽수}} / 다음 시험 {{다음시험}}', {
    '이름': '오태식', '교재': '개념원리', '쪽수': 42, '다음시험': '2026-10-22'
  });
  assert.equal(r.text, '오태식 개념원리 p.42 / 다음 시험 2026-10-22');
  assert.deepEqual(r.missing, []);
});

test('fillTemplate: 빈 값은 missing으로 잡아 조용히 지우지 않는다', () => {
  const r = fillTemplate('{{이름}} {{메모}}', { '이름': '홍길동', '메모': '' });
  assert.equal(r.text, '홍길동 {{메모}}');
  assert.deepEqual(r.missing, ['메모']);
});

test('dedupKey: 날짜|이름|템플릿', () => {
  assert.equal(dedupKey('2026-10-15', '홍길동', '결석'), '2026-10-15|홍길동|결석');
  assert.notEqual(dedupKey('2026-10-15', '홍길동', '결석'), dedupKey('2026-10-15', '홍길동', '미등원'));
});

test('matchRules: 문자열 이벤트는 켜진 규칙+같은 언제만 고른다', () => {
  const rules = [
    { on: true, when: '출결 저장', status: '결석', minutes: 0, template: '결석' },
    { on: '아니오', when: '출결 저장', status: '결석', minutes: 0, template: '결석안내' },
    { on: '예', when: '미등원', status: '미등원', minutes: 10, template: '미등원' }
  ];
  const hit = matchRules(rules, '출결 저장');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].template, '결석');
  assert.equal(matchRules(rules, '미등원').length, 1);
  assert.equal(matchRules(rules, '하원').length, 0);
});

test('matchRules: 객체 이벤트는 상태까지 같은 것만 고른다', () => {
  const rules = [
    { on: '예', when: '출결 저장', status: '결석', minutes: 0, template: '결석' },
    { on: '예', when: '출결 저장', status: '등원', minutes: 0, template: '등원' },
    { on: '예', when: '미등원', status: '미등원', minutes: 15, template: '미등원' }
  ];
  const hit = matchRules(rules, { when: '출결 저장', status: '결석' });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].template, '결석');
});

test('isOnValue/hhmmToMinutes/toDigits 헬퍼', () => {
  assert.equal(isOnValue('예'), true);
  assert.equal(isOnValue(true), true);
  assert.equal(isOnValue('TRUE'), true); // 체크박스
  assert.equal(isOnValue('아니오'), false);
  assert.equal(isOnValue(''), false);
  assert.equal(hhmmToMinutes('19:30'), 1170);
  assert.equal(hhmmToMinutes('19시'), null);
  assert.equal(toDigits('010-1111-2222'), '01011112222');
});

test('dueNoShows: 기준(수업시작+분) 전에는 없고, 딱 되는 순간부터 나온다', () => {
  assert.deepEqual(dueNoShows(students, [], '19:09', 10), []); // 19:00+10=19:10 전
  const hit = dueNoShows(students, [], '19:10', 10);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, '홍길동'); // 19:10은 기준에 포함(<=)
  assert.equal(dueNoShows(students, [], '20:10', 10).length, 2); // 홍길동·김해민
});

test('dueNoShows: 오늘 출결 행이 있는 학생은 제외한다', () => {
  const attendance = [{ name: '홍길동', status: '등원' }, '김해민'];
  const hit = dueNoShows(students, attendance, '21:00', 10);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, '오태식');
});

test('dueNoShows: 수업시작 없는 학생·해석 불가 now는 안전하게 걸러진다', () => {
  const list = [{ name: '홍길동', start: '' }, { name: '김해민', start: '19:00' }, { name: '', start: '19:00' }];
  const hit = dueNoShows(list, [], '20:00', 10);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].name, '김해민');
  assert.deepEqual(dueNoShows(students, [], '열시', 10), []);
  assert.deepEqual(dueNoShows(null, null, '20:00', 10), []);
});

test('isClassDay: 비어 있으면 매일 수업이다', () => {
  assert.equal(isClassDay('', 1), true);
  assert.equal(isClassDay('   ', 3), true);
  assert.equal(isClassDay(null, 5), true);
  assert.equal(isClassDay(undefined, 0), true);
});

test('isClassDay: 그 요일 글자가 있어야 수업일이다', () => {
  assert.equal(isClassDay('월수금', 1), true);  // 월
  assert.equal(isClassDay('월수금', 3), true);  // 수
  assert.equal(isClassDay('월수금', 5), true);  // 금
  assert.equal(isClassDay('월수금', 2), false); // 화
  assert.equal(isClassDay('화목', 4), true);    // 목
  assert.equal(isClassDay('화목', 0), false);   // 일
});

test('isClassDay: 공백 섞인 표기·범위 밖 요일도 안전하게 다룬다', () => {
  assert.equal(isClassDay('월 수 금', 3), true);
  assert.equal(isClassDay('월수금', 7), false);
  assert.equal(isClassDay('월수금', -1), false);
});

test('dueNoShows: weekdayIndex가 있으면 수업요일이 아닌 학생을 건너뛴다', () => {
  const list = [
    { name: '홍길동', start: '19:00', days: '월수금' },
    { name: '김해민', start: '19:00', days: '화목' },
    { name: '오태식', start: '19:00', days: '' }
  ];
  assert.deepEqual(dueNoShows(list, [], '20:00', 10, 3).map(s => s.name), ['홍길동', '오태식']); // 수요일
  assert.deepEqual(dueNoShows(list, [], '20:00', 10, 2).map(s => s.name), ['김해민', '오태식']); // 화요일
});

test('dueNoShows: weekdayIndex가 없으면 수업요일을 보지 않는다', () => {
  const list = [{ name: '홍길동', start: '19:00', days: '월수금' }];
  assert.equal(dueNoShows(list, [], '20:00', 10).length, 1);        // 인자 생략
  assert.equal(dueNoShows(list, [], '20:00', 10, null).length, 1); // null도 생략과 같다
});

// ---------- 새 구조: 반·학생·템플릿·변수·자동화 ----------

const classes = [
  { name: '중2A', days: '월수금', start: '16:00' },
  { name: '중3B', days: '화목', start: '17:00' }
];
const studentsByClass = [
  { name: '홍길동', cls: '중2A', phone: '010-0000-0001', fields: { '메모': '', '다음시험': '11월 모의고사' } },
  { name: '김해민', cls: '중2A', phone: '010-0000-0002', fields: { '다음시험': '11월 모의고사' } },
  { name: '오태식', cls: '중3B', phone: '010-0000-0003', fields: {} },
  { name: '장첸', cls: '중3B', phone: '010-0000-0004', fields: {} }
];

test('dedupKey: 태그를 붙이면 4조각, 빼면 옛 3조각 키와 같다', () => {
  assert.equal(dedupKey('2026-10-15', '홍길동', '지각 안내', '수동'), '2026-10-15|홍길동|지각 안내|수동');
  assert.equal(dedupKey('2026-10-15', '홍길동', '지각 안내', '자동화3'), '2026-10-15|홍길동|지각 안내|자동화3');
  assert.equal(dedupKey('2026-10-15', '홍길동', '지각 안내'), '2026-10-15|홍길동|지각 안내');
  assert.equal(dedupKey('2026-10-15', '홍길동', '지각 안내', ''), '2026-10-15|홍길동|지각 안내');
});

test('buildVars: 시스템 변수·추가 열·사용자 변수를 한 맵으로 모은다', () => {
  const vars = buildVars(
    studentsByClass[0], classes[0],
    { '학원명': '해민영어' }, { '학원전화': '02-000-0000' },
    '2026-10-15', '16:10', '결석'
  );
  assert.equal(vars['이름'], '홍길동');
  assert.equal(vars['반'], '중2A');
  assert.equal(vars['수업시작'], '16:00');
  assert.equal(vars['학원명'], '해민영어');
  assert.equal(vars['날짜'], '2026-10-15');
  assert.equal(vars['시각'], '16:10');
  assert.equal(vars['상태'], '결석');
  assert.equal(vars['다음시험'], '11월 모의고사');
  assert.equal(vars['학원전화'], '02-000-0000');
});

test('buildVars: 빈 값·없는 값은 넣지 않아 missing으로 남는다', () => {
  const vars = buildVars(
    { name: '오태식', cls: '중3B', fields: { '메모': '' } }, classes[1],
    { '학원명': '해민영어' }, null, '2026-10-15', '17:00', null
  );
  assert.equal('메모' in vars, false);
  assert.equal('상태' in vars, false);
  const r = fillTemplate('{{이름}} {{메모}} {{상태}}', vars);
  assert.deepEqual(r.missing, ['메모', '상태']);
});

test('buildVars: 시스템 변수는 같은 이름의 사용자 변수를 덮는다', () => {
  const vars = buildVars(
    studentsByClass[0], classes[0],
    { academy: '해민영어' }, { '이름': '가짜', '학원명': '다른학원' },
    '2026-10-15', '16:10', null
  );
  assert.equal(vars['이름'], '홍길동');
  assert.equal(vars['학원명'], '해민영어'); // settings.academy 도 읽는다
});

test('buildVars: 반 정보가 없으면 학생의 반 이름만 쓰고 수업시작은 비워 둔다', () => {
  const vars = buildVars({ name: '장첸', cls: '중3B', fields: {} }, null,
    {}, null, '2026-10-15', '17:00', null);
  assert.equal(vars['반'], '중3B');
  assert.equal('수업시작' in vars, false);
});

test('automationSentence: 저장 즉시 규칙을 문장으로 푼다', () => {
  assert.equal(
    automationSentence({ type: '결석 저장 즉시', template: '결석 안내' }),
    '출결을 결석으로 저장하면 바로 「결석 안내」를 보냅니다');
  assert.equal(
    automationSentence({ type: '지각 저장 즉시', cls: '중2A', template: '지각 안내' }),
    '중2A 출결을 지각으로 저장하면 바로 「지각 안내」를 보냅니다');
});

test('automationSentence: 시작 후 미출석·예약 발송 문장', () => {
  assert.equal(
    automationSentence({ type: '시작 후 미출석', minutes: 10, cls: '중2A', template: '지각 안내' }),
    '중2A 수업 시작 10분 뒤에도 출석이 없으면 「지각 안내」를 보냅니다');
  assert.equal(
    automationSentence({ type: '시작 후 미출석', minutes: 5, template: '지각 안내' }),
    '수업 시작 5분 뒤에도 출석이 없으면 「지각 안내」를 보냅니다');
  assert.equal(
    automationSentence({ type: '예약 발송', time: '18:00', days: '금', template: '시험 안내' }),
    '매주 금 18:00 전체 학생에게 「시험 안내」를 보냅니다');
  assert.equal(
    automationSentence({ type: '예약 발송', time: '18:00', days: '', cls: '중3B', template: '시험 안내' }),
    '매일 18:00 중3B 학생에게 「시험 안내」를 보냅니다');
});

test('dueLate: 시작+분이 지난 반의 무기록 학생만 고른다', () => {
  // 수요일(3): 중2A만 수업. 16:10 = 16:00 + 10분
  assert.deepEqual(dueLate(studentsByClass, classes, [], '16:09', 10, 3, ''), []);
  const hit = dueLate(studentsByClass, classes, [], '16:10', 10, 3, '');
  assert.deepEqual(hit.map(s => s.name), ['홍길동', '김해민']);
  // 화요일(2): 중3B만 수업. 17:10 이후
  assert.deepEqual(
    dueLate(studentsByClass, classes, [], '17:10', 10, 2, '').map(s => s.name),
    ['오태식', '장첸']);
});

test('dueLate: 출결 행이 있는 학생·clsFilter 밖 학생은 뺀다', () => {
  const attendance = [{ name: '홍길동', status: '지각' }];
  assert.deepEqual(
    dueLate(studentsByClass, classes, attendance, '16:30', 10, 3, '').map(s => s.name),
    ['김해민']);
  assert.deepEqual(
    dueLate(studentsByClass, classes, [], '17:30', 10, null, '중3B').map(s => s.name),
    ['오태식', '장첸']);
  assert.deepEqual(dueLate(studentsByClass, classes, [], '17:30', 10, null, '없는반'), []);
});

test('dueLate: 반 없는 학생·시작 시각 없는 반·해석 불가 now는 안전하게 걸러진다', () => {
  const list = [
    { name: '홍길동', cls: '중2A' },
    { name: '김해민', cls: '없는반' },
    { name: '오태식', cls: '중3B' },
    { name: '', cls: '중2A' }
  ];
  const noStart = [{ name: '중2A', days: '', start: '' }, { name: '중3B', days: '', start: '17:00' }];
  assert.deepEqual(
    dueLate(list, noStart, [], '17:30', 10, null, '').map(s => s.name), ['오태식']);
  assert.deepEqual(dueLate(studentsByClass, classes, [], '열시', 10, 3, ''), []);
  assert.deepEqual(dueLate(null, null, null, '17:30', 10, null, ''), []);
});

test('dueScheduled: 요일이 맞고 시각이 지났을 때만 true', () => {
  const rule = { time: '18:00', days: '금' };
  assert.equal(dueScheduled(rule, '17:59', 5), false); // 금요일 아직 이전
  assert.equal(dueScheduled(rule, '18:00', 5), true);  // 정각 포함
  assert.equal(dueScheduled(rule, '18:05', 5), true);
  assert.equal(dueScheduled(rule, '20:00', 4), false); // 목요일은 수업일 아님
  assert.equal(dueScheduled({ time: '18:00', days: '' }, '18:30', 0), true);  // 비면 매일
  assert.equal(dueScheduled({ time: '', days: '' }, '18:30', 5), false);      // 시각 필수
  assert.equal(dueScheduled(null, '18:30', 5), false);
});

test('SYSTEM_VAR_NAMES: 일곱 개 시스템 변수 이름을 담는다', () => {
  ['이름', '반', '날짜', '시각', '상태', '수업시작', '학원명'].forEach(k => {
    assert.equal(SYSTEM_VAR_NAMES[k], true);
  });
  assert.equal(SYSTEM_VAR_NAMES['다음시험'], undefined);
});

test('미출석·예약은 정한 시각 뒤 60분 안에서만 보낸다', () => {
  assert.deepEqual(dueLate(studentsByClass, classes, [], '17:09', 10, 3, '').map(s => s.name), ['홍길동', '김해민']);
  assert.deepEqual(dueLate(studentsByClass, classes, [], '17:10', 10, 3, ''), []);
  assert.equal(dueScheduled({ time: '18:00', days: '' }, '18:59', 5), true);
  assert.equal(dueScheduled({ time: '18:00', days: '' }, '19:00', 5), false);
  assert.equal(dueScheduled({ time: '18:00', days: '' }, '23:00', 5), false);
});

test('ruleKey: 행 번호가 아니라 규칙 내용으로 정해진다', () => {
  const a = { row: 3, type: '시작 후 미출석', cls: '중2A', minutes: 10, template: '지각 안내' };
  assert.equal(ruleKey(a), ruleKey({ ...a, row: 2 }));
  assert.notEqual(ruleKey(a), ruleKey({ ...a, minutes: 15 }));
});

test('normalizePhone: 숫자형 셀의 앞 0 복원과 번호 경계', () => {
  for (const [input, expected] of [
    [1072367106, '01072367106'], [101234567, '0101234567'],
    ['010-1234-5678', '01012345678'], ['02-123-4567', '021234567'],
    ['1588-1234', '15881234'], ['12345678', '12345678'],
    ['12345678901', '12345678901'], [null, ''], ['', ''],
    ['(Solapi에 등록한 번호)', '']
  ]) assert.equal(normalizePhone(input), expected, String(input));
});

test('sendBlockers: 꺼짐·키·발신번호 사유를 모두 알리고 정상 설정은 통과', () => {
  assert.deepEqual(sendBlockers(false, false, ''), ['SOLAPI 사용 꺼짐', 'SOLAPI 키 없음', '발신번호 없음']);
  assert.deepEqual(sendBlockers(true, false, '01011112222'), ['SOLAPI 키 없음']);
  for (const sender of ['', '(Solapi에 등록한 번호)', '1234567', '010123456789']) {
    assert.deepEqual(sendBlockers(true, true, sender), ['발신번호 없음']);
  }
  for (const sender of ['1588-1234', '02-123-4567', 1072367106, 101234567]) {
    assert.deepEqual(sendBlockers(true, true, sender), []);
  }
});

function gasApp(options = {}) {
  const tabs = {
    '설정': [['항목', '값'], ['학원명', '첫 이름'], ['학원명', '옛 이름'], ['발신번호', '01011112222'], ['SOLAPI 사용', '아니오']],
    '반': [['반', '요일', '시작'], ['A', '', '16:00']],
    '학생': [['이름', '반', '학부모번호'], ['홍길동', 'A', '01012345678']],
    '출결': [['날짜', '이름', '반', '상태', '시각']],
    '템플릿': [['이름', '내용', '메모'], ['결석', '[{{학원명}}] {{이름}} {{상태}}', '']],
    '변수': [['이름', '값', '메모'], ['공지', '안내', '']],
    '자동화': [['켜기', '종류', '분', '시각', '요일', '반', '템플릿'], ['예', '결석 저장 즉시', '', '', '', '', '결석']],
    '발송기록': [['시각', '이름', '번호', '템플릿', '내용', '결과', '키']]
  };
  const props = options.props || {};
  const formats = [], requests = [];
  function sheet(name) {
    const data = tabs[name];
    if (!data) return null;
    return {
      getDataRange: () => ({ getValues: () => data.map(row => row.slice()) }),
      getLastRow: () => data.length,
      getLastColumn: () => data[0]?.length || 0,
      getMaxRows: () => 1000,
      getMaxColumns: () => 26,
      setFrozenRows() {},
      appendRow: row => data.push(row.slice()),
      deleteRow: row => data.splice(row - 1, 1),
      getRange: (row, col, height = 1, width = 1) => ({
        setNumberFormat(format) { formats.push({ name, row, col, height, width, format }); return this; },
        setFontWeight() { return this; },
        getValues: () => Array.from({ length: height }, (_, i) =>
          Array.from({ length: width }, (_, j) => data[row - 1 + i]?.[col - 1 + j] ?? '')),
        setValue(value) { data[row - 1][col - 1] = value; return this; },
        setValues(values) {
          values.forEach((cells, i) => cells.forEach((value, j) => {
            if (!data[row - 1 + i]) data[row - 1 + i] = [];
            data[row - 1 + i][col - 1 + j] = value;
          }));
          return this;
        }
      })
    };
  }
  const code = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');
  const api = new Function('SpreadsheetApp', 'PropertiesService', 'LockService', 'Session', 'Utilities', 'ScriptApp', 'UrlFetchApp',
    src + '\n' + code + '\nreturn {getApp, setupSheets, saveStudent, saveSettings, saveAttendance, getAttendance, saveClass, saveTemplate, saveVariable, previewTemplate, sendMessages, previewMessages, runAutomations, getLog};')(
    { getActiveSpreadsheet: () => ({ getSheetByName: sheet, getId: () => 'test-sheet', toast() {},
      insertSheet(name) { tabs[name] = []; return sheet(name); } }) },
    { getScriptProperties: () => ({ getProperty: key => props[key] || null, setProperty: (key, value) => { props[key] = value; } }) },
    { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    { getScriptTimeZone: () => 'Asia/Seoul' },
    { formatDate: (_date, _tz, format) => format === 'HH:mm' ? '16:05' : '2026-10-15',
      getUuid: () => 'test-uuid', computeHmacSha256Signature: () => [1, 2, 3] },
    { getProjectTriggers: () => [] },
    { fetch(url, input) {
      requests.push({ url, ...JSON.parse(input.payload) });
      return { getResponseCode: () => options.httpCode || 200,
        getContentText: () => JSON.stringify(options.body || {}) };
    } }
  );
  return { api, tabs, props, formats, requests, options };
}

test('GAS: 중복 설정 행도 저장 후 getApp·학원명 미리보기에 즉시 반영, 재저장 불변', () => {
  const { api, tabs } = gasApp();
  const settings = { academy: '새 학원', sender: '01011112222', solapiOn: false };
  api.saveSettings(settings);
  assert.equal(api.getApp().academy, '새 학원');
  assert.equal(api.getApp().settings.academy, '새 학원');
  assert.equal(api.previewTemplate('{{학원명}}', '홍길동').text, '새 학원');
  assert.equal(tabs['설정'].filter(row => row[0] === '학원명').length, 1);
  const saved = JSON.stringify(tabs);
  api.saveSettings(settings);
  assert.equal(JSON.stringify(tabs), saved);
});

test('GAS: 학생 생성·수정은 학부모번호 열을 일반 텍스트로, 숫자형 셀은 읽을 때 복원', () => {
  const { api, tabs, formats } = gasApp();
  delete tabs['학생'];
  api.setupSheets();
  assert.ok(formats.some(f => f.name === '학생' && f.col === 3 && f.height === 1000 && f.format === '@'));
  tabs['학생'] = [['반', '학부모번호', '이름'], ['A', 1072367106, '홍길동']];
  assert.equal(api.getApp().students[0].phone, '01072367106');
  for (const name of ['홍길동', '새 학생']) {
    api.saveStudent({ name, cls: 'A', phone: 101234567 });
    const row = tabs['학생'].find(r => r[2] === name);
    assert.equal(row[1], '0101234567');
  }
  assert.ok(formats.some(f => f.name === '학생' && f.col === 2 && f.height === 1000 && f.format === '@'));
});

test('GAS: 사용 켜짐·키 일부 누락·발신번호 자리표시자의 사유가 설정과 발송 결과에 나온다', () => {
  const f = gasApp();
  f.tabs['템플릿'][1][1] = '{{이름}} 안내';
  const save = sender => f.api.saveSettings({ academy: '학원', sender, solapiOn: true });
  const result = save('(Solapi에 등록한 번호)');
  assert.equal(result.sendReady, false);
  assert.deepEqual(result.sendBlockers, ['SOLAPI 키 없음', '발신번호 없음']);
  assert.match(result.note, /SOLAPI 키 없음.*발신번호 없음/);
  for (const props of [{}, { SOLAPI_KEY: 'test-key' }, { SOLAPI_SECRET: 'test-secret' }]) {
    delete f.props.SOLAPI_KEY; delete f.props.SOLAPI_SECRET;
    Object.assign(f.props, props);
    assert.equal(f.api.getApp().settings.keysSet, false);
    assert.equal(f.api.sendMessages('결석', ['홍길동'])[0].result, '시험(미발송): SOLAPI 키 없음');
  }
  Object.assign(f.props, { SOLAPI_KEY: 'test-key', SOLAPI_SECRET: 'test-secret' });
  for (const sender of ['', '(Solapi에 등록한 번호)', '1234567', '010123456789']) {
    save(sender);
    assert.equal(f.api.sendMessages('결석', ['홍길동'])[0].result, '시험(미발송): 발신번호 없음');
  }
  assert.equal(f.requests.length, 0);
  assert.equal(f.api.getLog()[0].result, '시험(미발송): 발신번호 없음');
  assert.equal(save(1072367106).sendReady, true);
  assert.equal(f.api.getApp().settings.sender, '01072367106');
  assert.deepEqual(f.api.getApp().settings.sendBlockers, []);
});

test('GAS: 시험·실패 후 같은 날 실제 접수 가능, 접수 뒤 자동·수동 각각 중복 차단', () => {
  const f = gasApp();
  f.tabs['템플릿'].push(['안내', '{{이름}} 안내', '']);
  f.tabs['학생'][1][2] = 1072367106;
  const auto = () => f.api.saveAttendance('2026-10-15', [{ name: '홍길동', status: '결석' }]).sent[0].result;
  const manual = () => f.api.sendMessages('안내', ['홍길동', '홍길동']).map(r => r.result);
  assert.equal(auto(), '시험(미발송): SOLAPI 사용 꺼짐');
  assert.deepEqual(manual(), ['시험(미발송): SOLAPI 사용 꺼짐', '시험(미발송): SOLAPI 사용 꺼짐']);
  Object.assign(f.props, { SOLAPI_KEY: 'test-key', SOLAPI_SECRET: 'test-secret' });
  f.api.saveSettings({ academy: '학원', sender: 1072367106, solapiOn: true });
  f.options.httpCode = 500;
  assert.equal(auto(), '실패: HTTP 500');
  assert.deepEqual(manual(), ['실패: HTTP 500', '실패: HTTP 500']);
  f.options.httpCode = 200;
  assert.equal(auto(), '접수');
  assert.equal(auto(), '중복 건너뜀');
  assert.deepEqual(manual(), ['접수', '중복 건너뜀']);
  assert.equal(f.api.previewMessages('안내', ['홍길동'])[0].duplicate, true);
  assert.ok(f.requests.every(r => r.messages[0].to === '01072367106' && r.messages[0].from === '01072367106'));
});

test('GAS: 옛 시험·실패 키는 무시하고 접수·보류 키만 유지한다', () => {
  for (const [result, duplicate] of [['시험(미발송)', false], ['시험(미발송): SOLAPI 키 없음', false],
    ['실패: HTTP 500', false], ['접수', true], ['보류: 빈 변수 메모', true], ['', false]]) {
    const { api, tabs } = gasApp();
    tabs['발송기록'].push(['2026-10-15', '홍길동', '', '결석', '', result, '2026-10-15|홍길동|결석|수동']);
    assert.equal(api.previewMessages('결석', ['홍길동'])[0].duplicate, duplicate, result);
  }
});

test('GAS: 예약 자동화도 시험·실패 후 재시도하고 빈 변수 보류는 하루 한 번 기록', () => {
  const f = gasApp();
  f.tabs['템플릿'].push(['예약', '{{이름}} 안내', '']);
  f.tabs['자동화'] = [f.tabs['자동화'][0], ['예', '예약 발송', '', '16:00', '', '', '예약']];
  f.api.runAutomations(); f.api.runAutomations();
  assert.equal(f.tabs['발송기록'].length, 3);
  Object.assign(f.props, { SOLAPI_KEY: 'test-key', SOLAPI_SECRET: 'test-secret' });
  f.api.saveSettings({ sender: '01011112222', solapiOn: true });
  f.options.httpCode = 500;
  f.api.runAutomations();
  f.options.httpCode = 200;
  f.api.runAutomations(); f.api.runAutomations();
  assert.deepEqual(f.tabs['발송기록'].slice(1).map(r => r[5]), [
    '시험(미발송): SOLAPI 사용 꺼짐', '시험(미발송): SOLAPI 사용 꺼짐', '실패: HTTP 500', '접수'
  ]);
  f.tabs['템플릿'][2][1] = '{{메모}}';
  f.tabs['발송기록'] = [f.tabs['발송기록'][0]];
  f.api.runAutomations(); f.api.runAutomations();
  assert.equal(f.tabs['발송기록'].length, 2);
  assert.equal(f.tabs['발송기록'][1][5], '보류: 빈 변수 메모');
  f.api.saveStudent({ name: '홍길동', cls: 'A', phone: '01012345678', fields: { '메모': '채움' } });
  f.api.runAutomations();
  assert.equal(f.tabs['발송기록'][2][5], '접수');
});

test('GAS: 날짜+학생 출결 upsert, 결석→등원, 시험 문자는 다시 처리', () => {
  const { api, tabs } = gasApp();
  const save = status => api.saveAttendance('2026-10-15', [{ name: '홍길동', status }]);
  assert.equal(save('결석').sent[0].result, '시험(미발송): SOLAPI 사용 꺼짐');
  assert.equal(save('결석').sent[0].result, '시험(미발송): SOLAPI 사용 꺼짐');
  save('등원');
  assert.equal(tabs['출결'].length, 2);
  assert.equal(api.getAttendance('2026-10-15', '')[0].status, '등원');
  assert.equal(tabs['발송기록'].length, 3);
  api.saveAttendance('2026-10-14', '홍길동', '결석');
  assert.equal(tabs['출결'].length, 3);
  assert.equal(tabs['발송기록'].length, 3);
});

test('GAS: 기존 출결 중복도 해당 날짜·학생만 정리, 잘못된 묶음은 쓰기 전 거절', () => {
  const { api, tabs } = gasApp();
  tabs['출결'].push(['2026-10-14', '홍길동', 'A', '결석', '16:00'],
    ['2026-10-15', '홍길동', 'A', '결석', '16:01'],
    ['2026-10-15', '홍길동', 'A', '지각', '16:02']);
  api.saveAttendance('2026-10-15', [{ name: '홍길동', status: '등원' }, { name: '홍길동', status: '지각' }]);
  assert.equal(tabs['출결'].length, 3);
  assert.equal(api.getAttendance('2026-10-15', '')[0].status, '지각');
  assert.equal(tabs['출결'][1][3], '결석');
  const before = JSON.stringify(tabs);
  assert.throws(() => api.saveAttendance('2026-10-15', [
    { name: '홍길동', status: '등원' }, { name: '없는 학생', status: '결석' }
  ]), /없는 학생/);
  assert.equal(JSON.stringify(tabs), before);
});

test('GAS: 설정 열 위치가 바뀌어도 항목·값 머리글에 맞춰 저장한다', () => {
  const { api, tabs } = gasApp();
  tabs['설정'].forEach(row => row.reverse());
  api.saveSettings({ academy: '열 바꾼 학원', sender: '010', solapiOn: false });
  assert.equal(api.getApp().academy, '열 바꾼 학원');
  assert.equal(tabs['설정'].length, 4);
});

test('GAS: 반·템플릿 재저장 불변, 이름 변경의 참조 전파와 변수 경고', () => {
  const { api, tabs } = gasApp();
  const cls = { name: 'B', originalName: 'A', days: '', start: '16:00' };
  api.saveClass(cls);
  assert.equal(api.getApp().students[0].cls, 'B');
  const tpl = { name: '새 결석', originalName: '결석', body: '{{ 공지 }}', note: '' };
  api.saveTemplate(tpl);
  assert.equal(api.getApp().automations[0].template, '새 결석');
  const saved = JSON.stringify(tabs);
  api.saveClass(cls);
  api.saveTemplate(tpl);
  api.saveClass({ ...cls, originalName: 'B' });
  api.saveTemplate({ ...tpl, originalName: '새 결석' });
  assert.equal(JSON.stringify(tabs), saved);
  assert.match(api.saveVariable({ name: '새 공지', originalName: '공지', value: '안내' }).note, /공지/);
});

function previewApi() {
  const html = readFileSync(new URL('./preview.html', import.meta.url), 'utf8');
  const script = html.match(/<script id="gasStub">([\s\S]*?)<\/script>/)[1];
  const win = {};
  new Function('window', 'setTimeout', script)(win, queueMicrotask);
  return (fn, ...args) => new Promise((resolve, reject) => {
    win.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
  });
}

test('데모 API: 설정·템플릿·반 재저장과 이름 변경, 변수 경고', async () => {
  const call = previewApi();
  const settings = { academy: '  새 학원  ', sender: '01011112222', solapiOn: false };
  await call('saveSettings', settings);
  await call('saveSettings', settings);
  assert.equal((await call('getApp')).academy, '새 학원');
  assert.equal((await call('previewTemplate', '{{학원명}}', '홍길동')).text, '새 학원');
  const cls = { name: '새 반', originalName: '중2A', days: '', start: '16:00' };
  const tpl = { name: '새 결석', originalName: '결석 안내', body: '{{ 학원전화 }}', note: '' };
  await call('saveClass', cls);
  await call('saveTemplate', tpl);
  const before = await call('getApp');
  await call('saveClass', cls);
  await call('saveTemplate', tpl);
  assert.deepEqual(await call('getApp'), before);
  assert.equal(before.students[0].cls, '새 반');
  assert.equal(before.automations[0].template, '새 결석');
  assert.match((await call('saveVariable', { name: '새 전화', originalName: '학원전화', value: '02' })).note, /학원전화/);
});

test('데모 API: 시험 모드 상태·켜기 저장 안내·전화번호 보정이 실제 앱과 같다', async () => {
  const call = previewApi();
  assert.deepEqual((await call('getApp')).settings.sendBlockers, ['SOLAPI 사용 꺼짐', 'SOLAPI 키 없음']);
  const saved = await call('saveSettings', { academy: '학원', sender: '(Solapi에 등록한 번호)', solapiOn: true });
  assert.equal(saved.sendReady, false);
  assert.deepEqual(saved.sendBlockers, ['SOLAPI 키 없음', '발신번호 없음']);
  assert.match(saved.note, /아직 실제 발송할 수 없습니다/);
  await call('saveStudent', { name: '홍길동', cls: '중2A', phone: 1072367106 });
  assert.equal((await call('getApp')).students[0].phone, '01072367106');
  assert.equal((await call('sendMessages', '결석 안내', ['홍길동']))[0].result, '시험(미발송): SOLAPI 키 없음');
});

test('데모 API: 출결 upsert·지난 날짜·트리거 꺼짐·수동/자동 별도 중복 키', async () => {
  const call = previewApi();
  const { today } = await call('getApp');
  await call('saveClass', { name: '중2A', days: '', start: '16:00' });
  await call('setAutomationRunning', false);
  const save = status => call('saveAttendance', today, [{ name: '홍길동', status }]);
  assert.equal((await save('결석')).sent[0].result, '시험(미발송): SOLAPI 사용 꺼짐');
  assert.equal((await save('결석')).sent[0].result, '시험(미발송): SOLAPI 사용 꺼짐');
  await save('등원');
  assert.equal((await call('getAttendance', today, '중2A'))[0].status, '등원');
  const manual = await call('sendMessages', '결석 안내', ['홍길동']);
  assert.equal(manual[0].result, '시험(미발송): SOLAPI 사용 꺼짐');
  assert.equal((await call('sendMessages', '결석 안내', ['홍길동']))[0].result, '시험(미발송): SOLAPI 사용 꺼짐');
  const past = await call('saveAttendance', '2000-01-01', '홍길동', '결석');
  assert.deepEqual(past.sent, []);
  assert.match(past.note, /지난 날짜/);
});

function syncClient() {
  const script = readFileSync(new URL('./Index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = {}, handlers = {}, timers = new Map(), calls = [], views = [];
  function node(id) {
    if (!nodes[id]) nodes[id] = {
      value: '', checked: false, disabled: false, hidden: false, textContent: '', tagName: 'INPUT',
      setAttribute(key, value) { this[key] = value; },
      getAttribute(key) { return this[key]; },
      querySelectorAll() { return []; },
      classList: { toggle() {} }
    };
    return nodes[id];
  }
  const card = node('settingsCard');
  const controls = ['setAcademy', 'setSender', 'setSolapi'].map(node);
  node('setSolapi').type = 'checkbox';
  node('setSave').parentElement = card;
  card.querySelectorAll = () => controls;
  const names = [node('sideName'), node('topName')];
  const doc = {
    hidden: false, title: '', getElementById: node,
    querySelectorAll(selector) {
      if (selector === '.academyName') return names;
      if (selector === '[data-editor]') return card['data-editor'] ? [card] : [];
      return [node('setSave'), node('tplDel'), node('autoRun')];
    },
    addEventListener: (name, fn) => { handlers[name] = fn; }
  };
  const state = {
    academy: '처음 학원', today: '2026-10-15', templates: [{ name: '안내', body: '{{학원명}}' }],
    settings: { academy: '처음 학원', sender: '010', solapiOn: false }, automationRunning: false
  };
  let fail = '', release;
  const server = fn => {
    calls.push(fn);
    if (fn === fail) return Promise.reject(new Error('실패 예시'));
    if (fn === 'getApp') return Promise.resolve(structuredClone(state));
    return new Promise(resolve => { release = () => resolve({ ok: true, row: 2 }); });
  };
  const start = script.slice(0, script.indexOf('/* ----- 페이지 이동 ----- */'));
  const load = script.slice(script.indexOf('function loadApp()'), script.indexOf('function keepVal('));
  const settings = script.slice(script.indexOf('function renderSettings()'), script.indexOf("$('setSave').onclick"));
  const client = new Function('document', 'window', 'setTimeout', 'clearTimeout', 'server', 'views', start + load + settings + `
    rpc = server;
    function fillSelects() { views.push('selects'); }
    function renderTplList() { views.push('templates'); }
    function fillTplEditor() { views.push('editor'); }
    function renderTplChips() { views.push('chips'); }
    function renderVars() { views.push('variables'); }
    function renderAuto() { views.push('automations'); }
    function renderStu() { views.push('students'); }
    function loadAtt() { views.push('attendance'); return Promise.resolve(); }
    function loadLog() { views.push('log'); return Promise.resolve(); }
    function runTplPv() { views.push('template-preview'); return Promise.resolve(); }
    function refreshSmsPv() { views.push('message-preview'); return Promise.resolve(); }
    function varRow() {} function clsRow() {} function stuRow() {}
    return { call: call, loadApp: loadApp, dirtyTemplate: function () { tplDirty = true; },
      showPreview: function () { pv = [{}]; }, busy: function () { return saving; } };
  `)(doc, { addEventListener: (name, fn) => { handlers[name] = fn; } },
    fn => { const id = {}; timers.set(id, fn); return id; }, id => timers.delete(id), server, views);
  return { client, state, node, names, calls, views, doc, handlers,
    fail: name => { fail = name; }, release: () => release(),
    flush: () => { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(fn => fn()); } };
}

test('화면 동기화: 모든 변경 성공마다 getApp 1회, 전체 의존 화면 갱신·버튼 복구', async () => {
  const f = syncClient();
  await f.client.loadApp();
  f.client.showPreview();
  const mutations = ['saveSettings', 'saveClass', 'deleteClass', 'saveStudent', 'deleteStudent',
    'saveTemplate', 'deleteTemplate', 'saveVariable', 'deleteVariable', 'saveAutomation',
    'deleteAutomation', 'setAutomationRunning', 'saveAttendance', 'sendMessages'];
  for (const fn of mutations) {
    const count = f.calls.filter(x => x === 'getApp').length;
    f.views.length = 0;
    f.client.showPreview();
    const pending = f.client.call(fn, { name: '안내' }, []);
    assert.equal(f.node('setSave').disabled, true, fn);
    await Promise.resolve();
    await Promise.resolve();
    f.release();
    await pending;
    assert.equal(f.calls.filter(x => x === 'getApp').length, count + 1, fn);
    for (const view of ['selects', 'templates', 'variables', 'automations', 'students', 'attendance', 'log', 'template-preview', 'message-preview']) {
      assert.ok(f.views.includes(view), fn + ': ' + view);
    }
    assert.equal(f.node('setSave').disabled, false, fn);
    assert.equal(f.client.busy(), false, fn);
  }
});

test('설정 화면: 미발송 사유별 해결 방법과 실제 발송 가능 상태를 렌더링한다', async () => {
  const f = syncClient();
  f.state.settings.sendBlockers = ['SOLAPI 사용 꺼짐', 'SOLAPI 키 없음', '발신번호 없음'];
  f.state.settings.sendReady = false;
  await f.client.loadApp();
  const status = f.node('sendStatus').innerHTML;
  assert.match(status, /실제 문자가 나가지 않습니다/);
  assert.match(status, /SOLAPI 사용을 켜고 저장/);
  assert.match(status, /프로젝트 설정 → 스크립트 속성/);
  assert.match(status, /SOLAPI_KEY·SOLAPI_SECRET 키 2개/);
  assert.match(status, /등록·승인된 번호/);
  f.state.settings.sendBlockers = [];
  f.state.settings.sendReady = true;
  await f.client.loadApp();
  assert.match(f.node('sendStatus').innerHTML, /실제 발송 가능 ✓/);
  assert.doesNotMatch(f.node('sendStatus').innerHTML, /시험 모드/);
});

test('화면 동기화: 학원명·제목·설정 갱신, 미저장 텍스트 보존, 포커스 debounce와 저장 중 제외', async () => {
  const f = syncClient();
  await f.client.loadApp();
  f.node('setSender').value = '미저장 번호';
  f.node('tplBody').value = '작성 중 {{학원명}}';
  f.client.dirtyTemplate();
  f.state.academy = f.state.settings.academy = '시트에서 바꾼 학원';
  f.handlers.focus(); f.handlers.visibilitychange(); f.handlers.focus();
  f.flush();
  await f.client.loadApp();
  assert.equal(f.doc.title, '시트에서 바꾼 학원 · 학원 문자');
  assert.equal(f.names[0].textContent, '시트에서 바꾼 학원');
  assert.equal(f.names[1].textContent, '시트에서 바꾼 학원');
  assert.equal(f.node('setAcademy').value, '시트에서 바꾼 학원');
  assert.equal(f.node('setSender').value, '미저장 번호');
  assert.equal(f.node('tplBody').value, '작성 중 {{학원명}}');
  assert.equal(f.calls.filter(x => x === 'getApp').length, 2);
  const pending = f.client.call('saveClass', { name: 'A' });
  const double = f.client.call('saveClass', { name: 'A' });
  await assert.rejects(double, /저장 중/);
  f.handlers.focus(); f.flush();
  assert.equal(f.calls.filter(x => x === 'getApp').length, 2);
  await Promise.resolve(); await Promise.resolve();
  f.release(); await pending;
  f.flush();
  assert.equal(f.calls.filter(x => x === 'getApp').length, 3);
  f.fail('saveSettings');
  await assert.rejects(f.client.call('saveSettings', {}), /실패 예시/);
  assert.equal(f.node('setSave').disabled, false);
  assert.equal(f.client.busy(), false);
});

test('화면 동기화: 재조회 실패도 저장 결과·버튼을 복구하고, 숨긴 탭은 복귀 후 한 번 읽는다', async () => {
  const f = syncClient();
  await f.client.loadApp();
  f.doc.hidden = true;
  f.handlers.focus(); f.flush();
  assert.equal(f.calls.filter(x => x === 'getApp').length, 1);
  f.doc.hidden = false;
  f.handlers.visibilitychange(); f.flush();
  await f.client.loadApp();
  assert.equal(f.calls.filter(x => x === 'getApp').length, 2);
  f.fail('getApp');
  const pending = f.client.call('saveClass', { name: 'A' });
  await Promise.resolve(); await Promise.resolve();
  f.release();
  assert.equal((await pending).ok, true);
  assert.match(f.node('syncMsg').textContent, /저장은 완료/);
  assert.equal(f.node('setSave').disabled, false);
  assert.equal(f.client.busy(), false);
});

test('normalizeHHmm: 시트에 보이는 여러 시각 표기를 17:00 꼴로', () => {
  assert.equal(normalizeHHmm('17:00'), '17:00');
  assert.equal(normalizeHHmm('17:00:00'), '17:00');
  assert.equal(normalizeHHmm('오후 5:00:00'), '17:00');
  assert.equal(normalizeHHmm('5:00 PM'), '17:00');
  assert.equal(normalizeHHmm('오전 12:30'), '00:30');
  assert.equal(normalizeHHmm('9:05'), '09:05');
  assert.equal(normalizeHHmm('없음'), '');
});
