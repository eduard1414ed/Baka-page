import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { categories, sectionOf } from '../content.config';
import { isPublished } from '../lib/publishing.mjs';
import { isExternalPost } from '../lib/externalPost.mjs';
import { getCardMedia } from '../lib/postCardMedia.mjs';
import { episodeNumber } from '../lib/postMeta.mjs';
import { canPlayInline, whyCannotPlay } from '../lib/postRef.mjs';

// Список материалов — для кнопки «Наш материал» в редакторе (ТЗ врезок, §6.2).
//
// ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Материал во врезке ВЫБИРАЕТСЯ ПОИСКОМ, а не
// вписывается адресом руками: набранный руками адрес — это опечатка, которая
// станет битой ссылкой, и не заметит её никто. У кнопки «Аниме» такой поиск
// уже есть, только ходит она в чужой API (Shikimori); нашей врезке искать
// надо по себе, и спрашивать чужой сервер тут не у кого.
//
// ПОЧЕМУ ФАЙЛОМ, А НЕ ЗАПРОСОМ ИЗ АДМИНКИ. Sveltia CMS в своё поле саму
// коллекцию не передаёт — приходит ровно { value, field, forID, onChange, ref }.
// Спросить репозиторий из браузера админка тоже не может: пометка «спам»
// на GitHub урезала квоту API до анонимной (задача 20). Значит список готовит
// сборка, а поле его просто качает — так же, как /anime-index.json для кнопки
// «Аниме» и /admin-posts.json для полей расшифровки.
//
// СПИСОК СЧИТАЕТСЯ ПРИ СБОРКЕ, и это надо знать: материал, заведённый пять
// минут назад, появится в поиске после ближайшей сборки, а не сразу. То же
// самое давно так у поля расшифровки.
//
// ЧЕРНОВИКОВ ЗДЕСЬ НЕТ — решение заказчика 31 августа 2026. У черновика нет
// страницы на сайте: поставь на него врезку, и на живом сайте будет ссылка
// в никуда, причём молча — сборка пройдёт, ошибки не будет. Отбор ведёт
// `isPublished`, тот же, которым решается всё остальное на сайте; своей
// проверки «а не черновик ли» тут нет и быть не должно.
//
// ВНЕШНИЕ МАТЕРИАЛЫ ЗДЕСЬ ЕСТЬ — решение заказчика того же дня. Своей страницы
// у них нет, врезка ведёт наружу, и стрелка у неё «↗» вместо «→»; всё
// остальное — обложка, заголовок, тип — работает как у своих.
export const prerender = true;

export const GET: APIRoute = async () => {
	const posts = await getCollection('posts', ({ data }) => isPublished(data));

	// Свежие сверху: врезку почти всегда ставят на то, что писали недавно,
	// а поле показывает первую страницу списка ещё до того, как начали печатать.
	posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

	const list = await Promise.all(
		posts.map(async (post) => {
			// Картинку берём ТЕМ ЖЕ правилом, что и карточка в ленте
			// (src/lib/postCardMedia.mjs): в списке выбора человек узнаёт материал
			// по той же обложке, которую видит на сайте. Своей лесенки «где взять
			// картинку» тут нет — она уже есть, и второй быть не должно.
			//
			// По сети это ничего не стоит: RSS качается один раз за сборку
			// и лежит в памяти процесса, сколько бы материалов его ни спросило.
			const media = await getCardMedia(post);
			const section = sectionOf(post.data.category);

			return {
				id: post.id,
				title: post.data.title,
				// Подпись ОДНОГО материала («Заметка»), а не название раздела
				// («Заметки»): в строке списка речь про эту конкретную вещь.
				// Берётся у раздела, потому что бонус показывается выпуском.
				type: categories.find((c) => c.id === section)?.labelOne ?? section,
				date: post.data.date.toISOString().slice(0, 10),
				// Номер есть только у обычного выпуска: у бонуса своей нумерации
				// нет, и придуманный номер сбил бы с толку сильнее пустоты.
				number: post.data.category !== 'bonus' && section === 'podcast' ? episodeNumber(post.id) : null,
				thumb: media?.src ?? null,
				external: isExternalPost(post.data),
				// ПРАВИЛО «МОЖЕТ ЛИ ИГРАТЬ» СЧИТАЕТСЯ НЕ ЗДЕСЬ. Его знает
				// src/lib/postRef.mjs, и тот же файл спрашивает плагин сборки:
				// разойдись эти двое, админка разрешала бы то, на чём падает
				// сборка. Здесь только пересказ ответа в поле.
				canPlay: canPlayInline(post),
				whyNot: whyCannotPlay(post),
			};
		}),
	);

	return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
};
