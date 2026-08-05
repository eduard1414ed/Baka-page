// Разово ищет тайтл по названию и кладёт результат в кэш: картинку —
// в public/anime/, JSON — в src/content/anime/. Сборка сайта эти файлы
// просто читает и сама ни на Shikimori, ни на AniList никогда не ходит.
//
// Запуск: node scripts/fetch-anime.mjs slug:поисковый_запрос [slug:запрос ...]
// Пример: node scripts/fetch-anime.mjs spirited-away:Spirited Away
//
// slug — как тайтл будет называться в адресе сайта (/anime/slug/), выбираете сами.
// запрос — название на любом языке, как для поиска на самом Shikimori.
//
// Источники пробуются по очереди (см. SOURCES ниже): сначала Shikimori,
// и только если там ничего не нашлось — AniList. Если тайтл взят из
// AniList, у него не будет русского названия (titleRu) — скрипт скажет
// об этом прямо, впишите его потом в файл тайтла вручную.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ANIME_POSTER_WIDTHS } from '../src/lib/animePoster.mjs';
import * as shikimori from './anime-sources/shikimori.mjs';
import * as anilist from './anime-sources/anilist.mjs';

// Порядок = приоритет поиска. Чтобы добавить третий источник — написать
// модуль такой же формы (id, label, find(query)) и дописать его в список,
// больше нигде ничего менять не нужно.
const SOURCES = [shikimori, anilist];

const PAUSE_MS = 1500; // пауза между тайтлами — источники ограничивают частоту запросов.

const ROOT = new URL('../', import.meta.url);
const ANIME_CONTENT_DIR = new URL('src/content/anime/', ROOT);
const ANIME_PUBLIC_DIR = new URL('public/anime/', ROOT);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadPoster(posterUrl, slug) {
	const response = await fetch(posterUrl);
	if (!response.ok) {
		throw new Error(`Не удалось скачать обложку: ${response.status}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());

	await mkdir(ANIME_PUBLIC_DIR, { recursive: true });
	for (const width of ANIME_POSTER_WIDTHS) {
		const outPath = fileURLToPath(new URL(`${slug}-${width}w.webp`, ANIME_PUBLIC_DIR));
		await sharp(buffer)
			.resize({ width, withoutEnlargement: true })
			.webp({ quality: 82 })
			.toFile(outPath);
	}
}

async function findAcrossSources(query) {
	for (const source of SOURCES) {
		console.log(`  ищу в ${source.label}…`);
		let result;
		try {
			result = await source.find(query);
		} catch (error) {
			console.error(`  ${source.label} ответил с ошибкой, пробую следующий источник: ${error.message}`);
			continue;
		}
		if (result) {
			console.log(`  нашёл в ${source.label}: ${result.matchedName}`);
			return { source, result };
		}
		console.log(`  в ${source.label} не нашлось.`);
	}
	return null;
}

async function fetchOne(slug, query) {
	console.log(`→ ${slug}: ищу «${query}»…`);
	const found = await findAcrossSources(query);

	if (!found) {
		console.log(`  тайтл «${query}» не найден ни в одном источнике (${SOURCES.map((s) => s.label).join(', ')}).`);
		return;
	}

	const { source, result } = found;

	if (result.posterUrl) {
		console.log(`  скачиваю обложку и сжимаю в ${ANIME_POSTER_WIDTHS.join('/')}px…`);
		await downloadPoster(result.posterUrl, slug);
	}

	const entry = {
		id: slug,
		source: source.id,
		sourceId: result.sourceId,
		...(result.titleRu && { titleRu: result.titleRu }),
		titleOriginal: result.titleOriginal,
		...(result.year && { year: result.year }),
		...(result.studio && { studio: result.studio }),
		...(result.posterUrl && { poster: `/anime/${slug}.jpg` }),
		...(result.synopsis && { synopsis: result.synopsis }),
		...(result.url && { url: result.url }),
	};

	await mkdir(ANIME_CONTENT_DIR, { recursive: true });
	const outPath = new URL(`${slug}.json`, ANIME_CONTENT_DIR);
	await writeFile(outPath, JSON.stringify(entry, null, '\t') + '\n', 'utf8');

	const warning = result.titleRu ? '' : '  ⚠ нет русского названия — впишите titleRu вручную в этот файл';
	console.log(`  сохранено: src/content/anime/${slug}.json${warning}`);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		console.log('Использование: node scripts/fetch-anime.mjs slug:поисковый_запрос [slug:запрос ...]');
		console.log('Пример: node scripts/fetch-anime.mjs spirited-away:Spirited Away');
		process.exit(1);
	}

	const pairs = args.map((arg) => {
		const sep = arg.indexOf(':');
		const slug = sep === -1 ? '' : arg.slice(0, sep);
		const query = sep === -1 ? '' : arg.slice(sep + 1).trim();
		if (!slug || !query) {
			throw new Error(`Не понял аргумент "${arg}", нужен формат slug:запрос`);
		}
		return { slug, query };
	});

	for (let i = 0; i < pairs.length; i++) {
		const { slug, query } = pairs[i];
		try {
			await fetchOne(slug, query);
		} catch (error) {
			console.error(`  ошибка для ${slug}: ${error.message}`);
		}
		if (i < pairs.length - 1) await sleep(PAUSE_MS);
	}

	console.log('Готово.');
}

main();
