// Общие сведения о сайте: адрес, имя, описание по умолчанию.
//
// Лежат отдельным модулем, потому что их спрашивают в трёх разных местах:
// astro.config.mjs (обычный node во время сборки), страницы Astro и скрипты.
// Обычный .js читается одинаково везде — тот же приём, что у src/data/platforms.js.
//
// ГЛАВНЫЙ АДРЕС — без www. www.bakapodcast.com показывает тот же сайт, и чтобы
// поисковик не счёл это двумя сайтами-дублями, на каждой странице стоит
// <link rel="canonical"> вот на этот адрес (см. src/layouts/Layout.astro).

export const SITE_URL = 'https://bakapodcast.com';
export const SITE_NAME = 'Бака!';
export const SITE_TITLE = 'Бака! — подкаст об аниме';
export const SITE_DESCRIPTION = 'Подкаст об аниме и о том, что скрывается между кадрами';

/** Язык сайта в двух написаниях: для <html lang> и для og:locale. */
export const SITE_LANG = 'ru';
export const SITE_LOCALE = 'ru_RU';

/**
 * Путь на сайте → полный адрес со схемой и доменом.
 *
 * Нужен там, где относительной ссылки мало и требуется абсолютная: canonical,
 * og:image, карта сайта, RSS. Аргумент может быть уже абсолютным адресом
 * (например, обложка выпуска на хостинге подкаста) — такой возвращается как есть.
 */
export function absoluteUrl(path) {
	if (!path) return null;
	if (/^https?:\/\//.test(path)) return path;
	return new URL(path, SITE_URL).href;
}

/**
 * Заголовок страницы для <title>: «Название — Бака!».
 *
 * У главной приписка не нужна — там название сайта и так стоит первым словом,
 * «Бака! — подкаст об аниме — Бака!» выглядело бы глупо.
 */
export function pageTitle(title) {
	return title ? `${title} — ${SITE_NAME}` : SITE_TITLE;
}
