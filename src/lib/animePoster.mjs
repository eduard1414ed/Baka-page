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
