import { setScheme } from './scheme.js';

// Оформление: темы, фоны, прозрачность панелей. Применяется через CSS-переменные на <html>.

export const THEMES = [
  {
    id: 'kraken',
    name: 'Тёмная',
    base: '#0e1117',
    surface: [20, 23, 31],
    panel: [24, 27, 36],
    panel2: [34, 38, 49],
    titlebar: [12, 14, 19],
    text: '#d6dae1',
    muted: '#848c99',
    dim: '#5b6270',
    ink: '#0f1217',
    green: '#3cf0a0',
    blue: '#2f9bff',
    red: '#f25d5d',
    yellow: '#f2ca33',
    glow: ['#3cf0a0', '#2f9bff', '#8e00c2'],
  },
  {
    id: 'light',
    name: 'Светлая',
    scheme: 'light',
    base: '#eceff4',
    surface: [246, 247, 250],
    panel: [255, 255, 255],
    panel2: [233, 236, 242],
    titlebar: [226, 230, 237],
    text: '#232936',
    muted: '#596274',
    dim: '#8a92a2',
    ink: '#ffffff',
    green: '#0c9a63',
    blue: '#1767d6',
    red: '#d23a3a',
    yellow: '#b07c00',
    purple: '#7a3bd9',
    glow: ['#7fdcbc', '#9cc3ff', '#d7b6ff'],
    // Цвета дорожек темнее, чтобы линии графа не терялись на белом
    lanes: ['#0b8fb0', '#0b5fdb', '#7e17b8', '#b5179e', '#c8105f', '#c41b1b', '#e0531f', '#b38400', '#4a9612', '#0e9c78'],
  },
  {
    id: 'midnight',
    name: 'Полночь',
    base: '#11151f',
    surface: [22, 27, 38],
    panel: [27, 33, 46],
    panel2: [38, 45, 61],
    titlebar: [14, 18, 27],
    text: '#d8dee9',
    muted: '#8a96ab',
    dim: '#5d6880',
    ink: '#11151f',
    green: '#a3be8c',
    blue: '#88c0d0',
    red: '#bf616a',
    yellow: '#ebcb8b',
    glow: ['#88c0d0', '#5e81ac', '#b48ead'],
  },
  {
    id: 'dracula',
    name: 'Дракула',
    base: '#191a21',
    surface: [33, 34, 44],
    panel: [40, 42, 54],
    panel2: [52, 55, 71],
    titlebar: [24, 25, 33],
    text: '#f8f8f2',
    muted: '#a4a7c2',
    dim: '#6b74a4',
    ink: '#191a21',
    green: '#50fa7b',
    blue: '#bd93f9',
    red: '#ff5555',
    yellow: '#f1fa8c',
    glow: ['#bd93f9', '#ff79c6', '#8be9fd'],
  },
  {
    id: 'monokai',
    name: 'Монокай',
    base: '#1b1916',
    surface: [34, 31, 27],
    panel: [41, 37, 33],
    panel2: [55, 50, 44],
    titlebar: [24, 22, 19],
    text: '#ece6d9',
    muted: '#a69d8d',
    dim: '#71695d',
    ink: '#1b1916',
    green: '#a6e22e',
    blue: '#66d9ef',
    red: '#f92672',
    yellow: '#e6db74',
    glow: ['#fd971f', '#f92672', '#a6e22e'],
  },
  {
    id: 'forest',
    name: 'Лес',
    base: '#0b1410',
    surface: [16, 26, 22],
    panel: [20, 32, 27],
    panel2: [30, 46, 39],
    titlebar: [10, 18, 15],
    text: '#d4e6dc',
    muted: '#82a092',
    dim: '#567266',
    ink: '#0b1410',
    green: '#4ade80',
    blue: '#38bdf8',
    red: '#f87171',
    yellow: '#facc15',
    glow: ['#4ade80', '#14b8a6', '#84cc16'],
  },
  {
    id: 'sakura',
    name: 'Сакура',
    base: '#171118',
    surface: [30, 22, 31],
    panel: [37, 27, 38],
    panel2: [51, 38, 52],
    titlebar: [22, 15, 23],
    text: '#f2e1ec',
    muted: '#ad93a6',
    dim: '#7a6274',
    ink: '#171118',
    green: '#5eead4',
    blue: '#f472b6',
    red: '#fb7185',
    yellow: '#fcd34d',
    glow: ['#f472b6', '#c084fc', '#fb923c'],
  },
  {
    id: 'oled',
    name: 'Чёрная',
    base: '#000000',
    surface: [6, 6, 8],
    panel: [11, 11, 14],
    panel2: [24, 24, 29],
    titlebar: [0, 0, 0],
    text: '#e8e8ec',
    muted: '#8d8d98',
    dim: '#5b5b66',
    ink: '#000000',
    green: '#3cf0a0',
    blue: '#2f9bff',
    red: '#f25d5d',
    yellow: '#f2ca33',
    glow: ['#3cf0a0', '#2f9bff', '#6d28d9'],
  },
];

