// Узкая колонка «Граф» (шаг 4.2): fitMetrics(…, { squeeze: true }) сперва ужимает шаг дорожек, к краю прижимает, только
// если и этого мало; при узком шаге — точки вместо аватаров. Без параметра — прежнее поведение (его сверяет graph-layout.mjs).
// node tests/ui-parity/graph-fit.mjs <корень репозитория>
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setup } from './hooks.mjs';

const [repo] = process.argv.slice(2);
setup(repo);
globalThis.localStorage = { getItem: () => null, setItem() {} };
const { fitMetrics, graphWidth, laneX, metricsFor, DENSITIES } = await import(pathToFileURL(path.join(repo, 'src', 'lib', 'graphLayout.ts')).href);

let count = 0;
const fail = (what, ...info) => {
  console.error('РАСХОЖДЕНИЕ', what, ...info.map((x) => JSON.stringify(x)));
  process.exit(1);
};
const ok = (what, cond, ...info) => {
  count++;
  if (!cond) fail(what, ...info);
};

const std = metricsFor('standard'); // laneW 28, nodeR 13, dotR 5.5
ok('помещается — те же метрики', fitMetrics(std, 3, 500, std.nodeR, { squeeze: true }) === std);
ok('нет ширины — те же метрики', fitMetrics(std, 30, 0, std.nodeR, { squeeze: true }) === std && fitMetrics(std, 30, NaN, std.nodeR, { squeeze: true }) === std);

// 10 дорожек в 200 px: шаг (200 − 20) / 10 = 18 — все видны, аватары (2 × 13 + 2 = 28) не помещаются → точки
const a = fitMetrics(std, 10, 200, std.nodeR, { squeeze: true });
ok('шаг ужат до всех дорожек', a.laneW === 18 && !a.hiddenLanes && !a.fitted, a);
ok('точки вместо аватаров', a.forceDots === true, a);
ok('граф помещается', graphWidth(10, a) <= 200, a);
// В стандартной плотности шаг 28 = 2 × nodeR + 2: любое ужатие — точки. В компактной (шаг 22, nodeR 9) до 20 — аватары
const cmp = metricsFor('compact');
const c = fitMetrics(cmp, 6, 140, cmp.nodeR, { squeeze: true });
ok('шаг ужат, аватары остаются', c.laneW === 20 && !c.forceDots && !c.fitted, c);
const c2 = fitMetrics(cmp, 6, 130, cmp.nodeR, { squeeze: true });
ok('шаг ужат сильнее — точки', c2.laneW < 20 && c2.forceDots === true, c2);

// Слишком узко: шаг не меньше 2 × dotR + 4 = 15, остальные прижаты к краю и посчитаны
const d = fitMetrics(std, 40, 200, std.nodeR, { squeeze: true });
ok('минимальный шаг', d.laneW === 15 && d.forceDots === true, d);
ok('прижаты и посчитаны', d.fitted === true && d.hiddenLanes > 0 && d.visibleLanes + d.hiddenLanes === 40, d);
ok('видимые дорожки не за краем', laneX(d.visibleLanes - 1, d) <= d.maxX, d);
ok('край — по точкам', d.maxX === 200 - Math.max(std.dotR + 5, d.laneW / 2), d);

// Перебор: при ужатии видно не меньше дорожек, чем без него, и шаг не меньше минимума
for (const density of Object.keys(DENSITIES)) {
  const m = metricsFor(density);
  for (let lanes = 1; lanes <= 60; lanes++) {
    for (let width = 40; width <= 700; width += 7) {
      for (const nodeR of [m.nodeR, m.dotR]) {
        const old = fitMetrics(m, lanes, width, nodeR);
        const neu = fitMetrics(m, lanes, width, nodeR, { squeeze: true });
        const shown = (x) => (x.fitted ? x.visibleLanes : lanes);
        ok(`видно не меньше ${density} ${lanes} ${width}`, shown(neu) >= shown(old), old, neu);
        ok(`шаг не меньше минимума ${density} ${lanes} ${width}`, neu.laneW >= 2 * m.dotR + 4 - 1e-9 && neu.laneW <= m.laneW, neu);
        ok(`точки — когда аватары перекрываются ${density} ${lanes} ${width}`, Boolean(neu.forceDots) === (neu.laneW < 2 * m.nodeR + 2), neu);
        if (!neu.fitted) ok(`без прижатия всё помещается ${density} ${lanes} ${width}`, graphWidth(lanes, neu) <= width + 1e-9, neu);
      }
    }
  }
}

console.log(`graph-fit: совпало ${count} проверок`);
