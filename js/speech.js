/* ── 짬짬이 쉼 — 문구 읽어주기 (브라우저 내장 음성합성) ──
   눈을 감고 하는 활동에서 화면의 문구는 읽을 수 없다. 그 문구를 소리로도
   전한다. 배경음과 같은 이유로 음원 파일을 두지 않는다 (PRD 9절) —
   녹음 파일 대신 브라우저에 이미 들어 있는 목소리를 쓴다:
   용량 0, 저작권 문제 0, 문구를 고쳐도 다시 녹음할 일이 없다.

   두 엔진이 있다. 기본은 만들어 둔 목소리 파일(js/voice-files.js — 선히·현수,
   명상 안내에 맞춰 늦추고 낮춘 것)이고, 파일이 없는 문구나 파일 목소리를 끈
   기기에서는 브라우저 내장 음성합성으로 읽는다.

   목소리는 항상 보조다. 어느 엔진도 없는 기기에서는 통째로 꺼지고, 활동은
   화면과 배경음만으로 완결된다. supported() 가 거짓이면 앱이 설정 화면의
   목소리 항목 자체를 감춘다. */
var JjamSpeech = (function () {
  'use strict';

  // 교실에서 따라 하기 좋은 속도 — 기본값(1.0)은 쉼 활동에 빠르다.
  var RATE = 0.86;
  var PITCH = 1.02;

  // cancel() 직후의 speak() 는 크롬에서 그대로 삼켜지는 일이 있다.
  // 큐가 비워질 틈을 주고 넣는다.
  var START_DELAY_MS = 80;
  // pause() 가 실제로 걸렸는지 확인하는 시점 (아래 resume 주석 참고).
  var RESUME_CHECK_MS = 240;

  var voice = null;
  var chosenName = '';    // 교사가 고른 목소리 이름 (없으면 순위 1등)
  var fellBack = false;   // 네트워크 목소리 실패로 기기 목소리로 되돌렸는가
  var lastCount = 0;      // 마지막으로 본 한국어 목소리 개수
  var enabled = true;
  var muted = false;
  var warmed = false;

  var speaking = false;
  var startTimer = null;
  var lastText = '';
  var wasSpeaking = false;   // 일시정지 시점에 실제로 읽는 중이었는가

  var onSpeakChange = null;  // 말하는 동안 배경음을 낮추기 위한 통지
  var onReady = null;        // 목소리 목록이 뒤늦게 도착했을 때 화면 갱신

  // ── 만들어 둔 목소리 파일 (js/voice-files.js) ──
  // fileVoice 가 비어 있지 않으면 파일이 있는 문구는 그 목소리 파일로 읽는다.
  // app.js 가 다음 문구를 미리 받아 풀어 두고(prime), 여기서는 꺼내 쓴다.
  var fileVoice = '';        // 'sunhi' | 'hyunsu' | '' (끔)
  var voiceHandle = null;    // 재생 중인 파일 목소리
  var seq = 0;               // 늦게 도착한 파일을 버리기 위한 표
  var lastEngine = '';       // 마지막 문구를 읽은 엔진 — pause/resume 이 이것만 다룬다

  function synth() {
    try { return window.speechSynthesis || null; } catch (e) { return null; }
  }

  // 한국어 목소리만 쓴다 — 영어 목소리에 한글을 넘기면 글자를 하나씩
  // 영어식으로 읽어 알아들을 수 없는 소리가 난다. 없으면 없는 대로 둔다.
  function koreanVoices() {
    var s = synth();
    if (!s) return [];
    var list;
    try { list = s.getVoices() || []; } catch (e) { return []; }
    return list.filter(function (v) { return /^ko\b|^ko[-_]/i.test(v.lang || ''); });
  }

  // 자연스러움 순위 — 이름으로 신경망 계열을 알아본다.
  // 기기에 설치된 목소리를 먼저 고르면 오프라인에는 안전하지만, 윈도우의
  // 기본 한국어(혜미)는 십수 년 된 연결합성이라 또렷해도 기계처럼 들린다.
  // 같은 기기에 구글·신경망 목소리가 함께 있으면 그쪽이 사람에 훨씬 가깝다.
  // 그래서 자연스러운 쪽을 기본으로 두고, 네트워크 목소리가 실패하면
  // (오프라인 교실) 아래 speak 의 폴백이 기기 목소리로 되돌린다.
  var VOICE_RANK = [
    /google/i,                       // Google 한국의 — 신경망
    /neural|natural|sunhi|injoon/i,  // 마이크로소프트 신경망 계열
    /yuna|sora|siri/i                // 애플
  ];

  function scoreVoice(v) {
    for (var i = 0; i < VOICE_RANK.length; i++) {
      if (VOICE_RANK[i].test(v.name || '')) return i;
    }
    // 알 수 없는 목소리는 기기에 설치된 쪽을 먼저 — 오프라인에서 확실히 난다.
    return VOICE_RANK.length + (v.localService ? 0 : 1);
  }

  function ranked() {
    return koreanVoices().slice().sort(function (a, b) { return scoreVoice(a) - scoreVoice(b); });
  }

  function pickVoice() {
    var list = ranked();
    if (!list.length) return null;
    // 교사가 고른 목소리가 아직 있으면 그것을 지킨다.
    if (chosenName) {
      for (var i = 0; i < list.length; i++) if (list[i].name === chosenName) return list[i];
    }
    return list[0];
  }

  function refresh() {
    lastCount = koreanVoices().length;
    var v = pickVoice();
    if (v) voice = v;
    return !!voice;
  }

  function notify(on) {
    if (speaking === on) return;
    speaking = on;
    if (onSpeakChange) { try { onSpeakChange(on); } catch (e) { /* 무시 */ } }
  }

  function utter(text) {
    var s = synth();
    if (!s || !voice) return;
    var u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang || 'ko-KR';
    u.rate = RATE;
    u.pitch = PITCH;
    u.volume = 1;
    u.onstart = function () { fellBack = false; notify(true); };
    u.onend = function () { notify(false); };
    // 네트워크 목소리는 오프라인 교실에서 소리 없이 실패한다. 그때 기기에
    // 설치된 목소리로 한 번 되돌려 다시 읽는다 — 자연스러움보다 들리는 것이 먼저다.
    u.onerror = function () {
      notify(false);
      if (fellBack || voice.localService) return;
      var local = null, list = koreanVoices();
      for (var i = 0; i < list.length; i++) if (list[i].localService) { local = list[i]; break; }
      if (!local) return;
      fellBack = true;
      voice = local;
      utter(text);
    };
    try { s.speak(u); } catch (e) { notify(false); }
  }

  function hardCancel() {
    seq++;                      // 아직 받는 중인 파일을 버린다
    stopFile();
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    var s = synth();
    if (s) { try { s.cancel(); } catch (e) { /* 무시 */ } }
    notify(false);
  }

  /* 한 문장을 읽는다. 앞 문장은 끊는다 — 화면의 문구가 이미 바뀌었으므로
     들리는 말과 보이는 글이 어긋나지 않아야 한다. */
  function speak(text, key) {
    if (!text || !enabled || muted) return;
    if (fileVoice && key && window.JjamVoiceFiles && JjamVoiceFiles.has(key, text)) {
      speakFile(key);
      return;
    }
    var s = synth();
    if (!s || !voice) return;
    hardCancel();
    lastEngine = 'browser';
    lastText = String(text);
    startTimer = setTimeout(function () {
      startTimer = null;
      utter(lastText);
    }, START_DELAY_MS);
  }

  function pause() {
    // 파일 목소리는 AudioContext 로 나므로 JjamSound.suspend() 가 이미
    // 그 자리에서 멈춰 세운다. 여기서 따로 할 일이 없고, 오히려 건드리면
    // 재개했을 때 문장이 처음부터 다시 나온다.
    if (lastEngine !== 'browser') return;
    var s = synth();
    if (!s) return;
    // 아직 시작하지 않은 예약은 멈춤 상태를 만들 수 없다 — 예약부터 지운다.
    wasSpeaking = speaking || !!startTimer;
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    try { s.pause(); } catch (e) { /* 무시 */ }
    notify(false);
  }

  function resume() {
    if (lastEngine !== 'browser') return;   // pause 와 같은 이유 — 오디오 시계가 알아서 잇는다
    var s = synth();
    if (!s || !enabled || muted) return;
    try { s.resume(); } catch (e) { /* 무시 */ }
    // 멈추기 전에 이미 다 읽은 문장은 다시 읽지 않는다 — 60초짜리 단계
    // 중간에 방송이 들어와 멈췄다가 재개할 때마다 문구가 되풀이된다.
    if (!wasSpeaking) return;
    wasSpeaking = false;
    // 안드로이드 크롬 등 일부 환경은 pause() 가 사실상 취소로 동작해
    // resume() 이 아무것도 되살리지 못한다. 재개하고도 조용하면 그 문장을
    // 처음부터 다시 읽어 준다 — 화면에 그 문구가 아직 떠 있기 때문이다.
    setTimeout(function () {
      if (!enabled || muted) return;
      if (!s.speaking && !s.pending && lastText) utter(lastText);
    }, RESUME_CHECK_MS);
  }

  /* AudioContext 와 같은 이유로 [시작] 클릭 안에서 한 번 깨워 둔다 —
     사파리는 사용자 제스처 밖에서 시작한 첫 발화를 통째로 무시한다. */
  function ensure() {
    refresh();
    var s = synth();
    if (!s || !voice || warmed) return;
    warmed = true;
    try {
      var u = new SpeechSynthesisUtterance(' ');
      u.voice = voice;
      u.volume = 0;
      s.speak(u);
    } catch (e) { /* 무시 */ }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) hardCancel();
  }

  function setMuted(m) {
    muted = !!m;
    if (muted) hardCancel();
  }

  /* 어느 목소리 파일로 읽을지('sunhi'·'hyunsu', '' 이면 끔). 바꿀 때 하던 말은
     끊는다 — 엔진이 바뀌는데 앞 소리가 남아 있으면 두 목소리가 겹친다. */
  function setFileVoice(key) {
    var next = key || '';
    if (next === fileVoice) return;
    hardCancel();
    fileVoice = next;
  }

  function usingFiles() { return !!fileVoice; }
  function currentFileVoice() { return fileVoice; }

  /* 미리 받아 풀어 두기. 실패는 조용히 넘긴다 — 그때는 speak 가 다시 시도하고,
     그것도 안 되면 브라우저 목소리로, 그것도 없으면 화면 글자만으로 진행된다. */
  function prime(key, text) {
    if (!fileVoice || !key || !window.JjamVoiceFiles) return Promise.resolve();
    if (!JjamVoiceFiles.has(key, text)) return Promise.resolve();
    return JjamVoiceFiles.get(fileVoice, key).then(function () {}, function () { /* 무시 */ });
  }

  // 한 세션이 끝나면 비운다 — 풀어 둔 소리는 파일보다 열 배쯤 크다.
  function clearPrimed() { if (window.JjamVoiceFiles) JjamVoiceFiles.clear(); }

  function stopFile() {
    if (voiceHandle) { try { voiceHandle.stop(); } catch (e) { /* 무시 */ } voiceHandle = null; }
    notify(false);
  }

  function playBuf(buf, mySeq) {
    // 그새 다음 문구로 넘어갔으면 버린다 — 들리는 말과 보이는 글이 어긋나지 않게.
    if (mySeq !== seq || !enabled || muted || !window.JjamSound) return;
    var h = JjamSound.playBuffer(buf);
    if (!h) return;
    voiceHandle = h;
    notify(true);
    h.onended = function () {
      if (voiceHandle === h) { voiceHandle = null; notify(false); }
    };
  }

  function speakFile(key) {
    var mySeq = ++seq;
    hardCancelBrowser();
    stopFile();
    lastEngine = 'file';
    // 미리 받아 둔 것이 있으면 즉시, 없으면 받는 중인 것에 올라탄다.
    JjamVoiceFiles.get(fileVoice, key).then(function (buf) {
      playBuf(buf, mySeq);
    }, function () { /* 조용히 — 활동은 글자만으로도 완결된다 */ });
  }

  // 브라우저 목소리만 끊는다(파일 쪽 표는 건드리지 않는다).
  function hardCancelBrowser() {
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    var s = synth();
    if (s) { try { s.cancel(); } catch (e) { /* 무시 */ } }
  }

  // 파일 목소리가 있으면 브라우저 목소리가 없는 기기에서도 읽을 수 있다.
  function supported() {
    return (fileVoice && !!window.JjamVoiceFiles && JjamVoiceFiles.ready()) || (!!synth() && !!voice);
  }

  /* 기기에 있는 한국어 목소리 목록 — 자연스러운 순으로. 설정 화면이
     두 개 이상일 때만 고르기를 띄운다(하나뿐이면 고를 것이 없다). */
  function list() {
    return ranked().map(function (v) {
      return { name: v.name, local: !!v.localService, current: v.name === currentName() };
    });
  }

  function setVoiceByName(name) {
    chosenName = name || '';
    fellBack = false;
    refresh();
  }

  function currentName() { return voice ? voice.name : ''; }

  /* 미리듣기 — 고른 목소리를 활동 문구 한 줄로 들려준다.
     설정 화면에서 부르므로 사용자 제스처 안이다(사파리 대응). */
  function preview(text, key) {
    if (muted) return;
    if (fileVoice && key && window.JjamVoiceFiles && JjamVoiceFiles.has(key, text)) {
      speakFile(key);
      return;
    }
    var s = synth();
    if (!s || !voice) return;
    hardCancel();
    lastEngine = 'browser';
    lastText = text;
    utter(text);
  }

  // 목소리 목록은 비동기로 채워진다 — 첫 조회가 빈 배열인 브라우저가 많다.
  (function listen() {
    var s = synth();
    if (!s) return;
    refresh();
    if (!s.addEventListener) return;
    s.addEventListener('voiceschanged', function () {
      var hadVoice = !!voice;
      var hadCount = lastCount;
      refresh();
      // 없다가 생겼을 때뿐 아니라 "개수가 달라졌을 때"도 알려야 한다.
      // 크롬은 기기 목소리를 먼저 주고 네트워크 목소리(Google 한국의)를 뒤늦게
      // 붙인다 — 1개→2개로 늘어나는 이 경우를 놓치면 고르기가 영영 안 나타난다.
      if (onReady && ((!hadVoice && voice) || lastCount !== hadCount)) {
        try { onReady(); } catch (e) { /* 무시 */ }
      }
    });
  })();

  return {
    supported: supported,
    ensure: ensure,
    speak: speak,
    cancel: hardCancel,
    pause: pause,
    resume: resume,
    setEnabled: setEnabled,
    setMuted: setMuted,
    setFileVoice: setFileVoice,
    usingFiles: usingFiles,
    currentFileVoice: currentFileVoice,
    prime: prime,
    clearPrimed: clearPrimed,
    list: list,
    setVoiceByName: setVoiceByName,
    currentName: currentName,
    preview: preview,
    setOnSpeakChange: function (fn) { onSpeakChange = fn; },
    setOnReady: function (fn) { onReady = fn; }
  };
})();
