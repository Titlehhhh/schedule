/* ============================================================================
   E2E-проверка: рендерим сайт в headless-браузере и смотрим на результат.
   Требует установленный Chrome или Edge. Запуск: node test/e2e.js
   ========================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8131;

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

function findBrowser() {
  for (const p of BROWSERS) if (fs.existsSync(p)) return p;
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
               '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
               '.webmanifest': 'application/manifest+json' };

/* Страница-обёртка: рендерит сайт в iframe нужной ширины и отправляет
   отчёт обратно на сервер. Сценарии (разные моменты времени) — все сразу. */
const SCENARIOS = [
  { id: 'live', now: '2026-10-21T13:30', expect: 'Идёт сейчас', also: 'Профессиональный иностранный язык' },
  { id: 'before', now: '2026-10-21T07:00', expect: 'Следующая пара' },
  { id: 'after', now: '2026-10-21T18:00', expect: 'Все пары закончились' },
  { id: 'free', now: '2026-10-23T10:00', expect: 'Сегодня пар не было' },
  { id: 'weekend', now: '2026-10-25T12:00', expect: 'Сегодня выходной' },
  { id: 'tue', now: '2026-10-20T15:30', expect: 'Идёт сейчас', also: 'Математические методы теории систем' },
  { id: 'tasks', now: '2026-10-22T12:00', expect: 'Задания по дисциплинам',
    also: 'Введение в большие данные' }
];

