import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { visit } from 'unist-util-visit';
import { getImageVariantSrcs } from '../lib/imageVariants.mjs';

// ПРОПОРЦИЮ ПЛИТКИ ЗАДАЮТ САМИ КАДРЫ, А НЕ ЧИСЛО ИЗ СТИЛЕЙ.
//
// Раньше плитка сетки была жёстко 16:9, и вертикальные кадры резались
// пополам: у заметки про «Человека-паука» две страницы манги с пропорцией
// 0.66 показывались широкими полосками. Замер 574 картинок из 125 галерей
// архива: пропорции идут от 0.54 до 2.98, у 38 галерей ВСЕ кадры
// вертикальные, а однородных галерей подавляющее большинство — разнобой
// больше чем в 1.25 раза нашёлся только у 24.
//
// Размеры читаются у самих файлов при сборке. Кэш по пути обязателен:
// тело поста разбирается дважды (страница материала и страница тайтла),
// а картинок в архиве 574 — без него это 1148 обращений к диску.
const ratioCache = new Map();

async function imageRatio(src) {
	if (ratioCache.has(src)) return ratioCache.get(src);

	let ratio = null;
	try {
		// fileURLToPath, а не `.pathname`: в пути к проекту русские буквы,
		// и `.pathname` отдал бы их закодированными — «файла нет» про файл,
		// который есть.
		const path = fileURLToPath(new URL(`../../public${src.startsWith('/') ? src : `/${src}`}`, import.meta.url));
		const { width, height } = await sharp(path).metadata();
		if (width > 0 && height > 0) ratio = width / height;
	} catch {
		// Картинки нет на диске (её ещё не загрузили) или формат неизвестен —
		// плитка останется прежней, 16:9. Ронять сборку всего сайта из-за
		// одной пропорции нельзя.
	}

	ratioCache.set(src, ratio);
	return ratio;
}

/**
 * Пропорция плитки для галереи — МЕДИАНА пропорций её кадров.
 *
 * Медиана, а не самый широкий кадр (как у рамки постера в марке) и не самый
 * узкий: у однородной галереи — а таких подавляющее большинство — она равна
 * пропорции кадров, то есть не режет вообще ничего. У разнобойной один
 * случайный кадр не тянет за собой всю сетку: возьми мы максимум, вертикальный
 * кадр в широкой плитке потерял бы шестьдесят процентов высоты.
 *
 * Ни одного размера не прочиталось — отдаём null, и плитка остаётся 16:9.
 */
function medianRatio(items) {
	const ratios = items.map((item) => ratioCache.get(item.src)).filter((r) => typeof r === 'number' && r > 0);
	if (ratios.length === 0) return null;

	ratios.sort((a, b) => a - b);
	const middle = ratios.length / 2;
	return ratios.length % 2 === 1 ? ratios[Math.floor(middle)] : (ratios[middle - 1] + ratios[middle]) / 2;
}

// Значения атрибутов приходят экранированными из админки (см. public/admin/index.html) —
// там кавычка ломает разбор синтаксиса директивы, поэтому её заменяют на &quot;.
// Тут — обратная замена. Обе стороны должны экранировать одинаково.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

// 4 картинки и меньше — сетка, 5 и больше — карусель.
const CAROUSEL_THRESHOLD = 4;

const text = (value) => ({ type: 'text', value });

function parseImageNode(node) {
	const attrs = node.attributes ?? {};
	if (!attrs.src) return null;

	return {
		src: attrs.src,
		alt: unescapeAttr(attrs.alt),
		caption: unescapeAttr(attrs.caption),
		isFull: attrs.width === 'full',
		sourceLabel: unescapeAttr(attrs['source-label']),
		sourceUrl: attrs['source-url'],
	};
}

