/* Тесты ядра расписания. Запуск: node test/core.test.js */
'use strict';

global.window = global;
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] === undefined ? null : this._d[k]; },
  setItem(k, v) { this._d[k] = String(v); }
};

require('../data.js');
require('../core.js');

const C = global.ScheduleCore;
const D = global.SCHEDULE;

let failed = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  ok  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}

console.log('\n— арифметика учебных недель —');

// Ключевая проверка: 21.10.2026 — вторая неделя (по условию задачи).
eq('21.10.2026 → 2-я неделя', C.weekParity(new Date(2026, 9, 21)), 2);
eq('21.10.2026 → учебная неделя 8', C.academicWeekNo(new Date(2026, 9, 21)), 8);

// Чередование 1,2,1,2 на протяжении учебного года.
let seq = [];
for (let i = 0; i < 16; i++) {
  seq.push(C.weekParity(C.addDays(new Date(2026, 8, 31), i * 7)));
}
eq('чередование 1,2,1,2…', seq.join(','), '1,2,1,2,1,2,1,2,1,2,1,2,1,2,1,2');

// Понедельник — начало учебной недели, воскресенье — конец.
eq('пн 19.10 → 2-я', C.weekParity(new Date(2026, 9, 19)), 2);
eq('вс 25.10 → 2-я', C.weekParity(new Date(2026, 9, 25)), 2);
eq('пн 26.10 → 1-я', C.weekParity(new Date(2026, 9, 26)), 1);
eq('пн 02.11 → 2-я', C.weekParity(new Date(2026, 10, 2)), 2);
eq('ср 01.07.2026 → до начала семестра', C.weekParity(new Date(2026, 6, 1)), 2);

console.log('\n— выборка занятий —');

const mon1 = C.lessonsFor(new Date(2026, 9, 19), 1);   // понедельник 2-й недели
const mon2 = C.lessonsFor(new Date(2026, 9, 19), 2);
eq('понедельник: 1-я неделя — 4 пары', mon1.length, 4);
eq('понедельник: 2-я неделя — 2 пары', mon2.length, 2);

const tue1 = C.lessonsFor(new Date(2026, 9, 20), 1);
const tue2 = C.lessonsFor(new Date(2026, 9, 20), 2);
eq('вторник 1-я неделя — 4 пары', tue1.length, 4);
eq('вторник 2-я неделя — 3 пары', tue2.length, 3);
eq('вторник 2-я неделя: первая пара в 15:00', tue2[0].time, '15:00');
eq('вторник 2-я неделя: последняя пара в 18:20', tue2[tue2.length - 1].time, '18:20');
eq('вторник: в 1-й неделе СКБ, во 2-й — ММТС',
  tue1[1].subject + ' / ' + tue2[0].subject,
  'Современные концепции БАЗ данных / Математические методы теории систем');

const wed2 = C.lessonsFor(new Date(2026, 9, 21), 2);
eq('среда 2-я неделя — 2 пары', wed2.length, 2);
eq('среда 2-я неделя — проф. иностранный язык', wed2[0].subject, 'Профессиональный иностранный язык');

const thu2 = C.lessonsFor(new Date(2026, 9, 22), 2);
eq('четверг 2-я неделя — 2 пары', thu2.length, 2);
eq('четверг 2-я неделя — деловое сотрудничество', thu2[0].subject,
   'Деловое сотрудничество и психология взаимодействия в коллективе');

const fri2 = C.lessonsFor(new Date(2026, 9, 23), 2);
eq('пятница 2-я неделя — 0 пар', fri2.length, 0);

eq('суббота — 0 пар', C.lessonsFor(new Date(2026, 9, 24), 1).length, 0);

console.log('\n— время —');
eq('13:20 → 15:00', C.endTime('13:20'), '15:00');
eq('18:20 → 20:00', C.endTime('18:20'), '20:00');
eq('8:00 → 9:40', C.endTime('08:00'), '09:40');

console.log('\n— целостность данных —');
const dayIds = D.days.map(d => d.id);
let bad = D.lessons.filter(l => dayIds.indexOf(l.day) === -1);
eq('все дни существуют', bad.length, 0);
bad = D.lessons.filter(l => !l.weeks.length || l.weeks.some(w => w !== 1 && w !== 2));
eq('недели только 1 или 2', bad.length, 0);
bad = D.lessons.filter(l => !l.subject || !l.teacher);
eq('есть название и преподаватель', bad.length, 0);

