// Подставной docker: запускается как `node <аргументы docker>` с NODE_OPTIONS=--require этого файла.
// Настоящего Docker в тестах нет, а execFile на Windows не запускает .cmd, поэтому роль программы играет сам node.
// GORYNYCH_FAKE_DOCKER — файл JSON: { log, script: [{ match, stdout, stderr, code }] }. Первое совпадение начала команды.
const fs = require('node:fs');
const path = require('node:path');

const conf = process.env.GORYNYCH_FAKE_DOCKER;
if (conf) {
  const { log, script } = JSON.parse(fs.readFileSync(conf, 'utf8'));
  const args = [path.basename(process.argv[1] ?? ''), ...process.argv.slice(2)];
  const line = args.join(' ');
  fs.appendFileSync(log, `${line}\n`);
  const hit = script.find((item) => line.startsWith(item.match)) ?? { code: 0 };
  if (hit.stdout) fs.writeSync(1, hit.stdout);
  if (hit.stderr) fs.writeSync(2, hit.stderr);
  process.exit(hit.code ?? 0);
}
