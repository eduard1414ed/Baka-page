// Обложки тайтлов лежат в public/anime/, два webp-размера на постер
// (карточка в сетке / крупная на странице тайтла), см. CLAUDE.md.
export const ANIME_POSTER_WIDTHS = [320, 640];

// "/anime/spirited-away.jpg" -> [{width:320, src:"/anime/spirited-away-320w.webp"}, ...]
export function getAnimePosterSrcs(poster) {
	if (!poster) return [];
	const dot = poster.lastIndexOf('.');
	const base = dot === -1 ? poster : poster.slice(0, dot);
	return ANIME_POSTER_WIDTHS.map((width) => ({ width, src: `${base}-${width}w.webp` }));
}

/**
 * Из чего сборке рисовать превью тайтла для соцсетей: самый крупный постер
 * или ничего.
 *
 * Знать это нужно двоим — странице (она ставит тег) и списку исходников
 * (по нему рисуются файлы). Две копии разошлись бы молча, и страница тайтла
 * без постера ссылалась бы на картинку, которой никто не нарисовал. Ровно
 * поэтому у материалов такое же правило вынесено в `socialSource`.
 *
 * @returns {string|null}
 */
export function animeSocialSource(poster) {
	const srcs = getAnimePosterSrcs(poster);
	return srcs.length > 0 ? srcs[srcs.length - 1].src : null;
}
