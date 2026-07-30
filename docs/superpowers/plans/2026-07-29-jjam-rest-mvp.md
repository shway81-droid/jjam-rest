# 짬짬이 쉼 (jjam-rest) MVP 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

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

- [x] git init, .gitignore(jjam-story 참고), 파일 골격 작성
- [x] index.html: topbar(티일) + 4 screen + 진행 화면(문장 1줄·anim 영역·남은시간 소형·일시정지 버튼 1개)
- [x] app.js: 상수 + 상태기계 + 타임라인 빌드/재생 + localStorage(음소거·최근·마지막 시간)
- [x] sessions.json: 숨 고르기 3편
- [x] 로컬 서버로 1분 모드 완주 검증(브라우저 DOM), ±5초 확인
- [x] commit

### Task 2: 호흡 애니메이션

**Files:** `css/style.css`, `js/app.js`(anim 마운트)

- [x] circle-46, box-4444, fade 구현 + 라벨 키프레임
- [x] `prefers-reduced-motion` 대체 경로
- [x] 브라우저 육안·DOM 검증, commit

### Task 3: Web Audio 합성음

**Files:** `js/sound.js`, `index.html`(음소거 토글), `js/app.js`(연결)

- [x] JjamSound: init(사용자 제스처)·play(preset)·stop·suspend·resume·mute
- [x] rain/wave/wind/fire 프리셋 + 종료 차임
- [x] 일시정지·음소거 연동 검증, commit

### Task 4: 콘텐츠 16편 완성

**Files:** `data/sessions.json`

- [x] 나머지 4유형 13편 작성 (작성·안전 기준 준수, 청유형·한 문장)
- [x] 전 편 정독 검수(편중·금지 표현), commit

### Task 5: 검증 스크립트 + CI + 공통 인프라 합류

**Files:** `scripts/validate-data.mjs`, `scripts/sync-shared.mjs`, `scripts/check-font-coverage.mjs`, `shared/jjam-switcher.js`, `assets/fonts/*`, `.github/workflows/ci.yml`, `.github/workflows/shared-sync.yml`, `package.json`

- [x] validate-data: app.js 상수 추출 대조 + 스키마 + 금지 문구(잠들/최면/기도 등) + 유형별 편수
- [x] 공통 파일 복사(jjam-story 클론에서) + sync-shared --check 통과
- [x] check-font-coverage 실행 — 미포함 글자 확인 (Task 8에서 상류 서브셋 갱신으로 해결)
- [x] `node scripts/validate-data.mjs` 통과, commit

### Task 6: 아이콘 + PWA + 반응형

**Files:** `favicon.svg`, `assets/icons/*.png`, `manifest.json`, `sw.js`, `css/style.css`

- [x] favicon.svg: 티일 타일 + 동심원 심볼 + 공통 배지
- [x] gen-icons(로컬 Chrome/Edge channel로 playwright 실행) → PNG 4종
- [x] manifest, sw(network-first, 캐시 목록 전 파일), 전자칠판(대형)·태블릿 반응형 점검
- [x] 오프라인 재방문 동작 확인, commit

### Task 7: GitHub 저장소 생성 + Pages 배포

- [x] `gh repo create shway81-droid/jjam-rest --public` + push main
- [x] Pages 활성화(main 루트), `Invoke-WebRequest`로 200 확인 (실패사전: curl 금지)
- [x] README.md 작성, commit

### Task 8: 상류 jjam 합류 + 5개 저장소 동기화

**Files (jjam):** `shared/jjam-switcher.js`(SITES+ART에 rest 추가), 필요시 `assets/fonts/*`(서브셋 재생성)

- [x] 쉼 문구의 미포함 글자가 있으면: 5개 저장소 사용 문자 합집합으로 pyftsubset 재생성 + coverage.txt 갱신 (fonttools 설치 실패 시 경고 수용하고 건너뜀)
- [x] jjam PR 생성 → CI 통과 → squash 머지 (CLAUDE.md 관례)
- [x] jjam-quiz·jjam-video·jjam-story·jjam-rest 각각 sync-shared 실행 → PR → CI → squash 머지
- [x] 최종 검증: 배포된 쉼에서 자매 4곳 바로가기, 자매 사이트에서 쉼 바로가기 확인

### Task 9: 완료 기준 전수 검증

- [x] PRD 12절 완료 기준 8항목을 배포본에서 하나씩 확인, 결과 기록

## 검증 결과 (배포본 https://shway81-droid.github.io/jjam-rest/ 실측)

