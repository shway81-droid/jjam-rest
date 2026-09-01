/* ── 짬짬이 쉼 — 신경망 목소리 (선택 설치) ──
   브라우저 내장 목소리는 기기마다 천차만별이다. 윈도우 크롬에는 십수 년 된
   기본 목소리밖에 없어 기계처럼 들리고, 자연스러운 마이크로소프트 목소리는
   Edge 에서만 잡힌다. 어느 브라우저에서든 같은 목소리로 읽어 주려면 목소리
   자체를 앱이 들고 있어야 한다.

   그래서 신경망 음성 모델(메타 MMS 한국어)을 브라우저에서 직접 돌린다.
   서버로 문구를 보내지 않으므로 교실 문구가 밖으로 나가지 않고, 한 번 받으면
   오프라인에서도 똑같이 난다.

   대신 47MB 를 받아야 한다. 그래서 기본이 아니라 '선택'이다 —
   받기 전에는 지금까지처럼 브라우저 목소리를 쓰고, 활동은 어느 쪽이든 완결된다.

   느리다는 점이 설계를 지배한다. 이 모델은 단일 스레드 wasm 에서 실시간의
   약 2배가 걸린다(6초 문장에 12초). 그래서 '말할 때 만들지' 않는다 —
   app.js 가 다음 문구를 미리 만들어 두고(prime), 여기서는 만들어 둔 것을
   즉시 꺼내 쓴다. 깃허브 페이지는 교차 출처 격리 헤더를 넣을 수 없어
   여러 스레드를 쓸 수 없다는 점도 여기에 걸린다. */
