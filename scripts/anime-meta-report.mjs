// ЗАМЕР ЗАГОЛОВКОВ И ОПИСАНИЙ СТРАНИЦ ТАЙТЛОВ (TASK-markup, части 2.2 и 2.3).
//
//   node scripts/anime-meta-report.mjs            — сводка по всем 658
//   node scripts/anime-meta-report.mjs --примеры  — 10 примеров: сильные и слабые
//
// ЗАЧЕМ. Правила с пределами длины («не длиннее 60», «держись 150–160») нельзя
// принять, посмотрев на одну страницу: «Унесённые призраками» влезают,
// а «Легенда о героях Галактики: Новый тезис — Столкновение» нет. Пороги
// в этом проекте подбираются замером по живому архиву, а не на глаз.
//
// ЗОВЁТ НАСТОЯЩИЕ ФУНКЦИИ из src/lib/animeMeta.mjs — те же, что зовёт страница.
// Своей копии правила здесь нет: копия мерила бы саму себя.

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';
import { sharedMentionIndex, postsForAnime } from '../src/lib/animeMentionIndex.mjs';
import { isPublished } from '../src/lib/publishing.mjs';
import { animeTitle, animeDescription, свои, ПРЕДЕЛ_ЗАГОЛОВКА, ПРЕДЕЛ_ОПИСАНИЯ } from '../src/lib/animeMeta.mjs';
import { pageTitle } from '../src/lib/site.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// Коллекции читаем сами, а не через Astro: поднимать сборку ради замера долго,
// а нужны от постов только шапка и тело. Разбор шапки — той же библиотекой
// js-yaml, которой пользуется сам Astro.
async function посты() {
	const дир = join(ROOT, 'src/content/posts');
	const файлы = (await readdir(дир)).filter((f) => f.endsWith('.md'));
	const готово = [];

	for (const файл of файлы) {
		const текст = await readFile(join(дир, файл), 'utf8');
		const м = текст.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
		if (!м) continue;
		const data = yaml.load(м[1]) ?? {};
		// Schema Astro приводит дату к Date и ссылки к {id}. Повторяем ровно
		// то, что нужно указателю упоминаний, и ничего сверх.
		data.date = data.date instanceof Date ? data.date : new Date(data.date);
		data.anime = (data.anime ?? []).map((id) => (typeof id === 'string' ? { id } : id));
		готово.push({ id: файл.replace(/\.md$/, ''), body: м[2], data });
	}

	return готово.filter(({ data }) => isPublished(data));
}

async function коллекция(путь) {
	const дир = join(ROOT, путь);
	const файлы = (await readdir(дир)).filter((f) => f.endsWith('.json'));
	return Promise.all(
		файлы.map(async (файл) => ({
			id: файл.replace(/\.json$/, ''),
			data: JSON.parse(await readFile(join(дир, файл), 'utf8')),
		})),
	);
}

const posts = await посты();
const animeList = await коллекция('src/content/anime');
const transcripts = await коллекция('src/content/transcripts');
const index = sharedMentionIndex({ posts, transcripts, animeList });

const строки = animeList.map((entry) => {
	const mentions = postsForAnime(entry.id, posts, index);
	const name = entry.data.titleRu || entry.data.titleOriginal;
	const заголовок = animeTitle({ name, year: entry.data.year, mentions });
	const описание = animeDescription({ mentions });

	return {
		id: entry.id,
		name,
		N: свои(mentions).length,
		заголовок: заголовок ?? pageTitle(name),
		новый: Boolean(заголовок),
		описание,
		синопсис: !описание,
	};
});

if (process.argv.includes('--примеры')) {
	const сильные = [...строки].sort((a, b) => b.N - a.N).slice(0, 5);
	const слабые = строки.filter((с) => с.N > 0).sort((a, b) => a.N - b.N).slice(0, 4);
	const пустая = строки.find((с) => с.N === 0);

	for (const с of [...сильные, ...слабые, пустая].filter(Boolean)) {
		console.log(`\n${с.id}  (своих материалов: ${с.N})`);
		console.log(`  <title>       ${с.заголовок}   [${с.заголовок.length}]${с.новый ? '' : '  ← прежний шаблон'}`);
		console.log(`  description   ${с.описание ?? '← остался синопсис'}${с.описание ? `   [${с.описание.length}]` : ''}`);
	}
	process.exit(0);
}

const новых = строки.filter((с) => с.новый).length;
const длинных = строки.filter((с) => с.заголовок.length > ПРЕДЕЛ_ЗАГОЛОВКА).length;
const своих = строки.filter((с) => с.описание).length;
const переросших = строки.filter((с) => с.описание && с.описание.length > ПРЕДЕЛ_ОПИСАНИЯ).length;
const короткихОписаний = строки.filter((с) => с.описание && с.описание.length < 150).length;
const безНазваний = строки.filter((с) => с.описание && !с.описание.startsWith('Обсуждали')).length;

const длины = строки.filter((с) => с.новый).map((с) => с.заголовок.length).sort((a, b) => a - b);
const среднее = (м) => (м.length ? Math.round(м.reduce((s, x) => s + x, 0) / м.length) : 0);

console.log(`Страниц тайтлов: ${строки.length}`);
console.log('');
console.log(`ЗАГОЛОВОК`);
console.log(`  по новому шаблону:        ${новых}`);
const безСвоих = строки.filter((с) => с.N === 0).length;
console.log(`  остались на прежнем:      ${строки.length - новых}`);
console.log(`     из них нет материалов: ${безСвоих}`);
console.log(`     не влез даже без года: ${строки.length - новых - безСвоих}`);
console.log(`  длиннее ${ПРЕДЕЛ_ЗАГОЛОВКА}:              ${длинных}`);
console.log(`  длина новых: ${длины[0]}…${длины.at(-1)}, в среднем ${среднее(длины)}`);
console.log('');
console.log(`ОПИСАНИЕ`);
console.log(`  из своих данных:          ${своих}`);
console.log(`  остался синопсис:         ${строки.length - своих}`);
console.log(`  длиннее ${ПРЕДЕЛ_ОПИСАНИЯ}:             ${переросших}`);
console.log(`  короче 150:               ${короткихОписаний}`);
console.log(`  без единого названия:     ${безНазваний}  (не влезло ни одно)`);
const дл = строки.filter((с) => с.описание).map((с) => с.описание.length);
const корзины = { '<80': 0, '80–119': 0, '120–149': 0, '150–160': 0 };
for (const л of дл) корзины[л < 80 ? '<80' : л < 120 ? '80–119' : л < 150 ? '120–149' : '150–160'] += 1;
console.log('  длина описаний:');
for (const [к, n] of Object.entries(корзины)) console.log(`     ${к.padEnd(8)} ${n}`);
const поЧислу = {};
for (const с of строки.filter((x) => x.описание)) {
	const ключ = с.N === 1 ? '1 материал' : с.N <= 3 ? '2–3' : с.N <= 10 ? '4–10' : 'больше 10';
	поЧислу[ключ] ??= [];
	поЧислу[ключ].push(с.описание.length);
}
console.log('  средняя длина по числу материалов:');
for (const [к, м] of Object.entries(поЧислу)) console.log(`     ${к.padEnd(11)} ${Math.round(м.reduce((a, b) => a + b, 0) / м.length)}  (страниц ${м.length})`);
