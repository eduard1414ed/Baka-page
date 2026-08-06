import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// Список уже известных тайтлов — для админки (кнопка «Аниме» в редакторе):
// чтобы при выборе тайтла, который уже есть в справочнике, не создавать
// второй файл на тот же Shikimori/AniList id, а переиспользовать существующий
// slug. Генерируется при каждой сборке сайта, значит после каждого пуша
// список свежий (см. тз/03-тайтлы.md).
export const prerender = true;

export const GET: APIRoute = async () => {
	const animeList = await getCollection('anime');

	const list = animeList.map((entry) => ({
		id: entry.id,
		source: entry.data.source,
		sourceId: entry.data.sourceId,
		titleRu: entry.data.titleRu ?? null,
		titleOriginal: entry.data.titleOriginal,
	}));

	return new Response(JSON.stringify(list), {
		headers: { 'Content-Type': 'application/json' },
	});
};
