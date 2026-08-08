// Какая картинка уходит в превью поста для соцсетей (тз/06, шаг 7).
//
// Своего поля «обложка» у постов архива нет, а картинка почти всегда есть —
// первая в тексте. У выпуска это обложка выпуска, у статьи — большой кадр
// сверху. Её и берём: заказчик именно её и считает обложкой статьи.
//
// Понадобилось, когда выяснилось, что у статьи в телеграме разворачивался
// баннер сайта вместо её собственного кадра.

import { getOgVariantSrc, getImageVariantSrcs, isOptimizableImage } from './imageVariants.mjs';

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
	if (src.startsWith('/images/uploads/')) return getOgVariantSrc(src);
	// Что-то ещё из public/ — отдаём как есть, если это не webp.
	return /\.webp$/i.test(src) ? null : src;
}
