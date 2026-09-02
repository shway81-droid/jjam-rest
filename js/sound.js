/* ── 짬짬이 쉼 — Web Audio 합성 배경음 ──
   음원 파일을 두지 않는다 (PRD 9절). 자연음은 전부 노이즈·오실레이터 합성:
   저작권 문제 0, 용량 0, 오프라인 완전 동작, 길이 무제한.
   AudioContext는 [시작] 클릭(사용자 제스처) 뒤에 만들어 자동재생 정책을 피한다.
   소리는 항상 보조다 — 음소거 상태에서도 활동이 완결된다. */
var JjamSound = (function () {
  'use strict';

  var ctx = null;
  var master = null;      // 음소거는 여기서 한 번에 (차임 포함)
  // 배경음만 지나는 마디. 목소리가 나오는 동안 여기만 낮춘다 —
  // 음소거(master)와 층을 나눠 두지 않으면 둘이 같은 gain 을 서로 덮어쓴다.
  var bus = null;
  var noiseBuf = null;
  var current = null;     // { key, gain, nodes }
  var muted = false;

  // 목소리가 나올 때의 배경음 크기. 0 으로 줄이지 않는다 — 빗소리가 끊겼다
  // 돌아오면 그 자체가 자극이 된다. 뒤로 물러나되 계속 들리는 정도.
  var DUCK = 0.35;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function getNoise() {
    if (noiseBuf) return noiseBuf;
    var len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function noiseSrc() {
    var src = ctx.createBufferSource();
    src.buffer = getNoise();
    src.loop = true;
    return src;
  }

  function lfo(freq, depth, param, base) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = depth;
    osc.connect(g);
    g.connect(param);
    if (base !== undefined) param.value = base;
    osc.start();
    return [osc, g];
  }

  /* 프리셋 — 각 함수는 [시작할 노드들, 마지막 gain] 을 만들어 master 앞에 붙인다 */
  var PRESETS = {
    /* 빗소리 = 필터를 거친 화이트 노이즈 */
    rain: function () {
      var src = noiseSrc();
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300; lp.Q.value = 0.4;
      var g = ctx.createGain(); g.gain.value = 0;
      src.connect(hp); hp.connect(lp); lp.connect(g);
      src.start();
      return { nodes: [src], gain: g, level: 0.11 };
    },
    /* 파도 = 낮게 거른 노이즈에 아주 느린 LFO (밀려왔다 밀려가는 소리) */
    wave: function () {
      var src = noiseSrc();
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.3;
      var swell = ctx.createGain();
      var extra = lfo(0.085, 0.42, swell.gain, 0.58);
      var g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(swell); swell.connect(g);
      src.start();
      return { nodes: [src, extra[0]], gain: g, level: 0.15 };
    },
    /* 바람 = 밴드패스 노이즈, 중심 주파수를 느리게 스윕 */
    wind: function () {
      var src = noiseSrc();
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.1;
      var extra = lfo(0.06, 240, bp.frequency, 520);
      var g = ctx.createGain(); g.gain.value = 0;
      src.connect(bp); bp.connect(g);
      src.start();
      return { nodes: [src, extra[0]], gain: g, level: 0.13 };
    },
    /* 모닥불 = 저역 노이즈(우르르) + 빠른 잔떨림(타닥타닥 느낌) */
    fire: function () {
      var src = noiseSrc();
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 330;
      var crackle = ctx.createGain();
      var e1 = lfo(5.3, 0.16, crackle.gain, 0.7);
      var e2 = lfo(0.9, 0.18, crackle.gain);
      var g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(crackle); crackle.connect(g);
      src.start();
      return { nodes: [src, e1[0], e2[0]], gain: g, level: 0.13 };
    }
  };

  function stop(fadeSec) {
    if (!current || !ctx) return;
    var c = current;
    current = null;
    var t = ctx.currentTime;
    var f = fadeSec === undefined ? 1.0 : fadeSec;
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setValueAtTime(c.gain.gain.value, t);
    c.gain.gain.linearRampToValueAtTime(0.0001, t + f);
    // 노드 정지는 오디오 시계로 예약한다. 벽시계 setTimeout 으로 끊으면
    // 페이드 도중 일시정지했을 때 페이드는 멈춘 채 정지만 실행되어 소리가 뚝 끊긴다.
    c.nodes.forEach(function (n) { try { n.stop(t + f + 0.05); } catch (e) { /* 이미 정지 */ } });
    // 연결 해제는 소리에 영향이 없으므로 넉넉히 뒤에 치운다.
    setTimeout(function () { try { c.gain.disconnect(); } catch (e) { /* 무시 */ } },
      (f + 1.5) * 1000);
  }

  function play(key) {
    if (!PRESETS[key]) { stop(); return; }          // 'none' 등
    if (current && current.key === key) return;      // 같은 소리는 이어 간다
    if (!ensure()) return;
    stop();
    var p = PRESETS[key]();
    p.key = key;
    // 배경음은 bus 를 거친다(차임은 master 로 직행) — 목소리에 밀려 마무리
    // 차임까지 작아지면 활동이 끝났다는 신호가 흐려진다.
    p.gain.connect(bus);
    var t = ctx.currentTime;
    p.gain.gain.setValueAtTime(0.0001, t);
    p.gain.gain.linearRampToValueAtTime(p.level, t + 1.6);   // 느린 페이드 인
    current = p;
  }

  /* 마무리 차임 — 아주 작은 두 음. master를 거치므로 음소거면 들리지 않는다. */
  function chime() {
    if (!ensure()) return;
    [[392.0, 0], [523.25, 0.55]].forEach(function (pair) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = pair[0];
      var t = ctx.currentTime + pair[1];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + 1.7);
    });
  }

  /* 신경망 목소리 재생 — 만들어 둔 파형을 그대로 튼다.
     차임처럼 master 로 직행한다: bus 는 목소리에 밀려 낮아지는 층이므로
     목소리 자신이 그리로 들어가면 스스로를 낮춘다.
     반환한 손잡이의 stop() 은 짧게 흐리며 끊는다 — 뚝 자르면 딸깍 소리가 난다. */
  function playVoice(samples, sampleRate) {
    if (!ensure()) return null;
    var buf = ctx.createBuffer(1, samples.length, sampleRate);
    buf.getChannelData(0).set(samples);
    return playBuffer(buf);
  }

  /* mp3 등 압축 파일을 소리로 푼다. 사용자 제스처 전에도 되므로 다음 문구를
     미리 풀어 둘 수 있다(AudioContext 는 만들어지되 멈춘 상태로 있다). */
  function decode(arrayBuffer) {
    if (!ensure()) return Promise.reject(new Error('Web Audio 없음'));
    return new Promise(function (resolve, reject) {
      // 콜백 꼴이 가장 널리 된다(구형 사파리는 약속을 돌려주지 않는다).
      ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
    });
  }

  /* 풀어 둔 소리를 그대로 튼다 — 만들어 둔 목소리 파일이 이 길로 나간다. */
  function playBuffer(buf) {
    if (!ensure()) return null;
    var src = ctx.createBufferSource();
    var g = ctx.createGain();
    src.buffer = buf;
    src.connect(g); g.connect(master);
    var t = ctx.currentTime;
    src.start(t);
    var handle = {
      onended: null,
      stop: function () {
        try {
          var now = ctx.currentTime;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now);
          g.gain.linearRampToValueAtTime(0.0001, now + 0.06);
          src.stop(now + 0.08);
        } catch (e) { /* 이미 끝났다 */ }
      }
    };
    src.onended = function () { if (handle.onended) handle.onended(); };
    return handle;
  }

  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  }

  /* 목소리가 문구를 읽는 동안 배경음을 뒤로 물린다.
     계단처럼 뚝 떨어지면 그것이 자극이 되므로 setTargetAtTime 으로 부드럽게. */
  function duck(on) {
    if (!bus || !ctx) return;
    bus.gain.setTargetAtTime(on ? DUCK : 1, ctx.currentTime, 0.12);
  }

  return { ensure: ensure, play: play, stop: stop, chime: chime,
           suspend: suspend, resume: resume, setMuted: setMuted, duck: duck,
           playVoice: playVoice, decode: decode, playBuffer: playBuffer };
})();