var JjamNeural = (function () {
  'use strict';

  var ORT_VER = '1.20.1';
  var ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VER + '/dist/';
  var MODEL_URL =
    'https://huggingface.co/Xenova/mms-tts-kor/resolve/main/onnx/model_quantized.onnx';

  // 캐시 이름에 버전을 둔다 — 모델이나 런타임을 바꾸면 올려서 옛것을 버린다.
  var CACHE = 'jjam-rest-voice-v1';
  var SAMPLE_RATE = 16000;

  /* 모델의 어휘(vocab.json)를 그대로 옮긴 것. 25글자뿐이고 모델과 짝이므로
     여기 값을 고치면 발음이 무너진다. 'u' 가 0 인 것은 오타가 아니다 —
     MMS 는 빈칸 토큰과 u 가 같은 번호를 쓴다(원본 구현도 그렇다). */
  var VOCAB = {
    ' ': 21, "'": 15, '-': 11, '_': 1, 'a': 7, 'b': 13, 'c': 14, 'd': 18,
    'e': 22, 'g': 19, 'h': 8, 'i': 9, 'j': 10, 'k': 12, 'l': 17, 'm': 23,
    'n': 16, 'o': 5, 'p': 24, 'r': 20, 's': 4, 't': 2, 'u': 0, 'w': 3, 'y': 6
  };

  // 내려받을 것 목록. bytes 는 진행률 표시용 어림값이다(서버가 길이를 알려주지
  // 않는 경우가 있어 미리 적어 둔다).
  // type 을 적어 두는 이유: 캐시에서 꺼낸 blob 은 원래의 Content-Type 을
  // 잃는다. 형식 없는 blob 으로 스크립트를 부르면 브라우저가
  // "Strict MIME type checking" 으로 거부해 엔진이 아예 뜨지 않는다.
  var FILES = [
    { key: 'ort-js',   url: ORT_CDN + 'ort.wasm.min.js',             bytes: 49000,
      type: 'text/javascript' },
    { key: 'ort-mjs',  url: ORT_CDN + 'ort-wasm-simd-threaded.mjs',  bytes: 29000,
      type: 'text/javascript' },
    { key: 'ort-wasm', url: ORT_CDN + 'ort-wasm-simd-threaded.wasm', bytes: 11246032,
      type: 'application/wasm' },
    { key: 'model',    url: MODEL_URL,                               bytes: 37600000,
      type: 'application/octet-stream' }
  ];

  var TOTAL_BYTES = FILES.reduce(function (n, f) { return n + f.bytes; }, 0);

  var session = null;      // 만들어진 추론 세션
  var loading = null;      // load() 중복 호출을 막는 약속
  var installing = null;   // install() 중복 호출을 막는 약속
  var queue = Promise.resolve();   // 합성은 한 번에 하나씩

  function haveCacheApi() {
    return typeof caches !== 'undefined' && typeof fetch === 'function';
  }

  function open() { return caches.open(CACHE); }

  /* 받아 둔 것이 있는가 — 네 파일이 모두 있어야 쓸 수 있다. */
  function installed() {
    if (!haveCacheApi()) return Promise.resolve(false);
    return open().then(function (c) {
      return Promise.all(FILES.map(function (f) { return c.match(f.url); }));
    }).then(function (hits) {
      return hits.every(Boolean);
    }).catch(function () { return false; });
  }

  /* 내려받아 캐시에 넣는다. onProgress(받은바이트, 전체바이트) 로 진행을 알린다.
     한 파일이라도 실패하면 통째로 실패로 본다 — 반쯤 받은 상태로 '설치됨'이
     되면 다음 실행에서 이유 없이 목소리가 안 난다. */
  function install(onProgress) {
    if (installing) return installing;
    if (!haveCacheApi()) return Promise.reject(new Error('캐시를 쓸 수 없는 브라우저'));

    var done = 0;
    installing = open().then(function (cache) {
      var chain = Promise.resolve();
      FILES.forEach(function (f) {
        chain = chain.then(function () {
          return cache.match(f.url).then(function (hit) {
            if (hit) { done += f.bytes; if (onProgress) onProgress(done, TOTAL_BYTES); return; }
            return fetch(f.url, { mode: 'cors' }).then(function (res) {
              if (!res.ok) throw new Error(f.key + ' 내려받기 실패 (' + res.status + ')');
              return trackedBlob(res, f.bytes, function (n) {
                if (onProgress) onProgress(done + n, TOTAL_BYTES);
              });
            }).then(function (blob) {
              done += f.bytes;
              if (onProgress) onProgress(done, TOTAL_BYTES);
              return cache.put(f.url, new Response(blob));
            });
          });
        });
      });
      return chain;
    }).then(function () {
      installing = null;
      return true;
    }).catch(function (e) {
      installing = null;
      // 반쯤 받은 것을 남기지 않는다.
      return remove().then(function () { throw e; });
    });
    return installing;
  }

  /* 진행률을 보려면 본문을 직접 읽어야 한다. 스트림을 못 쓰는 환경에서는
     그냥 통째로 받는다(진행률만 거칠어질 뿐 결과는 같다). */
  function trackedBlob(res, fallbackBytes, onBytes) {
    if (!res.body || !res.body.getReader) return res.blob();
    var reader = res.body.getReader();
    var chunks = [];
    var got = 0;
    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) return new Blob(chunks);
        chunks.push(r.value);
        got += r.value.length;
        if (onBytes) onBytes(Math.min(got, fallbackBytes));
        return pump();
      });
    })();
  }

  function remove() {
    if (!haveCacheApi()) return Promise.resolve();
    session = null;
    loading = null;
    return caches.delete(CACHE).then(function () { return true; })
      .catch(function () { return false; });
  }

  function cachedBlobUrl(cache, file) {
    return cache.match(file.url).then(function (res) {
      if (!res) throw new Error('캐시에 ' + file.key + ' 이 없습니다');
      return res.arrayBuffer();
    }).then(function (buf) {
      // 형식을 다시 붙여 준다 — 위 FILES 주석 참고.
      return URL.createObjectURL(new Blob([buf], { type: file.type }));
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('음성 엔진을 불러오지 못했습니다')); };
      document.head.appendChild(s);
    });
  }

  /* 캐시에 받아 둔 것으로 추론 세션을 만든다. 네트워크를 쓰지 않는다. */
  function load() {
    if (session) return Promise.resolve(session);
    if (loading) return loading;

    loading = open().then(function (cache) {
      return Promise.all([
        cachedBlobUrl(cache, FILES[0]),
        cachedBlobUrl(cache, FILES[1]),
        cachedBlobUrl(cache, FILES[2]),
        cache.match(FILES[3].url).then(function (r) {
          if (!r) throw new Error('캐시에 모델이 없습니다');
          return r.arrayBuffer();
        })
      ]);
    }).then(function (parts) {
      var jsUrl = parts[0], mjsUrl = parts[1], wasmUrl = parts[2], model = parts[3];
      return (window.ort ? Promise.resolve() : loadScript(jsUrl)).then(function () {
        // wasm 파일도 캐시에서 꺼낸 blob 으로 지정한다 — 실행 시점에 다시
        // 네트워크를 타지 않아야 오프라인 교실에서도 뜬다.
        window.ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
        // 깃허브 페이지는 교차 출처 격리를 켤 수 없어 스레드를 못 쓴다.
        window.ort.env.wasm.numThreads = 1;
        // 추론을 워커로 보낸다. 이것이 없으면 합성하는 십여 초 동안 메인
        // 스레드가 통째로 막혀 호흡 애니메이션이 얼어붙고 일시정지 단추도
        // 눌리지 않는다 — 시작 이후 화면이 스스로 진행한다는 약속이 깨진다.
        window.ort.env.wasm.proxy = true;
        window.ort.env.logLevel = 'error';
        return window.ort.InferenceSession.create(new Uint8Array(model),
          { executionProviders: ['wasm'] });
      });
    }).then(function (s) {
      session = s;
      return s;
    }).catch(function (e) {
      loading = null;
      throw e;
    });
    return loading;
  }

  /* 문구 하나를 소리로. 반환은 16kHz 모노 Float32Array.
     한 번에 하나씩 처리한다 — 동시에 여러 개를 돌리면 느린 기기에서
     서로 밀려 첫 문구가 더 늦어진다. */
  function synth(text) {
    var rom = window.JjamRoman ? JjamRoman.forModel(text) : '';
    if (!rom) return Promise.reject(new Error('읽을 내용이 없습니다'));

    var run = queue.then(function () {
      return load().then(function (s) {
        var ids = [0];
        for (var i = 0; i < rom.length; i++) {
          var id = VOCAB[rom[i]];
          if (id === undefined) continue;
          ids.push(id);
          ids.push(0);          // MMS 는 토큰 사이에 빈칸을 끼워 넣는다
        }
        var big = new BigInt64Array(ids.length);
        var mask = new BigInt64Array(ids.length);
        for (var k = 0; k < ids.length; k++) { big[k] = BigInt(ids[k]); mask[k] = 1n; }
        var ort = window.ort;
        return s.run({
          input_ids: new ort.Tensor('int64', big, [1, ids.length]),
          attention_mask: new ort.Tensor('int64', mask, [1, ids.length])
        });
      }).then(function (out) {
        return out.waveform.data;      // Float32Array
      });
    });
    // 한 건이 실패해도 줄이 끊기지 않게 한다.
    queue = run.then(function () {}, function () {});
    return run;
  }

  function isLoaded() { return !!session; }

  return {
    installed: installed,
    install: install,
    remove: remove,
    load: load,
    synth: synth,
    isLoaded: isLoaded,
    SAMPLE_RATE: SAMPLE_RATE,
    TOTAL_BYTES: TOTAL_BYTES
  };
})();
