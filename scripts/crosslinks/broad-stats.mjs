// ПЕРЕЛИНКОВКА — ЧАСТОТЫ МЕТОК ДЛЯ РЕШЕНИЯ «ШИРОКАЯ / УЗКАЯ» (сессия 1в, шаг 5).
//
//   node scripts/crosslinks/broad-stats.mjs [--out <файл.md>]
//
// По итоговым карточкам (статус/перелинковка/карточки.json) для каждой метки:
//   - у скольких постов она главная (и в разделе — для справки);
//   - о скольких разных тайтлах эти посты (главный тайтл по счётчику или
//     тайтл-предмет из карточки) — «разнородность» темы;
//   - сколько пар канал «темы» даёт ею ОДНОЙ, без второго сигнала (ровно
//     столько пар уйдёт, если назвать её широкой), и два примера.
// Поиск пар — themes.mjs, все метки узкие (как сейчас). Ничего не пишет,
// кроме --out.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, classifyAnime } from './lib.mjs';
import { findThemeCandidates } from './themes.mjs';
import { readDictionary } from './dictionary.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

const { posts: all, anime } = await loadCorpus();
const posts = all.filter((p) => p.published);
const byId = new Map(posts.map((p) => [p.id, p]));
const list = JSON.parse(await readFile(join(REPO, 'статус/перелинковка/карточки.json'), 'utf8')).cards;
const cards = new Map(list.map((c) => [c.id, c]));
const dict = await readDictionary();
const dictText = await readFile(join(REPO, 'статус/перелинковка/словарь.md'), 'utf8');
const nameOf = new Map([...dictText.matchAll(/^\*\*([^*\n]+)\*\* \(`([^`]+)`\)/gmu)].map((m) => [m[2], m[1]]));

const { candidates } = findThemeCandidates({ posts, cards, anime });

const stat = new Map([...dict.codes].map((c) => [c, { main: 0, section: 0, titles: new Set(), alone: [], any: 0 }]));
for (const [id, c] of cards) {
	const p = byId.get(id);
	if (!p) continue;
	const cls = classifyAnime(p);
	const subj = [...Object.entries(cls).filter(([, x]) => x.role === 'main').map(([a]) => a), ...(c.subjectAnime ?? []).map((s) => s.anime)];
	for (const l of c.labels ?? []) {
		const s = stat.get(l.code);
		if (!s) continue;
		if (l.level === 'главная') (s.main++, subj.forEach((a) => s.titles.add(a)));
		if (l.level === 'раздел') s.section++;
	}
}
for (const c of candidates) {
	const labels = c.reasons.filter((r) => r.signal === 'label');
	for (const r of labels) stat.get(r.code) && stat.get(r.code).any++;
	if (labels.length === 1 && c.reasons.length === 1) stat.get(labels[0].code)?.alone.push(c);
}

const rows = [...stat].map(([code, s]) => ({ code, name: nameOf.get(code) ?? code, ...s, titles: s.titles.size })).sort((a, b) => b.alone.length - a.alone.length || b.main - a.main);
const out = [];
out.push(`Карточек: ${cards.size}; пар канала «темы» всего: ${candidates.length} (все метки узкие)`, '');
out.push('| метка | главная у постов | в разделе | разных тайтлов | пар всего | пар ею одной | примеры пар одной меткой |');
out.push('|---|---:|---:|---:|---:|---:|---|');
for (const r of rows) {
	const ex = r.alone.slice(0, 2).map((c) => `«${c.sourceTitle}» → «${c.targetTitle}»`).join('; ');
	out.push(`| ${r.name} (\`${r.code}\`) | ${r.main} | ${r.section} | ${r.titles} | ${r.any} | ${r.alone.length} | ${ex} |`);
}
console.log(out.join('\n'));
if (outFile) await writeFile(outFile, out.join('\n') + '\n');
