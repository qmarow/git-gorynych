// Процент миграции 1.x → 2.0 для сообщений коммитов: node scripts/migration-progress.mjs
//
// Мера — строки исходников 1.x, у которых уже есть замена в 2.0:
//   - главный процесс `electron/**/*.cjs` (без vendor): перенесён в Rust целиком (Фазы 1–3, команды Tauri — Фаза 4);
//   - интерфейс `src/` (без vendor): готово то, что уже на TypeScript (`.ts`/`.tsx`), остальное — `.js`/`.jsx`.
// Эти две части — 90% работы; последние 10% — завершение Фазы 4: удаление `electron/`, инсталляторы, Fluent вместо
// русских ключей. Каждый пункт завершения прибавляет свою долю (FINAL ниже отмечать по мере готовности).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FINAL = { removeElectron: false, installers: false, fluent: true };

function lines(dir, test) {
  let n = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') n += lines(full, test);
    } else if (test(entry.name)) {
      n += fs.readFileSync(full, 'utf8').split('\n').length;
    }
  }
  return n;
}

// Пока `electron/` на месте, он — эталон и учитывается как перенесённый; после удаления его размер берётся из плана
const electron = lines(path.join(root, 'electron'), (f) => f.endsWith('.cjs')) || 15857;
const uiTs = lines(path.join(root, 'src'), (f) => /\.tsx?$/.test(f));
const uiJs = lines(path.join(root, 'src'), (f) => /\.jsx?$/.test(f));
const done = Object.values(FINAL).filter(Boolean).length / Object.keys(FINAL).length;
const percent = 90 * ((electron + uiTs) / (electron + uiTs + uiJs)) + 10 * done;

if (process.argv.includes('--details')) {
  console.log(`electron: ${electron} строк (перенесено), интерфейс: ${uiTs} на TS из ${uiTs + uiJs}, завершение: ${Math.round(done * 100)}%`);
}
console.log(`${percent.toFixed(1)}%`);
