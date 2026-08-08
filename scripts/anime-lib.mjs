// Общее для scripts/fetch-anime.mjs (запускаете вручную по одному тайтлу) и
// scripts/sync-anime.mjs (робот на GitHub Actions, донабирает тайтлы, размеченные
// в текстах постов) — скачать обложку, сжать её и записать файл тайтла в справочник.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ANIME_POSTER_WIDTHS } from '../src/lib/animePoster.mjs';

export const ROOT = new URL('../', import.meta.url);
export const ANIME_CONTENT_DIR = new URL('src/content/anime/', ROOT);
export const ANIME_PUBLIC_DIR = new URL('public/anime/', ROOT);

export async function downloadPoster(posterUrl, slug) {
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

// Поля, которые заказчик правит в админке и которые из-за этого нельзя
// перезаписывать данными источника (CLAUDE.md, раздел «Тайтл»). Признак стоит
// по каждому полю отдельно: описание переписано своими словами — не трогаем,
// а обложку в том же тайтле по-прежнему обновляем.
export const MANUAL_FIELDS = ['titleRu', 'synopsis', 'poster'];

async function readAnimeEntry(slug) {
	try {
		return JSON.parse(await readFile(new URL(`${slug}.json`, ANIME_CONTENT_DIR), 'utf8'));
	} catch {
		// Файла ещё нет (обычный случай для нового тайтла) или он битый —
		// в обоих случаях беречь нечего, пишем с нуля.
		return null;
	}
}

// source — модуль из scripts/anime-sources/ (id, label), result — то, что вернул
// find()/findById() этого модуля. Возвращает записанный объект тайтла.
export async function writeAnimeEntry(slug, source, result) {
	const previous = await readAnimeEntry(slug);
	const manual = (previous?.manual ?? []).filter((field) => MANUAL_FIELDS.includes(field));
	const kept = [];

	// Отмеченное как правленое руками оставляем от прежнего файла, а не берём
	// из источника. Что именно проигнорировали — обязательно говорим вслух:
	// молча разошедшиеся файл и API незаметны, а объясняться будут годами.
	const keep = (field, fromSource) => {
		if (manual.includes(field) && previous?.[field] !== undefined) {
			kept.push(field);
			return previous[field];
		}
		return fromSource;
	};

	const titleRu = keep('titleRu', result.titleRu);
	const synopsis = keep('synopsis', result.synopsis);
	const poster = keep('poster', result.posterUrl ? `/anime/${slug}.jpg` : undefined);

	// Обложку не качаем вовсе, если её пометили правленой руками: скачивание
	// перезаписывает файлы в public/anime/, и подменённая картинка пропала бы,
	// хотя путь к ней в JSON остался бы прежним.
	if (result.posterUrl && !manual.includes('poster')) {
		await downloadPoster(result.posterUrl, slug);
	}

	const entry = {
		id: slug,
		source: source.id,
		sourceId: result.sourceId,
		...(titleRu && { titleRu }),
		titleOriginal: result.titleOriginal,
		...(result.year && { year: result.year }),
		...(result.studio && { studio: result.studio }),
		...(poster && { poster }),
		...(synopsis && { synopsis }),
		...(result.url && { url: result.url }),
		// Варианты написания и сам признак ручной правки в источниках не
		// существуют — они живут только у нас, поэтому переносятся из прежнего
		// файла как есть, без всяких условий.
		...(previous?.aliases?.length && { aliases: previous.aliases }),
		// А альтернативные названия, наоборот, целиком приходят из источника
		// и обновляются вместе с остальными данными: в поиск они не идут,
		// портить ими нечего.
		...(result.sourceAliases?.length && { sourceAliases: result.sourceAliases }),
		...(manual.length && { manual }),
	};

	await mkdir(ANIME_CONTENT_DIR, { recursive: true });
	const outPath = new URL(`${slug}.json`, ANIME_CONTENT_DIR);
	await writeFile(outPath, JSON.stringify(entry, null, '\t') + '\n', 'utf8');

	if (kept.length > 0) {
		console.log(`  правлено руками, данные из ${source.label} для этих полей проигнорированы: ${kept.join(', ')}`);
	}

	return entry;
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
