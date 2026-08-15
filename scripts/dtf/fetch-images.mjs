// Картинки статьи DTF → сжатые копии в public/images/uploads/.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ СКРИПТОМ, А НЕ ВНУТРИ СБОРЩИКА. Сборщик пересобирается
// после каждой правки текста, а качать одни и те же мегабайты по десять раз
// незачем: у уже лежащего файла работы нет. Плюс скачивание — единственный
// шаг тут, который ходит в чужую сеть, и падать он умеет отдельно от разбора.
//
// КАЧАЕМ ОРИГИНАЛ, БЕЗ ХВОСТА `-/scale_crop/…`: с хвостом leonardo отдаёт
// уменьшенную копию, и в пост уехал бы кадр хуже, чем на DTF. Сжимаем ТЕМ ЖЕ
// правилом, которым сжимает админка при вставке (webp, качество 85, вписать
// в 2048, не увеличивать) — иначе перенесённые картинки отличались бы
// от вставленных руками, и отличие было бы невидимым до первой сверки.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { fetchArticle, uploadsPath, ПАУЗЫ } from './source.mjs';
// Вторая копия «повтора при сбое сети» жила здесь — со своим циклом и своим,
// уже разошедшимся с домом списком сетевых бед (доревизия задачи 15,
// находка 27). Дом один: `scripts/retry.mjs`.
import { сПовторами } from '../retry.mjs';

/**
 * Скачать все картинки статьи и положить сжатыми под именем `<prefix>-NN.webp`.
 *
 * ПОВТОРЯЕМ ТОЛЬКО СЕТЕВОЕ — то же правило, что в fetchArticle: «такого файла
 * нет» повтором не лечится, а `Connect Timeout` лечится.
 *
 * @returns {Promise<Array<{file: string, src: string, caption: string}>>} по одной записи на картинку, в порядке статьи
 */
export async function fetchImages(articleId, prefix) {
	const article = await fetchArticle(articleId);
	const result = [];

	for (const block of article.blocks) {
		if (block.type !== 'media') continue;
		for (const item of block.data.items) {
			const uuid = item.image?.data?.uuid;
			if (!uuid) continue;
			const name = `${prefix}-${String(result.length + 1).padStart(2, '0')}.webp`;
			const file = uploadsPath(name);
			result.push({ file: name, src: `/images/uploads/${name}`, caption: item.title ?? '' });
			if (fs.existsSync(file)) continue;

			// Молчать нельзя: пропущенная картинка — дыра в посте, а не мелочь.
			// `сПовторами` перебрасывает последнюю ошибку наружу как есть.
			const bytes = await сПовторами(
				async () => {
					const response = await fetch(`https://leonardo.osnova.io/${uuid}/`);
					if (!response.ok) throw new Error(`HTTP ${response.status} у ${uuid}`);
					return Buffer.from(await response.arrayBuffer());
				},
				{ паузы: ПАУЗЫ, назвать: `картинку ${uuid}` },
			);

			await sharp(bytes)
				.resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
				.webp({ quality: 85 })
				.toFile(file);
			console.log(`   ${name} ← ${uuid} (${(bytes.length / 1024 / 1024).toFixed(2)} МБ → ${(fs.statSync(file).size / 1024).toFixed(0)} КБ)`);
		}
	}

	return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	const [id, prefix] = process.argv.slice(2);
	if (!id || !prefix) throw new Error('нужны номер статьи и приставка имени: node fetch-images.mjs 1805563 dtf-doloy-bezdele');
	const images = await fetchImages(Number(id), prefix);
	console.log(`картинок: ${images.length}, с подписью: ${images.filter((i) => i.caption).length}`);
}
