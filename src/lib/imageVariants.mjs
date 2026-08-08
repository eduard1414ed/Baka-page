// Два размера согласно CLAUDE.md: телефон и десктоп, не больше.
export const IMAGE_WIDTHS = [640, 1280];

const OPTIMIZABLE_EXT = new Set(['.jpg', '.jpeg', '.png']);

export function isOptimizableImage(pathname) {
	const dot = pathname.lastIndexOf('.');
	if (dot === -1) return false;
	return OPTIMIZABLE_EXT.has(pathname.slice(dot).toLowerCase());
}

/**
 * Отдельная jpeg-копия для превью в соцсетях: "…/photo.jpeg" → "…/photo-og.jpg".
 *
 * Нужна потому, что на сайт загруженные картинки уезжают только в webp,
 * а телеграм webp-превью разворачивает ненадёжно (см. CLAUDE.md).
 *
 * Это ТРЕТИЙ файл на картинку при правиле «максимум два размера» в CLAUDE.md,
 * и поэтому он делается НЕ для всех загрузок подряд, а только для тех, что
 * реально стоят в превью: сборка ищет ссылки на такие копии в готовых
 * страницах и создаёт только их (src/plugins/optimize-uploads-integration.mjs).
 * Правило про два размера про то, что показывается на странице; здесь другое
 * назначение и штучное количество — сейчас одна копия на весь сайт.
 */
export function getOgVariantSrc(originalSrc) {
	const decoded = decodeURIComponent(originalSrc);
	const dot = decoded.lastIndexOf('.');
	const base = dot === -1 ? decoded : decoded.slice(0, dot);
	return encodeURI(`${base}-og.jpg`);
}

// "/images/uploads/photo%20one.jpeg" -> ["/images/uploads/photo one-640w.webp", ...]
// Расширение обрезаем от РЕАЛЬНОГО (декодированного) имени файла — так же,
// как это делает скрипт сжатия на файловой системе (astro.config.mjs).
export function getImageVariantSrcs(originalSrc) {
	const decoded = decodeURIComponent(originalSrc);
	const dot = decoded.lastIndexOf('.');
	const base = dot === -1 ? decoded : decoded.slice(0, dot);

	return IMAGE_WIDTHS.map((width) => ({
		width,
		src: encodeURI(`${base}-${width}w.webp`),
	}));
}