export const BACKGROUNDS = [
  { id: 'glow', name: 'Сияние', hint: 'Мягкие цветные пятна за стеклом' },
  { id: 'aurora', name: 'Аврора', hint: 'Переливающиеся полосы, как северное сияние' },
  { id: 'grid', name: 'Сетка', hint: 'Тонкая сетка и свечение сверху' },
  { id: 'gradient', name: 'Градиент', hint: 'Спокойный статичный градиент' },
  { id: 'solid', name: 'Однотонный', hint: 'Без эффектов' },
  { id: 'image', name: 'Картинка', hint: 'Своё изображение с размытием и затемнением' },
  { id: 'system', name: 'Windows', hint: 'Сквозь окно видно рабочий стол (Mica / Acrylic, Windows 11)' },
];

/** «Как в системе»: светлая или тёмная тема по настройке Windows/macOS */
export const AUTO_THEME = { id: 'auto', name: 'Как в системе', light: 'light', dark: 'kraken' };

const systemPrefersLight = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
};

/** id темы, которая реально применяется (для «Как в системе» — светлая или тёмная) */
export const resolveThemeId = (id) => (id === AUTO_THEME.id ? (systemPrefersLight() ? AUTO_THEME.light : AUTO_THEME.dark) : id);

export const DEFAULT_APPEARANCE = {
  theme: 'kraken',
  background: 'glow',
  transparency: 50, // 0 — панели непрозрачные, 100 — максимум стекла
  blur: 18, // px размытия под стеклом
  motion: true, // анимация фона
  imageBlur: 8,
  imageDim: 45,
  hasImage: false,
  material: 'acrylic', // для фона «Windows»: acrylic | mica
};

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const rgba = ([r, g, b], a) => `rgb(${r} ${g} ${b} / ${Math.round(a * 1000) / 1000})`;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function normalizeAppearance(value) {
  const v = { ...DEFAULT_APPEARANCE, ...(value && typeof value === 'object' ? value : {}) };
  if (v.theme !== AUTO_THEME.id && !THEMES.some((t) => t.id === v.theme)) v.theme = DEFAULT_APPEARANCE.theme;
  if (!BACKGROUNDS.some((b) => b.id === v.background)) v.background = DEFAULT_APPEARANCE.background;
  v.transparency = clamp(Number(v.transparency) || 0, 0, 100);
  v.blur = clamp(Number(v.blur) || 0, 0, 40);
  v.imageBlur = clamp(Number(v.imageBlur) || 0, 0, 40);
  v.imageDim = clamp(Number(v.imageDim) || 0, 0, 90);
  v.motion = v.motion !== false;
  v.material = v.material === 'mica' ? 'mica' : 'acrylic';
  return v;
}

