// Общее для scripts/fetch-anime.mjs (запускаете вручную по одному тайтлу) и
// scripts/sync-anime.mjs (робот на GitHub Actions, донабирает тайтлы, размеченные
// в текстах постов) — скачать обложку, сжать её и записать файл тайтла в справочник.

import { writeFile, mkdir } from 'node:fs/promises';
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

// source — модуль из scripts/anime-sources/ (id, label), result — то, что вернул
// find()/findById() этого модуля. Возвращает записанный объект тайтла.
export async function writeAnimeEntry(slug, source, result) {
	if (result.posterUrl) {
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

	return entry;
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
