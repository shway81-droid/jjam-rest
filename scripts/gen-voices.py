#!/usr/bin/env python3
"""쉼 문구를 목소리 파일로 — sessions.json 의 모든 문구를 두 목소리로 만든다.

왜 파일인가: 브라우저 목소리는 기기마다 다르고(크롬에는 자연스러운 한국어가
없다), 브라우저 안에서 도는 신경망 모델은 47MB 에 실시간의 두 배가 걸렸다.
133문장을 한 번 만들어 두면 5MB 안팎이고, 어느 브라우저에서나 같은 소리가
즉시 난다. 명상 안내에 맞춰 기본보다 늦추고(-22%) 살짝 낮춘다(-3Hz).

바뀐 문구만 다시 만든다: assets/voice/manifest.json 에 문구의 해시를 남겨 두고
같으면 건너뛴다. 문구를 고치면 그 문장만 새로 만들어진다(몇 초).

필요: pip install edge-tts   (Edge 의 한국어 신경망 목소리를 파일로 뽑는 도구.
마이크로소프트가 공식으로 열어 둔 것은 아니다 — 언젠가 막히면 이미 만든 파일은
그대로 남고 새 문구를 추가할 때만 영향을 받는다.)

실행: python3 scripts/gen-voices.py            # 바뀐 것만
      python3 scripts/gen-voices.py --all      # 전부 다시
프록시 환경: HTTPS_PROXY 가 있으면 자동으로 넘긴다.
"""
import asyncio, hashlib, json, os, sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit("edge-tts 가 없습니다: pip install edge-tts")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "sessions.json"
OUT = ROOT / "assets" / "voice"
MANIFEST = OUT / "manifest.json"

# 목소리 두 개 — 교사가 설정 화면에서 고른다. 키는 폴더 이름이자 앱의 선택값.
VOICES = {
    "sunhi":  {"id": "ko-KR-SunHiNeural",             "label": "선히", "gender": "여성"},
    "hyunsu": {"id": "ko-KR-HyunsuMultilingualNeural", "label": "현수", "gender": "남성"},
}
RATE, PITCH = "-22%", "-3Hz"
CONCURRENCY = 6      # 동시 요청 — 너무 많으면 서버가 끊는다

def lines_from_data():
    d = json.loads(DATA.read_text(encoding="utf-8"))
    for ss in d["sessions"]:
        for i, st in enumerate(ss["steps"]):
            yield f'{ss["id"]}-{i}', st["text"]
        yield f'{ss["id"]}-closing', ss["closing"]

def h(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]

async def synth(sem, voice_id, text, path):
    async with sem:
        proxy = os.environ.get("HTTPS_PROXY") or None
        c = edge_tts.Communicate(text, voice_id, rate=RATE, pitch=PITCH, proxy=proxy)
        await c.save(str(path))

async def main(force):
    old = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    old_lines = old.get("lines", {})
    lines = dict(lines_from_data())
    sem = asyncio.Semaphore(CONCURRENCY)
    jobs, skipped = [], 0
    for vkey, v in VOICES.items():
        (OUT / vkey).mkdir(parents=True, exist_ok=True)
        for key, text in lines.items():
            path = OUT / vkey / f"{key}.mp3"
            same = old_lines.get(key, {}).get("sha1") == h(text) and path.exists()
            if same and not force:
                skipped += 1
                continue
            jobs.append(synth(sem, v["id"], text, path))
    print(f"  만들 파일 {len(jobs)}개, 그대로 두는 파일 {skipped}개")
    if jobs:
        await asyncio.gather(*jobs)

    manifest = {
        "voices": VOICES,
        "settings": {"rate": RATE, "pitch": PITCH},
        "lines": {key: {"text": text, "sha1": h(text)} for key, text in lines.items()},
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    total = sum(p.stat().st_size for p in OUT.rglob("*.mp3"))
    missing = [f"{vk}/{k}" for vk in VOICES for k in lines if not (OUT / vk / f"{k}.mp3").exists()]
    print(f"  파일 {sum(1 for _ in OUT.rglob('*.mp3'))}개, 합계 {total/1048576:.1f} MB")
    if missing:
        sys.exit(f"  ✗ 만들어지지 않은 파일 {len(missing)}개: {missing[:5]}")

if __name__ == "__main__":
    asyncio.run(main("--all" in sys.argv))
