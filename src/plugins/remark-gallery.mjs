import { visit } from 'unist-util-visit';

// См. remark-image-figure.mjs — та же логика экранирования кавычки в подписи.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

/**
 * `::gallery{caption="..." items="<base64 JSON>"}` → <figure class="figure gallery">
 * со списком картинок в сетке и общей подписью. Список картинок кодирован в base64,
 * чтобы не зависеть от многострочного разбора блоков в CMS (там были баги с этим).
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
			if (!Array.isArray(items) || items.length === 0) return;

			const caption = unescapeAttr(attrs.caption);

			const imageChildren = items
				.filter((item) => item && item.src)
				.map((item) => ({
					type: 'element',
					tagName: 'a',
					properties: { href: item.src, class: 'figure-zoom' },
					children: [
						{
							type: 'element',
							tagName: 'img',
							properties: { src: item.src, alt: item.alt ?? '', loading: 'lazy' },
							children: [],
						},
					],
				}));

			if (imageChildren.length === 0) return;

			const figureChildren = [
				{ type: 'element', tagName: 'div', properties: { class: 'gallery-grid' }, children: imageChildren },
			];

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
				hProperties: { class: 'figure gallery' },
				hChildren: figureChildren,
			};
		});
	};
}
