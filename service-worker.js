// ===== LÚMEN SERVICE WORKER =====
// Muda este número em cada deploy para forçar actualização imediata
const CACHE_VERSION = 4;
const CACHE_NAME = 'lumen-v' + CACHE_VERSION;

// Apenas assets estáticos que mudam raramente (ícones/fontes)
const STATIC_ASSETS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Ficheiros de app — sempre vai à rede primeiro, cache só como fallback offline
const APP_FILES = [
  './',
  './index.html',
  './login.html',
  './app.js',
  './style.css',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase, Google APIs, Spotify — NÃO interceptar de forma alguma.
  // O Firestore usa WebChannel (long-polling) que quebra se o SW chamar fetch().
  // Ao não chamar event.respondWith(), o browser trata a request directamente.
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('spotify.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebasestorage') ||
    url.hostname.includes('identitytoolkit')
  ) {
    return; // deixar o browser tratar sem SW
  }

  const isAppFile = APP_FILES.some(f => url.pathname.endsWith(f.replace('./', '/'))) ||
                    url.pathname === '/' ||
                    url.pathname.endsWith('/index.html') ||
                    url.pathname.endsWith('/login.html') ||
                    url.pathname.endsWith('/app.js') ||
                    url.pathname.endsWith('/style.css') ||
                    url.pathname.endsWith('/manifest.json');

  if (isAppFile) {
    // Network-first: tenta sempre buscar a versão mais recente
    // Se offline, usa o cache como fallback
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Outros assets (ícones, imagens) — cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