// Ни одна пара не должна налезать на другую в один день и неделю.
let clashes = [];
for (const d of dayIds) {
  for (const w of [1, 2]) {
    const ls = D.lessons.filter(l => l.day === d && l.weeks.indexOf(w) !== -1);
    for (let i = 0; i < ls.length; i++) {
      for (let j = i + 1; j < ls.length; j++) {
        const a1 = C.toMin(ls[i].time), a2 = C.toMin(C.endTime(ls[i].time));
        const b1 = C.toMin(ls[j].time), b2 = C.toMin(C.endTime(ls[j].time));
        if (a1 < b2 && b1 < a2) clashes.push(d + ' w' + w + ': ' + ls[i].time + ' / ' + ls[j].time);
      }
    }
  }
}
eq('пары не накладываются', clashes.length, 0, clashes.join('; '));

console.log('\n— экспорт .ics —');
const ics = C.buildICS();
check('начинается с BEGIN:VCALENDAR', ics.startsWith('BEGIN:VCALENDAR'));
check('заканчивается END:VCALENDAR', ics.trim().endsWith('END:VCALENDAR'));
const evs = (ics.match(/BEGIN:VEVENT/g) || []).length;
const expectedEvs = (() => {
  let n = 0;
  for (let d = new Date(2026, 7, 31); d <= new Date(2026, 11, 31); d = C.addDays(d, 1)) {
    if (d.getDay() < 1 || d.getDay() > 5) continue;
    const w = C.weekParity(d);
    n += D.lessons.filter(l => l.day === D.days[d.getDay() - 1].id && l.weeks.indexOf(w) !== -1).length;
  }
  return n;
})();
eq('число событий совпадает с расписанием', evs, expectedEvs);
check('есть DTSTART', /DTSTART:\d{8}T\d{6}/.test(ics));
check('строки не длиннее 75 октетов', ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));

console.log('\n— что происходит «сейчас» —');

function at(y, m, d, hh, mm) { return new Date(y, m, d, hh, mm); }

// среда 21.10.2026, 2-я неделя: две пары 13:20 и 15:00
let s = C.statusFor(at(2026, 9, 21, 13, 20));
eq('в момент начала пары → running', s.kind, 'running');
eq('пара: проф. иностранный язык', s.running.lesson.subject, 'Профессиональный иностранный язык');
eq('осталось 100 минут', s.minutesLeft, 100);
eq('прогресс 0%', Math.round(s.progress * 100), 0);

s = C.statusFor(at(2026, 9, 21, 13, 25));
eq('через 5 минут → осталось 95', s.minutesLeft, 95);

s = C.statusFor(at(2026, 9, 21, 14, 59));
eq('в 14:59 пара ещё идёт', s.kind, 'running');
eq('осталась 1 минута', s.minutesLeft, 1);

s = C.statusFor(at(2026, 9, 21, 15, 0));
eq('ровно в 15:00 началась следующая', s.kind, 'running');
eq('это вторая пара', s.running.lesson.time, '15:00');

s = C.statusFor(at(2026, 9, 21, 12, 0));
eq('до первой пары → next', s.kind, 'next');
eq('следующая в 13:20', s.next.lesson.time, '13:20');
eq('до неё 80 минут', s.minutesToNext, 80);

s = C.statusFor(at(2026, 9, 21, 17, 0));
eq('после всех пар → done', s.kind, 'done');
eq('ближайший день с парами — четверг', C.DOW_NOM[s.nextDay.date.getDay()], 'четверг');

s = C.statusFor(at(2026, 9, 24, 12, 0));   // суббота
eq('в субботу → weekend', s.kind, 'weekend');
eq('ближайшие пары — в понедельник 26.10', C.fmtDate(s.nextDay.date), '26 октября');
eq('в понедельник 1-я неделя', s.nextDay.parity, 1);

