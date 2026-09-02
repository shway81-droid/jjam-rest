/* ── 짬짬이 쉼 — 만들어 둔 목소리 파일 ──
   문구 133개를 두 목소리(선히·현수)로 미리 만들어 assets/voice/ 에 둔다.
   scripts/gen-voices.py 가 만들고, assets/voice/manifest.json 이 어떤 문구가
   어떤 파일인지와 그 문구의 해시를 적어 둔다.

   왜 파일인가: 브라우저 목소리는 기기마다 달라 크롬에는 자연스러운 한국어가
   없고, 브라우저 안에서 도는 신경망 모델은 47MB 에 실시간의 두 배가 걸려
   첫 문구가 늦었다. 파일은 5MB 안팎이고, 어느 브라우저에서나 같은 소리가
   곧바로 난다. 명상 안내에 맞춰 늦추고 낮춰 둔 것도 파일이라 가능하다.

   문구를 고쳤는데 파일을 다시 만들지 않으면 옛 소리가 난다. 그래서 여기서는
   화면 문구와 manifest 의 문구가 같을 때만 파일을 쓰고, 다르면 없는 것으로
   본다 — speech.js 가 그 문구만 브라우저 목소리로 읽는다. CI 의
   scripts/check-voices.mjs 도 같은 어긋남을 잡는다. */
var JjamVoiceFiles = (function () {
  'use strict';

  var BASE = 'assets/voice/';

  var manifest = null;
  var loading = null;
  var buffers = {};      // 'voice/key' → 풀어 둔 AudioBuffer
  var inflight = {};     // 'voice/key' → 받는 중인 약속

  function load() {
    if (manifest) return Promise.resolve(manifest);
    if (loading) return loading;
    loading = fetch(BASE + 'manifest.json').then(function (r) {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json();
    }).then(function (m) {
      manifest = m;
      return m;
    }).catch(function (e) {
      loading = null;
      throw e;
    });
    return loading;
  }

  function ready() { return !!manifest; }

  /* 고를 수 있는 목소리 — { sunhi: {label, gender}, hyunsu: {...} } */
  function voices() { return (manifest && manifest.voices) || {}; }

  /* 이 문구의 파일이 있고, 화면 문구와 같은 내용으로 만들어졌는가. */
  function has(key, text) {
    if (!manifest || !manifest.lines) return false;
    var line = manifest.lines[key];
    return !!line && line.text === text;
  }

  function url(voice, key) { return BASE + voice + '/' + key + '.mp3'; }

  /* 파일을 받아 소리로 풀어 둔다. 같은 파일을 두 번 받지 않는다 —
     미리 준비(prime)와 실제 재생(speak)이 같은 약속을 기다린다. */
  function get(voice, key) {
    var id = voice + '/' + key;
    if (buffers[id]) return Promise.resolve(buffers[id]);
    if (inflight[id]) return inflight[id];
    var pr = fetch(url(voice, key)).then(function (r) {
      if (!r.ok) throw new Error('voice file ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return JjamSound.decode(buf);
    }).then(function (ab) {
      buffers[id] = ab;
      delete inflight[id];
      return ab;
    }, function (e) {
      delete inflight[id];
      throw e;
    });
    inflight[id] = pr;
    return pr;
  }

  // 한 세션이 끝나면 비운다 — 풀어 둔 소리는 파일보다 열 배쯤 크다.
  function clear() { buffers = {}; inflight = {}; }

  return { load: load, ready: ready, voices: voices, has: has, get: get, clear: clear };
})();
