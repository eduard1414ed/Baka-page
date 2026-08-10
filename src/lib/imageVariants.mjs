// Два размера согласно CLAUDE.md: телефон и десктоп, не больше.
export const IMAGE_WIDTHS = [640, 1280];

const OPTIMIZABLE_EXT = new Set(['.jpg', '.jpeg', '.png']);

export function isOptimizableImage(pathname) {
	const dot = pathname.lastIndexOf('.');
	if (dot === -1) return false;
	return OPTIMIZABLE_EXT.has(pathname.slice(dot).toLowerCase());
}

/**
 * Основа имени сжатых копий. РАСШИРЕНИЕ ВХОДИТ В НЕЁ, И ЭТО ГЛАВНОЕ ЗДЕСЬ:
 * «1.png» → «1-png», «1.jpeg» → «1-jpeg».
 *
 * ПОЧЕМУ. Раньше расширение просто отбрасывалось, и два разных файла
 * с одинаковым именем давали ОДНИ И ТЕ ЖЕ копии: `1.png` и `1.jpeg` оба
 * превращались в `1-640w.webp`, `1-1280w.webp` и `1-og.jpg`. Один затирал
 * другой, и на сайт уезжала одна картинка вместо двух.
 *
 * Наступили 10 августа 2026, и не теоретически. Админка предлагает при
 * совпадении имени «сохранить оба» и честно переименовывает — но сравнивает
 * имя ЦЕЛИКОМ, вместе с расширением, поэтому `4.png` рядом с `4.jpeg` для неё
 * два разных файла, и она права. Ломалось уже у нас. В галерее опубликованной
 * заметки «Знакомьтесь: Ёдзи Такэсигэ» вместо четырёх кадров стояли обложки
 * четырёх выпусков подкаста; проверено сравнением пикселей, а не размеров —
 * размеры у всех восьми были 16:9 и совпадали.
 *
 * КОПИЙ ЭТОГО ПРАВИЛА БЫЛО ДВЕ: здесь и в самом скрипте сжатия
 * (src/plugins/optimize-uploads-integration.mjs), который считает имя файла
 * на диске. Разъедься они — страница просила бы один файл, а сборка делала
 * другой, и картинки пропали бы молча. Теперь обе стороны зовут эту функцию.
 *
 * @param {string} filename Имя или путь ДЕКОДИРОВАННЫЙ, без %-кодировки.
 */
export function variantBase(filename) {
	const dot = filename.lastIndexOf('.');
	if (dot === -1) return filename;
	return `${filename.slice(0, dot)}-${filename.slice(dot + 1).toLowerCase()}`;
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
	return encodeURI(`${variantBase(decodeURIComponent(originalSrc))}-og.jpg`);
}

// "/images/uploads/photo%20one.jpeg" -> ["/images/uploads/photo one-jpeg-640w.webp", ...]
// Имя считаем от РЕАЛЬНОГО (декодированного) пути — так же, как это делает
// скрипт сжатия на файловой системе, и той же функцией.
export function getImageVariantSrcs(originalSrc) {
	const base = variantBase(decodeURIComponent(originalSrc));

	return IMAGE_WIDTHS.map((width) => ({
		width,
		src: encodeURI(`${base}-${width}w.webp`),
	}));
}
