import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { OG_WIDTH, OG_HEIGHT, OG_BACKGROUND, OG_DEFAULT } from '../lib/ogImage.mjs';

/**
 * Картинки превью для соцсетей: /og/{slug}.jpg, ровно 1200×630 (тз/08, 2.4).
 *
 * ПРАВИЛО КАДРИРОВАНИЯ ОДНО: обрезаем только то, что и так шире полосы.
 * Кадр 16:9 режется по центру — потери минимальны. Квадратная обложка выпуска
 * и постер аниме вписываются целиком на бумажный фон: обрезка квадрата
 * до широкой полосы срезала бы ровно ту часть, ради которой обложку рисовали
 * (обычно название выпуска).
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
 * С какого соотношения сторон картинку можно резать: 3:2.
 *
 * Порог не 1200:630 (это 1.90), хотя правило и звучит как «обрезаем только то,
 * что и так шире». Кадр 16:9 — это 1.78, до 1.90 он не дотягивает, и при
 * буквальном пороге его вписывало бы с бумажными полями по бокам. А раздел 4
 * подготовки к реализации прямо называет 16:9 обрезкой по центру: потери
 * там 6 % высоты, зато карточка заполнена целиком.
 *
 * 3:2 — граница между «пейзажный кадр, переживёт обрезку» и «выстроенная
 * картинка, резать нельзя»: квадратная обложка выпуска (1:1) и постер
 * аниме (2:3) остаются по эту сторону и вписываются целиком.
 */
const CROP_FROM_RATIO = 3 / 2;

/**
 * Картинка → полоса 1200×630.
 *
 * Пейзажный кадр обрезаем по центру, всё остальное вписываем целиком
 * на бумажный фон. `flatten` обязателен: у jpeg нет прозрачности, и без него
 * sharp положил бы прозрачные места на чёрное, а не на бумагу.
 */
async function toSocialBanner(buffer) {
	const { width, height } = await sharp(buffer).metadata();
	const wider = width && height && width / height >= CROP_FROM_RATIO;

	return sharp(buffer)
		.resize({
			width: OG_WIDTH,
			height: OG_HEIGHT,
			fit: wider ? 'cover' : 'contain',
			position: 'centre',
			background: OG_BACKGROUND,
		})
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
		create: { width: OG_WIDTH, height: OG_HEIGHT, channels: 3, background: OG_BACKGROUND },
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
				logger.info(`Сделал ${made} картинок превью 1200×630${tail}`);

				// Список исходников — рабочий файл сборки, на сайте ему делать
				// нечего.
				await unlink(sourcesPath);
			},
		},
	};
}
