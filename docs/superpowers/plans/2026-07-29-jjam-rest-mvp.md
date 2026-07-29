# 짬짬이 쉼 (jjam-rest) MVP 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 전자칠판용 정적 웹앱 "짬짬이 쉼" — 유형·시간 선택 후 완전 자동 진행되는 진정 활동 (PRD `짬짬이_쉼_PRD.md` 전체 구현 + 가족 인프라 합류 + GitHub Pages 배포).

**Architecture:** 순수 정적 사이트(HTML/CSS/Vanilla JS, 빌드 없음). `data/sessions.json`이 콘텐츠 단일 소스, `js/app.js`가 타임라인 재생기(상태기계 HOME→SETUP→PLAYING→PAUSED→DONE), `js/sound.js`가 Web Audio 합성음. 자매 사이트(jjam-story) 구조·관례를 그대로 따른다.

**Tech Stack:** HTML/CSS/Vanilla JS, Web Audio API, Service Worker, GitHub Pages, Node 스크립트(검증·동기화), gh CLI.

## Global Constraints (PRD에서 발췌)

- 시작 후 교사 조작 0회. 진행 화면 버튼은 **일시정지 하나만**.
- 1·3·5분 모드는 선언 시간 ±5초 안에 종료.
- 소리는 항상 보조 — 음소거 상태로도 전 과정이 이해돼야 함.
- 음원 파일 금지 — Web Audio 합성만 (rain, wave, wind, fire, none).
- 안전 기준: 종교 표현·수면 유도·무서운 소재 금지, 빠른 점멸 금지, `prefers-reduced-motion` 시 페이드 대체.
- 문구는 청유형 한 문장, 화면에 하나만. 본문 32px 상당 이상.
- 브랜드색 티일 `#0E7C86` 안팎. 아이콘은 "같은 틀(둥근 타일+시계 배지) + 티일 바탕 + 쉼 심볼".
- 가족 관례: 상류 jjam의 shared 파일 동기화(sync-shared), PR 생성 → CI 통과 시 squash 머지.
- 로컬 저장: 음소거·최근 사용·마지막 시간 선택만.

## 파일 구조

| 파일 | 책임 |
|---|---|
| `index.html` | 4개 화면(home/setup/play/done), 티일 topbar, switcher host |
| `css/style.css` | 티일 디자인 시스템 + 호흡 애니메이션(circle-46, box-4444, fade) + reduced-motion |
| `js/app.js` | 상수(TYPES/DURATIONS/ANIMS/SOUNDS), 상태기계, 타임라인 재생, localStorage |
| `js/sound.js` | `JjamSound` — 합성 프리셋 4종, 시작/정지/일시정지/음소거 |
| `data/sessions.json` | 세션 16편 (breath 4 · sound 3 · imagine 3 · relax 3 · mind 3) |
| `favicon.svg` | 티일 타일 + 흰 동심원(숨) 심볼 + 시계 배지 |
| `manifest.json`, `sw.js` | PWA·오프라인(network-first) |
| `scripts/validate-data.mjs` | sessions.json ↔ app.js 상수 대조 + 안전 기준 문구 검사 |
| `scripts/sync-shared.mjs` | jjam-story 것 복사 (상류 jjam 동기화) |
| `.github/workflows/ci.yml`, `shared-sync.yml` | verify 게이트, 드리프트 확인(05:30 KST) |
| `assets/fonts/*`, `shared/jjam-switcher.js` | 상류 공통 파일 (sync-shared 대상) |
| `assets/icons/*.png` | gen-icons로 favicon.svg에서 생성 |
| `.claude/launch.json`, `README.md`, `.gitignore` | 부속 |

## 핵심 설계 결정

**타임라인 규칙 (durations → steps):** 세션의 steps는 `ready 1개 + body N개 + close 1개` 순서. 시간 d분의 body 예산 = `d*60 − ready.seconds − close.seconds`. body를 앞에서부터 채우고, 예산이 남으면 body를 처음부터 반복, 마지막 단계는 예산에 맞게 초를 잘라 정확히 d*60초를 만든다(호흡 애니메이션은 주기적이라 중간 절단 무해). 1분 모드는 자연히 첫 body 단계만 남는다(PRD 8절 부합).

**일시정지:** `performance.now()` 기반 누적 시간 관리. pause 시 setInterval 정지 + `AudioContext.suspend()` + play 화면에 `.paused` 클래스(`animation-play-state: paused`).

**애니메이션:** `circle-46`(원이 4초 커지고 6초 작아짐, 들숨/날숨 라벨은 같은 주기의 opacity 키프레임으로 교대), `box-4444`(정사각 둘레를 도는 점 16초 주기 + 4단계 라벨), `fade`, `none`. reduced-motion에서는 크기·이동 애니메이션을 라벨 페이드만으로 대체.

