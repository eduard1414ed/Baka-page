// Какая картинка уходит в превью поста для соцсетей (тз/06, шаг 7).
//
// Своего поля «обложка» у постов архива нет, а картинка почти всегда есть —
// первая в тексте. У выпуска это обложка выпуска, у статьи — большой кадр
// сверху. Её и берём: заказчик именно её и считает обложкой статьи.
//
// Понадобилось, когда выяснилось, что у статьи в телеграме разворачивался
// баннер сайта вместо её собственного кадра.

import { getOgVariantSrc, getImageVariantSrcs, isOptimizableImage } from './imageVariants.mjs';
import { getEpisodeCoverOgSrc } from './episodeCover.mjs';
import { cutoutSrcs, cutoutSocialSource, cutoutIdForUpload } from './coverCutout.mjs';

/** Свой блок картинки из редактора админки: ::image{src="…" alt="…"}. */
const DIRECTIVE_RE = /^::image\{[^}]*\bsrc="([^"]+)"/m;

/** Обычная markdown-картинка: ![подпись](адрес). */
const MARKDOWN_RE = /!\[[^\]]*\]\(([^)\s]+)/;

/**
 * Первая картинка в тексте поста.
 *
 * @param {string} body Текст поста в markdown.
 * @returns {string | null} Адрес как он записан в тексте, или null.
 */
export function firstImageInBody(body) {
	if (!body) return null;

	// Какая из двух записей встретилась РАНЬШЕ в тексте, та и первая.
	// Просто проверить одну, потом другую нельзя: в посте может быть и то
	// и другое, и порядок тогда определялся бы порядком проверок, а не текстом.
	const candidates = [DIRECTIVE_RE, MARKDOWN_RE]
		.map((re) => {
			const match = body.match(re);
			return match ? { at: match.index, src: match[1] } : null;
		})
		.filter(Boolean);

	if (candidates.length === 0) return null;
	return candidates.sort((a, b) => a.at - b.at)[0].src;
}

/**
 * Обложка поста для показа в ленте: сжатые копии, если картинка наша.
 *
 * Отдельно от превью в соцсетях: там нужен jpeg (телеграм не любит webp),
 * а на странице наоборот webp — он легче. Один и тот же файл обложки,
 * два разных набора копий, и делает их одна и та же сборка.
 *
 * @returns {{src: string, srcset: string|null} | null}
 */
export function coverSrcs(cover) {
	if (!cover) return null;

	// Вырезанный персонаж, если он для этой обложки есть (тз/12). У бонуса
	// обложка загружается в админку руками, но нарисована она по тому же
	// шаблону «БАКА!», что и обложки выпусков, и обрабатывается так же.
	const cutout = cutoutSrcs(cutoutIdForUpload(cover));
	if (cutout) return cutout;

	// Картинка с чужого сервера или формат, который мы не жмём (svg, gif) —
	// как есть, лишь бы не битая ссылка.
	if (/^https?:\/\//.test(cover) || !isOptimizableImage(cover)) {
		return { src: cover, srcset: null };
	}

	const variants = getImageVariantSrcs(cover);
	return {
		// В src самый маленький — его берут браузеры, не понимающие srcset.
		src: variants[0].src,
		srcset: variants.map((v) => `${v.src} ${v.width}w`).join(', '),
	};
}

/**
 * Адрес картинки из текста → адрес, годный для превью в соцсетях.
 *
 * Загруженные в админку картинки сборка превращает в webp и удаляет оригинал
 * (src/plugins/optimize-uploads-integration.mjs), а webp телеграм разворачивает
 * ненадёжно. Поэтому для таких показываем отдельную jpeg-копию — её делает
 * та же сборка, но только для картинок, которые реально нужны в превью.
 *
 * Картинки с чужих серверов (обложка выпуска с хостинга подкаста) отдаём как
 * есть: они уже jpg или png.
 *
 * @returns {string | null}
 */
export function toSocialImage(src) {
	if (!src) return null;
	if (/^https?:\/\//.test(src)) return src;

	// Вырезанный персонаж (тз/12): на бумагу его положит сборка, рисующая
	// картинку 1200×630. Отдельная jpeg-копия для таких обложек не нужна.
	const cutout = cutoutSocialSource(cutoutIdForUpload(src));
	if (cutout) return cutout;

	if (src.startsWith('/images/uploads/')) return getOgVariantSrc(src);
	// Что-то ещё из public/ — отдаём как есть, если это не webp.
	return /\.webp$/i.test(src) ? null : src;
}

/**
 * ИЗ ЧЕГО делается картинка превью поста для соцсетей.
 *
 * Не сама картинка превью, а её исходник: готовое превью 1200×630 рисует
 * сборка (src/plugins/og-images-integration.mjs), и вот из этого файла.
 *
 * Порядок — от самого точного к самому общему:
 *   1) обложка поста, если заказчик её задал;
 *   2) обложка выпуска: СВОЯ jpeg-копия, а не ссылка на хостинг подкаста
 *      (почему — в src/lib/episodeCover.mjs). Своей копии может не быть
 *      у совсем свежего выпуска, тогда честно отдаём ссылку на хостинг;
 *   3) первая картинка в тексте — у статьи это её большой кадр сверху;
 *   4) ничего. Такой пост получит общую картинку сайта.
 *
 * Галочка «Без обложки» здесь НЕ учитывается: она про то, как пост выглядит
 * в ленте, а ссылка в чате совсем без картинки выглядит сломанной.
 *
 * Считается в одном месте намеренно. Это же нужно знать двоим: странице поста
 * (она ставит теги) и сборке (она рисует файл). Две копии правила разошлись бы
 * молча, и превью стало бы показывать не то, на что ссылается страница.
 *
 * @returns {string | null}
 */
export function socialSource({ cover, episodeImageUrl = null, body = '' }) {
	const episodeCover = episodeImageUrl
		? (getEpisodeCoverOgSrc(episodeImageUrl) ?? episodeImageUrl)
		: null;

	return toSocialImage(cover) ?? episodeCover ?? toSocialImage(firstImageInBody(body)) ?? null;
}
