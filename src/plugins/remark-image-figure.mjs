import { visit } from 'unist-util-visit';
import { getImageVariantSrcs } from '../lib/imageVariants.mjs';

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
 * Экспортируется ради проверки: случай «галерея занимает несколько номеров»
 * в живых данных пока не возникает (общая подпись у галереи появится в части 9),
 * а проверить его надо сейчас — иначе диапазоны и ведущий ноль останутся
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

// Несколько блоков "изображение с подписью" подряд, без текста между ними,
// автоматически становятся одной галереей: сеткой (до 5 картинок) или
// каруселью со стрелочками (больше 5). У каждой картинки — своя подпись.
function groupFigureData(items) {
	const isCarousel = items.length > CAROUSEL_THRESHOLD;

	const sizes = isCarousel ? '(max-width: 700px) 100vw, 700px' : '(max-width: 700px) 50vw, 350px';

	const itemNodes = items.map((item) => {
		const children = [buildLink(item, sizes)];
		const caption = buildCaption(item);
		if (caption) children.push(caption);
		return { type: 'element', tagName: 'div', properties: { class: isCarousel ? 'carousel-slide' : 'gallery-item' }, children };
	});

	const body = isCarousel
		? {
				type: 'element',
				tagName: 'div',
				properties: { class: 'carousel-viewport' },
				children: [
					{ type: 'element', tagName: 'div', properties: { class: 'carousel-track' }, children: itemNodes },
					{
						type: 'element',
						tagName: 'button',
						properties: { type: 'button', class: 'carousel-prev', 'aria-label': 'Предыдущее изображение' },
						children: [text('‹')],
					},
					{
						type: 'element',
						tagName: 'button',
						properties: { type: 'button', class: 'carousel-next', 'aria-label': 'Следующее изображение' },
						children: [text('›')],
					},
				],
			}
		: { type: 'element', tagName: 'div', properties: { class: 'gallery-grid' }, children: itemNodes };

	return { hName: 'figure', hProperties: { class: isCarousel ? 'figure gallery gallery-carousel' : 'figure gallery' }, hChildren: [body] };
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
	return (tree) => {
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
					run[0].node.data = groupFigureData(run.map((r) => r.item));
					// Общей подписи у галереи пока нет — она появится в части 9
					// вместе с самой галереей, и тогда галерея начнёт занимать
					// столько номеров, сколько в ней картинок, подписываясь
					// диапазоном. Счётчик это уже умеет: `images` он прибавляет
					// целиком, а не по единице.
					units.push({ figcaption: null, images: run.length, captioned: false });
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
