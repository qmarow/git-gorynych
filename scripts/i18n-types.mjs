// Тип ключей сообщений интерфейса из crates/gorynych-core/i18n/ru/ui.ftl → src/i18n/messages.ts.
// Запуск после правки ui.ftl: npm run i18n:types (npm run typecheck покажет вызов t() с неизвестным ключом).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ftl = fs.readFileSync(path.join(root, 'crates/gorynych-core/i18n/ru/ui.ftl'), 'utf8');
const ids = [...new Set(ftl.match(/^[a-zA-Z][a-zA-Z0-9_-]*(?= *=)/gm))].sort();
const out = `// Создано scripts/i18n-types.mjs из crates/gorynych-core/i18n/ru/ui.ftl — не править вручную.
export type MessageId =
${ids.map((id) => `  | '${id}'`).join('\n')};
`;
const target = path.join(root, 'src/i18n/messages.ts');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== out) {
    console.error('src/i18n/messages.ts устарел: npm run i18n:types');
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, out);
  console.log(`src/i18n/messages.ts: ${ids.length} ключей`);
}
