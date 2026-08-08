import { readdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_WIDTHS, isOptimizableImage, getOgVariantSrc } from '../lib/imageVariants.mjs';

const UPLOADS_DIR = 'images/uploads';

/** Ширина jpeg-копии для превью в соцсетях. */
const OG_WIDTH = 1200;

/**
 * Собрать весь html готовой сборки в одну строку — по ней проверяем, на какие
 * картинки реально ссылаются страницы.
 */
async function readBuiltHtml(dir) {
	const root = fileURLToPath(dir);
	let html = '';

	async function walk(current) {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.name.endsWith('.html')) html += await readFile(full, 'utf8');
		}
	}

	await walk(root);
	return html;
}

/**
 * Картинки, вставленные прямо в текст поста (блок "Изображение с подписью",
 * галерея), лежат в public/images/uploads и Astro их не трогает — она
 * оптимизирует только то, что проходит через её собственный <Image>
 * (обложки постов). После сборки сжимаем их сами: два webp-размера
 * (телефон/десктоп, см. src/lib/imageVariants.mjs) вместо оригинала —
 * иначе на сайт уезжали бы исходники в несколько мегабайт как есть.
 */
export default function optimizeUploadsIntegration() {
	return {
		name: 'optimize-uploaded-images',
		hooks: {
			'astro:build:done': async ({ dir, logger }) => {
				const uploadsUrl = new URL(`${UPLOADS_DIR}/`, dir);
				let entries;

				try {
					entries = await readdir(uploadsUrl);
				} catch {
					return; // в этой сборке никто не вставлял картинки в текст
				}

				// На какие jpeg-копии для превью ссылаются готовые страницы.
				// Делаем только их, а не по копии на каждую загрузку: файл третий
				// при правиле «два размера» в CLAUDE.md, и плодить его почём зря
				// незачем. Сейчас такая копия нужна ровно одной картинке.
				const builtHtml = await readBuiltHtml(dir);

				let converted = 0;
				let ogCopies = 0;

				for (const entry of entries) {
					if (!isOptimizableImage(entry)) continue;

					const ext = path.extname(entry);
					const base = entry.slice(0, -ext.length);
					const filePath = fileURLToPath(new URL(entry, uploadsUrl));
					const buffer = await readFile(filePath);

					for (const width of IMAGE_WIDTHS) {
						const outPath = fileURLToPath(new URL(`${base}-${width}w.webp`, uploadsUrl));
						await sharp(buffer)
							.resize({ width, withoutEnlargement: true })
							.webp({ quality: 80 })
							.toFile(outPath);
					}

					// Копия для превью — до удаления оригинала, из него же.
					//
					// Ищем ПОЛНЫЙ путь, ровно как его пишет страница. Проверка
					// по одному имени файла не годится: имена вкладываются друг
					// в друга. Первый заход искал «5-og.jpg» и находил его внутри
					// «photo_2026-08-05 17.48.25-og.jpg» — копия создавалась лишняя.
					const ogName = `${base}-og.jpg`;
					const ogHref = getOgVariantSrc(`/${UPLOADS_DIR}/${entry}`);
					if (builtHtml.includes(ogHref)) {
						await sharp(buffer)
							.resize({ width: OG_WIDTH, withoutEnlargement: true })
							.jpeg({ quality: 82 })
							.toFile(fileURLToPath(new URL(ogName, uploadsUrl)));
						ogCopies += 1;
					}

					await unlink(filePath);
					converted += 1;
				}

				if (converted > 0) {
					const tail = ogCopies > 0 ? `, из них ${ogCopies} с jpeg-копией для превью` : '';
					logger.info(`Сжал ${converted} картинок из ${UPLOADS_DIR} в webp (по 2 размера)${tail}`);
				}

				// Обложки выпусков: jpeg-копия для превью в соцсетях.
				//
				// Делается из УЖЕ СКАЧАННОЙ webp-копии в public/episodes/ —
				// с хостинга подкаста заново ничего не тянется. Только для тех
				// выпусков, чьи страницы реально собрались (то есть опубликованных):
				// у архива под полторы сотни обложек, и копия каждой была бы
				// полутора сотнями файлов впустую.
				//
				// Зачем вообще своя копия, если на хостинге лежит jpeg, —
				// см. getEpisodeCoverOgSrc в src/lib/episodeCover.mjs.
				const episodesUrl = new URL('episodes/', dir);
				let episodeOg = 0;

				for (const match of builtHtml.matchAll(/\/episodes\/([\w-]+)-og\.jpg/g)) {
					const id = match[1];
					const outPath = fileURLToPath(new URL(`${id}-og.jpg`, episodesUrl));
					if (existsSync(outPath)) continue; // уже сделали на этой сборке

					// Берём копию покрупнее: 1280 px, из неё 1200 получится без
					// растягивания.
					const sourcePath = fileURLToPath(new URL(`${id}-1280w.webp`, episodesUrl));
					if (!existsSync(sourcePath)) {
						logger.warn(`Обложка выпуска для превью не собрана, нет файла: episodes/${id}-1280w.webp`);
						continue;
					}

					await sharp(await readFile(sourcePath))
						.resize({ width: OG_WIDTH, withoutEnlargement: true })
						.jpeg({ quality: 82 })
						.toFile(outPath);
					episodeOg += 1;
				}

				if (episodeOg > 0) {
					logger.info(`Сделал ${episodeOg} jpeg-обложек выпусков для превью в соцсетях`);
				}

				// Ссылка на картинку, которой нет. Так бывает, если файл удалили
				// из медиатеки, а пост на него ещё ссылается, или если путь
				// правили руками. Сборку не роняем — но и молчать нельзя: в ленте
				// это дыра на месте обложки, и заметить её можно только глазами.
				// (CLAUDE.md: ломаться громко лучше, чем тихо врать.)
				const missing = new Set();
				for (const match of builtHtml.matchAll(/\/images\/uploads\/([^"'\s>]+?\.(?:webp|jpg))/g)) {
					const name = decodeURIComponent(match[1]);
					if (!existsSync(fileURLToPath(new URL(name, uploadsUrl)))) missing.add(name);
				}

				for (const name of missing) {
					logger.warn(`Пост ссылается на картинку, которой нет: ${UPLOADS_DIR}/${name}`);
				}
			},
		},
	};
}
