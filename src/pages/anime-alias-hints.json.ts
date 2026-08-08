import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { collectAliasHints } from '../lib/aliasHints.mjs';

// Подсказки к полю «Варианты написания» — только для админки (тз/05, шаг 6).
// Что знает Shikimori и что реально звучит в архиве; ни то, ни другое
// не применяется само. Правила и причины — в src/lib/aliasHints.mjs.
//
// Считается при сборке: разбирать 22 575 реплик в браузере админки было бы
// и медленно, и означало бы вторую копию правил поиска.
export const prerender = true;

export const GET: APIRoute = async () => {
	const [animeList, transcripts] = await Promise.all([getCollection('anime'), getCollection('transcripts')]);

	return new Response(JSON.stringify(collectAliasHints(animeList, transcripts)), {
		headers: { 'Content-Type': 'application/json' },
	});
};
