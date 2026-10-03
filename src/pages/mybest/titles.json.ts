import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { catalogCodes } from '../../lib/animeCatalog.mjs';
import { getAnimePosterSrcs } from '../../lib/animePoster.mjs';

// СПРАВОЧНИК СТРАНИЦЫ «МОИ ДЕВЯТЬ АНИМЕ» (задача 22, тз/тз-22-moi-devyat-anime.md).
//
// Один файл рядом со страницей: `/mybest/titles.json`. Качается ТОЛЬКО при
// заходе на `/mybest/`, и только когда читатель впервые открыл поиск — на
// остальные страницы сайта он не попадает никак.
//
// ВТОРОГО ИСТОЧНИКА ПРАВДЫ ТУТ НЕТ. Тайтлы берутся из той же коллекции `anime`,
// что и каталог `/anime/`, — все до единого, без отбора, как в каталоге, —
// и в том же порядке добавления (`catalogCodes`). Поменяли название в админке —
// поменялось и здесь, при ближайшей сборке.
//
// ЧТО В ФАЙЛЕ И ЗАЧЕМ:
//   id      — адрес страницы тайтла `/anime/<id>/` выводится из него в браузере;
//             отдельной строкой его не пишем, это 685 одинаковых хвостов;
//   ru, orig, aliases, auto — ровно то, по чему ищет `buildAnimeMatcher`
//             (src/lib/animeMentions.mjs): русское и оригинальное название,
//             ручные варианты написания и падежные формы. Браузер строит
//             по ним ТОТ ЖЕ матчер, что и сборка, — второго правила нет;
//   year, studio — строка под названием в выдаче («2009 · Bones»);
//   poster  — малый размер постера (320 px), тот же файл, что в каталоге.
//
// ВЕС на 3 октября 2026: 195 КБ файлом, около 45 КБ при передаче со сжатием.
// Больше всего весят падежные формы (около 74 КБ из 195) — без них не нашлось
// бы «Стального алхимика» по запросу «стального алхимика».
export const prerender = true;

export const GET: APIRoute = async () => {
	const animeList = await getCollection('anime');
	const codes = catalogCodes(animeList);

	const items = [...animeList]
		.sort((a, b) => (codes.get(a.id)?.order ?? 0) - (codes.get(b.id)?.order ?? 0))
		.map(({ id, data }) => {
			const poster = getAnimePosterSrcs(data.poster)[0]?.src;
			return {
				id,
				...(data.titleRu ? { ru: data.titleRu } : {}),
				orig: data.titleOriginal,
				...(data.year ? { year: data.year } : {}),
				...(data.studio ? { studio: data.studio } : {}),
				...(poster ? { poster } : {}),
				...(data.aliases?.length ? { aliases: data.aliases } : {}),
				...(data.aliasesAuto?.length ? { auto: data.aliasesAuto } : {}),
			};
		});

	return new Response(JSON.stringify(items), {
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
	});
};
