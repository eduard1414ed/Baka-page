// ПЕРЕЛИНКОВКА — ЗАПУСК ПОИСКОВИКА.
//
//   node scripts/crosslinks/find.mjs                     — все посты
//   node scripts/crosslinks/find.mjs --since 2026-10-01  — только пары, где источник
//        или цель появились или менялись после даты (оба направления: новые посты
//        как источники и новые посты как цели для старых источников)
//   --out <папка>       куда писать (по умолчанию ~/baka-audit/crosslinks/candidates/)
//   --titles-only       только канал «тайтлы», как до сессии 1в (для сравнения)
//   --rejected <файл>   отклонённые Эдом пары (по умолчанию статус/перелинковка/отклонено.json;
//                       нет файла — нет отклонённых)
//
// Уже стоящие вставки учитываются: цель, которая уже стоит в посте, не
// предлагается повторно; места рядом с существующей вставкой заняты; потолок
// на цель считает и их. В репозиторий не пишет ничего.
//
// Формат отклонённых: JSON-массив строк «источник→цель» или объектов { key }
// (страница ревью пишет объекты: key, source, target, reason, comment…).
//
// С сессии 2 в результат пишутся `fingerprints` — отпечатки файлов постов-
// источников на момент поиска. По ним страница ревью (review/) замечает, что
// пост изменился после поиска, и ищет место вставки заново по первым словам.
//
// С сессии 3 (решения Эда 2 и 3):
//   — одобренные пары (статус/перелинковка/решения.json, approved) считаются
//     уже стоящими вставками: плотность, «не ближе абзаца», потолок на цель;
//   — ПРОЙДЕННЫЙ ПОСТ ЗАКРЫТ ЦЕЛИКОМ. Пройден — если по всем его основным
//     кандидатам в ПРЕДЫДУЩЕМ candidates.json (том, что Эд видел на странице)
//     есть решение «одобрено» или «отклонено». Отложенное решением не считается.
//     Список закрытых переносится из прогона в прогон (`closed`) и не убывает.
//     Новый основной у закрытого поста получает статус «добор» — его Эд
//     посмотрит в конце проекта, а страница ревью его не показывает.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib.mjs';
import { fingerprint as fp, reanchor } from './review/fresh.mjs';
import { findTitleCandidates, mergeCandidates, RULES } from './finder.mjs';
import { buildCandidates } from './pipeline.mjs';
import { readDictionary } from './dictionary.mjs';
import { fingerprint } from './review/fresh.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const outDir = opt('--out', join(homedir(), 'baka-audit/crosslinks/candidates'));
const rejectedFile = opt('--rejected', join(REPO, 'статус/перелинковка/отклонено.json'));
const since = opt('--since', null);
const decisionsFile = opt('--decisions', join(REPO, 'статус/перелинковка/решения.json'));

