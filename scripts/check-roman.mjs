/* ===================================================================
   한글 → 로마자 변환 검사 — CI 게이트
   ===================================================================
   신경망 목소리가 쓰는 음성 모델은 한글이 아니라 로마자를 받는다.
   그 표기는 모델이 학습할 때 쓴 uroman 과 글자 하나까지 같아야 한다 —
   어긋나면 발음이 무너지는데, 화면에는 아무 표시도 나지 않아 눈치채기 어렵다.

   js/hangul-roman.js 의 자모 표는 uroman 을 직접 돌려 뽑았고, 개발 중에
   한글 음절 11,172자 전부와 sessions.json 의 모든 문구로 대조해 일치를
   확인했다. CI 에는 uroman(파이썬)이 없으므로 그때의 정답 일부를
   scripts/roman-golden.json 에 고정해 두고 여기서 대조한다.
   (data/ 가 아니라 scripts/ 에 두는 이유: 표본에는 화면에 나오지 않는
   무작위 음절이 섞여 있어, data/ 에 두면 웹폰트 커버리지 검사가 그것까지
   '서브셋에 없는 글자'로 잡는다.)

   또 두 가지를 함께 본다:
   - 모델에 넘길 문자열에 어휘 밖 글자가 남아 있지 않은가
   - 새로 넣은 문구가 로마자로 바뀌지 않고 한글로 남지 않는가
     (한자·일본어 등 표에 없는 글자를 넣으면 여기서 걸린다)

   실행: node scripts/check-roman.mjs
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

// js/hangul-roman.js 는 브라우저용 전역 스크립트다. 그대로 읽어 평가한다
// (여기서 따로 옮겨 적으면 검사 대상과 실제 코드가 갈라진다).
const src = fs.readFileSync(path.join(ROOT, 'js', 'hangul-roman.js'), 'utf-8');
let JjamRoman;
try {
  JjamRoman = new Function(`${src}\n; return JjamRoman;`)();
} catch (e) {
  fail(`js/hangul-roman.js 를 불러오지 못했습니다 — ${e.message}`);
}

const goldenPath = path.join(ROOT, 'scripts', 'roman-golden.json');
if (!fs.existsSync(goldenPath)) fail('scripts/roman-golden.json 이 없습니다.');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'));

let bad = 0;
const show = [];

for (const [k, want] of Object.entries(golden.syl)) {
  const got = JjamRoman.romanize(k);
  if (got !== want) { bad++; if (show.length < 8) show.push(`'${k}' → ${got} (기대: ${want})`); }
}
for (const [k, want] of Object.entries(golden.sent)) {
  const got = JjamRoman.romanize(k);
  if (got !== want) { bad++; if (show.length < 8) show.push(`"${k}"\n        나온 값: ${got}\n        기대값 : ${want}`); }
}
if (bad) {
  for (const m of show) console.error(`      ${m}`);
  fail(`uroman 표기와 ${bad}건 어긋납니다 — 자모 표를 바꿨다면 되돌리세요.`);
}

// ── 실제 문구가 모델에 넣을 수 있는 모양이 되는가 ──────────────
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sessions.json'), 'utf-8'));
const texts = [];
for (const ss of data.sessions) {
  for (const st of ss.steps) texts.push(st.text);
  texts.push(ss.closing);
}

const allowed = new Set(JjamRoman.ALLOWED.split(''));
const leftovers = new Map();   // 글자 → 처음 나온 문구
for (const t of texts) {
  const rom = JjamRoman.romanize(t);
  for (const ch of rom) {
    // 로마자로 바뀌지 않고 남은 글자 중, 어휘에도 없고 흔한 문장부호도 아닌 것
    if (allowed.has(ch.toLowerCase())) continue;
    if (' .,!?~…·\'"()-'.includes(ch)) continue;
    if (!leftovers.has(ch)) leftovers.set(ch, t);
  }
  if (!JjamRoman.forModel(t)) {
    fail(`모델에 넘길 것이 남지 않는 문구가 있습니다: "${t}"`);
  }
}
if (leftovers.size) {
  console.error('  ✗ 로마자로 바뀌지 않는 글자가 있습니다 — 신경망 목소리가 그 부분을 읽지 못합니다.');
  for (const [ch, where] of leftovers) {
    console.error(`      '${ch}' (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})  "${where}"`);
  }
  process.exit(1);
}

console.log(`\n✅ 한글 로마자 변환 확인 — 고정 표본 ${Object.keys(golden.syl).length}자 · ` +
  `문구 ${Object.keys(golden.sent).length}개 일치, 쉼 문구 ${texts.length}개 모두 변환 가능`);
