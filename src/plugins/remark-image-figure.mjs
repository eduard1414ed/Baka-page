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
 */
export default function remarkImageFigure() {
	return (tree) => {
		visit(tree, (node) => {
			if (!Array.isArray(node.children)) return;

			const newChildren = [];
			let run = [];

			const flushRun = () => {
				if (run.length === 0) return;
				if (run.length === 1) {
					run[0].node.data = singleFigureData(run[0].item);
					newChildren.push(run[0].node);
				} else {
					run[0].node.data = groupFigureData(run.map((r) => r.item));
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
	};
}
