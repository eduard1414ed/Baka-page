import { visit } from 'unist-util-visit';

/**
 * `:anime[Текст]{id="frieren" source="shikimori" source-id="9253"}` — метка тайтла
 * в тексте, ставит кнопка «Аниме» в админке (public/admin/index.html). `id` — slug
 * тайтла в справочнике (src/content/anime/), `source`/`source-id` нужны только
 * роботу, который добирает данные тайтла после публикации (scripts/sync-anime.mjs),
 * сам сайт их не читает.
 *
 * Первое упоминание каждого id в посте становится ссылкой на /anime/id,
 * повторные — обычный текст (см. тз/03-тайтлы.md, п. 4).
 */
export default function remarkAnime() {
	return (tree) => {
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
	};
}
