// Скачать обложку выпуска с хостинга подкаста, сжать в два webp-размера
// и положить в public/episodes/. Общее для двух вызывающих:
//   - scripts/fetch-episode-covers.mjs — разовый прогон по всему архиву руками;
//   - scripts/sync-episodes.mjs — робот на GitHub Actions, делает это для
//     каждого нового выпуска сразу, чтобы мегабайт больше не возвращался.
//
// Тот же приём, что у обложек тайтлов (scripts/anime-lib.mjs → public/anime/).
// Почему вообще копируем к себе — см. src/lib/episodeCover.mjs.

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { EPISODE_COVER_WIDTHS, coverIdFromUrl } from '../src/lib/episodeCover.mjs';

const QUALITY = 82;

// Здесь `import.meta.url` надёжен: скрипты запускаются обычным node и через
// сборщик Astro не проходят (в отличие от src/lib/episodeCover.mjs, см.
// комментарий там про список обложек файлом).
const ROOT = new URL('../', import.meta.url);
export const EPISODE_COVER_DIR = new URL('public/episodes/', ROOT);
export const COVER_MANIFEST = new URL('src/data/episodeCovers.mjs', ROOT);

function outPathFor(id, width) {
	return fileURLToPath(new URL(`${id}-${width}w.webp`, EPISODE_COVER_DIR));
}

/** Все ли размеры этой обложки уже лежат на диске. */
export function coverAlreadyDone(url) {
	const id = coverIdFromUrl(url);
	if (!id) return false;
	return EPISODE_COVER_WIDTHS.every((width) => existsSync(outPathFor(id, width)));
}

/**
 * Перезаписать список скачанных обложек (src/data/episodeCovers.mjs) по
 * настоящему содержимому папки. Именно этот список читает сборка сайта, поэтому
 * вызывать обязательно после скачивания — иначе новые обложки на страницах
 * не появятся. В список попадают только те id, у которых есть ВСЕ размеры:
 * недокачанная обложка не должна превратиться в битую картинку на странице.
 */
export async function writeCoverManifest() {
	await mkdir(EPISODE_COVER_DIR, { recursive: true });
	const files = await readdir(EPISODE_COVER_DIR);

	const seen = new Map();
	for (const file of files) {
		const match = file.match(/^(.+)-(\d+)w\.webp$/);
		if (!match) continue;
		const [, id, width] = match;
		if (!seen.has(id)) seen.set(id, new Set());
		seen.get(id).add(Number(width));
	}

	const complete = [...seen.entries()]
		.filter(([, widths]) => EPISODE_COVER_WIDTHS.every((w) => widths.has(w)))
		.map(([id]) => id)
		.sort();

	const body = [
		'// Список сжатых обложек выпусков в public/episodes/ — по id картинки',
		'// с хостинга подкаста. Файл создаётся скриптами, руками не править:',
		'// scripts/fetch-episode-covers.mjs (разово по архиву) и',
		'// scripts/sync-episodes.mjs (робот, для каждого нового выпуска).',
		'// Зачем он нужен и почему это js, а не json — src/lib/episodeCover.mjs.',
		'export default [',
		...complete.map((id) => `\t'${id}',`),
		'];',
		'',
	].join('\n');

	await writeFile(COVER_MANIFEST, body, 'utf8');
	return complete.length;
}

/**
 * Скачать и сжать одну обложку. Идемпотентно: уже готовую пропускает, ничего
 * не качая, — поэтому скрипт можно запускать сколько угодно раз.
 *
 * Список обложек этот вызов НЕ обновляет — после пачки вызовите
 * writeCoverManifest() один раз.
 *
 * @returns {Promise<{status:'done'|'skipped'|'foreign', id:string|null, sourceBytes?:number, outBytes?:number}>}
 */
export async function downloadEpisodeCover(url) {
	const id = coverIdFromUrl(url);
	// Не с хостинга подкаста — не наше дело, ничего не трогаем.
	if (!id) return { status: 'foreign', id: null };
	if (coverAlreadyDone(url)) return { status: 'skipped', id };

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Не удалось скачать обложку (${response.status}): ${url}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());

	await mkdir(EPISODE_COVER_DIR, { recursive: true });

	let outBytes = 0;
	for (const width of EPISODE_COVER_WIDTHS) {
		const info = await sharp(buffer)
			.resize({ width, withoutEnlargement: true })
			.webp({ quality: QUALITY })
			.toFile(outPathFor(id, width));
		outBytes += info.size;
	}

	return { status: 'done', id, sourceBytes: buffer.length, outBytes };
}
