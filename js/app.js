/* ── 짬짬이 쉼 — 자동 진행 재생기 ──
   흐름: HOME → SETUP → PLAYING → (PAUSED) → DONE
   PLAYING 은 data/sessions.json 의 steps 를 순서대로 소비하는 타임라인 하나다.
   시작 버튼 이후 교사는 아무것도 누르지 않는다 — 화면 안 버튼은 일시정지 하나뿐. */
(function () {
  'use strict';

  // ── 상수 (scripts/validate-data.mjs 가 이 상수들을 읽어 데이터와 대조한다) ──
  var TYPES = {
    breath:  { emoji: '🫁', name: '숨 고르기', desc: '원과 네모를 따라 천천히 숨 쉬어요' },
    sound:   { emoji: '🌧', name: '소리 여행', desc: '눈을 감고 소리만 들어요' },
    imagine: { emoji: '🎈', name: '상상 여행', desc: '문장을 따라 천천히 상상해요' },
    relax:   { emoji: '🧊', name: '몸 힘 빼기', desc: '꼭 쥐었다가 스르르 힘을 빼요' },
    mind:    { emoji: '💗', name: '마음 보기', desc: '고마운 것과 내 기분을 떠올려요' }
  };

  var DURATIONS = [1, 3, 5];

  var ANIMS = ['none', 'fade', 'circle-46', 'box-4444', 'glow'];

  var SOUNDS = ['rain', 'wave', 'wind', 'fire', 'none'];

  var PHASES = ['ready', 'breath', 'sound', 'imagine', 'relax', 'mind', 'close'];

  var LS_KEY = 'jjam-rest-v1';
  var RECENT_MAX = 8;
  var TICK_MS = 250;
  // 글자를 완전히 흐린 뒤에 갈아 끼운다 — CSS 의 transition 길이와 같은 값이어야
  // 한다(style.css 의 .play-text / .anim-label). 짧으면 반쯤 보이는 글자 위에
  // 다음 문장이 얹혀 급전환처럼 보인다.
  var TEXT_FADE_MS = 500;
  var LABEL_FADE_MS = 250;

  // 애니메이션 키 → 무대 마크업. 같은 키가 이어지면 다시 만들지 않는다
  // (호흡 주기가 단계 경계에서 끊기지 않도록).
  var ANIM_HTML = {
    'circle-46':
      '<div class="breath-circle"><div class="bc-disc"></div>' +
      '<div class="anim-label"></div></div>',
    'box-4444':
      '<div class="breath-box"><div class="bb-square"></div><div class="bb-dot"></div>' +
      '<div class="anim-label"></div></div>',
    'glow': '<div class="calm-glow"></div>',
    'fade': '<div class="calm-still"></div>',
    'none': ''
  };

  // 호흡 라벨 주기 — [문구, 초] 를 순서대로 도는 사이클.
  // CSS 키프레임이 아니라 여기서 타이머로 바꾼다: prefers-reduced-motion 환경에서는
  // CSS 애니메이션 타임라인이 멈춰 라벨 교대까지 정지해 버리기 때문이다.
  // 초 구성은 CSS 의 같은 이름 키프레임과 길이가 일치해야 한다(원 10초·네모 16초).
  var ANIM_CYCLE = {
    'circle-46': [['들이쉬어요', 4], ['내쉬어요', 6]],
    'box-4444': [['들이쉬어요', 4], ['멈춰요', 4], ['내쉬어요', 4], ['멈춰요', 4]]
  };

  // ── 상태 ──
  var sessions = [];
  var byId = {};
  var store = loadStore();

  var S = {
    type: null,
    session: null,
    // 저장값을 그대로 믿지 않는다 — 저장소가 깨졌거나 옛 버전이 남아 있으면
    // 아무 버튼도 선택되지 않은 채로 99분짜리 세션이 시작될 수 있다.
    duration: DURATIONS.indexOf(store.duration) !== -1 ? store.duration : 3,
    timeline: [],      // buildTimeline 결과
    bounds: [],        // 단계 누적 종료 시각(초)
    total: 0,
    stepIdx: -1,
    curAnim: null,
    animStartAt: 0,    // 지금 무대가 만들어진 시점(경과 초) — 라벨 위상 계산 기준
    labelIdx: -1,
    startAt: 0,        // performance.now() 기준
    pausedAccum: 0,
    pausedAt: 0,
    paused: false,
    handle: null
  };

  // ── 저장소 — 음소거·최근 사용·마지막 시간 선택만 (학생 정보 없음) ──
  function loadStore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var s = raw ? JSON.parse(raw) : {};
      s.recent = s.recent || [];
      s.muted = !!s.muted;
      return s;
    } catch (e) {
      return { recent: [], muted: false };
    }
  }
  function saveStore() {
    store.duration = S.duration;
    try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* 무시 */ }
  }

  // ── 유틸 ──
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  // ── 예약된 화면 전환 ──────────────────────────────
  // 문구·라벨 교체는 크로스페이드 뒤에 일어난다. 그 대기 시간은 벽시계
  // setTimeout 이라 일시정지가 건드리지 못한다 — 그대로 두면 멈춘 화면에서
  // 글자가 저절로 넘어간다. 예약을 한곳에 모아 두고, 멈출 때 즉시 끝낸다.
  var pending = { fadeTimer: null, labelTimer: null };

  function schedule(slot, fn, ms) {
    cancel(slot);
    pending[slot] = { fn: fn, id: setTimeout(function () { pending[slot] = null; fn(); }, ms) };
  }
  function cancel(slot) {
    if (pending[slot]) { clearTimeout(pending[slot].id); pending[slot] = null; }
  }
  function flushPending() {
    Object.keys(pending).forEach(function (slot) {
      var p = pending[slot];
      if (!p) return;
      clearTimeout(p.id);
      pending[slot] = null;
      p.fn();
    });
  }

  function show(screenId) {
    ['screen-home', 'screen-setup', 'screen-play', 'screen-done'].forEach(function (id) {
      $(id).hidden = (id !== screenId);
    });
    // 진행 중에는 자매 사이트 바로가기를 숨긴다 — 쉼 도중에 눌러 나가지 않도록.
    var sw = $('site-switch');
    if (sw) sw.hidden = (screenId === 'screen-play');
    window.scrollTo(0, 0);
  }

  // ── 편 뽑기 — 최근 사용한 편은 같은 유형에서 다시 뽑을 때 제외 ──
  function candidates(type, excludeRecent, excludeId) {
    return sessions.filter(function (ss) {
      if (ss.type !== type) return false;
      if (ss.id === excludeId) return false;
      if (excludeRecent && store.recent.indexOf(ss.id) !== -1) return false;
      return true;
    });
  }
  function recommend(type, excludeId) {
    var pool = candidates(type, true, excludeId);
    if (!pool.length) pool = candidates(type, false, excludeId);
    if (!pool.length) pool = candidates(type, false, null);
    return pool.length ? pick(pool) : null;
  }

  // ── 타임라인 — durations 에 따라 steps 를 자르거나 반복하는 규칙 (PRD 8절) ──
  // steps = [ready, body..., close]. 시간 d분의 body 예산 = d*60 − ready − close.
  // body 를 앞에서부터 채우고, 모자라면 처음부터 반복해 총합을 정확히 d*60초로 만든다.
  // 1분 모드는 자연히 첫 단계만 남는다.
  var TAIL_MIN = 20;   // 이보다 짧은 자투리는 새 문구를 끼우지 않는다

  function buildTimeline(session, minutes) {
    var steps = session.steps;
    var ready = steps[0];
    var close = steps[steps.length - 1];
    var body = steps.slice(1, -1);
    var budget = minutes * 60 - ready.seconds - close.seconds;
    var out = [ready];
    var used = 0, i = 0;
    while (used < budget && body.length) {
      var remain = budget - used;
      var src = body[i % body.length];
      // 자투리가 짧으면 새 문구를 띄우지 않고 직전 단계를 늘린다.
      // 그러지 않으면 5분 모드 마무리 직전에 "두 주먹을 꽉 쥐어요" 같은
      // 도입 문구가 10초짜리로 끼어들어 진정 흐름이 끊긴다.
      if (remain < TAIL_MIN && out.length > 1) {
        out[out.length - 1].seconds += remain;
        break;
      }
      out.push({
        phase: src.phase,
        text: src.text,
        seconds: Math.min(src.seconds, remain),
        anim: src.anim,
        // 두 바퀴째부터는 소리 지시를 따르지 않고 그때 상태를 유지한다.
        // 본체 첫 단계는 보통 "소리 없이 익히기"라 sound:false 인데, 그것이
        // 그대로 복사되면 가장 차분해야 할 마지막 구간에서 배경음이 꺼진다.
        sound: i < body.length ? src.sound : undefined
      });
      used += Math.min(src.seconds, remain);
      i++;
    }
    out.push(close);
    return out;
  }

  // ── 화면: 홈 ──
  function renderHome() {
    var grid = $('type-grid');
    grid.innerHTML = Object.keys(TYPES).map(function (key) {
      var t = TYPES[key];
      return '<button class="type-card" type="button" data-type="' + key + '">' +
        '<span class="type-emoji" aria-hidden="true">' + t.emoji + '</span>' +
        '<span class="type-name">' + esc(t.name) + '</span>' +
        '<span class="type-desc">' + esc(t.desc) + '</span></button>';
    }).join('');

    var recent = store.recent.map(function (id) { return byId[id]; }).filter(Boolean);
    $('recent-section').hidden = !recent.length;
    $('recent-row').innerHTML = recent.map(function (ss) {
      return '<button class="session-chip" type="button" data-id="' + ss.id + '">' +
        TYPES[ss.type].emoji + ' ' + esc(ss.title) + '</button>';
    }).join('');
  }

  // ── 화면: 시간 선택 ──
  function goSetup(type, pinnedId) {
    S.type = type;
    S.session = pinnedId ? byId[pinnedId] : recommend(type, null);
    if (!S.session) return;
    $('setup-title').textContent = TYPES[type].emoji + ' ' + TYPES[type].name;
    renderSetup();
    show('screen-setup');
  }

  function renderSetup() {
    $('picked-title').textContent = S.session.title;
    // 이 편이 지원하는 시간만 그린다 — 화면에 없는 시간은 아무도 고를 수 없어야 한다.
    var avail = DURATIONS.filter(function (d) { return S.session.durations.indexOf(d) !== -1; });
    if (avail.indexOf(S.duration) === -1) S.duration = avail[0];
    $('opt-duration').innerHTML = avail.map(function (d) {
      var on = (d === S.duration);
      return '<button class="opt-btn" type="button" role="radio" aria-checked="' + on + '" data-d="' + d + '">' +
        d + '분</button>';
    }).join('');
  }

  // ── 화면: 진행 ──
  function start() {
    stopTimer();   // 어떤 경로로든 이전 타이머가 살아 있으면 여기서 끊는다
    S.timeline = buildTimeline(S.session, S.duration);
    S.bounds = [];
    var acc = 0;
    S.timeline.forEach(function (st) { acc += st.seconds; S.bounds.push(acc); });
    S.total = acc;
    S.stepIdx = -1;
    S.curAnim = null;
    S.animStartAt = 0;
    S.labelIdx = -1;
    S.pausedAccum = 0;
    S.paused = false;
    saveStore();

    // AudioContext 는 사용자 제스처(시작 클릭) 안에서 만든다
    if (window.JjamSound) {
      JjamSound.ensure();
      JjamSound.setMuted(store.muted);
    }

    $('play-anim').innerHTML = '';
    $('play-text').textContent = '';
    $('play-text').classList.remove('fading');
    // 첫 tick 전까지 이전 세션의 남은 시간이 남아 보이지 않게 미리 채운다.
    $('play-remain').textContent = fmt(S.total);
    $('screen-play').classList.remove('paused');
    setPauseBtn(false);
    show('screen-play');

    S.startAt = performance.now();
    applyStep(0, true);
    S.handle = setInterval(tick, TICK_MS);
  }

  function elapsedSec() {
    return (performance.now() - S.startAt - S.pausedAccum) / 1000;
  }

  function tick() {
    if (S.paused) return;
    var e = elapsedSec();
    if (e >= S.total) { finish(); return; }
    $('play-remain').textContent = fmt(S.total - e);
    var idx = 0;
    while (idx < S.bounds.length - 1 && e >= S.bounds[idx]) idx++;
    if (idx !== S.stepIdx) applyStep(idx, false);
    updateLabel(e);
  }

  // 호흡 라벨 — 무대가 만들어진 시점부터의 경과를 사이클에 대입한다.
  // CSS 애니메이션도 삽입 시점에 시작하므로 원·점의 움직임과 위상이 맞는다.
  // 일시정지 중에는 elapsedSec 이 멈춰 있어 라벨도 함께 멈춘다.
  function updateLabel(e) {
    var cycle = ANIM_CYCLE[S.curAnim];
    var el = $('play-anim').querySelector('.anim-label');
    if (!cycle || !el) { S.labelIdx = -1; return; }

    var period = 0, i;
    for (i = 0; i < cycle.length; i++) period += cycle[i][1];
    var t = (e - S.animStartAt) % period;
    var acc = 0, idx = 0;
    for (i = 0; i < cycle.length; i++) {
      acc += cycle[i][1];
      if (t < acc) { idx = i; break; }
    }
    if (idx === S.labelIdx) return;
    var first = (S.labelIdx === -1);
    S.labelIdx = idx;
    // 무대를 막 만들었을 때는 페이드 없이 바로 쓴다 —
    // 그러지 않으면 새 호흡 단계마다 라벨이 잠깐 빈칸으로 남는다.
    if (first) { el.textContent = cycle[idx][0]; return; }
    el.classList.add('fading');
    schedule('labelTimer', function () {
      el.textContent = cycle[idx][0];
      el.classList.remove('fading');
    }, LABEL_FADE_MS);
  }

  function applyStep(idx, immediate) {
    S.stepIdx = idx;
    var st = S.timeline[idx];
    var textEl = $('play-text');

    function put() {
      textEl.textContent = st.text;
      textEl.classList.remove('fading');
      // 같은 애니메이션이 이어지면 그대로 둔다 — 호흡 주기가 끊기지 않게.
      if (st.anim !== S.curAnim) {
        $('play-anim').innerHTML = ANIM_HTML[st.anim] || '';
        S.curAnim = st.anim;
        S.animStartAt = elapsedSec();
        S.labelIdx = -1;
        updateLabel(S.animStartAt);
      }
    }

    // 소리 — 단계에 sound:false/true 가 있으면 그대로 따른다 (없으면 유지)
    if (window.JjamSound && st.sound !== undefined) {
      if (st.sound) JjamSound.play(S.session.sound);
      else JjamSound.stop();
    }

    if (immediate) { cancel('fadeTimer'); put(); return; }
    textEl.classList.add('fading');
    schedule('fadeTimer', put, TEXT_FADE_MS);
  }

  function setPauseBtn(paused) {
    $('btn-pause').textContent = paused ? '▶ 계속' : '⏸ 일시정지';
  }

  // ── 일시정지 — 소리·화면·타이머가 함께 멈추고 함께 재개된다 (FR-03) ──
  function togglePause() {
    if (S.paused) {
      S.pausedAccum += performance.now() - S.pausedAt;
      S.paused = false;
      $('screen-play').classList.remove('paused');
      if (window.JjamSound) JjamSound.resume();
    } else {
      // 크로스페이드 도중에 멈추면 글자가 반쯤 흐려진 채 굳거나, 벽시계
      // setTimeout 이 살아남아 정지 중에 문구가 저절로 넘어간다.
      // 예약된 전환을 지금 끝내 놓고 멈춘다 — 화면이 실제로 정지한다.
      flushPending();
      S.pausedAt = performance.now();
      S.paused = true;
      $('screen-play').classList.add('paused');
      if (window.JjamSound) JjamSound.suspend();
    }
    setPauseBtn(S.paused);
  }

  function stopTimer() {
    clearInterval(S.handle);
    cancel('fadeTimer');
    cancel('labelTimer');
    S.handle = null;
  }

  // ── 마무리 ──
  function finish() {
    stopTimer();
    if (window.JjamSound) { JjamSound.stop(); JjamSound.chime(); }
    // 최근 사용 기록 — 실제로 완주한 편만
    store.recent = [S.session.id].concat(
      store.recent.filter(function (id) { return id !== S.session.id; })
    ).slice(0, RECENT_MAX);
    saveStore();
    $('done-text').textContent = S.session.closing;
    show('screen-done');
    renderHome();   // 최근 사용 갱신
  }

  function abandon() {
    if ($('screen-play').hidden === false) {
      stopTimer();
      if (window.JjamSound) JjamSound.stop(0.3);
    }
  }

  function goHome() {
    abandon();
    renderHome();
    show('screen-home');
  }

  // ── 음소거 (FR-04) ──
  function renderMute() {
    $('btn-mute').setAttribute('aria-pressed', store.muted ? 'true' : 'false');
  }
  function toggleMute() {
    store.muted = !store.muted;
    saveStore();
    renderMute();
    if (window.JjamSound) JjamSound.setMuted(store.muted);
  }

  // ── 이벤트 ──
  function bind() {
    $('type-grid').addEventListener('click', function (e) {
      var card = e.target.closest('.type-card');
      if (card) goSetup(card.getAttribute('data-type'), null);
    });
    $('recent-row').addEventListener('click', function (e) {
      var chip = e.target.closest('.session-chip');
      if (chip) {
        var ss = byId[chip.getAttribute('data-id')];
        if (ss) goSetup(ss.type, ss.id);
      }
    });
    $('opt-duration').addEventListener('click', function (e) {
      var btn = e.target.closest('.opt-btn');
      if (!btn) return;
      S.duration = Number(btn.getAttribute('data-d'));
      renderSetup();
    });
    $('btn-swap').addEventListener('click', function () {
      var next = recommend(S.type, S.session.id);
      if (next) { S.session = next; renderSetup(); }
    });
    $('btn-setup-back').addEventListener('click', goHome);
    $('btn-start').addEventListener('click', start);
    $('btn-pause').addEventListener('click', togglePause);
    $('btn-again').addEventListener('click', function () {
      S.session = recommend(S.type, S.session.id) || S.session;
      renderSetup();
      show('screen-setup');
    });
    $('btn-done-home').addEventListener('click', goHome);
    $('brand-home').addEventListener('click', function (e) { e.preventDefault(); goHome(); });
    $('btn-mute').addEventListener('click', toggleMute);
  }

  // ── 시작 ──
  function init() {
    renderMute();
    bind();
    fetch('data/sessions.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        sessions = data.sessions;
        sessions.forEach(function (ss) { byId[ss.id] = ss; });
        renderHome();
      })
      .catch(function () {
        $('type-grid').innerHTML =
          '<p class="cta-copy">콘텐츠를 불러오지 못했어요. 새로고침해 주세요.</p>';
      });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 미지원 */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
