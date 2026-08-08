// Посты-ссылки на чужие сайты — для поискового индекса (тз/10, задача 2).
//
// ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Pagefind строит индекс, обходя УЖЕ СОБРАННЫЕ страницы
// в dist/. У внешнего поста страницы нет вовсе и не должно быть — значит
// обычным путём в поиск он не попадёт никогда. Поэтому такие посты дописываются
// в индекс отдельной записью «без страницы» (штатная возможность Pagefind,
// index.addCustomRecord), а делает это scripts/build-search-index.mjs
// сразу после сборки сайта.
//
// Список считается ЗДЕСЬ, а не в скрипте, и это не мелочь: тут работают те же
// getCollection и isPublished, что и на страницах сайта. Собери скрипт этот
// список сам, разбирая файлы постов, — и однажды в поиск утёк бы черновик,
// а черновиков у нас 138 против 8 опубликованных постов (CLAUDE.md).
//
// Формат — сразу тот, который ждёт Pagefind: скрипту остаётся только передать
// записи дальше, ничего не решая.

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/publishing.mjs';
import { isExternalPost, externalSourceName } from '../lib/externalPost.mjs';
import { excerptFromBody } from '../lib/excerpt.mjs';
import { categories, sectionOf } from '../content.config';
import { SITE_DESCRIPTION } from '../lib/site.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
	const posts = await getCollection('posts', ({ data }) => isPublished(data) && isExternalPost(data));

	const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

	const records = posts.map((post) => {
		const { title, category, date, externalUrl } = post.data;
		const categoryLabel = categories.find((c) => c.id === category)?.label ?? category;
		// «Выпуски» или «Посты» — по РАЗДЕЛУ, а не по категории: ровно так же
		// это решает страница поста (src/pages/posts/[slug].astro), и расходиться
		// им нельзя, иначе фильтр в выдаче начнёт врать.
		const isEpisode = sectionOf(category) === 'podcast';
		const description = excerptFromBody(post.body ?? '', SITE_DESCRIPTION);
		const source = externalSourceName(post.data);

		return {
			// Адрес чужой статьи. Pagefind его не трогает — результат поиска
			// поведёт читателя наружу, как и карточка в ленте.
			url: externalUrl,
			// Что ищется. Текста у нас нет, поэтому в индекс идёт то, что есть:
			// заголовок и описание. Название площадки тоже — по запросу
			// «Кинопоиск» человек ждёт увидеть свои статьи там.
			content: [title, description, source].filter(Boolean).join('. '),
			language: 'ru',
			meta: {
				title,
				type: isEpisode ? 'episode' : 'post',
				category: categoryLabel,
				date: dateFormatter.format(date),
			},
			filters: {
				type: [isEpisode ? 'Выпуски' : 'Посты'],
				category: [categoryLabel],
			},
		};
	});

	return new Response(JSON.stringify(records), { headers: { 'Content-Type': 'application/json' } });
};