async function readJsonOr(file, dflt) {
	try {
		return JSON.parse(await readFile(file, 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return dflt;
		throw new Error(`Не читается ${file}: ${e.message}`);
	}
}

async function readRejected(file) {
	try {
		const list = JSON.parse(await readFile(file, 'utf8'));
		return new Set(list.map((x) => (typeof x === 'string' ? x : x.key)));
	} catch (e) {
		if (e.code === 'ENOENT') return new Set();
		throw new Error(`Не читается список отклонённых ${file}: ${e.message}`);
	}
}

/** Посты, появившиеся или менявшиеся после даты: по дате поста и по истории git. */
function changedSince(date, posts) {
	const out = new Set(posts.filter((p) => p.date && p.date >= date).map((p) => p.id));
	const log = execFileSync(
		'git',
		['-c', 'core.quotepath=false', 'log', `--since=${date}`, '--name-only', '--format=', '--', 'src/content/posts/'],
		{ cwd: REPO, encoding: 'utf8' },
	);
	for (const line of log.split('\n')) {
		const m = line.match(/^src\/content\/posts\/(.+)\.md$/);
		if (m) out.add(m[1]);
	}
	return out;
}

const { posts: all, anime } = await loadCorpus();
const posts = all.filter((p) => p.published);
const rejected = await readRejected(rejectedFile);
const byPost = new Map(posts.map((p) => [p.id, p]));

// Одобренные, но ещё не вписанные: место — по номеру, если файл поста тот же,
// что при решении, иначе заново по первым словам абзаца.
const approved = (await readJsonOr(decisionsFile, { approved: [] })).approved ?? [];
const planned = new Map();
const lostPlaces = [];
for (const a of approved) {
	const src = byPost.get(a.source);
	if (!src) continue;
	if (src.blocks.some((b) => b.kind === 'material' && b.target === a.target)) continue; // уже вписано
	let place = a.place;
	if (a.fingerprint !== (await fp(a.source))) place = reanchor(src.blocks, a.place);
	if (!place) {
		lostPlaces.push(a.key);
		continue;
	}
	if (!planned.has(a.source)) planned.set(a.source, []);
	planned.get(a.source).push({ key: a.key, target: a.target, afterBlock: place.afterBlock });
}

// Закрытые посты: прежний список + пройденные по предыдущему прогону.
const prev = await readJsonOr(join(outDir, 'candidates.json'), null);
const closed = new Set(prev?.closed ?? []);
if (prev) {
	const decided = new Set([...approved.map((a) => a.key), ...rejected]);
	const mainsOf = new Map();
	for (const c of prev.candidates) {
		if (c.status !== 'основной') continue;
		if (!mainsOf.has(c.source)) mainsOf.set(c.source, []);
		mainsOf.get(c.source).push(c.key);
	}
	for (const [sid, keys] of mainsOf) if (keys.every((k) => decided.has(k))) closed.add(sid);
}
// С сессии 1в — оба канала (pipeline.mjs): карточки разметчика
// статус/перелинковка/карточки.json, широкие метки — из словаря.
let candidates;
let forStep5;
let stats = null;
if (args.includes('--titles-only')) {
	const r = findTitleCandidates({ posts, anime, rejected });
	candidates = mergeCandidates(r.candidates);
	forStep5 = r.forStep5;
} else {
	const cards = new Map(JSON.parse(await readFile(join(REPO, 'статус/перелинковка/карточки.json'), 'utf8')).cards.map((c) => [c.id, c]));
	const { broad, occasions } = await readDictionary();
	const r = buildCandidates({ posts, anime, cards, broad, occasions, rejected, planned });
	candidates = r.candidates;
	forStep5 = r.forStep5;
	stats = { ...r.stats, coverage: r.coverageLog.length };
}

// Новый основной у закрытого поста — в «добор».
const approvedKeys = new Set(approved.map((a) => a.key));
for (const c of candidates) {
	if (c.status === 'основной' && closed.has(c.source) && !approvedKeys.has(c.key)) {
		c.status = 'добор';
		c.statusWhy = 'пост уже пройден — посмотреть в конце проекта';
	}
}

let fresh = null;
if (since) {
	fresh = changedSince(since, posts);
	candidates = candidates.filter((c) => fresh.has(c.source) || fresh.has(c.target));
}

await mkdir(outDir, { recursive: true });
const stamp = since ? `-since-${since}` : '';
const result = {
	made: new Date().toISOString(),
	since,
	rules: RULES,
	rejectedCount: rejected.size,
	channels: args.includes('--titles-only') ? ['titles'] : ['titles', 'themes'],
	stats,
	sources: posts.filter((p) => p.ownPage && RULES.sourceCategories.includes(p.category)).length,
	candidates,
	forStep5: forStep5.filter((c) => !fresh || fresh.has(c.source) || fresh.has(c.target)),
	fingerprints: {},
	// Посты, пройденные целиком (решение Эда 2 к сессии 3). Не убывает.
	closed: [...closed].sort(),
};
for (const id of new Set(candidates.map((c) => c.source))) result.fingerprints[id] = await fingerprint(id);
await writeFile(join(outDir, `candidates${stamp}.json`), JSON.stringify(result, null, 1));
console.log(`Кандидатов: ${candidates.length} (основных ${candidates.filter((c) => c.status === 'основной').length}), для шага 5: ${result.forStep5.length}. Отклонённых в списке: ${rejected.size}.`);
console.log(`Закрытых постов: ${closed.size}; в «доборе»: ${candidates.filter((c) => c.status === 'добор').length}; одобренных, но не вписанных: ${[...planned.values()].flat().length}.`);
if (lostPlaces.length) console.log(`⚠ Место одобренной вставки не нашлось (пост изменился): ${lostPlaces.join(', ')}`);
if (stats) console.log(`Слияние: найдено обоими каналами ${stats.merged}, снято фильтром ${stats.filtered}, решений охвата ${stats.coverage}.`);
if (fresh) console.log(`Новых или изменённых постов после ${since}: ${fresh.size}.`);
console.log(`Записано: ${join(outDir, `candidates${stamp}.json`)}`);
