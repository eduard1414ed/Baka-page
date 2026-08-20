import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { ogSize, OG_DEFAULT_WIDTH, OG_DEFAULT_HEIGHT, OG_BACKGROUND, OG_DEFAULT } from '../lib/ogImage.mjs';

/**
 * Картинки превью для соцсетей: /og/{slug}.jpg (тз/08, 2.4).
 *
 * ПРЕВЬЮ ПОВТОРЯЕТ ФОРМУ ОБЛОЖКИ. Ни обрезки, ни полей: квадратная обложка даёт
 * квадратное превью, кадр 16:9 — превью 16:9, постер тайтла — вертикальное.
 * Меняется только масштаб, и решает его одно правило на проект — `ogSize`
 * в src/lib/ogImage.mjs, там же записано, почему пределы именно такие.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ ССЫЛКА НА ОБЛОЖКУ КАК ЕСТЬ. Ссылка на обложку
 * у хостинга подкаста в телеграме не разворачивалась вовсе, хотя отдавалась
 * с кодом 200 (см. src/lib/episodeCover.mjs). Своя копия нужного размера
 * на своём домене снимает вопрос.
 *
 * ЗАПУСКАТЬ ПОСЛЕ optimize-uploads: исходники для части превью — это как раз
 * jpeg-копии, которые тот шаг создаёт. Порядок задаётся порядком в списке
 * integrations в astro.config.mjs, Astro выполняет хуки по очереди.
 */

const SOURCES_FILE = 'og-sources.json';
const OG_DIR = 'og';

/** Логотип для общей картинки сайта. Лежит рядом с исходниками, не в public. */
const LOGO_URL = new URL('../assets/images/logo-ink.png', import.meta.url);

/** Ширина логотипа на общей картинке: примерно половина полосы. */
const LOGO_WIDTH = 620;

/** Собрать весь html сборки — по нему видно, на какие превью реально ссылаются. */
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
 * Картинка → превью её же формы.
 *
 * `fit: 'fill'` здесь не растягивает ничего: обе стороны посчитаны из размеров
 * самой картинки одним масштабом, и разойтись они могут разве что на пиксель
 * от округления. Взят он потому, что 'inside' при таком округлении оставил бы
 * картинку на пиксель меньше запрошенного, и файл перестал бы совпадать
 * с размером, который посчитало правило.
 *
 * `flatten` обязателен: у jpeg нет прозрачности, и без него sharp положил бы
 * прозрачные места НА ЧЁРНОЕ. Ровно так и вышло у бонуса про «Железобетон»
 * (обложка с прозрачным фоном, в телеграме чёрный квадрат) — правда,
 * не здесь, а в шаге, который готовит jpeg-копии загруженных картинок:
 * там `flatten` был потерян. Держим оба.
 */
async function toSocialBanner(buffer) {
	const { width, height } = await sharp(buffer).metadata();
	const size = ogSize(width, height);

	return sharp(buffer)
		.resize({ width: size.width, height: size.height, fit: 'fill' })
		.flatten({ background: OG_BACKGROUND })
		.jpeg({ quality: 82 })
		.toBuffer();
}

/** Общая картинка сайта: логотип по центру бумажного листа. */
async function buildDefaultBanner() {
	if (!existsSync(fileURLToPath(LOGO_URL))) {
		// Громко, а не тихо: без этого файла превью ломается у КАЖДОЙ страницы,
		// у которой нет своей картинки, — то есть почти у всех.
		throw new Error(`Не найден логотип для картинки превью: ${fileURLToPath(LOGO_URL)}`);
	}

	const logo = await sharp(await readFile(fileURLToPath(LOGO_URL)))
		.resize({ width: LOGO_WIDTH })
		.toBuffer();

	return sharp({
		create: { width: OG_DEFAULT_WIDTH, height: OG_DEFAULT_HEIGHT, channels: 3, background: OG_BACKGROUND },
	})
		.composite([{ input: logo, gravity: 'centre' }])
		.jpeg({ quality: 86 })
		.toBuffer();
}

export default function ogImagesIntegration() {
	return {
		name: 'og-images',
		hooks: {
			'astro:build:done': async ({ dir, logger }) => {
				const ogDir = new URL(`${OG_DIR}/`, dir);
				await mkdir(fileURLToPath(ogDir), { recursive: true });

				// Общая картинка нужна всегда: на неё ссылается всё, у чего нет
				// своей обложки, — главная, поиск, каталог, «О подкасте».
				const fallback = await buildDefaultBanner();
				await writeFile(fileURLToPath(new URL(path.basename(OG_DEFAULT), ogDir)), fallback);

				const sourcesPath = fileURLToPath(new URL(SOURCES_FILE, dir));
				if (!existsSync(sourcesPath)) {
					logger.warn(`Нет ${SOURCES_FILE}: превью материалов не сделаны, у всех будет общая картинка`);
					return;
				}

				const sources = JSON.parse(await readFile(sourcesPath, 'utf8'));
				const builtHtml = await readBuiltHtml(dir);

				let made = 0;
				let fellBack = 0;

				for (const { og, source } of sources) {
					// Только то, на что реально ссылаются собранные страницы.
					// Тот же приём, что у обложек выпусков в optimize-uploads:
					// иначе на архиве в полторы сотни постов сюда посыпались бы
					// файлы для страниц, которых не существует.
					if (!builtHtml.includes(og)) continue;

					const outPath = fileURLToPath(new URL(path.basename(og), ogDir));

					// Исходник ищем в готовой сборке. Картинка с чужого сервера
					// (обложка совсем свежего выпуска, которую робот ещё не скачал)
					// сюда не годится: за ней пришлось бы лезть в сеть во время
					// сборки, а сборка от чужого домена не должна зависеть.
					const local = source.startsWith('http')
						? null
						: fileURLToPath(new URL(`.${decodeURIComponent(source)}`, dir));

					if (!local || !existsSync(local)) {
						// Не молчим и не оставляем битую ссылку: кладём общую
						// картинку под именем этого материала. Страница ссылается
						// на существующий файл, превью не пустое, а строчка в логе
						// говорит, что картинка не своя.
						await writeFile(outPath, fallback);
						logger.warn(`Превью ${og}: исходник недоступен (${source}), поставил общую картинку сайта`);
						fellBack += 1;
						continue;
					}

					await writeFile(outPath, await toSocialBanner(await readFile(local)));
					made += 1;
				}

				const tail = fellBack > 0 ? `, ещё ${fellBack} с общей картинкой` : '';
				logger.info(`Сделал ${made} картинок превью, каждая в форме своей обложки${tail}`);

				// Список исходников — рабочий файл сборки, на сайте ему делать
				// нечего.
				await unlink(sourcesPath);
			},
		},
	};
}
