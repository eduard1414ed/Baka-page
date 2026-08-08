// Карта сайта (тз/06, шаг 9) — список всех страниц для поисковика.
//
// Своим кодом, а не через @astrojs/sitemap. Официальный пакет собирает карту
// из ФАЙЛОВ, которые получились в dist/, и такой список нечем проверить:
// «черновиков там нет» пришлось бы принимать на веру. Здесь список строится
// из тех же коллекций и той же функции isPublished, что и сами страницы, —
// а значит его можно прогнать в Node и пересчитать, что и сделано
// (см. статус/этап-6-seo.md).
//
// Это важно именно у нас: опубликовано 7 постов, а черновиков 140+. Утечка
// черновика в карту сайта — это приглашение поисковику на страницу, которой
// не существует, по всему архиву сразу.

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/publishing.mjs';
import { visibleCategories } from '../content.config';
import { absoluteUrl } from '../lib/site.mjs';

/**
 * Одна запись карты.
 * `lastmod` необязателен — ставим только там, где дата осмысленна (у постов).
 */
function urlEntry(path: string, lastmod?: Date): string {
	const lastmodTag = lastmod ? `\n\t\t<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
	return `	<url>\n\t\t<loc>${absoluteUrl(path)}</loc>${lastmodTag}\n\t</url>`;
}

export const GET: APIRoute = async () => {
	// Та же проверка, что решает, будет ли у поста своя страница
	// (src/pages/posts/[slug].astro). Одна функция на оба места — иначе карта
	// однажды разошлась бы с сайтом молча.
	const posts = await getCollection('posts', ({ data }) => isPublished(data));
	const animeList = await getCollection('anime');

	const entries = [
		urlEntry('/'),
		urlEntry('/about/'),
		urlEntry('/anime/'),
		// Только категории со своей страницей. Скрытые («Бонус») страницы
		// не имеют вовсе — см. content.config.ts.
		...visibleCategories.map((category) => urlEntry(`/category/${category.id}/`)),
		...posts.map((post) => urlEntry(`/posts/${post.id}/`, post.data.publishAt ?? post.data.date)),
		...animeList.map((entry) => urlEntry(`/anime/${entry.id}/`)),
	];

	// /search/ в карту НЕ идёт: она закрыта noindex (см. src/pages/search.astro).
	// Звать робота на страницу и тут же говорить «не индексируй» — противоречие,
	// и Search Console на такое ругается.

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

	return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
