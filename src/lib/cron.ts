// Расписания в формате cron: готовые варианты и описание по-русски (и по-английски)
import { getLanguage, t } from '../i18n/index.ts';

export interface CronPreset {
  cron: string;
  label: string;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { cron: '0 3 * * *', label: t('Каждый день в 3:00') },
  { cron: '0 9 * * 1-5', label: t('По будням в 9:00') },
  { cron: '0 * * * *', label: t('Каждый час') },
  { cron: '*/15 * * * *', label: t('Каждые 15 минут') },
  { cron: '0 4 * * 1', label: t('По понедельникам в 4:00') },
  { cron: '0 2 1 * *', label: t('1-го числа каждого месяца в 2:00') },
];

// i18n-ignore-start — русская грамматика; для английского — describeCronEn ниже
const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['', 'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

const pad = (n: string | number) => String(n).padStart(2, '0');
const isNum = (s: string) => /^\d+$/.test(s);

function listDays(field: string): string | null {
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

/** День вне 0…7 — `undefined`, как в 1.x: в тексте окажется «по undefined». */
function dowPlural(d: number): string | undefined {
  return ['воскресеньям', 'понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'][d];
}

/** «0 3 * * 1-5» → «по будням в 03:00». Если формат непонятен — null */
export function describeCron(expr: unknown): string | null {
  if (getLanguage() !== 'ru') return describeCronEn(expr);
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

  let when: string | null;
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

// i18n-ignore-end

/* ---------- English ---------- */
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_EN_LONG = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const MONTHS_EN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n: number) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

function describeCronEn(expr: unknown): string | null {
  const f = String(expr ?? '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, mon, dow] = f;
  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `every ${everyMin[1]} min`;
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'every minute';
  if (isNum(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `every hour at :${pad(min)}`;
  const everyHour = /^\*\/(\d+)$/.exec(hour);
  if (isNum(min) && everyHour && dom === '*' && mon === '*' && dow === '*') return `every ${everyHour[1]} h at :${pad(min)}`;
  if (!isNum(min) || !(isNum(hour) || /^\d+(,\d+)+$/.test(hour))) return null;
  const time = hour.split(',').map((h) => `${pad(h)}:${pad(min)}`).join(', ');
  let when: string;
  if (dom === '*' && dow === '*') when = 'every day';
  else if (dom === '*' && dow !== '*') {
    if (dow === '1-5') when = 'on weekdays';
    else if (['0,6', '6,0', '6-7', '6,7'].includes(dow)) when = 'on weekends';
    else {
      const parts = dow.split(',');
      const range = /^(\d)-(\d)$/.exec(dow);
      if (parts.every(isNum)) when = parts.length === 1 ? `on ${DOW_EN_LONG[Number(parts[0])]}` : `on ${parts.map((p) => DOW_EN[Number(p)]).join(', ')}`;
      else if (range) when = `${DOW_EN[Number(range[1])]}–${DOW_EN[Number(range[2])]}`;
      else return null;
    }
  } else if (isNum(dom) && dow === '*') when = `on the ${ordinal(Number(dom))}`;
  else return null;
  let month = '';
  if (mon !== '*') {
    if (isNum(mon)) month = ` in ${MONTHS_EN[Number(mon)] ?? mon}`;
    else return null;
  }
  return `${when}${month} at ${time}`;
}

export const TIMEZONES: readonly string[] = [
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

export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
