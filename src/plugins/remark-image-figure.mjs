import { visit } from 'unist-util-visit';

// Значения атрибутов приходят экранированными из админки (см. public/admin/index.html) —
// там кавычка ломает разбор синтаксиса директивы, поэтому её заменяют на &quot;.
// Тут — обратная замена. Обе стороны должны экранировать одинаково.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

const text = (value) => ({ type: 'text', value });

/**
 * Превращает `::image{src="..." alt="..." caption="..." width="column|full" source-label="..." source-url="..."}`
 * в <figure>: картинку-ссылку для лайтбокса (см. скрипт в src/pages/posts/[slug].astro) и подпись с источником.
 */
export default function remarkImageFigure() {
	return (tree) => {
		visit(tree, 'leafDirective', (node) => {
			if (node.name !== 'image') return;

			const attrs = node.attributes ?? {};
			const src = attrs.src;
			if (!src) return;

			const alt = unescapeAttr(attrs.alt);
			const caption = unescapeAttr(attrs.caption);
			const sourceLabel = unescapeAttr(attrs['source-label']);
			const sourceUrl = attrs['source-url'];
			const isFull = attrs.width === 'full';

			const figureChildren = [
				{
					type: 'element',
					tagName: 'a',
					properties: { href: src, class: 'figure-zoom' },
					children: [{ type: 'element', tagName: 'img', properties: { src, alt, loading: 'lazy' }, children: [] }],
				},
			];

			const captionChildren = [];
			if (caption) captionChildren.push(text(caption));
			if (sourceUrl) {
				if (caption) captionChildren.push(text(' — '));
				captionChildren.push({
					type: 'element',
					tagName: 'a',
					properties: { href: sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
					children: [text(sourceLabel || 'источник')],
				});
			}
			if (captionChildren.length) {
				figureChildren.push({ type: 'element', tagName: 'figcaption', properties: {}, children: captionChildren });
			}

			node.data = {
				hName: 'figure',
				hProperties: { class: isFull ? 'figure figure-full' : 'figure' },
				hChildren: figureChildren,
			};
		});
	};
}
