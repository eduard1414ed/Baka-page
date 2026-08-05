// Значения атрибутов приходят экранированными из админки (см. public/admin/index.html) —
// та же логика, что и в remark-image-figure.mjs.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

// Длина скрытого текста (считая только реальные буквы, без markdown-разметки) —
// нужна, чтобы плашка-заглушка была той же ширины, что и спрятанный текст.
function textLength(nodes) {
	let length = 0;
	for (const node of nodes) {
		if (node.type === 'text') length += node.value.length;
		else if (Array.isArray(node.children)) length += textLength(node.children);
	}
	return length;
}

function blockSpoilerNode(buttonLabel, contentChildren) {
	return {
		type: 'spoiler',
		children: [
			{
				type: 'spoilerButton',
				children: [],
				data: {
					hName: 'button',
					hProperties: { type: 'button', class: 'spoiler-toggle' },
					hChildren: [{ type: 'text', value: buttonLabel }],
				},
			},
			{
				type: 'spoilerContent',
				children: contentChildren,
				data: { hName: 'template', hProperties: { class: 'spoiler-content' } },
			},
		],
		data: { hName: 'div', hProperties: { class: 'spoiler' } },
	};
}

// Инлайн-вариант — сплошная цветная плашка нужной ширины вместо кнопки с текстом,
// раскрывается на том же месте (см. .spoiler-inline в [slug].astro).
function inlineSpoilerNode(contentChildren) {
	const length = textLength(contentChildren) || 1;

	return {
		type: 'spoiler',
		children: [
			{
				type: 'spoilerButton',
				children: [],
				data: {
					hName: 'button',
					hProperties: {
						type: 'button',
						class: 'spoiler-toggle',
						style: `width:${length}ch`,
						'aria-label': 'Показать скрытый текст',
					},
					hChildren: [],
				},
			},
			{
				type: 'spoilerContent',
				children: contentChildren,
				data: { hName: 'template', hProperties: { class: 'spoiler-content' } },
			},
		],
		data: { hName: 'span', hProperties: { class: 'spoiler spoiler-inline' } },
	};
}

/**
 * Два способа спрятать содержимое до клика — оба в <template> (не рендерится и
 * не читается поисковиком, пока не нажать — раскрывается через JS в [slug].astro):
 *
 * 1. Блок: `::spoiler-start{label="..."}` ... абзацы/картинки/галерея ...
 *    `::spoiler-end{}` — два отдельных маркера вместо пары "открылось-закрылось"
 *    в одном блоке, потому что многострочные блоки в CMS ненадёжны (см. историю
 *    с галереей).
 * 2. Слово/фраза внутри предложения: `:spoiler-inline[скрытый текст]{}` —
 *    один компонент, содержимое прямо в квадратных скобках.
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
					newChildren.push(blockSpoilerNode(label, captured));
					capturing = false;
					captured = [];
					continue;
				}

				if (!capturing && child.type === 'textDirective' && child.name === 'spoiler-inline') {
					newChildren.push(inlineSpoilerNode(child.children ?? []));
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
