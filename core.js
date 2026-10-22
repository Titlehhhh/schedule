/* ============================================================================
   Расписание занятий — ядро
   Чистые функции: время, учебные недели, выборка занятий, экспорт в .ics.
   Не трогает DOM — поэтому его можно прогнать тестами в node.
   ========================================================================== */

(function (root) {
  'use strict';

  var D = root.SCHEDULE;

  var DAY_MS = 86400000;
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн',
                       'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var DOW_NOM = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var KIND_CLASS = { 'лек': 'lec', 'пр': 'pr', 'лаб': 'lab' };
  var KIND_FULL = { 'лек': 'лекция', 'пр': 'практическое занятие', 'лаб': 'лабораторная работа' };
  var PREFS_KEY = 'schedule-prefs';

  /* ------------------------------- утилиты -------------------------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toMin(hm) { var p = String(hm).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function fromMin(m) { return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); }
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
  }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function fmtDate(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function fmtDateLong(d) { return DOW_NOM[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function humanDuration(mins) {
    mins = Math.max(0, Math.round(mins));
    var h = Math.floor(mins / 60), m = mins % 60;
    if (h && m) return h + ' ч ' + m + ' мин';
    if (h) return h + ' ' + (h === 1 ? 'час' : (h < 5 ? 'часа' : 'часов'));
    return m + ' мин';
  }

  /* Русские склонения: plural(5, ['пара','пары','пар']) → 'пар' */
  function plural(n, forms) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  /* ------------------------------ настройки ------------------------------- */

  function loadPrefs() {
    try { return JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function savePrefs(p) {
    try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* приватный режим */ }
  }
  function anchorDate() {
    var p = loadPrefs();
    return (p.anchor && /^\d{4}-\d{2}-\d{2}$/.test(p.anchor)) ? p.anchor : D.semesterStart;
  }

  /* ------------------------- арифметика недель ---------------------------- */

  /* Учебные недели идут с понедельника. Неделя, внутри которой лежит
     anchorDate(), — первая. Дальше 1, 2, 1, 2, ... */
  function academicWeekNo(date) {
    var anchor = mondayOf(parseISO(anchorDate()));
    return Math.round((mondayOf(date) - anchor) / (7 * DAY_MS)) + 1;
  }

  /* 1-я или 2-я неделя (чередуются 1, 2, 1, 2, ...).
     Внимание: остаток от деления отрицательного числа в JS отрицателен,
     поэтому чётность проверяем через % 2 === 0 — иначе все недели до
     начала семестра помечались бы как «2-я». */
  function weekParity(date) {
    return (academicWeekNo(date) % 2 === 0) ? 2 : 1;
  }

  /* Первый день занятий (можно переопределить из подвала страницы) */
  function classesStart() {
    var p = loadPrefs();
    if (p.classes && /^\d{4}-\d{2}-\d{2}$/.test(p.classes)) return p.classes;
    return D.classesStart || D.semesterStart;
  }

  /* Внутри ли семестр? */
  function semesterState(date) {
    var x = startOfDay(date);
    var s = startOfDay(parseISO(classesStart()));
    var e = startOfDay(parseISO(D.semesterEnd));
    return x < s ? 'before' : (x > e ? 'after' : 'inside');
  }

  function weekMonday(n) {
    return addDays(mondayOf(parseISO(anchorDate())), (n - 1) * 7);
  }

  /* ------------------------------ расписание ------------------------------ */

  function dayIdFor(date) {
    var dow = date.getDay();
    return (dow >= 1 && dow <= 5) ? D.days[dow - 1].id : null;
  }

  /* Если в колледже 1-я неделя — это нижняя подстрока исходной таблицы,
     недели меняются местами. Настройка живёт в data.js и в localStorage. */
  var _lessonsCache = null;
  function effectiveLessons() {
    var p = loadPrefs();
    var swap = (p.swap !== undefined) ? !!p.swap : !!D.swapWeeks;
    if (_lessonsCache && _lessonsCache.swap === swap) return _lessonsCache.lessons;
    var lessons = D.lessons;
    if (swap) {
      lessons = D.lessons.map(function (l) {
        return {
          day: l.day, time: l.time, subject: l.subject, kind: l.kind,
          teacher: l.teacher, room: l.room, dept: l.dept,
          weeks: l.weeks.map(function (w) { return w === 1 ? 2 : 1; })
        };
      });
    }
    _lessonsCache = { swap: swap, lessons: lessons };
    return lessons;
  }

  function lessonsFor(date, parity) {
    var id = dayIdFor(date);
    if (!id) return [];
    return effectiveLessons()
      .filter(function (l) { return l.day === id && l.weeks.indexOf(parity) !== -1; })
      .sort(function (a, b) { return toMin(a.time) - toMin(b.time); });
  }

  /* Последняя учебная неделя семестра — дальше листать некуда */
  function lastWeekNo() {
    var end = mondayOf(parseISO(D.semesterEnd));
    return academicWeekNo(end);
  }

  /* Конец пары в минутах от полуночи. Может быть > 1440, если пара
     заканчивается за полночь — поэтому сравнения идут по минутам,
     а не по строке времени. */
  function endMinutes(startHM) {
    var s = toMin(startHM);
    for (var i = 0; i < D.bells.length; i++) {
      if (toMin(D.bells[i]) > s) return toMin(D.bells[i]);
    }
    return s + 100;   /* после последнего звонка — пара на 100 минут */
  }

  function endTime(startHM) {
    return fromMin(endMinutes(startHM));
  }

  function nextDayWithClasses(from) {
    for (var i = 0; i <= 21; i++) {
      var d = addDays(from, i);
      var ls = lessonsFor(d, weekParity(d));
      if (ls.length) return { date: d, lessons: ls, parity: weekParity(d), offset: i };
    }
    return null;
  }

  /* Что происходит прямо сейчас. Чистая функция — её удобно тестировать. */
  function statusFor(now) {
    var parity = weekParity(now);
    var todays = lessonsFor(now, parity);
    var mins = now.getHours() * 60 + now.getMinutes();
    var running = null, next = null;

    for (var i = 0; i < todays.length; i++) {
      var s = toMin(todays[i].time), e = endMinutes(todays[i].time);
      if (mins >= s && mins < e) { running = { lesson: todays[i], start: s, end: e }; break; }
      if (s > mins) { next = { lesson: todays[i], start: s, end: e }; break; }
    }

    var dow = now.getDay();
    var weekend = (dow === 0 || dow === 6);
    var kind = running ? 'running'
             : next ? 'next'
             : todays.length ? 'done'
             : weekend ? 'weekend' : 'free';

    var nx = null;
    if (kind === 'done' || kind === 'free' || kind === 'weekend') {
      nx = nextDayWithClasses(addDays(startOfDay(now), 1));
    }

    return {
      parity: parity,
      semester: semesterState(now),
      lessons: todays,
      running: running,
      next: next,
      kind: kind,
      nextDay: nx,
      minutesLeft: running ? running.end - mins : 0,
      minutesToNext: next ? next.start - mins : 0,
      progress: running ? (mins - running.start) / (running.end - running.start) : 0
    };
  }

  /* ------------------------------ задания --------------------------------- */

  /* Отметки «сделано» живут только в браузере. Ключ отдельный от настроек
     недель, чтобы правка настроек не стирала отметки. */
  var TASKS_KEY = 'schedule-tasks-done';

  function loadDone() {
    try {
      var raw = JSON.parse(root.localStorage.getItem(TASKS_KEY) || '{}');
      return (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    } catch (e) { return {}; }
  }
  function saveDone(map) {
    try { root.localStorage.setItem(TASKS_KEY, JSON.stringify(map || {})); }
    catch (e) { /* приватный режим */ }
  }

  /* Список заданий; tolerate отсутствие раздела в data.js */
  function assignmentsList() {
    return Array.isArray(D.assignments) ? D.assignments : [];
  }

  /* Сколько дней до срока. Отрицательное — срок прошёл. */
  function daysUntil(date, now) {
    return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  }

  /* Состояние задания: сдано / просрочено / скоро / в работе */
  function assignmentState(a, now, done) {
    if (done && done[a.id]) return 'done';
    if (!a.due) return 'active';
    var d = daysUntil(parseISO(a.due), now);
    if (d < 0) return 'overdue';
    if (d <= 3) return 'soon';
    return 'active';
  }

  function fmtDueShort(d) {
    return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
  }

  /* «среда, 28 октября» (+ год, если он не текущий) */
  function fmtDeadline(d) {
    var s = DOW_NOM[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    return s + ' ' + d.getFullYear();
  }

  /* «сегодня», «завтра», «через 3 дня», «2 дня назад» */
  function relativeDeadline(days) {
    if (days === 0) return 'сегодня';
    if (days === 1) return 'завтра';
    if (days === 2) return 'послезавтра';
    if (days === -1) return 'вчера';
    if (days < 0) return (-days) + ' ' + plural(-days, ['день', 'дня', 'дней']) + ' назад';
    return 'через ' + days + ' ' + plural(days, ['день', 'дня', 'дней']);
  }

  /* Группировка заданий по дисциплинам. Внутри — по сроку, группы — по
     ближайшему сроку: то, что горит, всегда сверху. */
  function groupAssignments(list, now, done) {
    var groups = [];
    var index = {};
    list.forEach(function (a) {
      var key = a.subject || 'Без дисциплины';
      if (!index[key]) {
        index[key] = { subject: key, items: [], min: null, max: null };
        groups.push(index[key]);
      }
      var g = index[key];
      var due = a.due ? parseISO(a.due) : null;
      g.items.push({
        a: a,
        state: assignmentState(a, now, done),
        days: due ? daysUntil(due, now) : null
      });
      if (due) {
        if (!g.min || due < g.min) g.min = due;
        if (!g.max || due > g.max) g.max = due;
      }
    });
    groups.forEach(function (g) {
      g.items.sort(function (x, y) {
        if (x.days === null && y.days === null) return String(x.a.title).localeCompare(String(y.a.title));
        if (x.days === null) return 1;
        if (y.days === null) return -1;
        return x.days - y.days;
      });
      g.open = g.items.filter(function (i) { return i.state !== 'done'; }).length;
      g.done = g.items.length - g.open;
      g.next = g.items.filter(function (i) { return i.days !== null && i.days >= 0; })[0] || null;
    });
    groups.sort(function (a, b) {
      var an = a.next ? a.next.days : 9999, bn = b.next ? b.next.days : 9999;
      if (an !== bn) return an - bn;
      return a.subject.localeCompare(b.subject);
    });
    return groups;
  }

  /* Сводка по заданиям: сколько всего, сколько осталось, что горит */
  function assignmentSummary(list, now, done) {
    var total = list.length, open = 0, doneCount = 0, overdue = 0, soon = 0;
    var next = null;
    list.forEach(function (a) {
      var st = assignmentState(a, now, done);
      if (st === 'done') { doneCount++; return; }
      open++;
      if (st === 'overdue') overdue++;
      else if (st === 'soon') soon++;
      if (a.due) {
        var d = daysUntil(parseISO(a.due), now);
        if (d >= 0 && (!next || d < next.days)) next = { a: a, days: d, date: parseISO(a.due) };
      }
    });
    return { total: total, open: open, done: doneCount, overdue: overdue, soon: soon, next: next };
  }

  /* Ближайшая пара по этой дисциплине — чтобы было видно, где спросят */
  function nextLessonForSubject(subject, now) {
    var start = startOfDay(now);
    for (var i = 0; i <= 21; i++) {
      var d = addDays(start, i);
      var ls = lessonsFor(d, weekParity(d));
      for (var k = 0; k < ls.length; k++) {
        if (ls[k].subject === subject) return { date: d, lesson: ls[k] };
      }
    }
    return null;
  }

  /* ------------------------------- экспорт -------------------------------- */

  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }
  function icsLocal(d, mins) {
    var day = d, m = mins;
    if (m >= 1440) { day = addDays(d, Math.floor(m / 1440)); m = m % 1440; }
    return '' + day.getFullYear() + pad(day.getMonth() + 1) + pad(day.getDate()) +
           'T' + pad(Math.floor(m / 60)) + pad(m % 60) + '00';
  }
  function icsUTC(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

  /* Строка .ics не должна превышать 75 октетов. Кириллица — 2 байта,
     поэтому режем по байтам, а не по символам. */
  function utf8Len(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }
  function icsFold(line) {
    if (utf8Len(line) <= 75) return line;
    var parts = [], cur = '', curLen = 0, limit = 75;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      var chLen = utf8Len(ch);
      if (curLen + chLen > limit) {
        parts.push(cur);
        cur = ''; curLen = 0;
        limit = 74;              // продолжение начинается с пробела
      }
      cur += ch; curLen += chLen;
    }
    if (cur) parts.push(cur);
    return parts.join('\r\n ');
  }

  function buildICS() {
    /* Диапазон экспорта — границы семестра, а НЕ якорь отсчёта недель:
       иначе смена даты начала в подвале тихо выбрасывала бы пары. */
    var start = mondayOf(parseISO(classesStart()));
    var end = parseISO(D.semesterEnd);
    var stamp = icsUTC(new Date());
    var TZ = 'Europe/Yekaterinburg';

    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//schedule//ru//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape('Расписание ' + D.group),
      'X-WR-TIMEZONE:' + TZ,
      'BEGIN:VTIMEZONE',
      'TZID:' + TZ,
      'X-LIC-LOCATION:' + TZ,
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0500',
      'TZOFFSETTO:+0500',
      'TZNAME:YEKT',
      'DTSTART:19700101T000000',
      'END:STANDARD',
      'END:VTIMEZONE'
    ];

    for (var d = new Date(start); d <= end; d = addDays(d, 1)) {
      var dow = d.getDay();
      if (dow < 1 || dow > 5) continue;
      var parity = weekParity(d);
      var dayId = D.days[dow - 1].id;
      effectiveLessons().forEach(function (l) {
        if (l.day !== dayId || l.weeks.indexOf(parity) === -1) return;
        var s = toMin(l.time), e = endMinutes(l.time);
        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + icsLocal(d, s) + '-' + l.day + '-' + l.time.replace(':', '') +
                   '-' + (KIND_CLASS[l.kind] || 'x') + '@schedule');
        lines.push('DTSTAMP:' + stamp);
        lines.push('DTSTART;TZID=' + TZ + ':' + icsLocal(d, s));
        lines.push('DTEND;TZID=' + TZ + ':' + icsLocal(d, e));
        lines.push('SUMMARY:' + icsEscape(l.subject + ' · ' + (KIND_FULL[l.kind] || l.kind)));
        lines.push('LOCATION:' + icsEscape([l.room].filter(Boolean).join(', ')));
        lines.push('DESCRIPTION:' + icsEscape(l.teacher));
        lines.push('END:VEVENT');
      });
    }
    lines.push('END:VCALENDAR');
    /* каждая content-line должна заканчиваться CRLF (RFC 5545) */
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  /* Сроки сдачи — отдельным календарём. События «на весь день»:
     DTSTART;VALUE=DATE без времени, DTEND — следующий день (не включительно). */
  function icsDate(d) {
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  function asciiId(s, fallback) {
    var out = String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
    out = out.replace(/^[-.]+|[-.]+$/g, '');
    return out || fallback;
  }

  function buildTasksICS(list) {
    var stamp = icsUTC(new Date());
    var TZ = 'Europe/Yekaterinburg';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//schedule//ru//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape('Сроки заданий'),
      'X-WR-TIMEZONE:' + TZ,
      'BEGIN:VTIMEZONE',
      'TZID:' + TZ,
      'X-LIC-LOCATION:' + TZ,
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0500',
      'TZOFFSETTO:+0500',
      'TZNAME:YEKT',
      'DTSTART:19700101T000000',
      'END:STANDARD',
      'END:VTIMEZONE'
    ];

    (list || []).forEach(function (a, i) {
      if (!a.due) return;
      var d = parseISO(a.due);
      var uid = 'task-' + asciiId(a.id, 'a' + (i + 1)) + '-' + icsDate(d) + '@schedule';
      var desc = [a.teacher, a.what].filter(Boolean).join(' — ');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART;VALUE=DATE:' + icsDate(d));
      lines.push('DTEND;VALUE=DATE:' + icsDate(addDays(d, 1)));
      lines.push('SUMMARY:' + icsEscape([a.subject, a.title].filter(Boolean).join(' · ')));
      if (desc) lines.push('DESCRIPTION:' + icsEscape(desc));
      if (a.link) lines.push('URL:' + icsEscape(a.link));
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  root.ScheduleCore = {
    D: D,
    KIND_CLASS: KIND_CLASS,
    KIND_FULL: KIND_FULL,
    MONTHS: MONTHS,
    MONTHS_SHORT: MONTHS_SHORT,
    DOW_NOM: DOW_NOM,
    esc: esc, pad: pad, toMin: toMin, fromMin: fromMin,
    startOfDay: startOfDay, addDays: addDays, mondayOf: mondayOf, parseISO: parseISO,
    sameDay: sameDay, fmtDate: fmtDate, fmtDateLong: fmtDateLong, capitalize: capitalize,
    humanDuration: humanDuration, plural: plural,
    loadPrefs: loadPrefs, savePrefs: savePrefs, anchorDate: anchorDate,
    academicWeekNo: academicWeekNo, weekParity: weekParity, weekMonday: weekMonday,
    semesterState: semesterState, classesStart: classesStart,
    dayIdFor: dayIdFor, lessonsFor: lessonsFor, endTime: endTime, endMinutes: endMinutes,
    nextDayWithClasses: nextDayWithClasses,
    statusFor: statusFor, effectiveLessons: effectiveLessons, lastWeekNo: lastWeekNo,
    buildICS: buildICS,
    /* задания */
    loadDone: loadDone, saveDone: saveDone, assignmentsList: assignmentsList,
    daysUntil: daysUntil, assignmentState: assignmentState, fmtDueShort: fmtDueShort,
    fmtDeadline: fmtDeadline, relativeDeadline: relativeDeadline,
    groupAssignments: groupAssignments, assignmentSummary: assignmentSummary,
    nextLessonForSubject: nextLessonForSubject, buildTasksICS: buildTasksICS
  };
})(typeof window !== 'undefined' ? window : globalThis);
