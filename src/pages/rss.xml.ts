// Лента постов сайта (тз/06, шаг 6). ЭТО НЕ RSS ПОДКАСТА: аудио раздаёт Mave
// по адресу из СТАТУС.md, а здесь лента всего, что выходит на сайте, — выпуски,
// заметки, статьи, видеоэссе. Для читалок и для тех, кто следит за сайтом
// без телеграма.
//
// Своим кодом, а не через @astrojs/rss: пакет ради полусотни строк XML тянуть
// не стали, а формат тут простой и фиксированный. Разбор чужого RSS у нас тоже
// свой (src/lib/podcastFeed.mjs) — по той же причине.

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/publishing.mjs';
import { postHref } from '../lib/externalPost.mjs';
import { excerptFromBody } from '../lib/excerpt.mjs';
import { SITE_URL, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION, absoluteUrl } from '../lib/site.mjs';

/** Сколько последних постов отдавать. Читалке архив целиком не нужен. */
const LIMIT = 30;

/**
 * Экранирование для XML. Без него апостроф или амперсанд в заголовке
 * («Кайдзю № 8» с & в описании) сделали бы ленту нечитаемой целиком:
 * читалка на битом XML не показывает НИЧЕГО, а не пропускает один элемент.
 */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export const GET: APIRoute = async () => {
	const posts = (await getCollection('posts', ({ data }) => isPublished(data)))
		// ДАТА ЭЛЕМЕНТА — publishAt, а не date. Решение с девятого этапа
		// (тз/09-отложенный-постинг.md): `date` это дата материала, её можно
		// поставить задним числом, и такой пост у подписчика утонул бы в середине
		// ленты — читалка сортирует по pubDate. `publishAt` это когда пост
		// реально появился на сайте, то есть когда он стал новым для читателя.
		//
		// У большинства постов publishAt пустой (его ставят только при отложенной
		// публикации) — тогда честно берём date, другой даты просто нет.
		.map((post) => ({ post, feedDate: post.data.publishAt ?? post.data.date }))
		.sort((a, b) => b.feedDate.valueOf() - a.feedDate.valueOf())
		.slice(0, LIMIT);

	const items = posts
		.map(({ post, feedDate }) => {
			// У поста-ссылки на чужой сайт (тз/10, задача 2) это адрес чужой
			// статьи: в ленту такие посты идут, а вот страницы у нас для них нет.
			// В отличие от карты сайта, где чужому адресу не место, читалке
			// внешняя ссылка совершенно нормальна — она ведёт туда, где текст.
			//
			// guid остаётся тем же адресом: читалка по нему отличает новый
			// элемент от уже показанного, и адрес статьи для этого годится —
			// он у неё один и не меняется.
			const url = absoluteUrl(postHref(post));
			const description = excerptFromBody(post.body ?? '', SITE_DESCRIPTION);

			return `		<item>
			<title>${escapeXml(post.data.title)}</title>
			<link>${url}</link>
			<guid isPermaLink="true">${url}</guid>
			<pubDate>${feedDate.toUTCString()}</pubDate>
			<description>${escapeXml(description)}</description>
		</item>`;
		})
		.join('\n');

	// lastBuildDate — дата самого свежего поста, а не времени сборки: сборка
	// случается и от правки опечатки, а читалке важно, когда менялось содержимое.
	const lastBuild = posts[0]?.feedDate ?? new Date();

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
	<channel>
		<title>${escapeXml(SITE_TITLE)}</title>
		<link>${SITE_URL}/</link>
		<description>${escapeXml(SITE_DESCRIPTION)}</description>
		<language>ru</language>
		<lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
		<atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
${items}
	</channel>
</rss>
`;

	return new Response(xml, {
		headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
	});
};
