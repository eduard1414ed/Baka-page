// Значения атрибутов приходят экранированными из админки (см. public/admin/index.html) —
// та же логика, что и в remark-image-figure.mjs.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

/**
 * `::spoiler-start{label="..."}` ... произвольный markdown (текст, наши блоки
 * картинки/галереи) ... `::spoiler-end{}` → один <div class="spoiler"> с кнопкой
 * и спрятанным в <template> содержимым (не рендерится и не читается поисковиком,
 * пока пользователь не нажмёт — раскрывается только через JS, см. [slug].astro).
 *
 * Два отдельных маркера вместо одной пары "открылось-закрылось" в редакторе —
 * потому что многострочные блоки в CMS ненадёжны (см. историю с галереей).
 */
export default function remarkSpoiler() {
	return (tree) => {
		const walk = (node) => {
			if (!Array.isArray(node.children)) return;

			const newChildren = [];
			let capturing = false;
			let label = 'Показать спойлер';
			let captured = [];

			for (const child of node.children) {
				if (!capturing && child.type === 'leafDirective' && child.name === 'spoiler-start') {
					capturing = true;
					label = unescapeAttr(child.attributes?.label) || 'Показать спойлер';
					captured = [];
					continue;
				}

				if (capturing && child.type === 'leafDirective' && child.name === 'spoiler-end') {
					newChildren.push({
						type: 'spoiler',
						children: [
							{
								type: 'spoilerButton',
								children: [],
								data: {
									hName: 'button',
									hProperties: { type: 'button', class: 'spoiler-toggle' },
									hChildren: [{ type: 'text', value: label }],
								},
							},
							{
								type: 'spoilerContent',
								children: captured,
								data: { hName: 'template', hProperties: { class: 'spoiler-content' } },
							},
						],
						data: { hName: 'div', hProperties: { class: 'spoiler' } },
					});
					capturing = false;
					captured = [];
					continue;
				}

				walk(child);

				if (capturing) {
					captured.push(child);
					continue;
				}

				newChildren.push(child);
			}

			// Забыли закрывающий маркер — просто ничего не прячем, чтобы контент не исчез.
			if (capturing) newChildren.push(...captured);

			node.children = newChildren;
		};

		walk(tree);
	};
}
