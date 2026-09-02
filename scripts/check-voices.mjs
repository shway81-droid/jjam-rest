/* ===================================================================
   목소리 파일 검사 — CI 게이트
   ===================================================================
   쉼 문구는 두 목소리(선히·현수)로 미리 만들어 assets/voice/ 에 둔다.
   문구를 고치고 파일을 다시 만들지 않으면, 앱은 그 문구를 브라우저 목소리로
   읽어 넘기지만(js/voice-files.js 의 has 가 문구 해시를 대조한다) 그러면
   한 활동 안에서 목소리가 바뀐다. 여기서 미리 잡는다.

   검사:
   - sessions.json 의 모든 문구가 manifest 에 있고 해시가 같은가
   - 두 목소리 모두 그 문구의 mp3 가 실제로 있고 비어 있지 않은가

   어긋나면: python3 scripts/gen-voices.py  (바뀐 문구만 다시 만든다)

   실행: node scripts/check-voices.mjs
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_DIR = path.join(ROOT, 'assets', 'voice');

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

const manifestPath = path.join(VOICE_DIR, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('assets/voice/manifest.json 이 없습니다 — python3 scripts/gen-voices.py');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sessions.json'), 'utf-8'));

// scripts/gen-voices.py 의 h() 와 같은 규칙 — sha1 앞 12자리
const h = (t) => crypto.createHash('sha1').update(t, 'utf8').digest('hex').slice(0, 12);

const lines = [];
for (const ss of data.sessions) {
  ss.steps.forEach((st, i) => lines.push([`${ss.id}-${i}`, st.text]));
  lines.push([`${ss.id}-closing`, ss.closing]);
}

const voices = Object.keys(manifest.voices || {});
if (voices.length < 1) fail('manifest 에 목소리가 없습니다.');

const stale = [], missing = [];
let bytes = 0;
for (const [key, text] of lines) {
  const entry = manifest.lines && manifest.lines[key];
  if (!entry || entry.sha1 !== h(text)) stale.push(`${key}  "${text}"`);
  for (const v of voices) {
    const p = path.join(VOICE_DIR, v, `${key}.mp3`);
    if (!fs.existsSync(p) || fs.statSync(p).size === 0) missing.push(`${v}/${key}.mp3`);
    else bytes += fs.statSync(p).size;
  }
}

if (stale.length || missing.length) {
  if (stale.length) {
    console.error(`  ✗ 파일과 다른 문구 ${stale.length}개 (고친 뒤 다시 만들지 않았습니다):`);
    for (const s of stale.slice(0, 8)) console.error(`      ${s}`);
  }
  if (missing.length) {
    console.error(`  ✗ 없는 파일 ${missing.length}개:`);
    for (const m of missing.slice(0, 8)) console.error(`      ${m}`);
  }
  fail('python3 scripts/gen-voices.py 를 돌려 목소리 파일을 맞춰 주세요.');
}

console.log(`\n✅ 목소리 파일 확인 — 문구 ${lines.length}개 × 목소리 ${voices.length}개(${voices.join('·')}), ` +
  `${(bytes / 1048576).toFixed(1)} MB, 문구 해시 모두 일치`);
