// Разово запрашивает данные тайтла с Shikimori и кладёт результат в кэш:
// картинку — в public/anime/, JSON — в src/content/anime/. Сборка сайта
// эти файлы просто читает и сама на Shikimori никогда не ходит.
//
// Запуск: node scripts/fetch-anime.mjs slug:id [slug:id ...]
// Пример: node scripts/fetch-anime.mjs spirited-away:199 howls-moving-castle:431
//
// slug — как тайтл будет называться в адресе сайта (/anime/slug/), выбираете сами.
// id — числовой ID тайтла на Shikimori, его видно в адресе страницы тайтла
//      на самом Shikimori: https://shikimori.one/animes/z199-... -> id 199.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ANIME_POSTER_WIDTHS } from '../src/lib/animePoster.mjs';

const SHIKIMORI_BASE = 'https://shikimori.one';
const USER_AGENT = 'BakaPodcastSite/1.0 (+https://github.com/eduard1414ed/Baka-page)';
const PAUSE_MS = 1500; // Shikimori ограничивает частоту запросов — не долбим подряд.

const ROOT = new URL('../', import.meta.url);
const ANIME_CONTENT_DIR = new URL('src/content/anime/', ROOT);
const ANIME_PUBLIC_DIR = new URL('public/anime/', ROOT);

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shikimori вставляет в описание разметку вида [character=384]Имя[/character] —
// на сайте она не нужна, оставляем только текст внутри тегов.
function cleanDescription(description) {
	if (!description) return undefined;
	return description.replace(/\[\/?\w+(?:=\d+)?\]/g, '').trim();
}

async function fetchAnimeData(shikimoriId) {
	const response = await fetch(`${SHIKIMORI_BASE}/api/animes/${shikimoriId}`, {
		headers: { 'User-Agent': USER_AGENT },
	});
	if (!response.ok) {
		throw new Error(`Shikimori ответил ${response.status} для id ${shikimoriId}`);
	}
	return response.json();
}

async function downloadPoster(imagePath, slug) {
	const response = await fetch(`${SHIKIMORI_BASE}${imagePath}`, {
		headers: { 'User-Agent': USER_AGENT },
	});
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

async function fetchOne(slug, shikimoriId) {
	console.log(`→ ${slug}: запрашиваю тайтл ${shikimoriId} с Shikimori…`);
	const data = await fetchAnimeData(shikimoriId);

	const year = data.aired_on ? Number(data.aired_on.slice(0, 4)) : undefined;
	const studio = data.studios?.[0]?.name;
	const posterPath = data.image?.original;

	if (posterPath) {
		console.log(`  скачиваю обложку и сжимаю в ${ANIME_POSTER_WIDTHS.join('/')}px…`);
		await downloadPoster(posterPath, slug);
	}

	const entry = {
		id: slug,
		shikimoriId: data.id,
		titleRu: data.russian || data.name,
		titleOriginal: data.name,
		...(year && { year }),
		...(studio && { studio }),
		...(posterPath && { poster: `/anime/${slug}.jpg` }),
		...(cleanDescription(data.description) && { synopsis: cleanDescription(data.description) }),
		...(data.url && { url: `${SHIKIMORI_BASE}${data.url}` }),
	};

	await mkdir(ANIME_CONTENT_DIR, { recursive: true });
	const outPath = new URL(`${slug}.json`, ANIME_CONTENT_DIR);
	await writeFile(outPath, JSON.stringify(entry, null, '\t') + '\n', 'utf8');
	console.log(`  сохранено: src/content/anime/${slug}.json`);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0) {
		console.log('Использование: node scripts/fetch-anime.mjs slug:id [slug:id ...]');
		console.log('Пример: node scripts/fetch-anime.mjs spirited-away:199');
		process.exit(1);
	}

	const pairs = args.map((arg) => {
		const [slug, idStr] = arg.split(':');
		const id = Number(idStr);
		if (!slug || !id) {
			throw new Error(`Не понял аргумент "${arg}", нужен формат slug:id`);
		}
		return { slug, id };
	});

	for (let i = 0; i < pairs.length; i++) {
		const { slug, id } = pairs[i];
		try {
			await fetchOne(slug, id);
		} catch (error) {
			console.error(`  ошибка для ${slug}: ${error.message}`);
		}
		if (i < pairs.length - 1) await sleep(PAUSE_MS);
	}

	console.log('Готово.');
}

main();