// понедельник 19.10 — 2-я неделя, пар нет (в 1-й неделе были)
s = C.statusFor(at(2026, 9, 19, 10, 0));
eq('в понедельник 2-й недели есть пары', s.kind, 'next');
eq('следующая пара в 13:20', s.next.lesson.time, '13:20');
eq('это лекция', s.next.lesson.kind, 'лек');
eq('в понедельнике 2-й недели всего 2 пары',
   C.lessonsFor(new Date(2026, 9, 19), 2).length, 2);

console.log('\n— границы семестра и склонения —');
eq('последняя учебная неделя семестра', C.lastWeekNo(), 18);
eq('plural(1, пара/пары/пар)', C.plural(1, ['пара', 'пары', 'пар']), 'пара');
eq('plural(2, ...)', C.plural(2, ['пара', 'пары', 'пар']), 'пары');
eq('plural(5, ...)', C.plural(5, ['пара', 'пары', 'пар']), 'пар');
eq('plural(11, ...)', C.plural(11, ['пара', 'пары', 'пар']), 'пар');
eq('plural(21, ...)', C.plural(21, ['пара', 'пары', 'пар']), 'пара');

console.log('\n— перестановка недель (1-я неделя снизу) —');
global.localStorage.setItem('schedule-prefs', JSON.stringify({ swap: true }));
let swapped = C.lessonsFor(new Date(2026, 9, 19), 1);   // понедельник
eq('после перестановки в понедельник 1-й недели — 2 пары', swapped.length, 2);
swapped = C.lessonsFor(new Date(2026, 9, 19), 2);
eq('а во 2-ю неделю — 4 пары', swapped.length, 4);
global.localStorage.setItem('schedule-prefs', JSON.stringify({}));
eq('без перестановки понедельник 1-й недели = 4 пары',
   C.lessonsFor(new Date(2026, 9, 19), 1).length, 4);

console.log('\n— недели до начала семестра (отрицательные номера) —');
eq('июнь: неделя -9 → 1-я неделя', C.weekParity(new Date(2026, 5, 22)), 1);
eq('июль: неделя -7 → 1-я неделя', C.weekParity(new Date(2026, 6, 6)), 1);
eq('август: неделя -1 → 1-я неделя', C.weekParity(new Date(2026, 7, 17)), 1);
eq('июнь: понедельник — 4 пары 1-й недели',
   C.lessonsFor(new Date(2026, 5, 22), 1).length, 4);

console.log('\n— состояние семестра —');
eq('октябрь — внутри семестра', C.semesterState(new Date(2026, 9, 21)), 'inside');
eq('лето — до семестра', C.semesterState(new Date(2026, 6, 1)), 'before');
eq('январь — после семестра', C.semesterState(new Date(2027, 0, 4)), 'after');

console.log('\n— .ics не зависит от браузерной настройки недели —');
global.localStorage.setItem('schedule-prefs', JSON.stringify({ anchor: '2026-10-05' }));
const icsShifted = C.buildICS();
const shiftedCount = (icsShifted.match(/BEGIN:VEVENT/g) || []).length;
check('смена якоря не обрезает экспорт (событий >= 180)', shiftedCount >= 180, String(shiftedCount));
check('в экспорте есть сентябрь, а не только октябрь',
      /DTSTART;TZID=Europe\/Yekaterinburg:202609/.test(icsShifted));
global.localStorage.setItem('schedule-prefs', JSON.stringify({}));
const icsNow = C.buildICS();
eq('число событий не изменилось', (icsNow.match(/BEGIN:VEVENT/g) || []).length, 216);
check('есть TZID', /DTSTART;TZID=Europe\/Yekaterinburg:/.test(icsNow));
check('есть блок VTIMEZONE', /BEGIN:VTIMEZONE/.test(icsNow) && /END:VTIMEZONE/.test(icsNow));
check('файл заканчивается CRLF', icsNow.endsWith('\r\n'));
check('последняя строка — END:VCALENDAR', icsNow.trim().endsWith('END:VCALENDAR'));

console.log('\n— смена якорной даты —');
global.localStorage.setItem('schedule-prefs', JSON.stringify({ anchor: '2026-10-05' }));
eq('с якорем 05.10.2026 → 21.10 = 1-я неделя', C.weekParity(new Date(2026, 9, 21)), 1);
global.localStorage.setItem('schedule-prefs', JSON.stringify({ anchor: '2026-10-01' }));
eq('с якорем 01.10.2026 → 21.10 = 2-я неделя', C.weekParity(new Date(2026, 9, 21)), 2);
global.localStorage.setItem('schedule-prefs', JSON.stringify({}));
eq('без якоря → 21.10 = 2-я неделя', C.weekParity(new Date(2026, 9, 21)), 2);

