/* WO Sports service worker: works offline once loaded.
   Bump CACHE_VERSION when you ADD or RENAME files in ASSETS. Edits to existing files update by themselves
   (stale-while-revalidate: you see the cached copy now and the fresh copy on the next open). */
var CACHE_VERSION = "wo-sports-v1";
var FUSE_URL = "https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js";
var ASSETS = [
  "./", "index.html", "styles.css", "logic.js", "app.js", "timetable.json", "venues.json",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_VERSION).then(function (cache) {
    var fuse = fetch(FUSE_URL, { mode: "no-cors" }).then(function (r) { return cache.put(FUSE_URL, r); }).catch(function () {});
    return Promise.all([cache.addAll(ASSETS), fuse]);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE_VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  if (req.url === FUSE_URL) { // cache-first for the pinned library
    event.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone(); caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); }); return res;
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  event.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var network = fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || network.then(function (res) {
      return res || (req.mode === "navigate" ? caches.match("index.html") : res);
    });
  }));
});
