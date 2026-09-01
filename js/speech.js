/* ── 짬짬이 쉼 — 문구 읽어주기 (브라우저 내장 음성합성) ──
   눈을 감고 하는 활동에서 화면의 문구는 읽을 수 없다. 그 문구를 소리로도
   전한다. 배경음과 같은 이유로 음원 파일을 두지 않는다 (PRD 9절) —
   녹음 파일 대신 브라우저에 이미 들어 있는 목소리를 쓴다:
   용량 0, 저작권 문제 0, 문구를 고쳐도 다시 녹음할 일이 없다.

   목소리는 항상 보조다. 한국어 목소리가 없는 기기(대부분의 리눅스, 일부
   구형 안드로이드)에서는 통째로 꺼지고, 활동은 화면과 배경음만으로 완결된다.
   그런 기기에서 선택지를 보여 주면 눌러도 아무 일이 없으므로,
   supported() 가 거짓이면 앱이 설정 화면의 목소리 항목 자체를 감춘다. */
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
  var enabled = true;
  var muted = false;
  var warmed = false;

  var speaking = false;
  var startTimer = null;
  var lastText = '';
  var wasSpeaking = false;   // 일시정지 시점에 실제로 읽는 중이었는가

  var onSpeakChange = null;  // 말하는 동안 배경음을 낮추기 위한 통지
  var onReady = null;        // 목소리 목록이 뒤늦게 도착했을 때 화면 갱신

  function synth() {
    try { return window.speechSynthesis || null; } catch (e) { return null; }
  }

  // 한국어 목소리만 쓴다 — 영어 목소리에 한글을 넘기면 글자를 하나씩
  // 영어식으로 읽어 알아들을 수 없는 소리가 난다. 없으면 없는 대로 둔다.
  function pickVoice() {
    var s = synth();
    if (!s) return null;
    var list;
    try { list = s.getVoices() || []; } catch (e) { return null; }

    var ko = list.filter(function (v) { return /^ko\b|^ko[-_]/i.test(v.lang || ''); });
    if (!ko.length) return null;
    // 기기에 설치된 목소리를 먼저 고른다 — 네트워크 목소리는 오프라인 교실에서
    // 소리가 나지 않는다. 이 앱은 오프라인 동작을 전제로 한다(PRD 10절).
    for (var i = 0; i < ko.length; i++) if (ko[i].localService) return ko[i];
    return ko[0];
  }

  function refresh() {
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
    u.onstart = function () { notify(true); };
    u.onend = function () { notify(false); };
    u.onerror = function () { notify(false); };
    try { s.speak(u); } catch (e) { notify(false); }
  }

  function hardCancel() {
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    var s = synth();
    if (s) { try { s.cancel(); } catch (e) { /* 무시 */ } }
    notify(false);
  }

  /* 한 문장을 읽는다. 앞 문장은 끊는다 — 화면의 문구가 이미 바뀌었으므로
     들리는 말과 보이는 글이 어긋나지 않아야 한다. */
  function speak(text) {
    if (!text) return;
    var s = synth();
    if (!s || !voice || !enabled || muted) return;
    hardCancel();
    lastText = String(text);
    startTimer = setTimeout(function () {
      startTimer = null;
      utter(lastText);
    }, START_DELAY_MS);
  }

  function pause() {
    var s = synth();
    if (!s) return;
    // 아직 시작하지 않은 예약은 멈춤 상태를 만들 수 없다 — 예약부터 지운다.
    wasSpeaking = speaking || !!startTimer;
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    try { s.pause(); } catch (e) { /* 무시 */ }
    notify(false);
  }

  function resume() {
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

  function supported() { return !!synth() && !!voice; }

  // 목소리 목록은 비동기로 채워진다 — 첫 조회가 빈 배열인 브라우저가 많다.
  (function listen() {
    var s = synth();
    if (!s) return;
    refresh();
    if (!s.addEventListener) return;
    s.addEventListener('voiceschanged', function () {
      var had = !!voice;
      refresh();
      // 없다가 생겼을 때만 알린다 — 화면에 목소리 선택지를 이제 그려도 된다.
      if (!had && voice && onReady) { try { onReady(); } catch (e) { /* 무시 */ } }
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
    setOnSpeakChange: function (fn) { onSpeakChange = fn; },
    setOnReady: function (fn) { onReady = fn; }
  };
})();
