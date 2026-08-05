// Два размера согласно CLAUDE.md: телефон и десктоп, не больше.
export const IMAGE_WIDTHS = [640, 1280];

const OPTIMIZABLE_EXT = new Set(['.jpg', '.jpeg', '.png']);

export function isOptimizableImage(pathname) {
	const dot = pathname.lastIndexOf('.');
	if (dot === -1) return false;
	return OPTIMIZABLE_EXT.has(pathname.slice(dot).toLowerCase());
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
