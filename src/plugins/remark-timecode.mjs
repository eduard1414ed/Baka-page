// Находит в тексте выпуска метки времени вида «12:34» или «1:02:03» и превращает
// в ссылку `<a class="timecode" data-seconds="754">12:34</a>` — клик по ней
// перематывает закреплённый плеер (см. src/components/PlayerBar.astro). Ссылками
// становятся только у постов категории `podcast` (см. тз/04) — у остальных
// категорий число с двоеточием не имеет отношения к плееру.
//
// Формат H:MM:SS отдельно от M:SS (минуты могут быть трёхзначными — выпуски
// длиннее часа), чтобы не путать секунды с минутами при разборе.
const TIME_RE = /\b(?:(\d{1,2}):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d))\b/g;

function toSeconds(match) {
	const [, h, m, s, m2, s2] = match;
	if (h !== undefined) return Number(h) * 3600 + Number(m) * 60 + Number(s);
	return Number(m2) * 60 + Number(s2);
}

function timecodeNode(text, seconds) {
	return {
		type: 'timecodeLink',
		data: {
			hName: 'a',
			hProperties: { href: '#', class: 'timecode', 'data-seconds': String(seconds) },
			hChildren: [{ type: 'text', value: text }],
		},
	};
}

// `remark-directive` (используется блоками «Аниме»/«Спойлер»/«Видео» из редактора,
// см. remark-anime.mjs, remark-spoiler.mjs, remark-video.mjs) при разборе текста
// принимает двоеточие, за которым сразу идут цифры, за начало своей метки —
// «:05» становится отдельным узлом `textDirective` с именем «05», а не остаётся
// частью обычного текста. Ни одна метка в этом проекте не называется просто
// числом, так что такой узел — это всегда испорченное двоеточие из живого текста
// (например, таймкод в шоунотах «12:34» или список «00:00 — Опенинг»), а не
// настоящая метка. Без лечения кусок текста после двоеточия с цифрами пропадал бы
// со страницы совсем — баг существовал независимо от этого плагина и уже
// подъедал шоуноты в опубликованных выпусках (ep-100, ep-101 и т. д., проверено
// на реальном содержимом постов). Лечим для всех категорий, а не только подкаста —
// это исправление испорченного текста, а не часть фичи с таймкодами.
function isStrayDigitDirective(node) {
	return (
		node.type === 'textDirective' &&
		/^\d+$/.test(node.name || '') &&
		(!node.attributes || Object.keys(node.attributes).length === 0) &&
		(!node.children || node.children.length === 0)
	);
}

function literalValue(node) {
	if (node.type === 'text') return node.value;
	if (isStrayDigitDirective(node)) return `:${node.name}`;
	return null;
}

// Ссылку из таймкода внутри уже существующей ссылки не делаем — вложенный <a>
// внутри <a> невалиден и не кликается браузером как надо.
function isLinkLike(node) {
	return node.type === 'link' || node.type === 'linkReference' || node.data?.hName === 'a';
}

function processChildren(children, isPodcast) {
	const result = [];
	let bufferText = '';

	const flush = () => {
		if (bufferText === '') return;

		if (isPodcast) {
			TIME_RE.lastIndex = 0;
			const matches = [...bufferText.matchAll(TIME_RE)];
			if (matches.length > 0) {
				let cursor = 0;
				for (const match of matches) {
					const start = match.index;
					if (start > cursor) result.push({ type: 'text', value: bufferText.slice(cursor, start) });
					result.push(timecodeNode(match[0], toSeconds(match)));
					cursor = start + match[0].length;
				}
				if (cursor < bufferText.length) result.push({ type: 'text', value: bufferText.slice(cursor) });
				bufferText = '';
				return;
			}
		}

		// Таймкода не нашли (или это не подкаст) — восстанавливаем обычным текстом.
		// Для буфера из одного здорового текстового узла это просто отдаёт его
		// обратно как есть, ничего не меняя.
		result.push({ type: 'text', value: bufferText });
		bufferText = '';
	};

	for (const child of children) {
		if (isLinkLike(child)) {
			// Текст внутри ссылки всё равно лечим (испорченное двоеточие — баг сам
			// по себе, чинить нужно везде), но не превращаем в новую ссылку —
			// вложенный <a> внутри <a> невалиден.
			flush();
			if (Array.isArray(child.children)) child.children = processChildren(child.children, false);
			result.push(child);
			continue;
		}

		const text = literalValue(child);
		if (text !== null) {
			bufferText += text;
			continue;
		}

		flush();
		if (Array.isArray(child.children)) child.children = processChildren(child.children, isPodcast);
		result.push(child);
	}
	flush();

	return result;
}

export default function remarkTimecode() {
	return (tree, file) => {
		const isPodcast = file.data?.astro?.frontmatter?.category === 'podcast';
		tree.children = processChildren(tree.children, isPodcast);
	};
}
