// Service Worker — オフライン対応 & 高速起動
const CACHE = 'riberyu-v3';
const STATIC = ['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];

// インストール: 静的ファイルをキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// 有効化: 古いキャッシュを削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// フェッチ戦略
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // data.json は Network-First（最新データ優先、失敗時はキャッシュ）
  if (url.pathname.endsWith('data.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // その他は Cache-First（高速起動）
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request).then(res => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
  );
});
