import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { fieldHash } from '../lib/animeFieldHash.mjs';

// Слепки правимых руками полей справочника — только для админки (тз/05, шаг 6).
// По ним раздел «Аниме» на /admin понимает, какое поле человек действительно
// поправил, и сам ставит галочку «не обновлять из Shikimori/AniList».
// Подробности и сам хеш — в src/lib/animeFieldHash.mjs.
//
// Отдельный файл, а не добавка к /anime-index.json: тот запрашивается при
// правке каждого поста, и таскать в него лишнее незачем. Этот же нужен только
// при правке тайтла.
export const prerender = true;

export const GET: APIRoute = async () => {
	const animeList = await getCollection('anime');

	const hashes = Object.fromEntries(
		animeList.map((entry) => [
			entry.id,
			{
				titleRu: fieldHash(entry.data.titleRu),
				synopsis: fieldHash(entry.data.synopsis),
				poster: fieldHash(entry.data.poster),
			},
		]),
	);

	return new Response(JSON.stringify(hashes), {
		headers: { 'Content-Type': 'application/json' },
	});
};
