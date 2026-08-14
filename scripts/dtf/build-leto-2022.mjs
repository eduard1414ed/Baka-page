// Пересборка поста «Обзор всех аниме лета 2022» из статьи DTF 1329025.
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКРЫТЬ АДМИНКУ (см. README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags, blockToParagraphs, postPath, unwrapRedirect } from './source.mjs';
import { writeGuarded } from './guard.mjs';
import { captionFor } from './captions.mjs';

const { readAnimeCollection } = await import(new URL('../anime-cases-lib.mjs', import.meta.url).href);
const { buildAnimeMatcher, findMentions } = await import(new URL('../../src/lib/animeMentions.mjs', import.meta.url).href);

const SLUG = 'obzor-vseh-anime-leta-2022';

// Ссылки на материалы, которые есть на самом сайте. Всё остальное остаётся
// внешним: этих статей у нас нет, вести некуда.
const LINKS = new Map([
	['https://dtf.ru/anime/1198618-vse-serialy-vesny-2022-chto-stoit-posmotret', '/posts/obzor-vseh-anime-vesny-162/'],
	['https://dtf.ru/podcasts/1018419-neobychnoe-taksi-chto-esli-by-tarantino-snimal-anime-i-kak-sdelat-detektiv-pro-morzha', '/posts/ep-22/'],
]);
const rewrite = (href) => LINKS.get(unwrapRedirect(href)) ?? unwrapRedirect(href);

async function build() {
	const entries = await readAnimeCollection();
	const matcher = buildAnimeMatcher(entries.map((e) => ({ id: e.data.id, data: e.data })), { quotes: 'ignore', speech: false });
	const catalogId = (name) => {
		const hit = findMentions(name, matcher).find((m) => m.start === 0 && m.end === name.length);
		return hit ? hit.id : null;
	};

	const article = await fetchArticle(1329025);
	const lines = [];
	const anime = [];
	const noLink = [];
	const pending = [];
	let img = 0;
	let cover = null;

	for (const block of article.blocks) {
		if (block.type === 'delimiter') continue;

		if (block.type === 'media') {
			for (const _ of block.data.items) {
				img++;
				const src = `/images/uploads/dtf-leto-2022-${String(img).padStart(2, '0')}.webp`;
				if (!cover) cover = src;
				pending.push(src);
			}
			continue;
		}

		if (block.type === 'header') {
			const name = stripTags(block.data.text);
			// Заголовок без ссылки на AniList — это раздел статьи, а не тайтл.
			if (!/href="[^"]*anilist/.test(block.data.text)) {
				for (const src of pending.splice(0)) lines.push(`::image{src="${src}" alt="" width="column"}`);
				lines.push(`### ${name}`);
				continue;
			}
			const id = catalogId(name);
			// Ссылки на AniList сняты по решению заказчика.
			if (id) { anime.push(id); lines.push(`#### [${name}](/anime/${id}/)`); }
			else { noLink.push(name); lines.push(`#### ${name}`); }
			const caption = captionFor(name);
			for (const src of pending.splice(0)) lines.push(`::image{src="${src}" alt="" caption="${caption}" width="column"}`);
			continue;
		}

		if (block.type === 'text') {
			for (const paragraph of blockToParagraphs(block.data.text, rewrite)) {
				// Обложка стоит до всякого заголовка — выкладываем без подписи.
				for (const src of pending.splice(0)) lines.push(`::image{src="${src}" alt="" width="column"}`);
				lines.push(paragraph);
			}
		}
	}
	for (const src of pending.splice(0)) lines.push(`::image{src="${src}" alt="" width="column"}`);

	// Шапка — из живого файла (см. build-zima-2022.mjs), обложка сверяется с телом.
	const live = fs.readFileSync(postPath(SLUG), 'utf8');
	const parts = live.split(/^---$/m);
	const frontmatter = ['---', parts[1].trim().replace(/^cover: .*$/m, `cover: ${cover}`), '---', ''].join('\n');
	const refs = parts.slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? [];

	// Заслон: пересборка не имеет права стереть правку заказчика (guard.mjs).
	writeGuarded(postPath(SLUG), frontmatter + '\n' + [...lines, ...refs].join('\n\n') + '\n', { force: process.argv.includes('--force') });
	console.log(`тайтлов: ${anime.length + noLink.length} | из справочника: ${new Set(anime).size} | без ссылки: ${noLink.length}`);
	console.log(`картинок: ${img} | разделов: ${lines.filter((l) => l.startsWith('### ')).length}`);
	if (noLink.length) { console.log('\nБЕЗ ССЫЛКИ (нет в справочнике):'); noLink.forEach((n) => console.log('   ', n)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await build();
