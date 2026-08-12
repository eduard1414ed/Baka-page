// Какая картинка стоит в карточке материала — и стоит ли вообще.
//
// Одно место на все ленты: главная, разделы, страница тайтла. Правило
// «материал без обложки остаётся текстовой карточкой» (§9.1 дизайн-системы)
// держится ровно здесь: заглушку не подставляем НИКОГДА. Заглушка есть только
// у аниме, где ряд держится на пропорции постера и дыра ломает сетку;
// у материала же пустое место просто ничего не значит.
//
// ПРОПОРЦИЯ КАРТИНКИ ЗДЕСЬ НЕ РЕШАЕТСЯ. Квадрат у выпуска и кадр 16:9
// у остального задаёт CSS карточки по её типу (`[data-type]` в PostCard.astro).
// Иначе правило про геометрию медиа жило бы в двух местах сразу — в стилях
// и в этом файле — и однажды разъехалось бы.

import { getYoutubeThumbnailUrl } from './youtube.mjs';
import { coverSrcs, firstImageInBody } from './postImage.mjs';
import { findEpisodeByGuid } from './podcastFeed.mjs';
import { resolveEpisodeCover } from './episodeCover.mjs';

/**
 * @typedef {{ src: string, srcset: string | null, play: boolean }} CardMedia
 *
 * `play` — рисовать ли поверх кадра значок «▶». Он ставится только там, где
 * картинка это кадр из ролика: обложка выпуска подкаста ничего не проигрывает.
 */

/**
 * Картинка карточки, или null — если её нет и быть не должно.
 *
 * Порядок — от самого точного к самому общему:
 *   1) галочка «Без обложки» перебивает всё, даже кадр с ютюба. Это осознанный
 *      выбор автора: короткая заметка должна идти в ленте одним заголовком.
 *      Отличается от «обложка не задана» — там картинку просто не выбрали;
 *   2) обложка поста, если заказчик её задал;
 *   3) обложка выпуска с хостинга подкаста — своя сжатая копия, если она
 *      уже скачана (см. episodeCover.mjs);
 *   4) кадр с ютюба у видеоэссе;
 *   5) первая картинка из текста — ровно то, что обещает подсказка поля
 *      «Обложка» в админке («пусто — сайт возьмёт первую картинку из текста»).
 *      Правило считает `firstImageInBody`, тот же код, что и у превью для
 *      соцсетей: карточка и ссылка в чате обязаны показывать одну картинку.
 *      Стоит ПОСЛЕДНЕЙ, ниже ютюба: у видеоэссе обложка — кадр ролика,
 *      а картинка в тексте там иллюстрация по ходу дела;
 *   6) ничего. Карточка остаётся текстовой.
 *
 * @param {{ id: string, data: Record<string, any>, body?: string }} post
 * @returns {Promise<CardMedia | null>}
 */
export async function getCardMedia(post) {
	const { cover, noCover, youtube, audioGuid } = post.data;

	if (noCover) return null;

	const own = coverSrcs(cover);
	if (own) return { ...own, play: false };

	// Обложка выпуска приезжает из RSS. По сети это ничего не стоит: фид
	// качается один раз за сборку и лежит в памяти процесса, сколько бы
	// карточек его ни спросило (см. podcastFeed.mjs).
	if (audioGuid) {
		const episode = await findEpisodeByGuid(audioGuid);
		if (episode?.imageUrl) return { ...resolveEpisodeCover(episode.imageUrl), play: false };
	}

	const thumbnail = youtube ? getYoutubeThumbnailUrl(youtube) : null;
	if (thumbnail) return { src: thumbnail, srcset: null, play: true };

	// Сжатые копии для неё сделает сборка сама: она смотрит, на какие загрузки
	// ссылаются ГОТОВЫЕ страницы (optimize-uploads-integration.mjs), и новая
	// ссылка из карточки попадает в этот список наравне с остальными.
	const inBody = coverSrcs(firstImageInBody(post.body));
	if (inBody) return { ...inBody, play: false };

	return null;
}
