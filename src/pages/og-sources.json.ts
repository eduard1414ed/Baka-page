// Из чего сборке рисовать картинки превью для соцсетей (тз/08, часть 2.4).
//
// ЗАЧЕМ ЭТОТ ФАЙЛ. Превью 1200×630 рисует сборочный шаг после сборки
// (src/plugins/og-images-integration.mjs). Он работает с готовой папкой dist
// и сам по себе не знает, у какого поста какая обложка: это решают поля поста,
// расшифровка RSS и текст материала.
//
// Список считается ЗДЕСЬ, а не в самом шаге, по той же причине, что
// и в search-external.json.ts: тут работают те же getCollection, isPublished
// и socialSource, что и на страницах сайта. Разбери сборочный шаг файлы постов
// сам — и однажды превью показало бы не ту картинку, что стоит на странице,
// или досталось бы черновику (их у нас 138 против 8 опубликованных).
//
// ФАЙЛ ДО САЙТА НЕ ДОЕЗЖАЕТ: тот же шаг удаляет dist/og-sources.json сразу
// после того, как нарисует по нему картинки.

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/publishing.mjs';
import { isExternalPost } from '../lib/externalPost.mjs';
import { findEpisodeByGuid } from '../lib/podcastFeed.mjs';
import { socialSource } from '../lib/postImage.mjs';
import { ogUrlForPost } from '../lib/ogImage.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
	// Тот же отбор, что у getStaticPaths страницы поста: у черновиков и внешних
	// постов страницы нет, значит и превью им не нужно. Отбор здесь — чтобы
	// не гонять RSS по всему архиву; настоящая же защита от лишних файлов
	// в сборочном шаге: он рисует только то, на что реально ссылаются
	// собранные страницы.
	const posts = await getCollection('posts', ({ data }) => isPublished(data) && !isExternalPost(data));

	const list = await Promise.all(
		posts.map(async (post) => {
			const episode = post.data.audioGuid ? await findEpisodeByGuid(post.data.audioGuid) : null;
			const source = socialSource({
				cover: post.data.cover,
				episodeImageUrl: episode?.imageUrl ?? null,
				body: post.body ?? '',
			});

			return source ? { og: ogUrlForPost(post.id), source } : null;
		}),
	);

	return new Response(JSON.stringify(list.filter(Boolean)), {
		headers: { 'Content-Type': 'application/json' },
	});
};
