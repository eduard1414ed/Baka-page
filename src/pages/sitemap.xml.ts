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
import { isExternalPost } from '../lib/externalPost.mjs';
import { visibleCategories, categoriesShownIn } from '../content.config';
import { absoluteUrl } from '../lib/site.mjs';
import { ARCHIVE_BASE, pageCount, pageUrl } from '../lib/archive.mjs';

/**
 * Одна запись карты.
 * `lastmod` необязателен — ставим только там, где дата осмысленна (у постов).
 */
function urlEntry(path: string, lastmod?: Date): string {
	const lastmodTag = lastmod ? `\n\t\t<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
	return `	<url>\n\t\t<loc>${absoluteUrl(path)}</loc>${lastmodTag}\n\t</url>`;
}

export const GET: APIRoute = async () => {
	// Те же две проверки, что решают, будет ли у поста своя страница
	// (src/pages/posts/[slug].astro). Одни функции на оба места — иначе карта
	// однажды разошлась бы с сайтом молча.
	//
	// isExternalPost — про посты-ссылки на чужие сайты (тз/10, задача 2):
	// своей страницы у них нет вовсе, и звать на неё поисковика значит обещать
	// ему 404. Чужой адрес в свою карту сайта тоже не кладут: карта заявляет
	// страницы этого домена.
	const posts = await getCollection('posts', ({ data }) => isPublished(data) && !isExternalPost(data));
	const animeList = await getCollection('anime');

	// СТРАНИЦ ЛИСТАНИЯ У АРХИВА НЕСКОЛЬКО, И КАЖДАЯ — ОТДЕЛЬНАЯ СТРАНИЦА САЙТА.
	// Заявить одну первую значит спрятать от поисковика весь архив, кроме
	// свежих 24 материалов. Сколько их выходит, считает та же функция, что
	// нарезает сами страницы (src/lib/archive.mjs), — иначе карта однажды
	// пообещала бы страницу, которой нет.
	//
	// В архив, в отличие от списка постов выше, попадают И посты-ссылки
	// на чужие сайты: своей страницы у них нет, но в ленте архива они стоят
	// и на число страниц влияют.
	const inArchive = await getCollection('posts', ({ data }) => isPublished(data));
	const pagesOf = (base: string, total: number) =>
		Array.from({ length: pageCount(total) }, (_, i) => urlEntry(pageUrl(base, i + 1)));

	const entries = [
		urlEntry('/'),
		urlEntry('/about/'),
		urlEntry('/support/'),
		urlEntry('/anime/'),
		...pagesOf(ARCHIVE_BASE, inArchive.length),
		// Только категории со своей страницей. Скрытые («Бонус») страницы
		// не имеют вовсе — см. content.config.ts.
		...visibleCategories.flatMap((category) => {
			// Не `data.category === id`, а список: в разделе «Подкаст» лежат
			// и выпуски, и приписанные к нему бонусы.
			const shown = categoriesShownIn(category.id);
			const own = inArchive.filter((post) => shown.includes(post.data.category));
			return pagesOf(`/category/${category.id}/`, own.length);
		}),
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
