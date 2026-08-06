import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { visit } from 'unist-util-visit';

const ANIME_CONTENT_DIR = new URL('../content/anime/', import.meta.url);
const MIN_NAME_LENGTH = 2;

function loadAnimeNames(id) {
	const path = fileURLToPath(new URL(`${id}.json`, ANIME_CONTENT_DIR));
	if (!existsSync(path)) return [];

	try {
		const data = JSON.parse(readFileSync(path, 'utf8'));
		const names = [data.titleRu, data.titleOriginal].filter((name) => name && name.length >= MIN_NAME_LENGTH);
		return [...new Set(names)];
	} catch {
		return [];
	}
}

function autoLinkNode(id, text) {
	return {
		type: 'animeAutoLink',
		data: {
			hName: 'a',
			hProperties: { href: `/anime/${id}`, class: 'anime-mention' },
			hChildren: [{ type: 'text', value: text }],
		},
	};
}

/**
 * `:anime[Текст]{id="frieren" source="shikimori" source-id="9253"}` — метка тайтла
 * в тексте, ставит кнопка «Аниме» в админке (public/admin/index.html). `id` — slug
 * тайтла в справочнике (src/content/anime/), `source`/`source-id` нужны только
 * роботу, который добирает данные тайтла после публикации (scripts/sync-anime.mjs),
 * сам сайт их не читает.
 *
 * Первое упоминание каждого id в посте становится ссылкой на /anime/id,
 * повторные — обычный текст (см. тз/03-тайтлы.md, п. 4).
 *
 * Тайтлы, которые есть в поле `anime` поста (например, проставлены вручную
 * до появления кнопки «Аниме», как в «Знакомьтесь: Ёдзи Такэсигэ»), но нигде
 * не отмечены меткой в тексте, доразмечаются сами: ищем в обычном тексте первое
 * упоминание названия тайтла (русского или оригинального) и превращаем его
 * в такую же ссылку — руками расставлять метки по старым постам не нужно.
 * Ищется точное совпадение текста: название в другом падеже («Ходячего замка»
 * вместо «Ходячий замок») не найдётся — тогда стоит вручную отметить его
 * кнопкой «Аниме» в редакторе.
 */
export default function remarkAnime() {
	return (tree, file) => {
		const seen = new Set();

		visit(tree, 'textDirective', (node, index, parent) => {
			if (node.name !== 'anime' || !parent || typeof index !== 'number') return;

			const id = node.attributes?.id;
			if (!id) return;

			if (seen.has(id)) {
				// Не первое упоминание — заменяем узел его же содержимым, без ссылки.
				parent.children.splice(index, 1, ...node.children);
				return index;
			}

			seen.add(id);
			node.data = { hName: 'a', hProperties: { href: `/anime/${id}`, class: 'anime-mention' } };
		});

		const frontmatterAnime = file.data?.astro?.frontmatter?.anime;
		if (!Array.isArray(frontmatterAnime)) return;

		const pending = new Map();
		for (const id of frontmatterAnime) {
			if (seen.has(id)) continue;
			const names = loadAnimeNames(id);
			if (names.length > 0) pending.set(id, names);
		}

		if (pending.size === 0) return;

		visit(tree, 'text', (node, index, parent) => {
			if (!parent || typeof index !== 'number' || pending.size === 0) return;

			for (const [id, names] of pending) {
				const name = names.find((candidate) => node.value.includes(candidate));
				if (!name) continue;

				const pos = node.value.indexOf(name);
				const before = node.value.slice(0, pos);
				const after = node.value.slice(pos + name.length);

				const replacement = [];
				if (before) replacement.push({ type: 'text', value: before });
				replacement.push(autoLinkNode(id, name));
				if (after) replacement.push({ type: 'text', value: after });

				parent.children.splice(index, 1, ...replacement);
				pending.delete(id);
				return index;
			}
		});
	};
}
