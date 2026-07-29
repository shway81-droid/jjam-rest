/* ===================================================================
   자가 호스팅 웹폰트 글자 커버리지 검사 — CI 게이트
   ===================================================================
   assets/fonts/PretendardVariable.subset.woff2 는 짬짬이 4개 사이트가 쓰는
   글자만 남긴 서브셋이다. 새 게임·이야기·영상이 들어오면서 서브셋에 없는
   글자가 생기면, 그 글자만 시스템 폰트로 렌더링되어 한 문장 안에서 서체가
   섞인다(깨지지는 않지만 눈에 띈다).

   이 스크립트는 저장소의 화면 텍스트에서 실제 사용 문자를 모아
   폰트의 cmap 테이블과 대조한다. 빠진 글자가 있으면 알려 준다.

   서브셋 재생성이 필요할 때:
     python3 -m pip install fonttools brotli
     pyftsubset <원본 PretendardVariable.woff2> \
       --unicodes-file=<사용 코드포인트> --flavor=woff2 \
       --layout-features='*' --output-file=PretendardVariable.subset.woff2

   실행: node scripts/check-font-coverage.mjs
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT = path.join(ROOT, 'assets', 'fonts', 'PretendardVariable.subset.woff2');

// 화면에 글자로 나올 수 있는 파일만 (스크립트·문서·설정은 제외)
const TEXT_EXTS = new Set(['.html', '.js', '.json', '.css']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'scripts', 'docs', '_original', 'bgm-preview', 'assets', '.github', 'frontend']);

// ── woff2 → cmap 코드포인트 집합 ─────────────────────────────────
// woff2는 sfnt 테이블을 재배치·압축하므로 직접 파싱하지 않고,
// 폰트에 동봉해 둔 커버리지 목록(coverage.txt)과 대조한다.
// (목록은 서브셋을 만들 때 함께 생성한다 — 폰트와 항상 짝을 이룬다.)
const COVERAGE = path.join(ROOT, 'assets', 'fonts', 'coverage.txt');

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(FONT)) fail('assets/fonts/PretendardVariable.subset.woff2 가 없습니다.');
if (!fs.existsSync(COVERAGE)) fail('assets/fonts/coverage.txt 가 없습니다 — 서브셋과 함께 생성해야 합니다.');

const coverageRaw = fs.readFileSync(COVERAGE, 'utf-8');

// 첫 줄에 폰트 해시를 적어 둔다 → 목록과 폰트가 어긋난 채로 검사가 통과하는 일을 막는다.
{
  const m = coverageRaw.match(/^#\s*sha256=([0-9a-f]{64})/m);
  if (!m) fail('coverage.txt 에 폰트 해시(# sha256=...) 줄이 없습니다.');
  const actual = crypto.createHash('sha256').update(fs.readFileSync(FONT)).digest('hex');
  if (actual !== m[1]) {
    fail(`coverage.txt 가 현재 폰트와 짝이 맞지 않습니다.\n` +
         `      목록 기준: ${m[1].slice(0, 16)}…\n` +
         `      실제 폰트: ${actual.slice(0, 16)}…\n` +
         `      → 폰트를 바꿨다면 coverage.txt 도 함께 다시 만들어야 합니다.`);
  }
}

const covered = new Set(
  coverageRaw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => parseInt(s.replace(/^U\+/i, ''), 16))
);

// ── 저장소 텍스트에서 사용 문자 수집 ────────────────────────────
const used = new Map();   // codepoint → 처음 발견한 파일

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    if (!TEXT_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
    const p = path.join(dir, entry.name);
    let text;
    try { text = fs.readFileSync(p, 'utf-8'); } catch { continue; }
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (!used.has(cp)) used.set(cp, path.relative(ROOT, p));
    }
  }
}
walk(ROOT);

// ── 폰트가 담당하지 않는 문자는 검사 대상에서 제외 ───────────────
// 이모지·기호는 시스템 컬러 이모지 폰트가 그린다. 제어문자도 제외.
const isEmoji = (cp) => cp >= 0x1F000 || (cp >= 0x2600 && cp <= 0x27BF) || cp === 0xFE0F || cp === 0x20E3;
const isControl = (cp) => cp < 0x20 || (cp >= 0x7F && cp <= 0x9F);

const missing = [];
for (const [cp, where] of used) {
  if (isEmoji(cp) || isControl(cp) || covered.has(cp)) continue;
  missing.push({ cp, ch: String.fromCodePoint(cp), where });
}

if (missing.length) {
  console.log(`  ⚠ 서브셋에 없는 글자 ${missing.length}자 — 이 글자들만 시스템 폰트로 표시됩니다.`);
  for (const m of missing.slice(0, 20)) {
    console.log(`      '${m.ch}' (U+${m.cp.toString(16).toUpperCase().padStart(4, '0')})  ${m.where}`);
  }
  if (missing.length > 20) console.log(`      … 외 ${missing.length - 20}자`);
  console.log('    → 서브셋을 다시 만들면 해결됩니다 (이 파일 상단 주석 참고).');
}

const fontKB = (fs.statSync(FONT).size / 1024).toFixed(0);
console.log(`\n✅ 웹폰트 커버리지 확인 — 사용 ${used.size}자 / 폰트 ${covered.size}자 / ${fontKB} KB` +
  (missing.length ? ` (미포함 ${missing.length}자)` : ''));
