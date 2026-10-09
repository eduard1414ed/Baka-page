// Из чего сборке рисовать картинки превью для соцсетей (тз/08, часть 2.4).
//
// ЗАЧЕМ ЭТОТ ФАЙЛ. Превью рисует сборочный шаг после сборки
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
import { animeSocialSource } from '../lib/animePoster.mjs';
import { ogUrlForPost, ogUrlForAnime, ogUrlForTestResult } from '../lib/ogImage.mjs';
import { prepareTest } from '../lib/testPage.mjs';

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

	// Страницы тайтлов: превью делается из уже скачанного постера. Берём
	// крупный размер — 640 px против 1200 в полосе, но постер вписывается
	// целиком и растягивается по высоте, а не по ширине. Тайтл без постера
	// в список не попадает и получает общую картинку сайта.
	const animeList = await getCollection('anime');
	const animeSources = animeList
		.map((entry) => {
			const source = animeSocialSource(entry.data.poster);
			return source ? { og: ogUrlForAnime(entry.id), source } : null;
		})
		.filter(Boolean);

	// Страницы результатов тестов (сессия «Тесты-5б»): превью РИСУЕТСЯ, а не
	// берётся с обложки, — поэтому запись другого вида, `kind: 'test-result'`,
	// с текстом и картинкой вместо `source`. Тот же отбор и тот же адрес
	// результата, что у самих страниц (posts/[slug]/[result].astro,
	// prepareTest): черновику превью не рисуется вовсе.
	const tests = posts.filter((post) => post.data.category === 'test');
	const testSources = [];
	for (const post of tests) {
		const test = await prepareTest(post, { dev: false, publishedIds: new Set(), postRefs: false });
		for (const result of test.results) {
			testSources.push({
				og: ogUrlForTestResult(post.id, result.slug),
				kind: 'test-result',
				test: post.data.title,
				title: result.title,
				image: result.image?.file ?? null,
			});
		}
	}

	return new Response(JSON.stringify([...list.filter(Boolean), ...animeSources, ...testSources]), {
		headers: { 'Content-Type': 'application/json' },
	});
};