| PRD 12절 완료 기준 | 결과 |
|---|---|
| 홈에서 10초 안에 활동 시작 | 클릭 3회(유형→시간→시작) |
| 시작 후 마무리까지 한 번도 누르지 않고 완주 | 5분 세션 클릭 0회로 완주 |
| 1·3·5분이 선언 시간 ±5초 안에 종료 | 60.30초 / 180.007초 / 300.065초 |
| 일시정지 시 소리·화면·타이머가 함께 멈추고 함께 재개 | 8초 정지 중 남은시간·라벨 고정, 재개 후 정상 |
| 음소거 상태로도 전 과정이 이해됨 | 라벨을 JS 타이머로 구동 — 소리·CSS와 독립 |
| `prefers-reduced-motion`에서 점멸·급전환 없음 | reduce가 켜진 브라우저에서 전 과정 완주 확인 |
| 전자칠판 뒷자리에서 문구가 읽힘 (32px 상당 이상) | 진행 화면 본문 43.52px |
| GitHub Pages 오류 없이 실행, 오프라인 재방문 동작 | HTTP 200, SW 활성, 자산 12개 캐시 |

1분 모드 재실측(수정 반영 후): 60.07초, 클릭 0회, 문장 opacity 최소 1.0.

## 코드 리뷰에서 잡아 고친 것

배포 후 별도 리뷰와 브라우저 실측으로 찾은 결함들이다. 모두 `8801585` 에서 수정했다.

| 결함 | 증상 | 수정 |
|---|---|---|
| reduced-motion에서 문장 소실 | 그 설정을 켠 브라우저는 CSS transition 진행도 멈춰, 흐려진 글자가 opacity 0 인 채 돌아오지 않았다 — 화면에서 문장이 사라진다 | 그 환경에서는 페이드를 끄고 즉시 교체 |
| 일시정지 중 문구 전환 | 교체 예약이 벽시계 `setTimeout` 이라 멈춘 화면에서 문장이 넘어갔다 (PRD 완료 기준 위반) | 예약을 `pending` 한곳에 모으고 멈출 때 즉시 끝냄 |
| 5분 모드 끝 24~40초 무음 | 본체를 되감을 때 첫 단계의 `sound:false` 가 복사돼, 가장 차분해야 할 구간에서 배경음이 꺼졌다 | 두 바퀴째부터 소리 상태 유지 |
| 마무리 직전 도입 문구 재삽입 | 5분 relax에서 "두 주먹을 꽉 쥐어요" 가 10초짜리로 끼어들었다 | 20초 미만 자투리는 직전 단계를 늘림 |
| 1분 모드 숨 고르기 무음 | 본체 첫 단계만 재생되는데 그것이 `sound:false` 였다 | 본체 첫 단계부터 소리 켬 |
| 저장된 `duration` 미검증 | 저장소가 깨지면 99분 세션이 시작될 수 있었다 | `DURATIONS` 로 검증 |
| `session.durations` 미사용 | 데이터에 없는 시간 버튼도 화면에 그려졌다 | 편별 durations 로 버튼 구성 |
| 크로스페이드 상수 불일치 | JS 500ms vs CSS 1.2s — 30%만 흐려진 상태에서 교체돼 급전환으로 보였다 | 0.5s / 0.25s 로 일치 |
| "하품하듯" 문구 | 하품은 졸음 신호 — PRD 1.4 비목표(수면 유도) 경계 | 문구 교체 + `BANNED` 에 추가 |
| 소리 정지가 벽시계 기준 | 페이드 도중 일시정지하면 소리가 뚝 끊겼다 | 오디오 시계로 예약 |

검증기도 함께 보강했다. `app.js` 의 `buildTimeline` 을 그대로 떼어 와 **48개 조합의 실제
재생 길이·단계 길이·배경음 재생 여부**를 검사한다. 재생 규칙을 깨뜨려 실제로 실패하는 것을
확인했다(마무리 단계를 빼자 "1분 모드의 실제 재생 길이가 50초" 로 잡힘).

## 남은 일

없다.

`.github/workflows/` 2개 파일이 한동안 빠져 있었다 — gh 토큰에 `workflow` 스코프가 없어
push가 거부됐다. `eacfd8c`·`664b69e` 에서 들어왔고, CI(`ci.yml`)와 공통 파일 드리프트
확인(`shared-sync.yml`) 모두 저장소에서 돈다.

## 배포 후 추가로 고친 것

| 결함 | 증상 | 수정 |
|---|---|---|
| SW가 오류 응답도 캐싱 | `res.ok` 를 보지 않고 모든 응답을 `cache.put` 했다. Pages가 잠깐 404·500을 주는 순간에 방문하면 그 오류가 캐시에 들어앉아, 이후 오프라인 재방문에서 계속 그것이 나온다 (FR-08 위반) | 오류 응답은 캐시에 넣지 않고, 성한 사본이 있으면 그것을 내보냄. 이미 오염된 v1 캐시를 버리려 `CACHE` 를 `v2` 로 올림 |
