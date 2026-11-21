// Service worker de Scrabble FR : rend l'appli installable, jouable hors ligne (contre l'ordinateur)
// et affiche les notifications. Les fichiers sont servis depuis le réseau quand il répond,
// sinon depuis le cache ; les fichiers de build (/assets/, nommés par leur empreinte) ne changent jamais.
const CACHE = 'scrabble-fr-v1';
const SCOPE = new URL(self.registration.scope);
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'dict/fr-libre.txt'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new URL(p, SCOPE)))).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetchAndCache(req)));
    return;
  }
  // Page d'accueil (avec ou sans ?partie=…) : une seule entrée de cache.
  const key = req.mode === 'navigate' ? new URL('./', SCOPE).href : req;
  e.respondWith(fetchAndCache(req, key).catch(async () => (await caches.match(key)) || Response.error()));
});

async function fetchAndCache(req, key = req) {
  const res = await fetch(req);
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
  }
  return res;
}

// Toucher une notification ramène sur la partie (en rouvrant l'appli si besoin).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || SCOPE.href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(SCOPE.href));
    if (win) return win.focus();
    return self.clients.openWindow(target);
  })());
});
