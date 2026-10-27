// Текущая цветовая схема для кода, которому нужны готовые цвета, а не CSS-переменные:
// линии и узлы графа (SVG), цветные бейджи с прозрачностью через `${hex}55` и т. п.
// Значения выставляет applyAppearance(); компоненты перечитывают их при каждом рендере.

// Цвета дорожек графа в духе GitKraken (тёмные темы)
export const DEFAULT_LANES = ['#15a0bf', '#0669f7', '#8e00c2', '#c517b6', '#d90171', '#cd0101', '#f25d2e', '#f2ca33', '#7bd938', '#2ece9d'];

let scheme = 'dark';
let lanes = DEFAULT_LANES;

export function setScheme(next, laneColors) {
  scheme = next === 'light' ? 'light' : 'dark';
  lanes = Array.isArray(laneColors) && laneColors.length ? laneColors : DEFAULT_LANES;
}

export const isLight = () => scheme === 'light';
export const laneColors = () => lanes;

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
};
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/** Относительная яркость по WCAG */
function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const cache = new Map();

/**
 * Цвет, который читается как текст или тонкая линия на фоне текущей схемы.
 * В тёмных темах — как есть. В светлой яркие неоновые цвета (#3cf0a0, #f2ca33) затемняются,
 * пока контраст с белым не станет не меньше 3.2:1, — оттенок сохраняется.
 */
export function readable(hex) {
  if (scheme !== 'light' || typeof hex !== 'string' || !hex.startsWith('#')) return hex;
  const hit = cache.get(hex);
  if (hit) return hit;
  let rgb = hexToRgb(hex);
  for (let i = 0; i < 24 && (1.05 / (luminance(rgb) + 0.05)) < 3.2; i++) rgb = rgb.map((v) => v * 0.9);
  const out = toHex(rgb);
  cache.set(hex, out);
  return out;
}
