// Пересбор studios.json — данных о студиях для подписей под картинками.
//
// Запускается РУКАМИ и только когда добавился новый перенос: студия у тайтла
// не меняется, а лишний поход к чужому сервису — лишний способ упасть.
//
//   node scripts/dtf/collect-studios.mjs
//
// ДВА ИСТОЧНИКА, И ОБА НАЗВАНЫ ВСЛУХ: справочник сайта (поле studio)
// и AniList — ПО ТОМУ ID, который автор поставил в ссылке заголовка статьи.
// Поиском по названию не ходим ни разу: он приводит к сиквелу, и это уже
// стоило проекту двух чужих обложек (CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags } from './source.mjs';

const { readAnimeCollection } = await import(new URL('../anime-cases-lib.mjs', import.meta.url).href);
const { buildAnimeMatcher, findMentions } = await import(new URL('../../src/lib/animeMentions.mjs', import.meta.url).href);

// Статьи, из заголовков которых берутся тайтлы и их id на AniList.
const SOURCES = [
	{ post: 'зима', id: 1149385 }, { post: 'зима', id: 1150944 }, { post: 'зима', id: 1153300 },
	{ post: 'зима', id: 1157405 }, { post: 'зима', id: 1167923 }, { post: 'лето', id: 1329025 },
];
// Тайтлы, которых в статьях нет: приехали из телеграма (посты 115 и 116).
const EXTRA = [
	{ post: 'зима', name: 'Медленная петля', anilistId: null },
	{ post: 'зима', name: 'Руководство гениального принца по вызволению страны из долгов', anilistId: null },
];

async function askAniList(id) {
	const query = {
		query: 'query($id:Int){Media(id:$id){title{romaji} studios(isMain:true){nodes{name}}}}',
		variables: { id },
	};
	let last;
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const response = await fetch('https://graphql.anilist.co', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(query),
			});
			// Слишком частые запросы — тоже сетевое: ждём и пробуем снова.
			if (response.status === 429) { last = new Error('AniList: слишком частые запросы (429)'); await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const json = await response.json();
			if (json.errors) throw new Error(json.errors[0]?.message ?? 'ошибка GraphQL');
			return json.data.Media;
		} catch (error) {
			// ПОВТОРЯЕМ ТОЛЬКО СЕТЕВОЕ: «такого тайтла нет» повтором не лечится.
			const network = error.cause || /fetch failed|timeout|network|ECONN|socket/i.test(error.message);
			last = error;
			if (!network) break;
			await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
		}
	}
	// Молчать нельзя: пустой ответ «студии нет» неотличим от «интернет кончился».
	throw last ?? new Error('AniList не ответил за четыре попытки');
}

async function collect() {
	const entries = await readAnimeCollection();
	const matcher = buildAnimeMatcher(entries.map((e) => ({ id: e.data.id, data: e.data })), { quotes: 'ignore', speech: false });
	const byId = new Map(entries.map((e) => [e.data.id, e.data]));
	const catalogId = (name) => {
		const hit = findMentions(name, matcher).find((m) => m.start === 0 && m.end === name.length);
		return hit ? hit.id : null;
	};

	const titles = [];
	for (const source of SOURCES) {
		const article = await fetchArticle(source.id);
		for (const block of article.blocks) {
			if (block.type !== 'header') continue;
			const match = /href="[^"]*anilist\.co\/anime\/(\d+)/.exec(block.data.text);
			if (!match) continue;
			titles.push({ post: source.post, name: stripTags(block.data.text), anilistId: Number(match[1]) });
		}
	}
	titles.push(...EXTRA);

	const out = [];
	let failures = 0;
	for (const title of titles) {
		const id = catalogId(title.name);
		const fromCatalog = id ? (byId.get(id)?.studio ?? null) : null;
		let fromAnilist = null;
		let romaji = null;
		if (title.anilistId) {
			try {
				const media = await askAniList(title.anilistId);
				fromAnilist = media.studios.nodes.map((n) => n.name);
				romaji = media.title.romaji;
			} catch (error) { failures++; console.error('НЕ СПРОСИЛОСЬ', title.name, error.message); }
			await new Promise((r) => setTimeout(r, 700)); // AniList: 90 запросов в минуту
		}
		out.push({ ...title, catalogId: id, fromCatalog, fromAnilist, romaji });
	}

	const file = new URL('./studios.json', import.meta.url);
	fs.writeFileSync(file, JSON.stringify(out, null, 1));
	console.log(`записано: ${out.length} | не спросилось у AniList: ${failures}`);
	const missing = out.filter((o) => !o.fromCatalog && !o.fromAnilist?.length);
	if (missing.length) { console.log('БЕЗ СТУДИИ ВОВСЕ:'); missing.forEach((o) => console.log('   ', o.name)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await collect();
