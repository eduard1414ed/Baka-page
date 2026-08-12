import { readdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { IMAGE_WIDTHS, isOptimizableImage, getOgVariantSrc, isWantedByPages, collectUploadRefs, variantBase } from '../lib/imageVariants.mjs';
import { OG_BACKGROUND } from '../lib/ogImage.mjs';

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
 *
 * СЖИМАЕМ ТОЛЬКО ТО, ЧТО КТО-ТО ПРОСИТ. Загрузок в репозитории 1233, а ссылок
 * на них у собранных страниц — семь десятков: остальные принадлежат черновикам,
 * а у черновика страницы нет вовсе, и его картинку не запросит никто. Пока
 * загрузок было полсотни, разница не читалась; на архиве это 92 секунды из 128
 * при КАЖДОЙ сборке — то есть три минуты ожидания у заказчика вместо минуты
 * после каждого сохранения в админке, — и две с лишним тысячи файлов, съедающих
 * лимит в 20 000. Опубликуете черновик — его копии сделает следующая сборка.
 *
 * ЛИШНИЙ ОРИГИНАЛ ВСЁ РАВНО УДАЛЯЕТСЯ: не сделать копий и оставить исходник —
 * это отправить на сайт 149 МБ полновесных фотографий вместо ничего.
 *
 * ЧТО ЭТО ЛОМАЕТ, ЕСЛИ СЛОМАЕТСЯ: на живой странице дыра вместо картинки.
 * Ловит это проверка в конце хука — она ищет в собранных страницах все ссылки
 * на загрузки и говорит про каждую, которой нет файла. Она стояла тут и раньше,
 * теперь на ней держится вся эта экономия.
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

				// Что вообще просят страницы — считается ОДИН раз. Спрашивать
				// у самой разметки поиском подстроки нельзя: она весит 22 МБ,
				// а вопросов к ней три на каждую из 1232 загрузок.
				const refs = collectUploadRefs(builtHtml, `/${UPLOADS_DIR}/`);

				let converted = 0;
				let ogCopies = 0;
				let unused = 0;
				// Копии для превью у картинок, которые сами остаются как есть.
				let asIsOg = 0;

				for (const entry of entries) {
					// Формат, который мы не пережимаем (webp, gif, svg). Страница
					// показывает такой файл КАК ЕСТЬ — coverSrcs отдаёт исходный
					// путь, — и webp-копий у него никто не просит. А вот jpeg-копия
					// для превью нужна ровно так же: телеграм webp разворачивает
					// ненадёжно, и без этой копии ссылка на пост разворачивалась
					// с общей картинкой сайта вместо его обложки. Наступили
					// 13 августа 2026 на двух опубликованных обзорах, чьи обложки
					// загружены в админку в webp; сборка честно ругалась
					// «ссылается на картинку, которой нет», а исправить это
					// было нечем: до сжатия такой файл не доходил вовсе.
					if (!isOptimizableImage(entry)) {
						const href = `/${UPLOADS_DIR}/${entry}`;
						if (!refs.has(getOgVariantSrc(href))) continue;

						const filePath = fileURLToPath(new URL(entry, uploadsUrl));
						const outName = `${variantBase(entry)}-og.jpg`;

						// Оригинал остаётся лежать: на него ссылается сама
						// страница. Это отличие от jpeg и png, которые после
						// снятия копий удаляются.
						await sharp(await readFile(filePath))
							.resize({ width: OG_WIDTH, withoutEnlargement: true })
							.flatten({ background: OG_BACKGROUND })
							.jpeg({ quality: 82 })
							.toFile(fileURLToPath(new URL(outName, uploadsUrl)));
						asIsOg += 1;
						continue;
					}

					// Имя копий считает ОДНА функция на обе стороны: страница
					// просит файл по этому имени (getImageVariantSrcs), сборка
					// его по нему же создаёт. Своя формула здесь означала бы,
					// что однажды страница попросит один файл, а сборка сделает
					// другой, — и картинка пропадёт молча, без единой ошибки.
					const base = variantBase(entry);
					const filePath = fileURLToPath(new URL(entry, uploadsUrl));

					// Копия для превью — отдельный вопрос: у поста, чья обложка
					// видна только в превью ссылки, webp-копий может не проситься
					// вовсе. Поэтому спрашиваем про оба назначения сразу, иначе
					// такая картинка попала бы в «никому не нужные» и пропала.
					const href = `/${UPLOADS_DIR}/${entry}`;
					const needsOg = refs.has(getOgVariantSrc(href));

					// Решение «нужна ли эта картинка» живёт ОДНОЙ функцией
					// в src/lib/imageVariants.mjs — там же, где считаются имена
					// копий, и там же его можно уронить подлогом
					// (scripts/image-variants.test.mjs).
					if (!isWantedByPages(href, refs)) {
						await unlink(filePath);
						unused += 1;
						continue;
					}

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
					// Ищется она ПОЛНЫМ путём (см. needsOg выше): проверка
					// по одному имени файла не годится, имена вкладываются друг
					// в друга. Первый заход искал «5-og.jpg» и находил его внутри
					// «photo_2026-08-05 17.48.25-og.jpg» — копия создавалась лишняя.
					const ogName = `${base}-og.jpg`;
					if (needsOg) {
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

				if (asIsOg > 0) {
					logger.info(`Сделал ${asIsOg} jpeg-копий для превью у картинок, которые не пережимаем (webp и подобные)`);
				}

				// Пропущенное называется вслух. Молчаливая экономия читается как
				// «сделано всё», и в тот день, когда она отрежет лишнего, никто
				// не догадается посмотреть сюда (CLAUDE.md: «no silent caps»).
				if (unused > 0) {
					logger.info(`Не трогал ${unused} картинок — на них не ссылается ни одна собранная страница (черновики). Оригиналы из сборки убраны.`);
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

					// `flatten` на бумагу обязателен, даже если исходник сейчас
					// без прозрачности: у jpeg прозрачности нет, и sharp кладёт
					// прозрачные места НА ЧЁРНОЕ. Проверено подстановкой:
					// без этой строки угол картинки выходит 53,53,53, с ней —
					// бумажный. Персонаж в телеграме пропал бы на чёрном фоне.
					await sharp(await readFile(sourcePath))
						.resize({ width: OG_WIDTH, withoutEnlargement: true })
						.flatten({ background: OG_BACKGROUND })
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
				//
				// НА НЕЙ ДЕРЖИТСЯ ЭКОНОМИЯ ВЫШЕ. Мы теперь нарочно не делаем копий
				// тому, чего никто не просит; ошибись отбор — дыра появилась бы
				// молча. Эта проверка спрашивает с другой стороны: не «кому нужно»,
				// а «что просят и чего нет».
				//
				// Спрашивается ТОТ ЖЕ набор путей, по которому шёл отбор: своя
				// вторая выборка разошлась бы с ним ровно в том случае, ради
				// которого проверка и стоит.
				const missing = new Set();
				for (const ref of refs) {
					if (!/\.(?:webp|jpg)$/.test(ref)) continue;
					const name = decodeURIComponent(ref.slice(`/${UPLOADS_DIR}/`.length));
					if (!existsSync(fileURLToPath(new URL(name, uploadsUrl)))) missing.add(name);
				}

				for (const name of missing) {
					logger.warn(`Пост ссылается на картинку, которой нет: ${UPLOADS_DIR}/${name}`);
				}
			},
		},
	};
}
