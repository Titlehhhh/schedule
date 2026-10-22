/* ============================================================================
   Service worker: кэширует сайт, чтобы расписание открывалось без интернета.

   Стратегия выборки — network-first: сначала пробуем сеть и только если сети
   нет, отдаём кэш. Так свежий деплой виден с ПЕРВОЙ загрузки, а офлайн
   продолжает работать. Имя кэша версионировано ('schedule-v2'): при активации
   новой версии старый кэш удаляется, и устаревшие файлы больше не отдаются.

   Все пути относительные — сайт живёт в подкаталоге '/schedule/'.
   ========================================================================== */

var CACHE = 'schedule-v3';
var ASSETS = [
  './',
  './index.html',
  './tasks.html',
  './styles.css',
  './data.js',
  './core.js',
  './app.js',
  './favicon.svg',
  './manifest.webmanifest'
];

/* ответ, когда сети нет и в кэше ничего не нашлось */
function offline() {
  return new Response('Страница недоступна офлайн: загрузите сайт с интернетом.', {
    status: 503,
    statusText: 'Offline',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

/* запрос в обход HTTP-кэша браузера: в кэш SW попадает ровно та версия
   файла, что сейчас лежит на сервере */
function fetchFresh(url) {
  try {
    return fetch(new Request(url, { cache: 'reload' }));
  } catch (e) {
    return fetch(url);
  }
}

/* ищем в кэше, игнорируя Vary (сервер отдаёт Vary: Accept-Encoding) */
function matchCached(request) {
  return caches.match(request, { ignoreVary: true });
}

/* кладём ответ в кэш; ошибки кэша не должны ронять страницу */
function putCached(req, res) {
  if (!res || !res.ok || res.status === 206 || res.type !== 'basic') {
    return Promise.resolve();
  }
  if (res.headers.get('Vary') === '*') return Promise.resolve();
  var copy = res.clone();
  return caches.open(CACHE).then(function (c) {
    return c.put(req, copy);
  }).catch(function () { /* кэш недоступен */ });
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* каждый файл кладём отдельно: один недоступный файл не должен
         срывать установку service worker */
      return Promise.all(ASSETS.map(function (url) {
        return fetchFresh(url).then(function (res) {
          if (!res || !res.ok) return null;
          return c.put(url, res.clone());
        }).catch(function () { /* файл не скачался — не критично */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        /* удаляем только старые версии нашего кэша */
        if (k === CACHE) return null;
        if (k.indexOf('schedule-') !== 0) return null;
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  /* не-GET и чужие origin не трогаем */
  if (req.method !== 'GET') return;
  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    /* сеть: отдаём свежее и обновляем кэш */
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        putCached(req, res);
      }
      return res;
    }).catch(function () {
      /* сети нет: отдаём из кэша */
      return matchCached(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') {
          return matchCached('./index.html').then(function (page) {
            return page || offline();
          });
        }
        return offline();
      });
    })
  );
});
