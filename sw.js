/* 짬짬이 쉼 — 오프라인 캐시 (FR-08) */
var CACHE = 'jjam-rest-v1';

var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/sound.js',
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
  e.respondWith(
    fetch(e.request).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