/** Применить оформление к документу. imageUrl — data: URL своей картинки (если выбран фон «Картинка») */
export function applyAppearance(value, { imageUrl, systemSupported = true } = {}) {
  const a = normalizeAppearance(value);
  const t = themeById(resolveThemeId(a.theme));
  const light = t.scheme === 'light';
  const fg = t.fg ?? (light ? [16, 24, 40] : [255, 255, 255]);
  const root = document.documentElement;
  const k = a.transparency / 100;
  // Чем выше прозрачность, тем меньше альфа у панелей. При 50% — как было изначально.
  const vars = {
    '--color-gk-bg': rgba(t.surface, 1 - k * 0.9),
    '--color-gk-panel': rgba(t.panel, 1 - k * 0.76),
    '--color-gk-panel-2': rgba(t.panel2, 1 - k * 0.44),
    '--color-gk-titlebar': rgba(t.titlebar, 1 - k * 0.56),
    '--color-gk-text': t.text,
    '--color-gk-muted': t.muted,
    '--color-gk-dim': t.dim,
    '--color-gk-ink': t.ink,
    '--color-gk-green': t.green,
    '--color-gk-blue': t.blue,
    '--color-gk-red': t.red,
    '--color-gk-yellow': t.yellow,
    '--color-gk-purple': t.purple ?? (light ? '#7a3bd9' : '#c084fc'),
    // Светлая/тёмная схема: подсветка поверх панелей, рамки, заголовки, «утопленные» места
    '--color-gk-strong': t.strong ?? (light ? '#0d1220' : '#ffffff'),
    '--color-gk-fg': `rgb(${fg.join(' ')})`,
    '--gk-fg-rgb': fg.join(' '),
    '--color-gk-sink': light ? 'rgb(84 94 122)' : 'rgb(0 0 0)',
    '--color-gk-scrim': light ? 'rgb(28 36 56 / 0.28)' : 'rgb(5 7 12 / 0.5)',
    '--color-gk-border': rgba(fg, light ? 0.11 : 0.07),
    '--color-gk-hover': rgba(fg, light ? 0.055 : 0.06),
    '--gk-dim-rgb': light ? '255 255 255' : '0 0 0',
    // Непрозрачные подложки для всплывающих окон и логов
    '--gk-base': t.base,
    '--gk-solid': rgba(t.surface, 1),
    '--gk-solid-2': rgba(t.panel, 1),
    '--gk-blur': `${a.blur}px`,
    '--glow-1': rgba(hexToRgb(t.glow[0]), light ? 0.5 : 0.42),
    '--glow-2': rgba(hexToRgb(t.glow[1]), light ? 0.5 : 0.45),
    '--glow-3': rgba(hexToRgb(t.glow[2]), light ? 0.35 : 0.25),
    '--glow-1-soft': rgba(hexToRgb(t.glow[0]), light ? 0.2 : 0.15),
    '--glow-2-soft': rgba(hexToRgb(t.glow[1]), light ? 0.22 : 0.18),
    '--bg-image-blur': `${a.imageBlur}px`,
    '--bg-image-dim': String(a.imageDim / 100),
  };
  for (const [key, val] of Object.entries(vars)) root.style.setProperty(key, val);
  root.style.setProperty('--bg-image', imageUrl ? `url("${imageUrl}")` : 'none');
  const bg = (a.background === 'image' && !imageUrl) || (a.background === 'system' && !systemSupported) ? 'glow' : a.background;
  root.dataset.bg = bg;
  root.dataset.motion = a.motion ? 'on' : 'off';
  root.dataset.theme = t.id;
  root.dataset.scheme = light ? 'light' : 'dark';
  setScheme(light ? 'light' : 'dark', t.lanes);
  return a;
}

/**
 * Сообщить схеме (scheme.js) цвета текущей темы. Вызывается прямо во время рендера App,
 * чтобы граф и бейджи в этом же рендере взяли цвета новой темы.
 */
export function syncScheme(value) {
  const t = themeById(resolveThemeId(normalizeAppearance(value).theme));
  setScheme(t.scheme === 'light' ? 'light' : 'dark', t.lanes);
  return t;
}

/** Что сообщить окну Electron: цвет подложки и светлая/тёмная схема системных элементов */
export function nativeAppearance(value) {
  const a = normalizeAppearance(value);
  const t = themeById(resolveThemeId(a.theme));
  return { ...a, base: t.base, scheme: a.theme === AUTO_THEME.id ? 'system' : t.scheme === 'light' ? 'light' : 'dark' };
}

const CACHE_KEY = 'appearance';

export function readCachedAppearance() {
  try {
    return normalizeAppearance(JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'));
  } catch {
    return normalizeAppearance(null);
  }
}

export function cacheAppearance(value) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* хранилище недоступно — не страшно */
  }
}

export const themeById = (id) => THEMES.find((t) => t.id === id) ?? THEMES[0];
