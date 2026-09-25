// ПЕРЕЛИНКОВКА — СБОРКА ИТОГОВЫХ КАРТОЧЕК (сессия 1в).
//
//   node scripts/crosslinks/cards-assemble.mjs [--dry]
//
// Складывает карточки разметчика из нескольких прогонов в один файл
// статус/перелинковка/карточки.json. Старшинство (поздний прогон побеждает):
//   1. 1б, слепой прогон (~/baka-audit/crosslinks/1b/карточки-слепо);
//   2. 1в, эссе эталона по выжимкам (1v/эссе-эталон/карточки);
//   3. 1в, контрольная пачка (1v/контроль/карточки);
//   4. 1в, разметка архива (1v/архив/карточки).
// Повторы для сверки (карточки-повтор) в итог не идут: они нужны только сверке.
// Имена людей приводятся к каноническим по статус/перелинковка/исправления-имён.json.
// Ответы смыслового фильтра («Ф1: пример») расшифровываются по нарезке пачек
// того же прогона (пачки.json): у ответа появляются `anime` и `block` — какой
// тайтл и в каком блоке спрошен. Без этого карточка без пачек нечитаема.
// Печатает, у каких опубликованных постов карточки нет (так быть не должно)
// и сколько карточек пришло из каждого прогона. --dry — ничего не пишет.

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCardSet } from './compare-cards.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const H = join(homedir(), 'baka-audit/crosslinks');
const OUT = join(REPO, 'статус/перелинковка/карточки.json');
const dry = process.argv.includes('--dry');

const SOURCES = [
	['1б-слепо', join(H, '1b/карточки-слепо'), join(H, '1b/пачки/пачки.json')],
	['1в-эссе-эталон', join(H, '1v/эссе-эталон/карточки'), join(H, '1v/эссе-эталон/пачки.json')],
	['1в-контроль', join(H, '1v/контроль/карточки'), join(H, '1v/контроль/пачки.json')],
	['1в-архив', join(H, '1v/архив/карточки'), join(H, '1v/архив/пачки.json')],
];

const fixes = JSON.parse(await readFile(join(REPO, 'статус/перелинковка/исправления-имён.json'), 'utf8'));
const cards = new Map();
const from = new Map();
let unresolved = 0;
for (const [name, dir, manifestFile] of SOURCES) {
	const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
	const qs = new Map(manifest.batches.flatMap((b) => b.posts).map((p) => [p.id, p.questions]));
	for (const [id, c] of await readCardSet(dir)) {
		for (const f of c.filter ?? []) {
			const q = (qs.get(id) ?? []).find((x) => x.q === f.q);
			if (q) (f.anime = q.anime, (f.block = q.block));
			else unresolved++;
		}
		cards.set(id, c);
		from.set(id, name);
	}
}

let renamed = 0;
for (const c of cards.values()) for (const p of c.people ?? []) if (fixes[p.name] && typeof fixes[p.name] === 'string') (p.name = fixes[p.name], renamed++);

const posts = JSON.parse(await readFile(join(H, 'data/posts.json'), 'utf8')).posts.filter((p) => p.published);
const missing = posts.filter((p) => !cards.has(p.id)).map((p) => p.id);
const extra = [...cards.keys()].filter((id) => !posts.some((p) => p.id === id));
const byRun = {};
for (const r of from.values()) byRun[r] = (byRun[r] ?? 0) + 1;

console.log(`Карточек: ${cards.size}; опубликованных постов: ${posts.length}; по прогонам: ${JSON.stringify(byRun)}`);
console.log(`Исправлено написаний имён: ${renamed}`);
if (unresolved) console.log(`ОТВЕТОВ ФИЛЬТРА БЕЗ ВОПРОСА В ПАЧКЕ: ${unresolved}`);
if (missing.length) console.log(`БЕЗ КАРТОЧКИ (${missing.length}): ${missing.join(', ')}`);
if (extra.length) console.log(`Карточки постов, которых нет среди опубликованных (${extra.length}): ${extra.join(', ')}`);
if (!dry) {
	const list = [...cards].sort((a, b) => a[0].localeCompare(b[0])).map(([id, c]) => ({ ...c, run: from.get(id) }));
	await writeFile(OUT, JSON.stringify({ made: new Date().toISOString().slice(0, 10), cards: list }, null, 1) + '\n');
	console.log(`Записано: ${OUT}`);
}
process.exitCode = missing.length ? 1 : 0;
