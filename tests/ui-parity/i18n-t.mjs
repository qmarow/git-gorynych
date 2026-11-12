// t() интерфейса (src/i18n/index.ts, Fluent) против ответов t() из 1.x: случаи `t` эталона ядра
// (crates/gorynych-core/tests/fixtures/parity.json — сняты с настоящего electron/i18n.cjs, ключ заменён ключом Fluent).
// Случаи с ключами ui.ftl проверяются здесь, с ключами main.ftl — в Rust (tests/parity.rs, t_matches_electron).
// node tests/ui-parity/i18n-t.mjs <корень репозитория>
import fs from 'node:fs';
import path from 'node:path';
import { setup, importAs } from './hooks.mjs';

const [root] = process.argv.slice(2);
setup(root);
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'crates/gorynych-core/tests/fixtures/parity.json'), 'utf8'));
const uiIds = new Set(fs.readFileSync(path.join(root, 'crates/gorynych-core/i18n/ru/ui.ftl'), 'utf8').match(/^[a-z][a-z0-9-]*(?= =)/gm));
const modules = { ru: await importAs(path.join(root, 'src/i18n/index.ts'), 'ru'), en: await importAs(path.join(root, 'src/i18n/index.ts'), 'en') };
let checked = 0;
for (const c of fixture.t) {
  if (!uiIds.has(c.msg)) continue;
  const out = modules[c.language].t(c.msg, ...c.args);
  checked++;
  if (out !== c.out) {
    console.error(`РАСХОЖДЕНИЕ ${c.language} ${c.msg} ${JSON.stringify(c.args)}\n  1.x:   ${JSON.stringify(c.out)}\n  сейчас: ${JSON.stringify(out)}`);
    process.exit(1);
  }
}
if (checked < 300) {
  console.error(`случаев с ключами ui.ftl мало: ${checked}`);
  process.exit(1);
}
console.log(`t() интерфейса = 1.x: ${checked} случаев`);
