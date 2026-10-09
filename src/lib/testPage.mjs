// Данные теста для его страницы (сессия «Тесты-3»). Правила — тз/ТЗ-тесты.md,
// вид — тз/макеты-тесты.html.
//
// Здесь только ПОДГОТОВКА: разметить строки из шапки файла, узнать пропорции
// картинок, собрать адреса. Рисует компонент src/components/Quiz.astro,
// правила теста (ровно один верный, диапазоны и т. п.) проверяет
// scripts/check-quizzes.mjs ДО сборки. Здесь их второй раз не проверяем
// и ничего молча не чиним: страница обязана пережить кривой черновик, а
// говорить о кривизне — дело проверки.
//
// ПУСТОТА ИЗ АДМИНКИ — НОРМА: `image: ''`, `posts: []`, `from: null`,
// `reply: ''`. Схема (src/content.config.ts, testSchema) приводит её
// к отсутствию, а тут каждое поле ещё раз читается с запасом.
import { join } from 'node:path';
import sharp from 'sharp';
import { getImageVariantSrcs, isOptimizableImage } from './imageVariants.mjs';
import { renderMarkdownString } from './markdownString.mjs';
import { slugify } from './slug.mjs';

/**
 * Пропорция картинки (ширина / высота) — у самого файла.
 *
 * Нужна ряду картинок вопроса: у каждой доля в ряду равна её пропорции,
 * тогда все в ряду одной высоты и ничего не режется (журнал Тесты-М).
 *
 * Путь — от папки проекта, а не от `import.meta.url`: этот файл зовёт
 * страница, а код страниц сборщик перекладывает в другое место (урок
 * CLAUDE.md про `import.meta.url` в src/lib/). Картинки нет на диске
 * или она с чужого сервера — `null`, и страница возьмёт квадрат: ронять
 * сборку всего сайта из-за одной пропорции нельзя.
 */
