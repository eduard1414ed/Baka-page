import { visit } from 'unist-util-visit';

// См. remark-image-figure.mjs — та же логика экранирования кавычки в подписи.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

const CAROUSEL_THRESHOLD = 5;

/**
 * `::gallery{caption="..." items="<base64 JSON>"}` → <figure class="figure gallery">.
 * items — base64 от JSON-массива путей к картинкам (без вложенных объектов и без
 * многострочного разбора блока в CMS — там были баги именно с этим).
 * Пять картинок и меньше — сетка в две колонки. Больше пяти — карусель с
 * перелистыванием (см. .carousel-prev/.carousel-next в src/pages/posts/[slug].astro).
 */
export default function remarkGallery() {
	return (tree) => {
		visit(tree, 'leafDirective', (node) => {
			if (node.name !== 'gallery') return;

			const attrs = node.attributes ?? {};
			if (!attrs.items) return;

			let items;
			try {
				items = JSON.parse(Buffer.from(attrs.items, 'base64').toString('utf-8'));
			} catch {
				return;
			}
			if (!Array.isArray(items)) return;

			const srcs = items.filter((src) => typeof src === 'string' && src);
			if (srcs.length === 0) return;

			const caption = unescapeAttr(attrs.caption);
			const isCarousel = srcs.length > CAROUSEL_THRESHOLD;

			const slideNodes = srcs.map((src) => ({
				type: 'element',
				tagName: 'a',
				properties: { href: src, class: isCarousel ? 'figure-zoom carousel-slide' : 'figure-zoom' },
				children: [
					{
						type: 'element',
						tagName: 'img',
						properties: { src, alt: caption, loading: 'lazy' },
						children: [],
					},
				],
			}));

			const bodyNode = isCarousel
				? {
						type: 'element',
						tagName: 'div',
						properties: { class: 'carousel-viewport' },
						children: [
							{ type: 'element', tagName: 'div', properties: { class: 'carousel-track' }, children: slideNodes },
							{
								type: 'element',
								tagName: 'button',
								properties: { type: 'button', class: 'carousel-prev', 'aria-label': 'Предыдущее изображение' },
								children: [{ type: 'text', value: '‹' }],
							},
							{
								type: 'element',
								tagName: 'button',
								properties: { type: 'button', class: 'carousel-next', 'aria-label': 'Следующее изображение' },
								children: [{ type: 'text', value: '›' }],
							},
						],
					}
				: { type: 'element', tagName: 'div', properties: { class: 'gallery-grid' }, children: slideNodes };

			const figureChildren = [bodyNode];
			if (caption) {
				figureChildren.push({
					type: 'element',
					tagName: 'figcaption',
					properties: {},
					children: [{ type: 'text', value: caption }],
				});
			}

			node.data = {
				hName: 'figure',
				hProperties: { class: isCarousel ? 'figure gallery gallery-carousel' : 'figure gallery' },
				hChildren: figureChildren,
			};
		});
	};
}
