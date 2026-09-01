/* 짬짬이 쉼 — 오프라인 캐시 (FR-08) */
// 이름을 올리면 activate 가 옛 캐시를 통째로 지운다. v1 에는 오류 응답이
// 섞여 들어갔을 수 있어(아래 fetch 주석) 그것을 버리기 위해 v2 로 올렸다.
// v3: 자산 목록에 js/speech.js 가 늘었다 — 목록이 바뀌면 이름도 올려야
// 옛 캐시를 쥔 기기가 새 파일 없이 index.html 만 갱신하는 일이 없다.
// v4: 한글 로마자·신경망 목소리 파일이 늘었다.
var CACHE = 'jjam-rest-v4';

var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/sound.js',
  './js/speech.js',
  './js/hangul-roman.js',
  './js/neural-voice.js',
  './shared/jjam-switcher.js',
  './data/sessions.json',
  './favicon.svg',
  './manifest.json',
  './assets/fonts/PretendardVariable.subset.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 네트워크 우선, 실패 시 캐시 (콘텐츠 갱신 반영) */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  // 우리 사이트 파일만 다룬다. 신경망 목소리(47MB)는 다른 출처에서 받아
  // js/neural-voice.js 가 자기 캐시에 넣는다 — 여기서 또 담으면 같은 것을
  // 두 벌 저장하게 되고, 그 캐시만 지워도 목소리가 살아 있는 것처럼 보인다.
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      // 오류 응답(404·500 등)은 캐시에 넣지 않는다. Pages 가 잠깐 흔들린 순간에
      // 방문하면 그 오류 페이지가 캐시에 들어앉아, 이후 오프라인 재방문에서
      // 정상 자산 대신 계속 그것이 나온다.
      if (!res.ok) {
        // 전 자산이 미리 캐시된 정적 사이트다 — 여기서 오는 오류는 의미 있는
        // 응답이 아니라 일시적 장애이므로, 성한 사본이 있으면 그것을 내보낸다.
        return caches.match(e.request).then(function (hit) { return hit || res; });
      }
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
