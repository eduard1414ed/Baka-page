// ПЕРЕЛИНКОВКА, ШАГ 1 — ВЫГРУЗКА ДАННЫХ О ПОСТАХ.
//
//   node scripts/crosslinks/collect.mjs [--out <папка>]
//
// Пишет `posts.json` (по записи на опубликованный пост) в ~/baka-audit/crosslinks/data/
// и печатает сводку. В репозиторий не пишет ничего.

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadCorpus, animeName } from './lib.mjs';

const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(homedir(), 'baka-audit/crosslinks/data');

const { posts, anime, mismatches } = await loadCorpus();
const pub = posts.filter((p) => p.published);

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'posts.json'), JSON.stringify({ made: new Date().toISOString(), posts: pub }, null, 1));

const isSource = (p) => p.ownPage && (p.category === 'note' || p.category === 'article');
const hasAnime = (p) => Object.keys(p.textAnime).length + Object.keys(p.titleAnime).length + p.field.length > 0;
const byCat = {};
for (const p of pub) {
	const k = p.external ? p.category + ' (внешн.)' : p.category;
	byCat[k] ??= { всего: 0, сТайтлом: 0, знаков: 0 };
	byCat[k].всего++;
	if (hasAnime(p)) byCat[k].сТайтлом++;
	byCat[k].знаков += p.textChars;
}

console.log(`Постов в папке: ${posts.length}, опубликованных: ${pub.length}, черновиков: ${posts.length - pub.length}`);
console.log(`С хотя бы одним тайтлом (текст, заголовок или поле): ${pub.filter(hasAnime).length}`);
console.log(`Только по тексту (указатель): ${pub.filter((p) => Object.keys(p.officialAnime).length).length}`);
console.table(byCat);

const sources = pub.filter(isSource);
console.log(`Источников (заметки и статьи со своей страницей): ${sources.length}, с тайтлом: ${sources.filter(hasAnime).length}`);
console.log(`Текст источников: ${sources.reduce((s, p) => s + p.textChars, 0)} знаков`);
const tgt = pub.filter((p) => ['podcast', 'videoessay', 'bonus'].includes(p.category) && p.ownPage);
console.log(`Описания выпусков, эссе и бонусов (без расшифровок): ${tgt.length} постов, ${tgt.reduce((s, p) => s + p.textChars, 0)} знаков`);
const ext = pub.filter((p) => p.external);
console.log(`Внешние посты: ${ext.length}, текста ${ext.reduce((s, p) => s + p.textChars, 0)} знаков`);

console.log(`\nРасхождений «указатель сайта против суммы по блокам»: ${mismatches.length}`);
for (const m of mismatches.slice(0, 20)) console.log('  ' + m);

for (const id of ['deti-ubiytsy', 'santu-vyzyvali']) {
	const p = pub.find((x) => x.id === id);
	const ids = Object.keys(p.textAnime);
	console.log(`\n${id}: ${ids.map((a) => animeName(anime, a) + ' ×' + p.textAnime[a]).join(', ') || '—'}`);
	for (const b of p.blocks.filter((b) => b.anime && Object.keys(b.anime).length)) console.log(`   блок ${b.n} (${b.kind}${b.textN ? ' №' + b.textN : ''}): ${Object.keys(b.anime).join(', ')}`);
}
