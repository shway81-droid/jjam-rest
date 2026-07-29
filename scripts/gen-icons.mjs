/* ===================================================================
   favicon.svg → 앱 아이콘 PNG 세트 생성
   ===================================================================
   사이트 아이콘의 단일 소스는 favicon.svg 하나다.
   브라우저 탭·헤더 로고·앱 아이콘이 모두 이 파일에서 나온다.

   PNG가 따로 필요한 이유: 안드로이드·iOS 홈 화면은 SVG를 쓰지 않는다.
   SVG만 넣어 두면 "홈 화면에 추가"에서 아이콘이 비거나 깨진다.

     assets/icons/icon-192.png            일반 (모서리 바깥 투명)
     assets/icons/icon-512.png            일반 고해상도
     assets/icons/icon-maskable-512.png   안드로이드 적응형
     assets/icons/apple-touch-icon.png    iOS 홈 화면 180px

   여백 비율이 이 파일에 있는 이유:
   - 안드로이드는 아이콘을 기기마다 다른 모양(원·둥근사각·물방울)으로 잘라낸다.
     보장되는 영역은 지름 80% 원뿐이라, 우상단 시계 배지까지 그 안에 들어오도록
     내용을 0.66배로 줄여 배경을 꽉 채운다. 안 그러면 배지가 잘린다.
   - iOS 마스크는 원이 아니라 스퀘어클이라 더 크게(0.80) 써도 잘리지 않는다.
     다만 iOS는 투명을 검정으로 칠하므로 배경을 반드시 채워야 한다.

   실행: node scripts/gen-icons.mjs
   (playwright 필요 — npm ci 로 설치된다)
   =================================================================== */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'favicon.svg');
const OUT = path.join(ROOT, 'assets', 'icons');

const MASKABLE_SCALE = 0.66;   // 안드로이드 안전 영역(지름 80% 원) 안에 들어오도록
const APPLE_SCALE = 0.80;      // iOS 스퀘어클 마스크

if (!fs.existsSync(SRC)) {
  console.error('  ✗ favicon.svg 가 없습니다.');
  process.exit(1);
}

const svg = fs.readFileSync(SRC, 'utf8');

// 바탕 사각형의 채움색 — 여백 있는 버전의 배경으로 쓴다.
const bgMatch = svg.match(/<rect[^>]*rx="24"[^>]*fill="(#[0-9A-Fa-f]{3,8})"/);
if (!bgMatch) {
  console.error('  ✗ favicon.svg 에서 바탕색을 찾지 못했습니다 (rx="24" 인 rect 의 fill).');
  process.exit(1);
}
const bg = bgMatch[1];

// 바탕 사각형을 뺀 내용만 — 축소해서 가운데 배치한다.
const inner = svg
  .replace(/^[\s\S]*?<rect[^>]*rx="24"[^>]*\/>/, '')
  .replace(/<\/svg>\s*$/, '');

const padded = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${bg}"/>
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${inner}</g>
</svg>`;

const JOBS = [
  { file: 'icon-192.png', size: 192, markup: svg, transparent: true },
  { file: 'icon-512.png', size: 512, markup: svg, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, markup: padded(MASKABLE_SCALE), transparent: false },
  { file: 'apple-touch-icon.png', size: 180, markup: padded(APPLE_SCALE), transparent: false },
];

// 사전 설치된 크로미움을 우선 사용 (없으면 playwright 기본 경로)
function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  for (const d of fs.readdirSync(base)) {
    const p = path.join(base, d, 'chrome-linux', 'chrome');
    if (d.startsWith('chromium-') && fs.existsSync(p)) return p;
  }
  return undefined;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findChromium(),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

fs.mkdirSync(OUT, { recursive: true });
console.log(`  바탕색 ${bg}`);

for (const job of JOBS) {
  const page = await browser.newPage({
    viewport: { width: job.size, height: job.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:transparent}
     svg{display:block;width:${job.size}px;height:${job.size}px}</style>
     ${job.markup}`,
    { waitUntil: 'load' }
  );
  await page.waitForTimeout(120);
  const out = path.join(OUT, job.file);
  await page.screenshot({ path: out, omitBackground: job.transparent });
  console.log(`  ↻ assets/icons/${job.file.padEnd(24)} ${job.size}px  ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
  await page.close();
}

await browser.close();
console.log('\n✅ 앱 아이콘 생성 완료 — manifest.json 의 icons 목록과 파일명이 맞는지 확인하세요.');
