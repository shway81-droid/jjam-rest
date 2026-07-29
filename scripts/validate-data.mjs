/* ===================================================================
   data/sessions.json 정적 검증 — CI 게이트 (.github/workflows/ci.yml)
   ===================================================================
   빌드 단계가 없는 정적 사이트라, 잘못된 데이터는 배포된 뒤 교실 화면에서야
   드러난다. 여기서 "재생기(js/app.js)가 실제로 소화할 수 있는 데이터인가"와
   "PRD 3절 안전 기준을 지켰는가"를 미리 확인한다.

   검증 기준(유형·시간·애니메이션·소리 키)은 js/app.js 의 상수에서 직접 읽어 온다.
   → 화면 상수와 데이터가 따로 노는 상황을 잡는다(하드코딩 X).

   실행: node scripts/validate-data.mjs
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ── app.js에서 검증 기준 상수 추출 ────────────────────────────────
// 패턴을 못 찾으면 조용히 넘어가지 않고 실패시킨다(리팩터링으로 검증이 무력화되는 것 방지).
const APP = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf-8');

function extract(label, re, parse) {
  const m = APP.match(re);
  if (!m) {
    err(`js/app.js에서 ${label}를 찾지 못했습니다 — 상수 이름이 바뀌었다면 이 스크립트도 함께 고쳐야 합니다.`);
    return null;
  }
  return parse(m);
}

const TYPES = extract('TYPES', /var TYPES = \{([\s\S]*?)\n  \};/, (m) =>
  [...m[1].matchAll(/^\s*(\w+):\s*\{/gm)].map((x) => x[1]));

const DURATIONS = extract('DURATIONS', /var DURATIONS = \[([^\]]*)\];/, (m) =>
  m[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)));

const ANIMS = extract('ANIMS', /var ANIMS = \[([^\]]*)\];/, (m) =>
  [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

const SOUNDS = extract('SOUNDS', /var SOUNDS = \[([^\]]*)\];/, (m) =>
  [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

const PHASES = extract('PHASES', /var PHASES = \[([^\]]*)\];/, (m) =>
  [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

// 애니메이션 키가 실제로 화면 마크업을 갖고 있는지도 확인한다.
// ANIMS 목록에만 있고 ANIM_HTML 에 없으면 그 단계는 빈 무대로 재생된다.
const ANIM_HTML_KEYS = extract('ANIM_HTML', /var ANIM_HTML = \{([\s\S]*?)\n  \};/, (m) =>
  [...m[1].matchAll(/'([^']+)':/g)].map((x) => x[1]));

// 재생기의 타임라인 규칙을 그대로 떼어 와 실제 재생 결과를 검사한다.
// 규칙을 여기에 다시 적으면 app.js 가 바뀔 때 검증만 옛 규칙에 머문다.
const TAIL_MIN = extract('TAIL_MIN', /var TAIL_MIN = (\d+);/, (m) => Number(m[1]));
const buildTimeline = extract(
  'buildTimeline',
  /function buildTimeline\(session, minutes\) \{[\s\S]*?\n  \}/,
  (m) => new Function('TAIL_MIN', 'return ' + m[0])(TAIL_MIN)
);

if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

for (const a of ANIMS) {
  if (!ANIM_HTML_KEYS.includes(a)) {
    err(`애니메이션 키 '${a}' 가 ANIMS 에는 있지만 ANIM_HTML 에 없습니다 — 빈 무대로 재생됩니다.`);
  }
}

// ── sessions.json 로드 ───────────────────────────────────────────
const DATA_PATH = path.join(ROOT, 'data', 'sessions.json');
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
} catch (e) {
  console.error(`  ✗ data/sessions.json 파싱 실패 — ${e.message}`);
  process.exit(1);
}

if (typeof data !== 'object' || data === null || Array.isArray(data)) {
  console.error('  ✗ data/sessions.json 최상위는 { version, sessions } 객체여야 합니다.');
  process.exit(1);
}
if (data.version === undefined) err('최상위 version 필드가 없습니다.');
if (!Array.isArray(data.sessions) || data.sessions.length === 0) {
  console.error('  ✗ sessions 는 비어 있지 않은 배열이어야 합니다.');
  process.exit(1);
}

// ── 안전 기준 (PRD 3절) ─────────────────────────────────────────
// 교실에서 한 번 나가면 되돌릴 수 없는 문구들이다. 사람 검토에만 맡기지 않는다.
const BANNED = [
  { re: /잠(이|을)?\s?(들|자|잘|와|온)/, why: '수면 유도 표현 (PRD 3절: "잠이 듭니다" 금지)' },
  { re: /최면/, why: '최면형 표현 금지' },
  { re: /졸(려|리|음)/, why: '수면 유도 표현 금지' },
  { re: /하품/, why: '하품은 대표적인 졸음 신호 — 수면 유도 금지(PRD 1.4 비목표)' },
  { re: /기도|기도문|하나님|부처|천국|영혼|명상법|만트라|주문을\s?외/, why: '종교적 표현·만트라 금지' },
  { re: /무서운|무섭|어둠\s?속|혼자\s?남|죽음|이별|사라져\s?버/, why: '무섭거나 슬픈 상상 소재 금지' },
  { re: /번쩍|깜빡깜빡|빠르게\s?움직/, why: '빠른 점멸·급격한 전환 연상 표현 금지' }
];

// 명령형 어미 — PRD 작성 기준은 청유형("힘을 빼 볼까요")이다.
// 문장 끝에서만 본다("~해요"는 청유·설명 모두 쓰이므로 제외).
const IMPERATIVE = /(해라|하라|해야\s?한다|하세요\s*$|하십시오|할\s?것)/;

const STR_FIELDS = ['id', 'title', 'type', 'sound', 'closing'];
const REQUIRED = [...STR_FIELDS, 'durations', 'steps'];
const ALLOWED = new Set(REQUIRED);
const STEP_REQUIRED = ['phase', 'text', 'seconds', 'anim'];
const STEP_ALLOWED = new Set([...STEP_REQUIRED, 'sound']);

const TEXT_MAX = 40;   // 전자칠판 한 줄로 읽히는 길이 (경고)

const seenId = new Map();
const nonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';

function checkSafety(where, text) {
  for (const b of BANNED) {
    if (b.re.test(text)) err(`${where}: 안전 기준 위반 — ${b.why}\n      "${text}"`);
  }
  if (IMPERATIVE.test(text)) {
    err(`${where}: 명령형 어미 — 청유형으로 바꿔 주세요 (PRD 3절)\n      "${text}"`);
  }
}

data.sessions.forEach((ss, i) => {
  const where = `sessions[${i}] (${ss && ss.id ? ss.id : 'id 없음'})`;

  if (typeof ss !== 'object' || ss === null || Array.isArray(ss)) {
    err(`${where}: 객체가 아닙니다.`);
    return;
  }

  for (const k of REQUIRED) {
    if (ss[k] === undefined || ss[k] === null) err(`${where}: 필수 필드 '${k}' 누락`);
  }
  for (const k of Object.keys(ss)) {
    if (!ALLOWED.has(k)) err(`${where}: 알 수 없는 필드 '${k}'`);
  }

  if (!nonEmptyStr(ss.id)) {
    err(`${where}: id 는 비어 있지 않은 문자열이어야 합니다.`);
  } else if (seenId.has(ss.id)) {
    err(`${where}: id '${ss.id}' 중복 (sessions[${seenId.get(ss.id)}]와 동일)`);
  } else {
    seenId.set(ss.id, i);
  }

  for (const k of STR_FIELDS) {
    if (ss[k] !== undefined && !nonEmptyStr(ss[k])) err(`${where}: ${k} 가 비어 있습니다.`);
  }

  // app.js 는 TYPES[ss.type] 을 그대로 조회한다 → 미등록 유형은 렌더링 시 터진다.
  if (!TYPES.includes(ss.type)) {
    err(`${where}: 알 수 없는 유형 '${ss.type}' (가능: ${TYPES.join(', ')})`);
  }
  if (!SOUNDS.includes(ss.sound)) {
    err(`${where}: 알 수 없는 소리 프리셋 '${ss.sound}' (가능: ${SOUNDS.join(', ')})`);
  }
  if (nonEmptyStr(ss.closing)) checkSafety(`${where} closing`, ss.closing);

  // 시간 모드는 DURATIONS 에 있는 것만 화면에 존재한다 → 그 밖의 값은 아무도 고를 수 없다.
  if (!Array.isArray(ss.durations) || ss.durations.length === 0) {
    err(`${where}: durations 는 비어 있지 않은 배열이어야 합니다.`);
  } else {
    for (const d of ss.durations) {
      if (!DURATIONS.includes(d)) {
        err(`${where}: 시간 모드 ${d}분은 app.js의 DURATIONS(${DURATIONS.join('·')}분)에 없습니다.`);
      }
    }
  }

  // ── steps ──
  if (!Array.isArray(ss.steps) || ss.steps.length < 3) {
    err(`${where}: steps 는 [준비, 본체…, 마무리] 로 최소 3개여야 합니다.`);
    return;
  }

  ss.steps.forEach((st, j) => {
    const sw = `${where} steps[${j}]`;
    if (typeof st !== 'object' || st === null || Array.isArray(st)) {
      err(`${sw}: 객체가 아닙니다.`);
      return;
    }
    for (const k of STEP_REQUIRED) {
      if (st[k] === undefined || st[k] === null) err(`${sw}: 필수 필드 '${k}' 누락`);
    }
    for (const k of Object.keys(st)) {
      if (!STEP_ALLOWED.has(k)) err(`${sw}: 알 수 없는 필드 '${k}'`);
    }
    if (!PHASES.includes(st.phase)) {
      err(`${sw}: 알 수 없는 phase '${st.phase}' (가능: ${PHASES.join(', ')})`);
    }
    if (!ANIMS.includes(st.anim)) {
      err(`${sw}: 알 수 없는 anim '${st.anim}' (가능: ${ANIMS.join(', ')})`);
    }
    if (st.sound !== undefined && typeof st.sound !== 'boolean') {
      err(`${sw}: sound 는 true/false 여야 합니다 (소리 프리셋은 세션의 sound 필드).`);
    }
    if (!Number.isInteger(st.seconds) || st.seconds < 5) {
      err(`${sw}: seconds 는 5 이상의 정수여야 합니다.`);
    }
    if (!nonEmptyStr(st.text)) {
      err(`${sw}: text 가 비어 있습니다.`);
    } else {
      checkSafety(sw, st.text);
      if (st.text.length > TEXT_MAX) {
        warn(`${sw}: 문구가 ${st.text.length}자 — 전자칠판 한 화면에는 ${TEXT_MAX}자 안팎이 읽기 좋습니다.`);
      }
    }
  });

  // 첫 단계는 준비, 마지막 단계는 마무리 — 재생기(buildTimeline)가 그렇게 자른다.
  if (ss.steps[0].phase !== 'ready') err(`${where}: 첫 단계의 phase 는 'ready' 여야 합니다.`);
  if (ss.steps[ss.steps.length - 1].phase !== 'close') {
    err(`${where}: 마지막 단계의 phase 는 'close' 여야 합니다.`);
  }

  // 가장 짧은 시간 모드가 준비+마무리만으로 꽉 차면 본체가 한 번도 재생되지 않는다.
  const ready = ss.steps[0].seconds || 0;
  const close = ss.steps[ss.steps.length - 1].seconds || 0;
  const shortest = Math.min(...(ss.durations || [0]));
  const budget = shortest * 60 - ready - close;
  if (budget < TAIL_MIN) {
    err(`${where}: ${shortest}분 모드에서 본체에 쓸 시간이 ${budget}초뿐입니다 ` +
        `(준비 ${ready}초 + 마무리 ${close}초). 준비·마무리를 줄여 주세요.`);
  }

  // ── 실제 재생 결과 검사 ──
  // 데이터만 보면 멀쩡한데 특정 시간 모드에서만 깨지는 것들이 있다.
  // 재생기의 타임라인을 그대로 만들어 본다.
  {
    for (const d of ss.durations || []) {
      let tl;
      try { tl = buildTimeline(ss, d); } catch (e) {
        err(`${where}: ${d}분 타임라인 생성 실패 — ${e.message}`);
        continue;
      }
      const sum = tl.reduce((a, x) => a + (x.seconds || 0), 0);
      if (sum !== d * 60) {
        err(`${where}: ${d}분 모드의 실제 재생 길이가 ${sum}초입니다 (선언 ${d * 60}초). ` +
            `PRD 완료 기준은 ±5초입니다.`);
      }
      // 짧게 스쳐 가는 문구는 읽히지 않는다.
      const tooShort = tl.filter((x) => x.seconds < 5);
      if (tooShort.length) {
        err(`${where}: ${d}분 모드에 ${tooShort[0].seconds}초짜리 단계가 있습니다 — 읽을 수 없습니다.`);
      }
      // 소리 상태를 앞에서부터 따라가, 그 시간 모드에서 배경음이 한 번이라도 나는지 본다.
      // (본체 첫 단계만 재생되는 1분 모드에서 소리가 통째로 빠지는 일이 실제로 있었다.)
      if (ss.sound !== 'none') {
        let on = false, everOn = false;
        for (const st of tl) {
          if (st.sound !== undefined) on = st.sound;
          if (on) { everOn = true; break; }
        }
        if (!everOn) {
          warn(`${where}: ${d}분 모드에서 배경음 '${ss.sound}' 가 한 번도 재생되지 않습니다 ` +
               `— 그 시간에는 세션의 sound 설정이 죽은 값입니다.`);
        }
      }
    }
  }
});

// ── 유형별 편수 ─────────────────────────────────────────────────
// 홈이 유형 5종을 나란히 보여 주므로, 한 유형만 비면 그 카드가 빈손이 된다.
{
  const byType = {};
  for (const ss of data.sessions) byType[ss.type] = (byType[ss.type] || 0) + 1;
  for (const t of TYPES) {
    if (!byType[t]) err(`유형 '${t}' 에 해당하는 세션이 하나도 없습니다.`);
    else if (byType[t] < 3) warn(`유형 '${t}' 이 ${byType[t]}편뿐입니다 — MVP 기준은 유형당 3~4편입니다.`);
  }
}

// ── 결과 ─────────────────────────────────────────────────────────
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.error(`  ✗ ${e}`);

if (errors.length) {
  console.error(`\n❌ 쉼 데이터 검증 실패 — 오류 ${errors.length}건`);
  process.exit(1);
}

console.log(`\n✅ 쉼 데이터 검증 통과 — ${data.sessions.length}편${warnings.length ? ` (경고 ${warnings.length}건)` : ''}`);