async function imageRatio(src) {
	if (!src || /^https?:\/\//.test(src)) return null;
	try {
		const path = join(process.cwd(), 'public', decodeURIComponent(src));
		const { width, height } = await sharp(path).metadata();
		return width > 0 && height > 0 ? width / height : null;
	} catch {
		return null;
	}
}

/**
 * Адрес картинки для страницы.
 *
 * НА САЙТЕ — две сжатые копии, как у любой картинки в тексте (640 и 1280,
 * правило CLAUDE.md «максимум два размера»); копии делает сборка по ссылкам
 * в готовых страницах (src/plugins/optimize-uploads-integration.mjs).
 *
 * В РЕЖИМЕ РАЗРАБОТКИ — оригинал. Копии там не делаются вовсе, а черновик
 * теста только там и виден: со ссылкой на копию картинка вышла бы битой.
 */
function imageSrcs(src, dev) {
	if (dev || /^https?:\/\//.test(src) || !isOptimizableImage(src)) return { src, srcset: null };
	const variants = getImageVariantSrcs(src);
	return { src: variants[0].src, srcset: variants.map((v) => `${v.src} ${v.width}w`).join(', ') };
}

async function image(raw, dev) {
	const src = String(raw?.src ?? '').trim();
	if (!src) return null;
	// `file` — путь к оригиналу в public/: из него сборка рисует превью
	// страницы результата (src/plugins/og-test-card.mjs), а `src` на сайте —
	// уже сжатая копия.
	return { ...imageSrcs(src, dev), file: src, alt: String(raw?.alt ?? '').trim(), ratio: await imageRatio(src) };
}

/** Адреса тайтлов, на которые ведут ссылки в готовой разметке. Тот же образец,
    что у марки при наведении (AnimeHoverCard.astro): ей эти адреса и нужны. */
function animeLinks(html) {
	return [...html.matchAll(/href="\/anime\/([a-z0-9-]+)/g)].map((m) => m[1]);
}

/**
 * Врезки «Наш материал» под результатом — ТЕМ ЖЕ КОДОМ, что `::material`
 * в статье: размечаем ровно такой блок, и вид у них не может разойтись.
 *
 * Только на опубликованное: врезка на черновик вела бы в никуда. Такой
 * адрес не ставим и говорим об этом в лог сборки — молча терять ссылку,
 * которую автор выбрал, нельзя.
 */
async function postRefsHtml(ids, publishedIds, where) {
	const parts = [];
	for (const id of ids) {
		if (!publishedIds.has(id)) {
			console.warn(`[тест] ${where}: материала «${id}» на сайте нет (черновик, удалён или переименован) — врезку не ставим. Выберите материал заново в админке.`);
			continue;
		}
		parts.push(await renderMarkdownString(`::material{id="${id}"}`));
	}
	return parts.join('');
}

/**
 * @param {{ id: string, data: Record<string, any> }} post
 * @param {{ dev: boolean, publishedIds: Set<string>, postRefs?: boolean }} options
 *   `postRefs: false` — врезки «ещё по теме» не размечать: странице
 *   результата они не нужны (ТЗ §5), а лог сборки повторил бы строку
 *   про битую врезку, уже сказанную страницей теста.
 */
export async function prepareTest(post, { dev, publishedIds, postRefs = true }) {
	const test = post.data.test ?? {};
	const kind = test.kind?.type === 'personality' ? 'personality' : 'quiz';
	const rawQuestions = test.kind?.questions ?? [];
	const total = rawQuestions.length;

	// Тайтлы, упомянутые ссылкой в пояснениях и результатах. Марка при
	// наведении знает только тайтлы из списка страницы — без этого ссылка
	// в пояснении осталась бы без марки (решение заказчика: марки на странице
	// теста показываются, ТЗ §2).
	const animeInText = new Set();

	const questions = [];
	for (const [index, q] of rawQuestions.entries()) {
		const explanationHtml = kind === 'quiz' ? await renderMarkdownString(q.explanation) : '';
		animeLinks(explanationHtml).forEach((id) => animeInText.add(id));

		questions.push({
			n: index + 1,
			text: String(q.text ?? '').trim(),
			images: (await Promise.all((q.images ?? []).slice(0, 4).map((raw) => image(raw, dev)))).filter(Boolean),
			options: (q.options ?? []).map((o) => ({
				text: String(o.text ?? '').trim(),
				correct: kind === 'quiz' && o.correct === true,
				reply: kind === 'personality' ? String(o.reply ?? '').trim() : '',
				// «Баллы» — заголовки результатов; странице нужны их АДРЕСА: по
				// адресу скрипт находит шаблон результата (Quiz.astro). Адрес —
				// тем же правилом, что у самого результата ниже, иначе
				// «Ферн» в баллах и «Ферн» в результатах разошлись бы.
				scores:
					kind === 'personality'
						? (o.scores ?? []).map((title) => slugify(String(title).trim())).filter(Boolean)
						: [],
			})),
			explanationHtml,
		});
	}

	const results = [];
	for (const r of test.results ?? []) {
		const title = String(r.title ?? '').trim();
		if (!title) continue; // без заголовка нет адреса; о нём говорит проверка тестов
		const textHtml = await renderMarkdownString(r.text);
		// Тайтлы ссылок в тексте ЭТОГО результата — марке страницы результата.
		const textAnime = [...new Set(animeLinks(textHtml))];
		textAnime.forEach((id) => animeInText.add(id));
		results.push({
			slug: slugify(title),
			title,
			image: await image({ src: r.image, alt: '' }, dev),
			textHtml,
			from: typeof r.from === 'number' ? r.from : null,
			to: typeof r.to === 'number' ? r.to : null,
			postsHtml: postRefs
				? await postRefsHtml(
						(r.posts ?? []).map((id) => String(id).trim()).filter(Boolean),
						publishedIds,
						`${post.id}, результат «${title}»`,
					)
				: '',
			textAnime,
			anime: (r.anime ?? []).map((id) => String(id).trim()).filter(Boolean),
		});
	}

	return { kind, total, questions, results, animeInText };
}
