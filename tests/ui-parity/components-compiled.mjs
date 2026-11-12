// Сверка компонентов, переведённых с .jsx на .tsx только типами: обе копии проходят через esbuild (как в Vite),
// и получившийся JS обязан совпасть до символа. Типы, `import type` и `!` исчезают, поэтому любое другое отличие —
// изменение поведения.
// node tests/ui-parity/components-compiled.mjs <папка со старыми components/*.jsx> <корень репозитория> <имя>...
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [oldDir, repo, ...names] = process.argv.slice(2);
const esbuild = createRequire(path.join(repo, 'package.json'))('esbuild');
// Импорты других компонентов переводятся по очереди: расширение в пути не считается отличием
const compile = (file, loader) =>
  esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader, jsx: 'automatic', format: 'esm' }).code.replace(/(["']\.{1,2}\/[^"']*?)\.(jsx|tsx)(["'])/g, '$1$3');
let n = 0;
for (const name of names) {
  // Обе копии — как TypeScript: он убирает неиспользуемые импорты, и это не считается отличием (импорт без единого
  // используемого имени пропал бы целиком — у компонентов таких побочных импортов нет)
  const a = compile(path.join(oldDir, 'components', `${name}.jsx`), 'tsx');
  // Файл без JSX переводится в .ts (`../main`)
  const base = path.join(repo, 'src', 'components', name);
  const b = compile(fs.existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`, 'tsx');
  if (a !== b) {
    const al = a.split('\n');
    const bl = b.split('\n');
    const i = al.findIndex((l, k) => l !== bl[k]);
    console.error(`РАСХОЖДЕНИЕ ${name}, строка ${i + 1}\nстарое: ${al[i]}\nновое:  ${bl[i]}`);
    process.exit(1);
  }
  n++;
}
console.log(`components-compiled: совпало ${n} компонентов`);