// Сжатые webp-версии (2 размера) появляются уже после этого шага, отдельным
// проходом по готовой сборке — см. src/plugins/optimize-uploads-integration.mjs.
// Здесь просто заранее знаем, как будут называться файлы.
function buildLink(item, sizes) {
	const variants = getImageVariantSrcs(item.src);
	const largest = variants[variants.length - 1];
	const srcset = variants.map((v) => `${v.src} ${v.width}w`).join(', ');

	return {
		type: 'element',
		tagName: 'a',
		properties: { href: largest.src, class: 'figure-zoom' },
		children: [
			{
				type: 'element',
				tagName: 'img',
				properties: {
					src: largest.src,
					srcset,
					sizes,
					alt: item.alt,
					loading: 'lazy',
					// .src после выбора браузером нужного варианта из srcset может
					// указывать не на самый крупный файл — лайтбоксу нужен именно он.
					'data-full': largest.src,
				},
				children: [],
			},
		],
	};
}

function buildCaption(item) {
	const children = [];
	if (item.caption) children.push(text(item.caption));
	if (item.sourceUrl) {
		if (item.caption) children.push(text(' — '));
		children.push({
			type: 'element',
			tagName: 'a',
			properties: { href: item.sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
			children: [text(item.sourceLabel || 'источник')],
		});
	}
	return children.length ? { type: 'element', tagName: 'figcaption', properties: {}, children } : null;
}

// ——— Сквозная нумерация иллюстраций (тз/08, раздел 5.1) ———

// Меньше двух подписанных иллюстраций — нумерации нет вовсе. Единственной
// картинке в заметке номер не нужен: ссылаться в тексте не на что,
// а «FIG. 01» в одиночку выглядит претенциозно.
const MIN_NUMBERED = 2;

/** «01», «09», «10» — ведущий ноль только до девятого номера. */
const figNumber = (n) => (n < 10 ? `0${n}` : String(n));

/**
 * Расставить номера подписям.
 *
 * @param {{ figcaption: object, images: number, captioned: boolean }[]} units
 *   Иллюстрации материала в порядке следования по тексту. `images` — сколько
 *   картинок внутри: у галереи их несколько, и она занимает столько же
 *   номеров, подписываясь диапазоном `FIG. 02–05`.
 *
 * НОМЕР ПОЛУЧАЮТ ТОЛЬКО ПОДПИСАННЫЕ ИЛЛЮСТРАЦИИ, и неподписанные в счёте
 * не участвуют. Иначе в нумерации появились бы дыры — `FIG. 01`, потом
 * `FIG. 03`, — и читатель принял бы это за ошибку вёрстки: он всё равно
 * не знает, сколько картинок между ними пропущено.
 *
 * Экспортируется ради проверки: галереи в живых данных пока подписей не имеют,
 * а диапазоны и ведущий ноль проверить надо — иначе они останутся
 * непроверенными до того дня, когда их некому будет вспомнить.
 */
export function numberFigures(units) {
	if (units.filter((unit) => unit.captioned).length < MIN_NUMBERED) return;

	let counter = 0;
	for (const unit of units) {
		if (!unit.captioned) continue;

		const from = counter + 1;
		counter += unit.images;
		// Короткое тире в диапазоне, а не дефис.
		const label = from === counter ? figNumber(from) : `${figNumber(from)}–${figNumber(counter)}`;

		// Номер — технический слой, подпись — Caption 12: это два разных слоя
		// в одной строке, поэтому номер отдельным элементом, а не текстом.
		unit.figcaption.children.unshift({
			type: 'element',
			tagName: 'b',
			properties: {},
			children: [text(`FIG. ${label} —`)],
		});
	}
}

function singleFigureData(item) {
	const sizes = item.isFull ? '100vw' : '(max-width: 700px) 100vw, 700px';
	const children = [buildLink(item, sizes)];
	const caption = buildCaption(item);
	if (caption) children.push(caption);

	return { hName: 'figure', hProperties: { class: item.isFull ? 'figure figure-full' : 'figure' }, hChildren: children };
}

/**
 * ПОДПИСЬ, ИСТОЧНИК И ССЫЛКА У ГАЛЕРЕИ ОДНИ НА ВЕСЬ БЛОК, а не у каждой
 * картинки (тз/08, §9.2). Полей под это заводить не пришлось — они у картинки
 * уже есть; берём первые заполненные.
 *
 * Если подписей несколько, лишние ПОКАЗАТЬ НЕГДЕ, и мы говорим об этом
 * в сборку: тихо потерянный текст автор не найдёт никогда.
 *
 * Альт остаётся у каждой картинки своим: это единственное, что читает вслух
 * экранный диктор, и общий на четыре картинки он не описывает ни одной.
 */
function blockCaptionItem(items, onWarn) {
	const captions = items.filter((item) => item.caption);
	const sources = items.filter((item) => item.sourceUrl);

	if (captions.length > 1) onWarn(`подписей ${captions.length}, показана первая («${captions[0].caption}»)`);
	if (sources.length > 1) onWarn(`ссылок на источник ${sources.length}, показана первая`);

	return {
		caption: captions[0]?.caption ?? '',
		sourceLabel: sources[0]?.sourceLabel ?? '',
		sourceUrl: sources[0]?.sourceUrl ?? '',
	};
}

// Несколько блоков "изображение с подписью" подряд, без текста между ними,
// автоматически становятся одной галереей: сеткой (до четырёх картинок) или
// каруселью с листанием (пять и больше). Подпись общая, см. blockCaptionItem.
//
// КАРУСЕЛЬ — ЕДИНСТВЕННОЕ МЕСТО НА САЙТЕ С ГОРИЗОНТАЛЬНЫМ СКРОЛЛОМ (§4.4),
// и скролл живёт только внутри трека. Слайд занимает всю его ширину, поэтому
// на 320 px он читается целиком и вложенного скролла внутри слайда нет.
function groupFigureData(items, onWarn) {
	const isCarousel = items.length > CAROUSEL_THRESHOLD;

	// Слайд карусели занимает всю ширину трека (до 1000), плитка сетки —
	// половину её на широком экране.
	const sizes = isCarousel ? '(max-width: 1000px) 100vw, 1000px' : '(max-width: 620px) 100vw, 500px';

	const itemNodes = items.map((item) => ({
		type: 'element',
		tagName: 'div',
		properties: { class: isCarousel ? 'gallery-slide' : 'gallery-item' },
		children: [buildLink(item, sizes)],
	}));

	const children = [];

	if (isCarousel) {
		// Технический слой над каруселью: слева подпись блока, справа счётчик.
		// Счётчик живой — его ведёт скрипт страницы; в разметке стоит первый кадр,
		// чтобы без скрипта строка не оказалась пустой.
		children.push({
			type: 'element',
			tagName: 'div',
			// В поиск шапка не идёт: «[ галерея ]01 / 06» это подпись органов
			// управления, а не текст материала, и в цитате она читалась бы мусором.
			// Подпись самой галереи стоит ниже, в figcaption, и индексируется.
			properties: { class: 'gallery-head', 'data-pagefind-ignore': '' },
			children: [
				// Скобки вокруг подписи рисует CSS (`.gallery-kicker::before`
				// в global.css) — одно правило на все подписи блоков сайта.
				// Руками их тут писать не надо, выйдут двойные.
				{ type: 'element', tagName: 'span', properties: { class: 'gallery-kicker' }, children: [text('галерея')] },
				{
					type: 'element',
					tagName: 'span',
					properties: { class: 'gallery-count' },
					children: [text(`01 / ${String(items.length).padStart(2, '0')}`)],
				},
			],
		});

		children.push({
			type: 'element',
			tagName: 'div',
			properties: { class: 'gallery-stage' },
			children: [
				{
					type: 'element',
					tagName: 'button',
					properties: {
						type: 'button',
						class: 'gallery-btn prev',
						'aria-label': 'Предыдущее изображение',
						disabled: true,
						'data-pagefind-ignore': '',
					},
					children: [text('‹')],
				},
				{ type: 'element', tagName: 'div', properties: { class: 'gallery-track' }, children: itemNodes },
				{
					type: 'element',
					tagName: 'button',
					properties: { type: 'button', class: 'gallery-btn next', 'aria-label': 'Следующее изображение', 'data-pagefind-ignore': '' },
					children: [text('›')],
				},
			],
		});
	} else {
		children.push(...itemNodes);
	}

	const caption = buildCaption(blockCaptionItem(items, onWarn));
	if (caption) children.push(caption);

	// Пропорция плитки (сетка) и рамки слайда (карусель) — от самих кадров.
	// Нет размеров — переменной нет, и стили берут запасные 16:9.
	const ratio = medianRatio(items);

	return {
		hName: 'figure',
		hProperties: {
			class: isCarousel ? 'figure gallery gallery-carousel' : 'figure gallery gallery-grid',
			...(ratio ? { style: `--tile-ratio: ${ratio.toFixed(3)}` } : {}),
		},
		hChildren: children,
	};
}

/**
 * `::image{src="..." alt="..." caption="..." width="column|full" source-label="..." source-url="..."}`
 * → <figure>. Несколько таких блоков подряд без текста между ними объединяются в одну
 * галерею (см. groupFigureData) — так проще и надёжнее, чем отдельный виджет-список
 * картинок внутри своего блока в CMS (там были проблемы с сохранением).
 *
 * Здесь же подписи получают сквозной номер по материалу — `FIG. 01 — текст`
 * (см. numberFigures). Считается при сборке, автор ничего не проставляет
 * и проставить не может: номер зависит от того, сколько картинок выше по тексту,
 * и сдвинулся бы от любой вставки.
 */
export default function remarkImageFigure() {
	return async (tree, file) => {
		// Размеры картинок читаются ДО основного прохода: он синхронный,
		// а обращение к диску — нет. Первый проход только собирает адреса.
		const srcs = new Set();
		visit(tree, 'leafDirective', (node) => {
			if (node.name === 'image' && node.attributes?.src) srcs.add(node.attributes.src);
		});
		await Promise.all([...srcs].map(imageRatio));

		const warnGallery = (what) => {
			console.warn(`[галерея] ${file?.path ?? 'пост'}: у галереи одна подпись на блок, а ${what}.`);
		};

		// Иллюстрации материала в порядке следования по тексту — для сквозной
		// нумерации подписей. Собираются за тот же проход, что и сами блоки:
		// второй обход дерева пришлось бы держать в согласии с первым.
		const units = [];

		visit(tree, (node) => {
			if (!Array.isArray(node.children)) return;

			const newChildren = [];
			let run = [];

			const flushRun = () => {
				if (run.length === 0) return;
				if (run.length === 1) {
					run[0].node.data = singleFigureData(run[0].item);
					const figcaption = run[0].node.data.hChildren.find((child) => child.tagName === 'figcaption') ?? null;
					units.push({ figcaption, images: 1, captioned: Boolean(figcaption) });
					newChildren.push(run[0].node);
				} else {
					run[0].node.data = groupFigureData(
						run.map((r) => r.item),
						warnGallery,
					);
					// Галерея занимает столько номеров, сколько в ней картинок,
					// и подписывается диапазоном — `FIG. 02–05`. Счётчик это умеет
					// с части 5: `images` он прибавляет целиком, а не по единице.
					const figcaption = run[0].node.data.hChildren.find((child) => child.tagName === 'figcaption') ?? null;
					units.push({ figcaption, images: run.length, captioned: Boolean(figcaption) });
					newChildren.push(run[0].node);
				}
				run = [];
			};

			for (const child of node.children) {
				const item = child.type === 'leafDirective' && child.name === 'image' ? parseImageNode(child) : null;

				if (item) {
					run.push({ node: child, item });
					continue;
				}

				flushRun();
				newChildren.push(child);
			}

			flushRun();
			node.children = newChildren;
		});

		numberFigures(units);
	};
}
