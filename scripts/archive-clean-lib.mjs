// РАЗОВАЯ ЧИСТКА ПРИВЕЗЁННОГО АРХИВА — ОБЩЕЕ ЧТЕНИЕ И РАЗБОР (тз/16).
//
// Это НЕ механизм и в роботов не встраивается: скрипты задачи 16 живут до конца
// разбора архива заказчиком. Общая часть вынесена сюда затем же, зачем вынесен
// `posts-plain.mjs`: четыре правки меряют один архив и называют заказчику числа,
// которые он сравнивает между собой, — разъехаться им нельзя.
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ `posts-plain.mjs`. Тот отдаёт тело ГОЛЫМ ТЕКСТОМ, для
// счёта упоминаний. Здесь тело нужно СЫРЫМ: правки его переписывают, и место
// правки задаётся смещением в исходной строке.
//
// РАЗБОР ТОТ ЖЕ, ЧТО У СБОРКИ, И ЭТО ГЛАВНОЕ ПРАВИЛО ФАЙЛА. Хештег «часть
// ссылки или её адреса», якорь `#таймкод`, решётка внутри кода, заголовок
// markdown — всё это перечислять по памяти нельзя: список знаков разъедется
// с жизнью на первом же непредвиденном случае. Спрашивать надо разбор, который
// про эти случаи знает сам: у ссылки адрес лежит в `node.url`, а не в тексте;
// у кода — в `node.value`; решётка заголовка вообще не доезжает до дерева.
// Своим правилом остаётся ровно одно — цитата (`blockquote`), потому что текст
// внутри неё дерево считает обычным текстом.
//
// ПРАВИМ ПО СМЕЩЕНИЯМ, А НЕ ПЕРЕСБОРКОЙ ДЕРЕВА. `mdast-util-to-markdown` привёл
// бы весь файл к своему виду: переставил бы кавычки у атрибутов директив,
// переписал бы списки и переносы. Разница пришла бы на 900 файлов сразу, и среди
// неё нельзя было бы найти собственно правку. Поэтому дерево отвечает ТОЛЬКО
// на вопрос «где», а режется исходная строка.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { directive } from 'micromark-extension-directive';
import { directiveFromMarkdown } from 'mdast-util-directive';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';

export const POSTS_DIR = new URL('../src/content/posts/', import.meta.url);
export const ANIME_DIR = new URL('../src/content/anime/', import.meta.url);

/**
 * Все посты репозитория сырыми: шапка разобрана, тело как есть.
 *
 * Шапка читается тем же `js-yaml`, которым её читает сборка: `draft` решает
 * в этой задаче всё («только черновики»), и промахнуться в нём значит тронуть
 * опубликованное.
 *
 * `head` и `body` вместе дают файл побайтно — на этом стоит запись:
 * шапку правки 1, 2 и 4 не трогают вовсе, и склейка обязана вернуть её
 * ровно такой, какой она лежала.
 *
 * @returns {Promise<{ file: string, id: string, draft: boolean, front: object, head: string, body: string, raw: string }[]>}
 */
export async function readPostsRaw() {
	const files = (await readdir(POSTS_DIR)).filter((name) => name.endsWith('.md')).sort();
	const out = [];

	for (const file of files) {
		const raw = await readFile(new URL(file, POSTS_DIR), 'utf8');
		let front = {};
		let head = '';
		let body = raw;

		if (raw.startsWith('---')) {
			const end = raw.indexOf('\n---', 3);
			if (end > 0) {
				try {
					front = yaml.load(raw.slice(4, end)) ?? {};
				} catch {
					front = {};
				}
				head = raw.slice(0, end + 4);
				body = raw.slice(end + 4);
			}
		}

		out.push({
			file,
			id: file.replace(/\.md$/, ''),
			draft: front.draft === true,
			front,
			head,
			body,
			raw,
		});
	}

	return out;
}

/** Записать пост обратно, сохранив шапку побайтно. */
export async function writePostBody(post, body) {
	await writeFile(new URL(post.file, POSTS_DIR), post.head + body, 'utf8');
}

/**
 * Тело поста → дерево markdown с расширениями, которые включены у сборки.
 * Смещения узлов (`position.*.offset`) считаются от начала переданной строки.
 */
export function parseBody(body) {
	return fromMarkdown(body, {
		extensions: [gfm(), directive()],
		mdastExtensions: [gfmFromMarkdown(), directiveFromMarkdown()],
	});
}

/**
 * Все текстовые узлы тела с пометкой, лежат ли они внутри цитаты или ссылки.
 *
 * Обход свой, а не `unist-util-visit`, ровно из-за этой пометки: посетителю
 * дерева видно только текущий узел, а вопрос тут про ПРЕДКОВ. Ссылку `visit`
 * дал бы обойти списком узлов (так делает `remark-anime.mjs`), а цитату нет.
 *
 * @returns {{ node: object, inQuote: boolean, inLink: boolean, parent: object, index: number }[]}
 */
export function textNodes(tree) {
	const out = [];

	const walk = (node, parent, index, inQuote, inLink) => {
		if (node.type === 'text') {
			out.push({ node, parent, index, inQuote, inLink });
			return;
		}
		// У кода, встроенного и блочного, содержимое лежит в `value`, а не
		// в детях: обходить нечего, и решётка внутри него недосягаема сама собой.
		if (!Array.isArray(node.children)) return;

		const quote = inQuote || node.type === 'blockquote';
		const link = inLink || node.type === 'link' || node.type === 'linkReference';
		node.children.forEach((child, i) => walk(child, node, i, quote, link));
	};

	walk(tree, null, -1, false, false);
	return out;
}

/**
 * Вырезать из строки куски по смещениям.
 * @param {{ start: number, end: number }[]} cuts — могут идти в любом порядке, но не пересекаться
 */
export function cutRanges(text, cuts) {
	const sorted = [...cuts].sort((a, b) => a.start - b.start);
	let out = '';
	let cursor = 0;
	for (const cut of sorted) {
		if (cut.start < cursor) throw new Error('вырезаемые куски пересекаются — это ошибка в правиле отбора');
		out += text.slice(cursor, cut.start);
		cursor = cut.end;
	}
	return out + text.slice(cursor);
}