**합성음:** 공용 노이즈 버퍼(2초 루프) 기반 — rain=lowpass 노이즈, wave=lowpass 노이즈+느린 gain LFO, wind=밴드패스 중심주파수 LFO 스윕, fire=저역 노이즈+빠른 지터 LFO. 종료 시 아주 작은 2음 차임. 마스터 gain으로 음소거(localStorage `jjam-rest-v1`).

---

### Task 1: 저장소 골격 + 세로 관통 (홈→자동 진행→마무리)

**Files:** `index.html`, `css/style.css`, `js/app.js`, `data/sessions.json`(breath 3편), `.gitignore`, `.claude/launch.json`

- [ ] git init, .gitignore(jjam-story 참고), 파일 골격 작성
- [ ] index.html: topbar(티일) + 4 screen + 진행 화면(문장 1줄·anim 영역·남은시간 소형·일시정지 버튼 1개)
- [ ] app.js: 상수 + 상태기계 + 타임라인 빌드/재생 + localStorage(음소거·최근·마지막 시간)
- [ ] sessions.json: 숨 고르기 3편
- [ ] 로컬 서버로 1분 모드 완주 검증(브라우저 DOM), ±5초 확인
- [ ] commit

### Task 2: 호흡 애니메이션

**Files:** `css/style.css`, `js/app.js`(anim 마운트)

- [ ] circle-46, box-4444, fade 구현 + 라벨 키프레임
- [ ] `prefers-reduced-motion` 대체 경로
- [ ] 브라우저 육안·DOM 검증, commit

### Task 3: Web Audio 합성음

**Files:** `js/sound.js`, `index.html`(음소거 토글), `js/app.js`(연결)

- [ ] JjamSound: init(사용자 제스처)·play(preset)·stop·suspend·resume·mute
- [ ] rain/wave/wind/fire 프리셋 + 종료 차임
- [ ] 일시정지·음소거 연동 검증, commit

### Task 4: 콘텐츠 16편 완성

**Files:** `data/sessions.json`

- [ ] 나머지 4유형 13편 작성 (작성·안전 기준 준수, 청유형·한 문장)
- [ ] 전 편 정독 검수(편중·금지 표현), commit

### Task 5: 검증 스크립트 + CI + 공통 인프라 합류

**Files:** `scripts/validate-data.mjs`, `scripts/sync-shared.mjs`, `scripts/check-font-coverage.mjs`, `shared/jjam-switcher.js`, `assets/fonts/*`, `.github/workflows/ci.yml`, `.github/workflows/shared-sync.yml`, `package.json`

- [ ] validate-data: app.js 상수 추출 대조 + 스키마 + 금지 문구(잠들/최면/기도 등) + 유형별 편수
- [ ] 공통 파일 복사(jjam-story 클론에서) + sync-shared --check 통과
- [ ] check-font-coverage 실행 — 미포함 글자 확인 (Task 8에서 상류 서브셋 갱신으로 해결)
- [ ] `node scripts/validate-data.mjs` 통과, commit

### Task 6: 아이콘 + PWA + 반응형

**Files:** `favicon.svg`, `assets/icons/*.png`, `manifest.json`, `sw.js`, `css/style.css`

- [ ] favicon.svg: 티일 타일 + 동심원 심볼 + 공통 배지
- [ ] gen-icons(로컬 Chrome/Edge channel로 playwright 실행) → PNG 4종
- [ ] manifest, sw(network-first, 캐시 목록 전 파일), 전자칠판(대형)·태블릿 반응형 점검
- [ ] 오프라인 재방문 동작 확인, commit

### Task 7: GitHub 저장소 생성 + Pages 배포

- [ ] `gh repo create shway81-droid/jjam-rest --public` + push main
- [ ] Pages 활성화(main 루트), `Invoke-WebRequest`로 200 확인 (실패사전: curl 금지)
- [ ] README.md 작성, commit

### Task 8: 상류 jjam 합류 + 5개 저장소 동기화

**Files (jjam):** `shared/jjam-switcher.js`(SITES+ART에 rest 추가), 필요시 `assets/fonts/*`(서브셋 재생성)

- [ ] 쉼 문구의 미포함 글자가 있으면: 5개 저장소 사용 문자 합집합으로 pyftsubset 재생성 + coverage.txt 갱신 (fonttools 설치 실패 시 경고 수용하고 건너뜀)
- [ ] jjam PR 생성 → CI 통과 → squash 머지 (CLAUDE.md 관례)
- [ ] jjam-quiz·jjam-video·jjam-story·jjam-rest 각각 sync-shared 실행 → PR → CI → squash 머지
- [ ] 최종 검증: 배포된 쉼에서 자매 4곳 바로가기, 자매 사이트에서 쉼 바로가기 확인

### Task 9: 완료 기준 전수 검증

- [ ] PRD 12절 완료 기준 8항목을 배포본에서 하나씩 확인, 결과 기록
