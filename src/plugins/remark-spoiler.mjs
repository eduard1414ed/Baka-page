// Значения атрибутов приходят экранированными из админки (см. public/admin/index.html) —
// та же логика, что и в remark-image-figure.mjs.
const unescapeAttr = (value = '') => value.replaceAll('&quot;', '"');

/** Что подставляется, если автор ничего не написал. */
const DEFAULT_NOUN = 'спойлер';

/**
 * Системный глагол в начале подписи. Нужен для СТАРЫХ постов: до части 9 автор
 * писал в поле всю строку кнопки целиком («Показать спойлер»), и без этой
 * чистки вышло бы «Показать Показать спойлер».
 *
 * МЕНЯЕТЕ ТУТ — ПОПРАВЬТЕ И В public/admin/index.html: админка чистит подпись
 * тем же правилом, когда открывает старый пост на правку. Импортировать оттуда
 * отсюда нельзя, CMS не собирается вместе с сайтом.
 */
const VERB_RE = /^\s*(?:показать|скрыть|раскрыть|открыть|спрятать)(?:\s+|$)/i;

/**
 * Подпись кнопки собирается из двух частей: глагол системный, существительное
 * авторское — «Показать финал» / «Скрыть финал». Отдай мы автору всю строку,
 * подписи разъехались бы по формулировкам, и кнопка перестала бы читаться
 * как один и тот же элемент.
 *
 * @param {string} label Что записано в `label` у `::spoiler-start`.
 * @returns {string} Одно существительное.
 */
export function spoilerNoun(label) {
	const raw = String(label ?? '').trim();
	if (!raw) return DEFAULT_NOUN;

	return raw.replace(VERB_RE, '').trim() || DEFAULT_NOUN;
}

// Длина скрытого текста (считая только реальные буквы, без markdown-разметки) —
// нужна, чтобы плашка-заглушка была примерно той же ширины, что и спрятанный
// текст, ПОКА НЕ ОТРАБОТАЛ СКРИПТ. Дальше ширину задаёт сам текст, см. ниже.
function textLength(nodes) {
	let length = 0;
	for (const node of nodes) {
		if (node.type === 'text') length += node.value.length;
		else if (Array.isArray(node.children)) length += textLength(node.children);
	}
	return length;
}

const text = (value) => ({ type: 'text', value });
const el = (tagName, properties, children) => ({ type: 'element', tagName, properties, children });

function blockSpoilerNode(noun, contentChildren) {
	return {
		type: 'spoiler',
		children: [
			{
				type: 'spoilerButton',
				children: [],
				data: {
					hName: 'button',
					hProperties: { type: 'button', class: 'spoiler-toggle', 'aria-expanded': 'false' },
					// Подпись и знак — два разных слоя одной строки, поэтому два
					// элемента, а не одна строка текста: скрипт меняет их порознь.
					hChildren: [
						el('span', { class: 'label' }, [text(`Показать ${noun}`)]),
						el('span', { class: 'mark', 'aria-hidden': 'true' }, [text('+')]),
					],
				},
			},
			{
				type: 'spoilerContent',
				children: contentChildren,
				data: { hName: 'template', hProperties: { class: 'spoiler-content' } },
			},
		],
		data: {
			hName: 'div',
			hProperties: {
				class: 'spoiler',
				// Существительное нужно скрипту: он собирает из него вторую подпись
				// («Скрыть финал»), а второго места, где оно записано, быть не должно.
				'data-label': noun,
				// В поиск по сайту блок не идёт целиком — вместе с подписью кнопки.
				// Само содержимое и так лежит в <template> и в индекс не попадает.
				'data-pagefind-ignore': '',
			},
		},
	};
}

/**
 * Ссылка внутри спрятанной фразы превратилась бы в ссылку ВНУТРИ КНОПКИ:
 * такая разметка недопустима, и браузер по ней всё равно не переходит.
 * Поэтому ссылку разворачиваем в обычный текст и говорим об этом в сборку —
 * тихо терять слова нельзя, а тихо оставлять мёртвую ссылку тем более.
 *
 * Метку тайтла (`:anime[…]{…}`) к этому месту уже обработал remark-anime:
 * узел остался прежним, но получил `data.hName === 'a'`.
 */
function unlink(nodes, onWarn) {
	const result = [];

	for (const node of nodes) {
		if (Array.isArray(node.children) && node.children.length > 0) {
			node.children = unlink(node.children, onWarn);
		}

		if (node.type === 'link') {
			onWarn();
			result.push(...node.children);
			continue;
		}

		if (node.data?.hName === 'a') {
			onWarn();
			node.data = { ...node.data, hName: 'span', hProperties: {} };
		}

		result.push(node);
	}

	return result;
}

/**
 * Инлайн-вариант: слово или фраза внутри предложения.
 *
 * ТЕКСТ ЛЕЖИТ В <template>, А НЕ В КНОПКЕ. Так его не видит ни поисковый робот,
 * ни поиск по сайту (Pagefind разбирает собранную разметку, а содержимое
 * <template> в неё не входит). Скрипт страницы переносит текст внутрь кнопки
 * при загрузке — и с этого момента текст СТОИТ НА МЕСТЕ и только становится
 * видимым по нажатию: строка не прыгает и абзац не переверстывается.
 * До скрипта ширину плашки держит грубая оценка в `ch`.
 */
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
						class: 'spoiler-word',
						'aria-expanded': 'false',
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
		data: { hName: 'span', hProperties: { class: 'spoiler-inline' } },
	};
}

/**
 * Два способа спрятать содержимое до клика — оба в <template> (не рендерится и
 * не читается поисковиком, пока не нажать — раскрывается через JS в [slug].astro):
 *
 * 1. Блок: `::spoiler-start{label="финал"}` ... абзацы/картинки/галерея ...
 *    `::spoiler-end{}` — два отдельных маркера вместо пары "открылось-закрылось"
 *    в одном блоке, потому что многострочные блоки в CMS ненадёжны (см. историю
 *    с галереей).
 * 2. Слово/фраза внутри предложения: `:spoiler-inline[скрытый текст]{}` —
 *    один компонент, содержимое прямо в квадратных скобках.
 */
export default function remarkSpoiler() {
	return (tree, file) => {
		const warnLink = () => {
			console.warn(
				`[спойлер] ${file?.path ?? 'пост'}: внутри спрятанной фразы была ссылка — ` +
					'она развёрнута в обычный текст. Ссылка внутри кнопки не работает; ' +
					'если она нужна, вынесите её из спойлера.',
			);
		};

		const walk = (node) => {
			if (!Array.isArray(node.children)) return;

			const newChildren = [];
			let capturing = false;
			let noun = DEFAULT_NOUN;
			let captured = [];

			for (const child of node.children) {
				if (!capturing && child.type === 'leafDirective' && child.name === 'spoiler-start') {
					capturing = true;
					noun = spoilerNoun(unescapeAttr(child.attributes?.label));
					captured = [];
					continue;
				}

				if (capturing && child.type === 'leafDirective' && child.name === 'spoiler-end') {
					newChildren.push(blockSpoilerNode(noun, captured));
					capturing = false;
					captured = [];
					continue;
				}

				if (!capturing && child.type === 'textDirective' && child.name === 'spoiler-inline') {
					newChildren.push(inlineSpoilerNode(unlink(child.children ?? [], warnLink)));
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
