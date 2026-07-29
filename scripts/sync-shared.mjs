/* ===================================================================
   짬짬이 게임(jjam)과 공유하는 파일의 이탈 감지·동기화
   ===================================================================
   짬짬이 네 사이트(게임·퀴즈·영상·이야기)는 저장소가 따로지만, 아래 파일들은
   네 곳에서 글자 하나까지 같아야 한다. 헤더의 자매 사이트 바로가기와 웹폰트가
   그렇다 — 한쪽만 고치면 사이트마다 다른 글씨체·다른 바로가기가 되어 버린다.

   여기서는 **jjam을 상류(upstream)로 삼는다.**
   - `--check` : 상류와 다른 파일이 있으면 알려 준다 (CI가 이 모드로 돈다)
   - 인자 없음  : 상류 내용을 그대로 받아 덮어쓴다 (한 줄로 동기화)

   공통 파일을 고칠 때 순서
     1. jjam 에서 고치고 머지한다
     2. 이 저장소에서 `node scripts/sync-shared.mjs` → 커밋

   빌드 단계가 없는 정적 사이트라 패키지로 묶지 않고, 이렇게 파일 단위로 맞춘다.

   실행:
     node scripts/sync-shared.mjs           상류 내용으로 동기화
     node scripts/sync-shared.mjs --check   이탈 여부만 확인 (수정하지 않음)
   =================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const UPSTREAM = 'shway81-droid/jjam';
const BRANCH = process.env.SYNC_SHARED_REF || 'main';
const RAW = `https://raw.githubusercontent.com/${UPSTREAM}/${BRANCH}`;

// 네 저장소에서 동일해야 하는 파일.
// (여기에 없는 파일은 저장소마다 다른 것이 정상 — index.html·sw.js·README 등에는
//  이 사이트 전용 내용이 들어 있다.)
const SHARED = [
  'shared/jjam-switcher.js',
  'scripts/check-font-coverage.mjs',
  'assets/fonts/PretendardVariable.subset.woff2',
  'assets/fonts/coverage.txt',
  'assets/fonts/LICENSE.txt',
];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function fetchUpstream(rel) {
  const res = await fetch(`${RAW}/${rel}`);
  if (!res.ok) throw new Error(`상류에서 ${rel} 을 받지 못했습니다 (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

const drifted = [];
const missing = [];
const failed = [];
let synced = 0;

for (const rel of SHARED) {
  const local = path.join(ROOT, rel);
  let upstream;
  try {
    upstream = await fetchUpstream(rel);
  } catch (e) {
    // 상류에 파일이 없는 것도 이탈이다 — 조용히 넘기지 않는다.
    console.log(`  ✗ ${rel} — ${e.message}`);
    failed.push(rel);
    continue;
  }

  if (!fs.existsSync(local)) {
    missing.push(rel);
    if (!CHECK) {
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, upstream);
      console.log(`  + ${rel} 새로 받음`);
    }
    continue;
  }

  const localBuf = fs.readFileSync(local);
  if (sha(localBuf) === sha(upstream)) {
    console.log(`  = ${rel}`);
    continue;
  }

  drifted.push(rel);
  if (!CHECK) {
    fs.writeFileSync(local, upstream);
    synced++;
    console.log(`  ↻ ${rel} 상류 내용으로 갱신`);
  } else {
    console.log(`  ✗ ${rel} 이 상류(${UPSTREAM}@${BRANCH})와 다릅니다`);
  }
}

const problems = drifted.length + missing.length + failed.length;

if (failed.length && !CHECK) {
  console.error(`\n❌ 상류에서 받지 못한 파일 ${failed.length}개: ${failed.join(', ')}`);
  console.error(`   ${UPSTREAM}@${BRANCH} 에 아직 그 파일이 없거나 네트워크 문제입니다.`);
  process.exit(1);
}

if (CHECK && problems) {
  console.error(
    `\n❌ 공통 파일 ${problems}개가 상류와 어긋났습니다` +
    (failed.length ? ` (그중 ${failed.length}개는 상류에 아예 없음)` : '') + `.\n` +
    `   사이트마다 글씨체나 자매 사이트 바로가기가 달라진 상태입니다.\n\n` +
    `   고치는 법:\n` +
    `     • 이 저장소를 맞추려면        →  node scripts/sync-shared.mjs\n` +
    `     • 바꾼 내용을 양쪽에 반영하려면 →  먼저 ${UPSTREAM} 에 반영한 뒤 위 명령\n`
  );
  process.exit(1);
}

if (CHECK) {
  console.log(`\n✅ 공통 파일 ${SHARED.length}개가 상류(${UPSTREAM}@${BRANCH})와 일치합니다.`);
} else {
  console.log(`\n✅ 동기화 완료 — 갱신 ${synced}개 / 신규 ${missing.length}개 / 이미 일치 ${SHARED.length - synced - missing.length}개`);
}
