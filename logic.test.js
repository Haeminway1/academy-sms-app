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
  SYSTEM_VAR_NAMES,
  buildVars,
  automationSentence,
  dueLate,
  dueScheduled,
  ruleKey
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