const HARNESS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0">
<div id="host"></div>
<script>
var SCENARIOS = ${JSON.stringify(SCENARIOS)};
var pending = SCENARIOS.length;
SCENARIOS.forEach(function (s) {
  var f = document.createElement('iframe');
  f.style.cssText = 'width:390px;height:1200px;border:0;position:absolute;left:-9999px';
  f.src = '/index.html?now=' + s.now + (s.view ? '&view=' + s.view : '');
  document.getElementById('host').appendChild(f);
  f.addEventListener('load', function () {
    setTimeout(function () {
      var d = f.contentDocument;
      var vw = d.documentElement.clientWidth;
      var over = [];
      d.querySelectorAll('body *').forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.width > vw + 0.5 || r.right > vw + 0.5) {
          over.push(el.tagName + '.' + (el.className || '') + ' w=' + Math.round(r.width));
        }
      });
      var report = {
        id: s.id,
        clientWidth: vw,
        scrollWidth: d.documentElement.scrollWidth,
        bodyScrollWidth: d.body.scrollWidth,
        overflow: over.slice(0, 12),
        html: d.documentElement.outerHTML,
        text: d.body.innerText
      };
      fetch('/__report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify(report) });
      if (--pending === 0) fetch('/__done', { method: 'POST', body: '1' });
    }, 900);
  });
});
</script></body></html>`;

const reports = {};
let done = false;

const server = http.createServer((req, res) => {
  if (req.url === '/__report' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');   /* без этого многобайтные символы на границе чанка портятся */
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const r = JSON.parse(body);
        reports[r.id] = r;
      } catch (e) { /* плохой отчёт */ }
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (req.url === '/__done' && req.method === 'POST') {
    done = true;
    res.writeHead(200); res.end('ok');
    return;
  }
  if (req.url === '/__harness') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HARNESS);
    return;
  }
  const file = req.url.split('?')[0].replace(/^\/+/, '') || 'index.html';
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  res.end(fs.readFileSync(full));
});

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  ok  ' + name);
  else { failed++; console.log('FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

server.listen(PORT, '127.0.0.1', () => {
  const browser = findBrowser();
  if (!browser) {
    console.log('\nChrome/Edge не найден — E2E-проверка пропущена.\n');
    server.close();
    process.exit(0);
  }
  console.log('\n— E2E: ' + path.basename(browser) + ' —');
  const profile = path.join(require('os').tmpdir(), 'schedule-e2e-' + Date.now());
  const child = spawn(browser, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=12000',
    '--window-size=500,1300',
    'http://127.0.0.1:' + PORT + '/__harness'
  ], { stdio: 'ignore', detached: process.platform !== 'win32' });

  /* Закрываем ВСЁ дерево процессов браузера, чтобы не оставалось зомби.
     Отдельный --user-data-dir гарантирует, что это не ваш обычный Edge. */
  function killBrowser() {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { child.kill('SIGKILL'); }
      }
    } catch (e) { /* уже мёртв */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* не критично */ }
  }

  const started = Date.now();
  const timer = setInterval(() => {
    if (done) {
      clearInterval(timer);
      killBrowser();
      finish();
    } else if (Date.now() - started > 45000) {
      clearInterval(timer);
      killBrowser();
      console.log('FAIL  браузер не отдал отчёт за 45 с');
      failed++;
      finish();
    }
  }, 300);

  function finish() {
    if (!Object.keys(reports).length) {
      console.log('FAIL  браузер не прислал ни одного отчёта');
      failed++;
      server.close();
      process.exit(1);
    }

    /* --- общие проверки по каждому сценарию --- */
    for (const s of SCENARIOS) {
      const r = reports[s.id];
      const tag = '[' + s.id + ']';
      if (!r) { check(tag + ' отчёт получен', false); continue; }
      const h = r.html || '';
      check(tag + ' страница отрендерилась', h.length > 2000, 'html=' + h.length);
      check(tag + ' нет горизонтального скролла на 390px', r.scrollWidth <= r.clientWidth + 1,
            r.scrollWidth + ' > ' + r.clientWidth);
      check(tag + ' нет переполненных элементов', r.overflow.length === 0, r.overflow.join('; '));
      check(tag + ' нет undefined / NaN', !/undefined|NaN/.test(h),
            (h.match(/.{0,40}(undefined|NaN).{0,40}/) || [])[0]);
      check(tag + ' ожидаемое состояние: ' + s.expect, r.text.includes(s.expect),
            r.text.slice(0, 160).replace(/\s+/g, ' '));
      if (s.also) check(tag + ' ожидаемый предмет: ' + s.also, r.text.includes(s.also));
    }

    /* --- структурные проверки (по первому сценарию) --- */
    const h = reports[SCENARIOS[0].id].html || '';
    check('есть заголовок сайта', /Расписание занятий/.test(h));
    check('показан номер недели', /[12]-я неделя/.test(h));
    check('есть блоки «Сегодня» и «Завтра»', />Сегодня</.test(h) && />Завтра</.test(h));
    check('в неделе 5 дней', (h.match(/class="day[ "]/g) || []).length === 5,
          String((h.match(/class="day[ "]/g) || []).length));
    check('есть время пар', /\d{2}:\d{2}/.test(h));
    check('есть преподаватель', /доц\.|проф\.|асс\./.test(h));
    check('есть кнопка экспорта в календарь', /В календарь/.test(h));
    check('есть навигация по неделям', /id="weekPrev"/.test(h) && /id="weekNext"/.test(h));
    check('в шапке видно текущую неделю', /week-pill__num"[^>]*>[12]-я неделя</.test(h));
    check('липкая полоса «сейчас» на месте', /id="nowbar"/.test(h) && /nowbar__text/.test(h));
    check('текущая пара помечена', /идёт сейчас|скоро/.test(h));
    check('пустые ячейки пояснены', /Пар нет/.test(h) && /неделю здесь/.test(h));
    check('нет подвала с устаревшим текстом', !/class="footer"/.test(h));
    check('есть навигация по якорям', /href="#tasks"/.test(h) && /href="#schedule"/.test(h));

    /* --- раздел с заданиями --- */
    const th = reports['tasks'] ? (reports['tasks'].html || '') : '';
    if (th) {
      check('[tasks] раздел расписания на месте', /id="schedule"/.test(th));
      check('[tasks] раздел заданий на той же странице', /id="tasks"/.test(th));
      check('навигация якорями', /href="#schedule"/.test(th) && /href="#tasks"/.test(th));
      check('нет скрытых панелей-вкладок', !/panel-schedule|panel-tasks/.test(th));
      check('[tasks] есть дисциплины', /class="disc"/.test(th));
      check('[tasks] есть отметки выполнения', /type="checkbox"/.test(th));
      check('[tasks] есть сроки', /Срок:/.test(th));
      check('[tasks] есть шаги «как делать»', /Как делать/.test(th));
      check('[tasks] есть блок «Что горит»', /Что горит/.test(th));
      check('[tasks] есть кнопка экспорта сроков', /Сроки в календарь/.test(th));
    }

    console.log(failed ? '\n✗ провалено проверок: ' + failed + '\n' : '\n✓ E2E пройдена\n');
    server.close();
    process.exit(failed ? 1 : 0);
  }
});
