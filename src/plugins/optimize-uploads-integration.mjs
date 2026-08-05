import { readdir, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_WIDTHS, isOptimizableImage } from '../lib/imageVariants.mjs';

const UPLOADS_DIR = 'images/uploads';

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

				let converted = 0;

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

					await unlink(filePath);
					converted += 1;
				}

				if (converted > 0) {
					logger.info(`Сжал ${converted} картинок из ${UPLOADS_DIR} в webp (по 2 размера)`);
				}
			},
		},
	};
}
