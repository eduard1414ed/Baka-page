// РАБОЧИЙ ФАЙЛ СБОРКИ: решения об индексируемости страниц тайтлов.
//
// Приём тот же, что у src/pages/og-sources.json.ts: страница-эндпоинт считает
// при сборке и кладёт результат в `dist/`, а шаг после сборки его читает
// и УДАЛЯЕТ. На сайте этому файлу делать нечего.
//
// Зачем через файл, а не прямо в интеграции: правило живёт в `src/lib/`
// и считается вместе со страницами — из одного указателя упоминаний и одного
// набора постов. Считай его лог заново, он построил бы указатель второй раз
// (12 секунд) и мог бы взять другой набор постов — то есть ответить иначе,
// чем ответила разметка.
//
// Читает: scripts/indexability-log.mjs (он же удаляет).

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/publishing.mjs';
import { индексируемостьСборки } from '../lib/animeIndexability.mjs';

export const GET: APIRoute = async () => {
	const animeList = await getCollection('anime');
	// ТОТ ЖЕ набор постов, что у страницы тайтла и у карты сайта.
	const posts = await getCollection('posts', ({ data }) => isPublished(data));
	const transcripts = await getCollection('transcripts');

	const решения = индексируемостьСборки({ posts, transcripts, animeList });

	return new Response(
		JSON.stringify({
			builtAt: new Date().toISOString(),
			// Список опубликованных постов этой сборки. Без него нельзя отличить
			// «страница выпала, потому что пост удалили» (обычная работа) от
			// «страница выпала, потому что поехал матчинг» (беда).
			posts: posts.map((p) => p.id).sort(),
			pages: [...решения.values()],
		}),
		{ headers: { 'Content-Type': 'application/json; charset=utf-8' } },
	);
};
