// Расписания в формате cron: готовые варианты и описание по-русски

export const CRON_PRESETS = [
  { cron: '0 3 * * *', label: 'Каждый день в 3:00' },
  { cron: '0 9 * * 1-5', label: 'По будням в 9:00' },
  { cron: '0 * * * *', label: 'Каждый час' },
  { cron: '*/15 * * * *', label: 'Каждые 15 минут' },
  { cron: '0 4 * * 1', label: 'По понедельникам в 4:00' },
  { cron: '0 2 1 * *', label: '1-го числа каждого месяца в 2:00' },
];

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['', 'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

const pad = (n) => String(n).padStart(2, '0');
const isNum = (s) => /^\d+$/.test(s);

function listDays(field) {
  if (field === '1-5') return 'по будням';
  if (field === '0,6' || field === '6,0' || field === '6-7' || field === '6,7') return 'по выходным';
  const parts = field.split(',');
  if (parts.every(isNum)) {
    if (parts.length === 1) return `по ${dowPlural(Number(parts[0]))}`;
    return `по дням: ${parts.map((p) => DOW_SHORT[Number(p)]).join(', ')}`;
  }
  const range = /^(\d)-(\d)$/.exec(field);
  if (range) return `с ${DOW_SHORT[Number(range[1])]} по ${DOW_SHORT[Number(range[2])]}`;
  return null;
}

function dowPlural(d) {
  return ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'][d];
}

/** «0 3 * * 1-5» → «по будням в 03:00». Если формат непонятен — null */
export function describeCron(expr) {
  const f = String(expr ?? '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;

  // Каждые N минут / каждый час
  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `каждые ${everyMin[1]} мин`;
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'каждую минуту';
  if (isNum(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `каждый час в :${pad(min)}`;
  const everyHour = /^\*\/(\d+)$/.exec(hour);
  if (isNum(min) && everyHour && dom === '*' && mon === '*' && dow === '*') return `каждые ${everyHour[1]} ч, в :${pad(min)}`;

  if (!isNum(min) || !(isNum(hour) || /^\d+(,\d+)+$/.test(hour))) return null;
  const time = hour.split(',').map((h) => `${pad(h)}:${pad(min)}`).join(', ');

  let when;
  if (dom === '*' && dow === '*') when = 'каждый день';
  else if (dom === '*' && dow !== '*') when = listDays(dow);
  else if (isNum(dom) && dow === '*') when = `${dom}-го числа`;
  else return null;
  if (!when) return null;

  let month = '';
  if (mon !== '*') {
    if (isNum(mon)) month = ` в ${MONTHS[Number(mon)] ?? mon}`;
    else return null;
  }
  return `${when}${month} в ${time}`;
}

export const TIMEZONES = [
  'UTC',
  'Europe/Kaliningrad',
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Yekaterinburg',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Yakutsk',
  'Asia/Vladivostok',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Europe/Minsk',
  'Europe/Kiev',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
];

export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
