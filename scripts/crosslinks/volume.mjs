// ПЕРЕЛИНКОВКА, ШАГ 6 — ОБЪЁМ РЕВЬЮ ПО ФАЙЛУ КАНДИДАТОВ.
//
//   node scripts/crosslinks/volume.mjs [файл кандидатов]
//
// Считает по ОСНОВНЫМ кандидатам (тем, что встали на место). Запасные на ревью
// показываются рядом как «другие цели на выбор» и отдельного времени не требуют.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const file = process.argv[2] ?? join(homedir(), 'baka-audit/crosslinks/candidates/candidates.json');
const { candidates, forStep5, sources, rules } = JSON.parse(await readFile(file, 'utf8'));
const SECONDS = 20;

const main = candidates.filter((c) => c.status === 'основной');
const by = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
const min = (n) => `${n} канд. ≈ ${Math.round((n * SECONDS) / 60)} мин`;

console.log(`Источников: ${sources}; получили хотя бы одного основного кандидата: ${new Set(main.map((c) => c.source)).size}`);
console.log(`Кандидатов всего: ${candidates.length}; основных ${main.length}, запасных ${candidates.filter((c) => c.status === 'запасной').length}, отсеянных ${candidates.filter((c) => c.status === 'отсеян').length}, в список шага 5: ${forStep5.length}`);
console.log('Основные по уверенности:', by(main, (c) => c.confidence));
console.log('Основные по типу сигнала:', by(main, (c) => c.signal));
console.log('Основные по типу цели:', by(main, (c) => (c.flags.external ? 'внешний' : c.targetCategory)));
console.log('Отсеяны по причине:', by(candidates.filter((c) => c.status === 'отсеян'), (c) => c.statusWhy));
console.log('Основных на источник (сколько вставок → у скольких постов):', by(Object.values(by(main, (c) => c.source)), (n) => n));

const tops = Object.entries(by(main, (c) => c.target)).sort((a, b) => b[1] - a[1]).slice(0, 15);
const titleOf = new Map(main.map((c) => [c.target, `${c.targetTitle} [${c.flags.external ? 'внешн.' : c.targetCategory}]`]));
console.log(`\n15 самых частых целей (потолок ${rules.targetCap} с учётом уже стоящих вставок):`);
for (const [t, n] of tops) {
	const capped = main.filter((c) => c.target === t && c.flags.capCount != null).length;
	console.log(`  ${n}  ${t} — ${titleOf.get(t)}${capped ? `  · сверх потолка: ${capped}` : ''}`);
}
console.log(`Целей, упёршихся в потолок: ${new Set(main.filter((c) => c.flags.capCount != null).map((c) => c.target)).size}; кандидатов с пометкой: ${main.filter((c) => c.flags.capCount != null).length}`);

const lv = (l) => main.filter((c) => l.includes(c.confidence)).length;
console.log(`\nВремя ревью при ${SECONDS} с на кандидата:`);
console.log(`  все основные: ${min(main.length)}`);
console.log(`  сильные и средние: ${min(lv(['сильный', 'средний']))}`);
console.log(`  только сильные: ${min(lv(['сильный']))}`);
