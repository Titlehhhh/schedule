/* ============================================================================
   Расписание занятий — интерфейс
   Рисует DOM, вешает обработчики. Вся логика — в core.js
   ========================================================================== */

(function () {
  'use strict';

  var C = window.ScheduleCore;
  if (!C || !C.D || !C.D.lessons) {
    document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">' +
      'Не удалось загрузить data.js и core.js</p>';
    return;
  }
  var D = C.D;
  var PAGE = document.body.getAttribute('data-page') || 'schedule';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = C.esc;
  function on(sel, ev, fn, capture) { var el = $(sel); if (el) el.addEventListener(ev, fn, !!capture); }

  var MIN_WEEK = -52;   // насколько далеко можно листать назад

  var state = {
    cursor: null,   // номер просматриваемой учебной недели
    now: new Date(),
    statusKey: null,// что показывает блок «Сейчас» (для live-региона)
    fixedNow: false,// ?now=… — посмотреть состояние на конкретный момент
    done: {},       // id задания → true (лежит в localStorage)
    openSubjects: {},// какие дисциплины раскрыты
    taskFilter: 'all',   // all | open | done
    taskSubject: '',     // id выбранной дисциплины (пусто — все)
    taskQuery: ''        // строка поиска
  };

  /* ?now=2026-10-25T12:00 — показать сайт на конкретный момент (для проверки) */
  function readFixedNow() {
    var m = /[?&]now=([\dT:\-]+)/.exec(window.location.search);
    if (!m) return null;
    var d = new Date(m[1].replace('T', ' ').replace(/-/g, '/'));
    return isNaN(d.getTime()) ? null : d;
  }

  function ensureCursor() {
    if (state.cursor == null) {
      /* ?week=N — открыть конкретную учебную неделю (ссылка на расписание) */
      var m = /[?&]week=(\d+)/.exec(window.location.search);
      var n = m ? parseInt(m[1], 10) : C.academicWeekNo(state.now);
      if (!isFinite(n)) n = C.academicWeekNo(state.now);
      state.cursor = Math.max(MIN_WEEK, Math.min(n, C.lastWeekNo()));
    }
  }

  /* -------------------------------- разметка ------------------------------- */

  function lessonHTML(l, flags) {
    flags = flags || {};
    var meta = [];
    if (flags.now) meta.push('<span class="pill-now">идёт сейчас</span>');
    else if (flags.next) meta.push('<span class="pill-soon">скоро</span>');
    meta.push('<span class="chip chip--' + (C.KIND_CLASS[l.kind] || 'pr') + '" title="' +
              esc(C.KIND_FULL[l.kind] || l.kind) + '">' + esc(l.kind) + '</span>');
    meta.push('<span class="lesson__teacher">' + esc(l.teacher) + '</span>');
    if (l.room) meta.push('<span class="lesson__sep">·</span><span>' + esc(l.room) + '</span>');

    var cls = 'lesson';
    if (flags.now) cls += ' lesson--now';
    else if (flags.next) cls += ' lesson--next';
    else if (flags.past) cls += ' lesson--past';

    return '<li class="' + cls + '">' +
      '<span class="lesson__time">' +
        '<span class="lesson__start">' + esc(l.time) + '</span>' +
        '<span class="lesson__end">–' + esc(C.endTime(l.time)) + '</span>' +
      '</span>' +
      '<span class="lesson__body">' +
        '<span class="lesson__subject">' + esc(l.subject) + '</span>' +
        '<span class="lesson__meta">' + meta.join(' ') + '</span>' +
      '</span>' +
    '</li>';
  }

  function listHTML(lessons, flagsFn) {
    if (!lessons.length) return '';
    return '<ul class="lessons">' + lessons.map(function (l, i) {
      return lessonHTML(l, flagsFn ? flagsFn(l, i) : null);
    }).join('') + '</ul>';
  }

  function emptyHTML(title, text) {
    return '<div class="empty"><p class="empty__title">' + esc(title) + '</p>' +
           (text ? '<p>' + esc(text) + '</p>' : '') + '</div>';
  }

  /* Какая пара идёт сейчас, а какая — следующая (индексы в списке) */
  function markState(lessons, mins) {
    var running = -1, next = -1;
    lessons.forEach(function (l, i) {
      var s = C.toMin(l.time), e = C.toMin(C.endTime(l.time));
      if (mins >= s && mins < e) running = i;
      else if (s > mins && next === -1) next = i;
    });
    return { running: running, next: next };
  }

  /* Пара закончилась — приглушаем её */
  function isPast(l, mins) {
    return mins >= C.toMin(C.endTime(l.time));
  }

  /* Подсказка «где следующие занятия»: с предметом и аудиторией.
     Пометка недели обязательна, если неделя отличается от текущей. */
  function nextHint(from) {
    var nx = C.nextDayWithClasses(from);
    if (!nx) return 'Расписание закончилось.';
    var l = nx.lessons[0];
    var week = (nx.parity !== C.weekParity(C.startOfDay(state.now)))
      ? ' (' + nx.parity + '-я неделя)' : '';
    var more = nx.lessons.length > 1
      ? ' Всего в этот день ' + nx.lessons.length + ' ' + C.plural(nx.lessons.length, ['пара', 'пары', 'пар']) + '.'
      : '';
    return 'Ближайшая пара — ' + C.DOW_NOM[nx.date.getDay()] + ', ' + C.fmtDate(nx.date) +
           ' в ' + l.time + ' — ' + l.subject +
           (l.room ? ', ' + l.room : '') + week + '.' + more;
  }

  /* ------------------------------- статус --------------------------------- */

  function renderStatus() {
    var now = state.now;
    var st = C.statusFor(now);

    var box = $('#status');
    var kicker = $('#statusKicker');
    var title = $('#statusTitle');
    var metaEl = $('#statusMeta');
    var lead = $('#statusLead');
    var progress = $('#statusProgress');
    box.className = 'status';

    function meta(l) {
      return '<span class="chip chip--' + (C.KIND_CLASS[l.kind] || 'pr') + '" title="' +
               esc(C.KIND_FULL[l.kind] || l.kind) + '">' + esc(l.kind) + '</span>' +
             '<span>' + esc(l.time) + '–' + esc(C.endTime(l.time)) + '</span>' +
             '<span class="lesson__sep">·</span><span>' + esc(l.teacher) + '</span>' +
             (l.room ? '<span class="lesson__sep">·</span><span>' + esc(l.room) + '</span>' : '');
    }

    /* живой регион обновляем только когда статус реально изменился,
       иначе скринридер будет перечитывать блок каждые 20 секунд */
    var key = st.semester + '|' + st.kind + '|' +
              (st.running ? st.running.lesson.time + st.running.lesson.subject
               : st.next ? st.next.lesson.time + st.next.lesson.subject : '');
    var changed = key !== state.statusKey;
    state.statusKey = key;

    if (st.semester === 'before' || st.semester === 'after') {
      var startD = C.parseISO(C.classesStart());
      var endD = C.parseISO(D.semesterEnd);
      kicker.textContent = st.semester === 'before' ? 'Ещё не началось' : 'Семестр завершён';
      if (changed) {
        title.innerHTML = '<span class="sr-only">' + (st.semester === 'before' ? 'Занятия ещё не начались: ' : 'Семестр завершён: ') + '</span>' +
          (st.semester === 'before' ? 'Занятия ещё не начались' : 'Занятий больше нет');
        metaEl.innerHTML = '';
      }
      lead.innerHTML = st.semester === 'before'
        ? 'Начало занятий — ' + C.fmtDate(startD) + ' ' + startD.getFullYear() + '.'
        : 'Последний день занятий — ' + C.fmtDate(endD) + ' ' + endD.getFullYear() + '.';
      progress.hidden = true;
      progress.innerHTML = '';
      renderNowBar(null);
      return;
    }

    if (st.running) {
      var l = st.running.lesson;
      box.className += ' status--live';
      kicker.textContent = 'Идёт сейчас';
      if (changed) {
        title.innerHTML = '<span class="sr-only">Идёт сейчас: </span>' + esc(l.subject);
        metaEl.innerHTML = meta(l);
      }
      lead.innerHTML = '<span class="countdown">До ' + esc(C.endTime(l.time)) +
        ' · осталось ' + C.humanDuration(st.minutesLeft) + '</span>';
      progress.hidden = false;
      var bar = progress.querySelector('.progress__bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'progress__bar';
        progress.appendChild(bar);
      }
      bar.style.width = Math.min(100, Math.round(st.progress * 100)) + '%';
      renderNowBar(l);
      return;
    }

    if (st.next) {
      var n = st.next.lesson;
      box.className += ' status--next';
      kicker.textContent = 'Следующая пара';
      if (changed) {
        title.innerHTML = '<span class="sr-only">Следующая пара: </span>' + esc(n.subject);
        metaEl.innerHTML = meta(n);
      }
      lead.innerHTML = '<span class="countdown">Начнётся через ' +
        C.humanDuration(st.minutesToNext) + '</span> · в ' + esc(n.time);
      progress.hidden = true;
      progress.innerHTML = '';
      renderNowBar(n, true);
      return;
    }

    var note = nextHint(C.addDays(C.startOfDay(now), 1));

    if (st.kind === 'done') {
      var last = st.lessons[st.lessons.length - 1];
      kicker.textContent = 'Занятия закончились';
      if (changed) {
        title.innerHTML = '<span class="sr-only">Занятия закончились: </span>Все пары закончились';
        metaEl.innerHTML = '';
      }
      lead.innerHTML = 'Последняя пара — ' + esc(last.subject) + ', закончилась в ' +
        esc(C.endTime(last.time)) + '.';
      if (note) lead.innerHTML += ' <span class="status__note">' + esc(note) + '</span>';
    } else {
      kicker.textContent = st.kind === 'weekend' ? 'Выходной' : 'Без занятий';
      if (changed) {
        title.innerHTML = '<span class="sr-only">' +
          (st.kind === 'weekend' ? 'Выходной: ' : 'Без занятий: ') + '</span>' +
          (st.kind === 'weekend' ? 'Сегодня выходной' : 'Сегодня пар не было');
        metaEl.innerHTML = '';
      }
      lead.innerHTML = '';
      if (note) lead.innerHTML = '<span class="status__note">' + esc(note) + '</span>';
    }
    progress.hidden = true;
    progress.innerHTML = '';
    renderNowBar(null);
  }

  /* Липкая полоска в шапке: что идёт прямо сейчас */
  function renderNowBar(lesson, isNext) {
    var bar = $('#nowbar');
    if (!lesson) { bar.hidden = true; return; }
    bar.hidden = false;
    $('#nowbarLabel').textContent = isNext ? 'скоро' : 'сейчас';
    /* аудитория впереди: её не обрезать — она и есть ответ «куда идти» */
    var where = lesson.room ? lesson.room + ' · ' : '';
    var when = lesson.time + '–' + C.endTime(lesson.time);
    $('#nowbarText').textContent = where + lesson.subject + ' · ' + when;
    $('#nowbarTextShort').textContent = where + when;
  }

  /* ------------------------- сегодня / завтра ----------------------------- */

  function renderDayCards() {
    var now = state.now;
    var today = C.startOfDay(now);
    var tomorrow = C.addDays(today, 1);
    var parityToday = C.weekParity(today);
    var parityTomorrow = C.weekParity(tomorrow);
    var mins = now.getHours() * 60 + now.getMinutes();

    var todayLessons = C.lessonsFor(today, parityToday);
    var tomorrowLessons = C.lessonsFor(tomorrow, parityTomorrow);
    var semester = C.semesterState(today);

    /* --- сегодня --- */
    $('#todayCard').className = 'card card--today';
    $('#todaySub').textContent = C.capitalize(C.fmtDateLong(today)) +
      (today.getFullYear() !== now.getFullYear() ? ' ' + today.getFullYear() : '') +
      ' · ' + parityToday + '-я неделя';

    if (semester !== 'inside') {
      $('#todayBody').innerHTML = emptyHTML(
        semester === 'before' ? 'Занятия ещё не начались' : 'Семестр завершён',
        semester === 'before'
          ? 'Начало занятий — ' + C.fmtDate(C.parseISO(C.classesStart())) + '.'
          : 'Расписание семестра закончилось.'
      );
    } else if (todayLessons.length) {
      var st = markState(todayLessons, mins);
      $('#todayBody').innerHTML = listHTML(todayLessons, function (l, i) {
        return {
          now: i === st.running,
          next: i === st.next,
          past: isPast(l, mins)
        };
      });
    } else {
      var otherWeek = C.lessonsFor(today, parityToday === 1 ? 2 : 1);
      $('#todayBody').innerHTML = emptyHTML(
        (today.getDay() === 0 || today.getDay() === 6) ? 'Выходной' : 'Сегодня пар не было',
        (otherWeek.length
          ? 'В ' + (parityToday === 1 ? '2-ю' : '1-ю') + ' неделю в этот день ' +
            otherWeek.length + ' ' + C.plural(otherWeek.length, ['пара', 'пары', 'пар']) + '.'
          : '') + (otherWeek.length ? ' ' : '') + nextHint(C.addDays(today, 1))
      );
    }

    /* --- завтра --- */
    $('#tomorrowSub').textContent = C.capitalize(C.fmtDateLong(tomorrow)) +
      (tomorrow.getFullYear() !== now.getFullYear() ? ' ' + tomorrow.getFullYear() : '') +
      ' · ' + parityTomorrow + '-я неделя';

    var alert = '';
    if (parityTomorrow !== parityToday) {
      alert = '<p class="card__alert">Завтра начинается ' + parityTomorrow +
              '-я неделя — расписание другое.</p>';
    }

    if (semester !== 'inside') {
      $('#tomorrowBody').innerHTML = alert + emptyHTML(
        semester === 'before' ? 'Занятия ещё не начались' : 'Семестр завершён', ''
      );
    } else if (tomorrowLessons.length) {
      $('#tomorrowBody').innerHTML = alert + listHTML(tomorrowLessons, null);
    } else {
      var otherWeek2 = C.lessonsFor(tomorrow, parityTomorrow === 1 ? 2 : 1);
      $('#tomorrowBody').innerHTML = alert + emptyHTML(
        (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) ? 'Выходной' : 'Пар не будет',
        (otherWeek2.length
          ? 'В ' + (parityTomorrow === 1 ? '2-ю' : '1-ю') + ' неделю в этот день ' +
            otherWeek2.length + ' ' + C.plural(otherWeek2.length, ['пара', 'пары', 'пар']) + '.'
          : '') + (otherWeek2.length ? ' ' : '') + nextHint(tomorrow)
      );
    }
  }

  /* ------------------------------ неделя ---------------------------------- */

  function renderWeek() {
    var n = state.cursor;
    var mon = C.weekMonday(n);
    var parity = C.weekParity(mon);
    var today = C.startOfDay(state.now);
    var currentWeekNo = C.academicWeekNo(today);
    var mins = state.now.getHours() * 60 + state.now.getMinutes();

    var fri = C.addDays(mon, 4);
    var range;
    if (mon.getMonth() === fri.getMonth()) {
      range = mon.getDate() + '–' + fri.getDate() + ' ' + C.MONTHS[mon.getMonth()];
    } else if (mon.getFullYear() === fri.getFullYear()) {
      range = C.fmtDate(mon) + ' – ' + C.fmtDate(fri);
    } else {
      /* неделя через Новый год — показываем год */
      range = C.fmtDate(mon) + ' ' + mon.getFullYear() + ' – ' + C.fmtDate(fri) + ' ' + fri.getFullYear();
    }

    $('#weekRange').textContent = range + ' · ' + parity + '-я неделя';

    var hint = $('#weekHint');
    if (n === currentWeekNo) {
      hint.hidden = true;
    } else {
      hint.hidden = false;
      hint.innerHTML = '<span>' +
        (n > currentWeekNo ? 'Показана следующая неделя' : 'Показана предыдущая неделя') +
        ' — ' + range + '.</span>' +
        '<button type="button" class="linkbtn linkbtn--inline" id="weekToday">К текущей неделе</button>';
    }

    /* не даём листать дальше конца семестра */
    var last = C.lastWeekNo();
    $('#weekNext').disabled = n >= last;
    $('#weekPrev').disabled = n <= MIN_WEEK;

    if (window.history && window.history.replaceState) {
      try {
        var params = new URLSearchParams(window.location.search);
        params.set('week', String(n));
        window.history.replaceState(null, '', '?' + params.toString());
      } catch (e) { /* file:// */ }
    }

    var html = '';
    for (var i = 0; i < 5; i++) {
      var date = C.addDays(mon, i);
      var day = D.days[i];
      var lessons = C.lessonsFor(date, parity);
      var isToday = C.sameDay(date, today);

      var runningIdx = -1, nextIdx = -1;
      if (isToday && C.semesterState(date) === 'inside') {
        var st = markState(lessons, mins);
        runningIdx = st.running;
        nextIdx = st.next;
      }

      var body;
      if (lessons.length) {
        body = listHTML(lessons, function (l, k) {
          return {
            now: k === runningIdx,
            next: k === nextIdx,
            past: isToday && isPast(l, mins)
          };
        });
      } else {
        var other = C.lessonsFor(date, parity === 1 ? 2 : 1);
        body = '<div class="empty">' +
          '<p class="empty__title">Пар нет</p>' +
          (other.length
            ? '<p>В ' + (parity === 1 ? '2-ю' : '1-ю') + ' неделю здесь ' + other.length + ' ' +
              C.plural(other.length, ['пара', 'пары', 'пар']) + ': ' +
              esc(other[0].time) + ' — ' + esc(other[0].subject) + '.</p>'
            : '<p>В этот день занятий нет ни в одну из недель.</p>') +
          '</div>';
      }

      html += '<article class="day' + (isToday ? ' day--today' : '') + '">' +
        '<header class="day__head">' +
          '<span class="day__name">' + esc(day.title) + '</span>' +
          '<span class="day__date">' + esc(C.fmtDate(date)) +
            (isToday ? ' <span class="tag-today">сегодня</span>' : '') +
          '</span>' +
        '</header>' +
        '<div class="day__body">' + body + '</div>' +
      '</article>';
    }
    $('#days').innerHTML = html;
  }

  /* ------------------------------- шапка ---------------------------------- */

  function renderTopbar() {
    var now = state.now;
    var parity = C.weekParity(now);
    $('#brandDept').textContent = D.form;
    $('#brandTitle').textContent = PAGE === 'tasks' ? 'Задания' : D.group;
    $('#weekPillNum').textContent = parity + '-я неделя';
    $('#weekPill').title = 'Сейчас идёт ' + parity + '-я учебная неделя';
    $('#topbarDate').textContent = C.fmtDate(now);
    if ($('#statusClock')) {
      $('#statusClock').textContent = C.pad(now.getHours()) + ':' + C.pad(now.getMinutes());
    }
  }

  function renderAnchorUI() {
    var a = C.anchorDate();
    var d = C.parseISO(a);
    var p = C.loadPrefs();
    $('#anchorInput').value = a;
    $('#anchorEcho').textContent = C.fmtDate(d) + ' ' + d.getFullYear();
    var wn = C.academicWeekNo(state.now);
    $('#academicWeekEcho').textContent = wn < 1 ? 'семестр ещё не начался' : wn;
    $('#swapInput').checked = (p.swap !== undefined) ? !!p.swap : !!D.swapWeeks;

    /* в исходной таблице колледжа написано «начало занятий с 2 ноября» —
       показываем подсказку, если у нас другая дата */
    var cs = D.classesStart || D.semesterStart;
    var note = $('#classesNote');
    var btn = $('#classesNov');
    if (cs === '2026-11-02') {
      note.textContent = 'Занятия считаются начавшимися 2 ноября 2026.';
      btn.hidden = true;
    } else {
      note.textContent = 'В исходной таблице написано: «начало занятий с 2 ноября — 2 неделя». ' +
        'Если до 2 ноября у вас пар нет, нажмите кнопку ниже.';
      btn.hidden = false;
    }
  }

  /* ------------------------------- экспорт -------------------------------- */

  function downloadICS() {
    var blob = new Blob([C.buildICS()], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'raspisanie.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* ------------------------------- задания -------------------------------- */

  function safeUrl(u) {
    return /^https?:\/\//i.test(String(u || '')) ? String(u) : '';
  }

  function itemById(id) {
    var list = C.assignmentsList();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        var a = list[i];
        return {
          a: a,
          state: C.assignmentState(a, state.now, state.done),
          days: a.due ? C.daysUntil(C.parseISO(a.due), state.now) : null
        };
      }
    }
    return null;
  }

  function stateChip(st) {
    if (st === 'done') return '<span class="chip chip--ok">сдано</span>';
    if (st === 'overdue') return '<span class="chip chip--danger">просрочено</span>';
    if (st === 'soon') return '<span class="chip chip--warn">скоро</span>';
    return '';
  }

  /* ближайший несданный срок среди заданий группы */
  function nearestDue(items) {
    var best = null;
    items.forEach(function (a) {
      if (!a.due) return;
      if (C.assignmentState(a, state.now, state.done) === 'done') return;
      var d = C.daysUntil(C.parseISO(a.due), state.now);
      if (!best || d < best.days) best = { days: d, a: a };
    });
    return best;
  }

  function dueChipHTML(best) {
    if (!best) return '';
    if (best.days < 0) {
      var n = -best.days;
      return '<span class="chip chip--danger">просрочено ' + n + ' ' +
             C.plural(n, ['день', 'дня', 'дней']) + '</span>';
    }
    return '<span class="chip chip--plain">до ' + esc(C.fmtDueShort(C.parseISO(best.a.due))) + '</span>';
  }

  function taskHTML(item) {
    var a = item.a;
    var id = a.id || '';
    var due = a.due ? C.parseISO(a.due) : null;
    var h = '<article class="task task--' + item.state + '" data-id="' + esc(id) + '">';
    h += '<div class="task__top">';
    h += '<span class="task__check"><input type="checkbox" data-task-id="' + esc(id) + '"' +
         (state.done[id] ? ' checked' : '') + '>' +
         '<span class="sr-only">Отметить «' + esc(a.title || 'задание') + '» как выполненное</span></span>';
    h += '<div class="task__head">';
    h += '<h3 class="task__title">' + esc(a.title || 'Без названия') + '</h3>';
    h += '<p class="task__meta">';
    if (a.type) h += '<span class="chip chip--type">' + esc(a.type) + '</span>';
    if (due) h += '<span class="task__due">Срок: ' + esc(C.fmtDeadline(due)) + '</span>';
    if (item.days !== null) h += '<span class="task__rel">' + esc(C.relativeDeadline(item.days)) + '</span>';
    h += stateChip(item.state);
    h += '</p></div></div>';
    if (a.what) h += '<p class="task__what">' + esc(a.what) + '</p>';
    var f = a.file ? C.fileById(a.file) : null;
    if (f) {
      h += '<a class="attach" href="' + esc(f.file) + '" download>';
      h += '<span class="attach__badge attach__badge--' +
           esc(String(f.type || '').toLowerCase()) + '">' +
           esc(String(f.type || '').toUpperCase()) + '</span>';
      h += '<span class="attach__body">';
      h += '<span class="attach__name">' + esc(f.title || '') + '</span>';
      h += '<span class="attach__meta">' + esc(C.fmtSize(f.size)) + ' · ' +
           esc(String(f.file || '').split('/').pop()) + '</span>';
      h += '</span>';
      h += '<span class="attach__dl" aria-hidden="true">';
      h += '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false">' +
           '<path d="M8 1.5v8M4.5 6 8 9.5 11.5 6M2.5 12.5v1A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-1" ' +
           'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      h += '</span></a>';
    }
    if (a.how && a.how.length) {
      h += '<details class="task__steps"><summary>Как делать · ' + a.how.length + ' ' +
           C.plural(a.how.length, ['шаг', 'шага', 'шагов']) + '</summary><ol class="steps">';
      for (var i = 0; i < a.how.length; i++) h += '<li>' + esc(a.how[i]) + '</li>';
      h += '</ol></details>';
    }
    var foot = [];
    if (a.criteria) foot.push('<span class="task__crit">Критерии: ' + esc(a.criteria) + '</span>');
    if (a.teacher) foot.push('<span class="task__teacher">' + esc(a.teacher) + '</span>');
    var nl = a.subject ? C.nextLessonForSubject(a.subject, state.now) : null;
    if (nl) {
      foot.push('<span class="task__next">следующая пара: ' +
        esc(C.DOW_NOM[nl.date.getDay()]) + ', ' + esc(nl.lesson.time) + '</span>');
    }
    var url = safeUrl(a.link);
    if (url) foot.push('<a class="task__link" href="' + esc(url) + '" target="_blank" rel="noopener">Материалы</a>');
    if (foot.length) h += '<div class="task__foot">' + foot.join('') + '</div>';
    h += '</article>';
    return h;
  }

  /* полоса сроков: где на оси времени лежат задания дисциплины */
  function railHTML(g) {
    var dated = g.items.filter(function (i) { return i.days !== null; });
    if (dated.length < 2 || !g.min || !g.max) return '';
    var span = (g.max - g.min) / 86400000;
    if (span <= 0) return '';
    var h = '<span class="disc__rail" aria-hidden="true">';
    var t = (C.startOfDay(state.now) - g.min) / 86400000;
    if (t >= 0 && t <= span) {
      h += '<span class="disc__today" style="left:' + (t / span * 100).toFixed(2) + '%"></span>';
    }
    dated.forEach(function (i) {
      var p = ((C.parseISO(i.a.due) - g.min) / 86400000) / span * 100;
      var cls = 'disc__tick';
      if (i.state === 'done') cls += ' disc__tick--done';
      else if (i.state === 'overdue') cls += ' disc__tick--overdue';
      else if (i.state === 'soon') cls += ' disc__tick--soon';
      h += '<span class="' + cls + '" style="left:' + p.toFixed(2) + '%"></span>';
    });
    h += '</span>';
    return h;
  }

  function disciplineHTML(g, idx) {
    var isOpen = (state.openSubjects[g.subject] !== undefined)
      ? state.openSubjects[g.subject]
      : (idx === 0);
    var h = '<details class="disc" data-subject="' + esc(g.subject) + '"' + (isOpen ? ' open' : '') + '>';
    h += '<summary class="disc__head"><span class="disc__row">';
    h += '<span class="disc__name">' + esc(g.subject) + '</span>';
    h += '<span class="disc__side">';
    h += '<span class="disc__count">' + g.done + ' из ' + g.items.length + ' сдано</span>';
    h += dueChipHTML(nearestDue(g.items.map(function (i) { return i.a; })));
    h += '<svg class="disc__chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
         '<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    h += '</span></span>';
    h += railHTML(g);
    h += '</summary><div class="disc__body">';
    g.items.forEach(function (i) { h += taskHTML(i); });
    h += '</div></details>';
    return h;
  }

  function visibleAssignments() {
    var q = state.taskQuery.trim().toLowerCase();
    return C.assignmentsList().filter(function (a) {
      var st = C.assignmentState(a, state.now, state.done);
      if (state.taskFilter === 'open' && st === 'done') return false;
      if (state.taskFilter === 'done' && st !== 'done') return false;
      if (state.taskSubject && (a.subject || 'Без дисциплины') !== state.taskSubject) return false;
      if (q) {
        var hay = [a.title, a.type, a.subject, a.what, a.teacher].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderSummary(sum) {
    var box = $('#tasksSummary');
    if (box) {
      if (!sum.total) {
        box.innerHTML = 'Заданий пока нет. Их заносят в <b>data.js</b>.';
      } else {
        var parts = [];
        parts.push(sum.total + ' ' + C.plural(sum.total, ['задание', 'задания', 'заданий']));
        if (sum.open) parts.push('осталось ' + sum.open);
        else parts.push('<span class="is-ok">всё сдано</span>');
        if (sum.overdue) parts.push('<span class="is-danger">просрочено ' + sum.overdue + '</span>');
        if (sum.next) parts.push('ближайший срок — <b>' + esc(C.fmtDeadline(sum.next.date)) + '</b>');
        box.innerHTML = parts.join(' · ');
      }
    }
    var badge = $('#tasksBadge');
    if (!badge) return;
    if (sum.open) { badge.textContent = String(sum.open); badge.hidden = false; }
    else badge.hidden = true;
  }

  function renderUrgent() {
    var list = C.assignmentsList().filter(function (a) {
      return C.assignmentState(a, state.now, state.done) !== 'done';
    });
    list.sort(function (a, b) {
      var da = a.due ? C.daysUntil(C.parseISO(a.due), state.now) : 9999;
      var db = b.due ? C.daysUntil(C.parseISO(b.due), state.now) : 9999;
      return da - db;
    });
    var box = $('#urgentList');
    if (!list.length) {
      box.innerHTML = '<p class="urgent__none">Несданных заданий нет.</p>';
      return;
    }
    var h = '';
    list.slice(0, 6).forEach(function (a) {
      var st = C.assignmentState(a, state.now, state.done);
      var days = a.due ? C.daysUntil(C.parseISO(a.due), state.now) : null;
      var mod = st === 'overdue' ? ' urgent__item--overdue'
              : st === 'soon' ? ' urgent__item--soon' : '';
      h += '<div class="urgent__item' + mod + '">';
      h += '<button type="button" class="urgent__btn" data-goto="' + esc(a.subject || '') + '">';
      h += '<span class="urgent__due">' +
           esc(days === null ? 'без срока' : C.relativeDeadline(days)) + '</span>';
      h += '<span class="urgent__name">' + esc(a.title || 'Без названия') + '</span>';
      h += '<span class="urgent__subj">' + esc(a.subject || '') + '</span>';
      h += '</button></div>';
    });
    box.innerHTML = h;
  }

  function renderSubjectSelect() {
    var sel = $('#tasksSubject');
    var subjects = [];
    C.assignmentsList().forEach(function (a) {
      var s = a.subject || 'Без дисциплины';
      if (subjects.indexOf(s) === -1) subjects.push(s);
    });
    subjects.sort();
    var html = '<option value="">Все дисциплины</option>';
    subjects.forEach(function (s) {
      html += '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    });
    sel.innerHTML = html;
    sel.value = state.taskSubject;
  }

  function renderTasks() {
    var all = C.assignmentsList();
    var list = visibleAssignments();
    var groups = C.groupAssignments(list, state.now, state.done);

    renderSummary(C.assignmentSummary(all, state.now, state.done));

    var box = $('#tasksList');
    if (!list.length) {
      box.innerHTML = '<div class="tasks__empty"><b>' +
        (all.length ? 'Ничего не найдено' : 'Заданий пока нет') + '</b>' +
        (all.length
          ? 'Под выбранные условия ничего не подходит — поменяйте фильтр или очистите поиск.'
          : 'Добавьте их в раздел assignments файла data.js — они появятся здесь сразу.') +
        '</div>';
    } else {
      var html = '';
      groups.forEach(function (g, i) { html += disciplineHTML(g, i); });
      box.innerHTML = html;
    }

    renderUrgent();
    renderSubjectSelect();
  }

  /* Пересчёт счётчиков без перерисовки списка — чтобы страница не прыгала
     после отметки «сделано». */
  function updateCounts() {
    var all = C.assignmentsList();
    renderSummary(C.assignmentSummary(all, state.now, state.done));
    $$('.disc', $('#tasksList')).forEach(function (disc) {
      var subject = disc.getAttribute('data-subject');
      var items = all.filter(function (a) {
        return (a.subject || 'Без дисциплины') === subject;
      });
      var done = items.filter(function (a) {
        return C.assignmentState(a, state.now, state.done) === 'done';
      }).length;
      var cnt = disc.querySelector('.disc__count');
      if (cnt) cnt.textContent = done + ' из ' + items.length + ' сдано';
      var chip = disc.querySelector('.disc__side .chip');
      var html = dueChipHTML(nearestDue(items));
      if (chip) chip.outerHTML = html;
      else if (html) {
        var side = disc.querySelector('.disc__side');
        if (side) side.insertAdjacentHTML('afterbegin', html);
      }
    });
    renderUrgent();
  }

  function refreshTask(id) {
    var item = itemById(id);
    if (!item) return;
    var el = null;
    $$('.task', $('#tasksList')).forEach(function (node) {
      if (node.getAttribute('data-id') === id) el = node;
    });
    if (!el) return;
    el.className = 'task task--' + item.state;
    var metas = el.querySelector('.task__meta');
    if (!metas) return;
    var old = metas.querySelector('.chip--ok, .chip--danger, .chip--warn');
    var html = stateChip(item.state);
    if (old) old.outerHTML = html;
    else if (html) metas.insertAdjacentHTML('beforeend', html);
  }

  function downloadTasksICS() {
    var blob = new Blob([C.buildTasksICS(C.assignmentsList())], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'zadaniya.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  /* --------------------------------- рендер ------------------------------- */

  function renderAll() {
    ensureCursor();
    renderTopbar();
    if ($('#status')) renderStatus();
    if ($('#todayBody')) renderDayCards();
    if ($('#days')) renderWeek();
    if ($('#anchorInput')) renderAnchorUI();
    renderSummary(C.assignmentSummary(C.assignmentsList(), state.now, state.done));
    if ($('#tasksList')) renderTasks();
  }

  /* -------------------------------- события -------------------------------- */

  function bind() {
    /* --- фильтры и поиск --- */
    $$('.segmented__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.taskFilter = btn.getAttribute('data-taskfilter');
        $$('.segmented__btn').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        renderTasks();
      });
    });

    on('#tasksSearch', 'input', function () {
      state.taskQuery = this.value;
      renderTasks();
    });

    on('#tasksSubject', 'change', function () {
      state.taskSubject = this.value;
      renderTasks();
    });

    /* --- отметки «сделано» --- */
    on('#tasksList', 'change', function (e) {
      var box = e.target;
      if (!box || box.type !== 'checkbox') return;
      var id = box.getAttribute('data-task-id');
      if (!id) return;
      if (box.checked) state.done[id] = true;
      else delete state.done[id];
      C.saveDone(state.done);
      refreshTask(id);
      updateCounts();
    });

    /* какие дисциплины раскрыты — запоминаем, чтобы фильтр не сбрасывал вид */
    on('#tasksList', 'toggle', function (e) {
      var d = e.target;
      if (!d || !d.className || d.className.indexOf('disc') !== 0) return;
      state.openSubjects[d.getAttribute('data-subject')] = d.open;
    }, true);

    /* --- «что горит»: переход к дисциплине --- */
    on('#urgentList', 'click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.urgent__btn') : null;
      if (!btn) return;
      var subject = btn.getAttribute('data-goto');
      var disc = null;
      $$('.disc', $('#tasksList')).forEach(function (d) {
        if (d.getAttribute('data-subject') === subject) disc = d;
      });
      if (!disc) return;
      disc.open = true;
      state.openSubjects[subject] = true;
      disc.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var sum = disc.querySelector('.disc__head');
      if (sum) sum.focus({ preventScroll: true });
    });

    on('#tasksIcsBtn', 'click', downloadTasksICS);

    on('#weekPrev', 'click', function () {
      state.cursor = Math.max(MIN_WEEK, state.cursor - 1);
      renderWeek();
    });

    on('#weekNext', 'click', function () {
      if (state.cursor >= C.lastWeekNo()) return;
      state.cursor += 1;
      renderWeek();
    });

    on('#weekHint', 'click', function (e) {
      if (e.target && e.target.id === 'weekToday') {
        state.cursor = C.academicWeekNo(state.now);
        renderWeek();
      }
    });

    on('#icsBtn', 'click', downloadICS);

    on('#anchorInput', 'change', function () {
      var v = this.value;
      var p = C.loadPrefs();
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { p.anchor = v; C.savePrefs(p); }
      else { delete p.anchor; C.savePrefs(p); }
      state.cursor = C.academicWeekNo(state.now);
      state.statusKey = null;
      renderAll();
    });

    on('#swapInput', 'change', function () {
      var p = C.loadPrefs();
      p.swap = this.checked;
      C.savePrefs(p);
      state.cursor = C.academicWeekNo(state.now);
      state.statusKey = null;
      renderAll();
    });

    on('#classesNov', 'click', function () {
      var p = C.loadPrefs();
      p.classes = '2026-11-02';
      C.savePrefs(p);
      state.cursor = C.academicWeekNo(state.now);
      state.statusKey = null;
      renderAll();
    });

    on('#anchorReset', 'click', function () {
      var p = C.loadPrefs();
      delete p.anchor;
      delete p.swap;
      delete p.classes;
      C.savePrefs(p);
      state.cursor = C.academicWeekNo(state.now);
      state.statusKey = null;
      renderAll();
    });

    var lastDay = C.startOfDay(state.now).getTime();
    var lastWeekNo = C.academicWeekNo(state.now);
    setInterval(function () {
      if (state.fixedNow) return;
      state.now = new Date();
      var d = C.startOfDay(state.now).getTime();
      if (d !== lastDay) {
        lastDay = d;
        var weekNo = C.academicWeekNo(state.now);
        /* если пользователь смотрел текущую неделю — переезжаем на новую,
           если смотрел другую — оставляем как есть */
        if (state.cursor === lastWeekNo) state.cursor = weekNo;
        lastWeekNo = weekNo;
        state.statusKey = null;
        renderAll();
        return;
      }
      if ($('#status')) renderStatus();
      renderTopbar();
    }, 20000);
  }

  /* --------------------------------- старт -------------------------------- */

  var fixed = readFixedNow();
  if (fixed) { state.now = fixed; state.fixedNow = true; }

  state.done = C.loadDone();

  renderAll();
  bind();

  /* офлайн-режим: кэшируем сайт, чтобы расписание открывалось без сети */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* не критично */ });
    });
  }
})();