console.log('\n— задания —');

const AS = C.assignmentsList();
check('раздел assignments существует', Array.isArray(AS) && AS.length > 0, String(AS.length));

const NOW = new Date(2026, 9, 22, 12, 0);   // четверг 22 октября 2026
eq('состояние без срока — в работе', C.assignmentState({ id: 'x' }, NOW, {}), 'active');
eq('срок вчера — просрочено', C.assignmentState({ id: 'x', due: '2026-10-21' }, NOW, {}), 'overdue');
eq('срок сегодня — скоро', C.assignmentState({ id: 'x', due: '2026-10-22' }, NOW, {}), 'soon');
eq('срок через 3 дня — скоро', C.assignmentState({ id: 'x', due: '2026-10-25' }, NOW, {}), 'soon');
eq('срок через 10 дней — в работе', C.assignmentState({ id: 'x', due: '2026-11-01' }, NOW, {}), 'active');
eq('отмеченное задание — сдано',
   C.assignmentState({ id: 'x', due: '2026-10-01' }, NOW, { x: true }), 'done');

eq('дней до срока', C.daysUntil(new Date(2026, 9, 25), NOW), 3);
eq('дней до срока в прошлом', C.daysUntil(new Date(2026, 9, 20), NOW), -2);
eq('relative: сегодня', C.relativeDeadline(0), 'сегодня');
eq('relative: завтра', C.relativeDeadline(1), 'завтра');
eq('relative: через 3 дня', C.relativeDeadline(3), 'через 3 дня');
eq('relative: 5 дней назад', C.relativeDeadline(-5), '5 дней назад');

const groups = C.groupAssignments(AS, NOW, {});
check('группы по дисциплинам собраны', groups.length > 0, String(groups.length));
check('в каждой группе есть счётчик сданных',
      groups.every(g => typeof g.done === 'number' && typeof g.open === 'number'));

const sum = C.assignmentSummary(AS, NOW, {});
eq('всего заданий', sum.total, AS.length);
check('считаются несданные', sum.open + sum.done === AS.length);
check('есть ближайший срок', !!sum.next);
check('просроченные посчитаны', sum.overdue >= 0);

const nl = C.nextLessonForSubject('Программирование (Python)', NOW);
check('найдена следующая пара по дисциплине', !!nl, JSON.stringify(nl));
if (nl) eq('это среда', C.DOW_NOM[nl.date.getDay()], 'среда');

console.log('\n— календарь со сроками —');
const tics = C.buildTasksICS(AS);
check('начинается с BEGIN:VCALENDAR', tics.startsWith('BEGIN:VCALENDAR'));
check('заканчивается CRLF', tics.endsWith('\r\n'));
check('события на весь день', /DTSTART;VALUE=DATE:\d{8}/.test(tics));
check('нет названия группы', !/Учебное расписание|[А-ЯЁ]{3,4}-[0-9]{2}-[0-9][А-ЯЁ]/i.test(tics));
const tev = (tics.match(/BEGIN:VEVENT/g) || []).length;
const dated = AS.filter(a => a.due).length;
eq('число событий = числу заданий со сроком', tev, dated);
check('строки не длиннее 75 октетов', tics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));
check('UID только из ASCII', /^UID:[!-~]+$/m.test(tics));

console.log('\n— отметки «сделано» —');
C.saveDone({ 'doc-otchet-praktika': true });
const doneMap = C.loadDone();
eq('отметка сохранилась', doneMap['doc-otchet-praktika'], true);
eq('состояние «сдано»', C.assignmentState({ id: 'doc-otchet-praktika', due: '2026-10-01' }, NOW, doneMap), 'done');
C.saveDone({});
eq('отметки очищены', Object.keys(C.loadDone()).length, 0);

console.log(failed ? '\n✗ провалено проверок: ' + failed + '\n' : '\n✓ все проверки пройдены\n');
process.exit(failed ? 1 : 0);
