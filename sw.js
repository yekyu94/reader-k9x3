/* 서비스 워커: 네트워크 우선, 실패 시 캐시 (오프라인 지원 + 업데이트 즉시 반영) */
const CACHE = "txtreader-v3";
const ASSETS = ["./", "index.html", "style.css", "app.js", "manifest.json", "icon-180.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith("http")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // 성공한 응답은 캐시에 갱신해둠 (오프라인 대비)
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
