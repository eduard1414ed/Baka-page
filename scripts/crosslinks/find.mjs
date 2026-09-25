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
// Формат отклонённых: JSON-массив строк «источник→цель» или объектов { key }.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib.mjs';
import { findTitleCandidates, mergeCandidates, RULES } from './finder.mjs';
import { buildCandidates } from './pipeline.mjs';
import { readDictionary } from './dictionary.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const outDir = opt('--out', join(homedir(), 'baka-audit/crosslinks/candidates'));
const rejectedFile = opt('--rejected', join(REPO, 'статус/перелинковка/отклонено.json'));
const since = opt('--since', null);

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
	const r = buildCandidates({ posts, anime, cards, broad, occasions, rejected });
	candidates = r.candidates;
	forStep5 = r.forStep5;
	stats = { ...r.stats, coverage: r.coverageLog.length };
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
};
await writeFile(join(outDir, `candidates${stamp}.json`), JSON.stringify(result, null, 1));
console.log(`Кандидатов: ${candidates.length} (основных ${candidates.filter((c) => c.status === 'основной').length}), для шага 5: ${result.forStep5.length}. Отклонённых в списке: ${rejected.size}.`);
if (stats) console.log(`Слияние: найдено обоими каналами ${stats.merged}, снято фильтром ${stats.filtered}, решений охвата ${stats.coverage}.`);
if (fresh) console.log(`Новых или изменённых постов после ${since}: ${fresh.size}.`);
console.log(`Записано: ${join(outDir, `candidates${stamp}.json`)}`);
