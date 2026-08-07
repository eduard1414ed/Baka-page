// Обложки выпусков подкаста, сжатые и положенные к себе в public/episodes/.
//
// Зачем понадобилось. Хостинг подкаста (Mave, `cdn.mave.digital`) отдаёт обложку
// одним размером — квадрат 2000×2000, от 1 до 5 МБ, и сжимать её не умеет:
// проверены восемь вариантов параметров в адресе (`?w=`, `?width=`, `?resize=`,
// `?format=webp` и другие) — все отдают тот же файл байт в байт. В RSS других
// размеров тоже нет. Вдобавок хостинг присылает `Cache-Control: no-cache`,
// то есть браузер качает эти мегабайты заново при каждом заходе на страницу.
// Сжатие в webp дало по архиву 208 МБ → 26 МБ, в 8 раз меньше.
//
// Аудио к себе по-прежнему НЕ копируем — там дело в статистике прослушиваний
// хостинга (см. этап 4). На картинку это правило не распространяется: статистика
// считает скачивания аудиофайла, обложка к ней отношения не имеет. Раньше запрет
// был перенесён на обложки по инерции.
//
// Два размера, не больше — требование CLAUDE.md.

// Список уже скачанных обложек — по id картинки. Пишется скриптами
// (scripts/episode-cover-lib.mjs, writeCoverManifest) из настоящего содержимого
// папки public/episodes/ после каждого скачивания.
//
// Почему списком, а не проверкой файлов на диске: этот модуль попадает
// в сборщик Astro, а там `import.meta.url` указывает не на исходный файл,
// и проверка существования файла молча отвечала «нет» — обложка на странице
// оставалась в исходном мегабайтном виде.
//
// Почему js-файл, а не json: этот же модуль импортируют скрипты, которые
// запускаются обычным node, а node требует для json особый синтаксис импорта,
// который сборщик Astro понимает иначе. Обычный js-модуль читается одинаково
// и там и там — тот же приём, что у src/data/platforms.js.
import COVER_IDS from '../data/episodeCovers.mjs';

export const EPISODE_COVER_WIDTHS = [640, 1280];

const COVER_HOST = 'cdn.mave.digital';
const KNOWN = new Set(COVER_IDS);

/**
 * Адрес обложки на хостинге подкаста → базовое имя файла у нас.
 *
 * Берём id самой картинки из адреса, а не guid выпуска: в архиве есть выпуски,
 * которые делят одну обложку (шесть выпусков на одну картинку), — при таком
 * имени она скачается и сожмётся один раз, а не шесть.
 *
 * @returns {string | null} null, если адрес не с хостинга подкаста.
 */
export function coverIdFromUrl(url) {
	if (!url || !url.includes(COVER_HOST)) return null;

	let pathname;
	try {
		pathname = new URL(url).pathname;
	} catch {
		return null;
	}

	const file = pathname.slice(pathname.lastIndexOf('/') + 1);
	const dot = file.lastIndexOf('.');
	const id = dot === -1 ? file : file.slice(0, dot);
	// Только то, что похоже на идентификатор: заодно защита от того, чтобы
	// случайный адрес не превратился в путь с ../ внутри.
	return /^[\w-]+$/.test(id) ? id : null;
}

/**
 * Варианты сжатой обложки для srcset.
 * @returns {{width:number, src:string}[]} Пустой массив, если адрес не наш.
 */
export function getEpisodeCoverSrcs(url) {
	const id = coverIdFromUrl(url);
	if (!id) return [];
	return EPISODE_COVER_WIDTHS.map((width) => ({ width, src: `/episodes/${id}-${width}w.webp` }));
}

/**
 * Скачана ли уже эта обложка. Нужно, чтобы новый выпуск не остался с битой
 * картинкой в промежутке между появлением в RSS и запуском робота: если файлов
 * ещё нет, страница честно показывает прямую ссылку на хостинг подкаста.
 */
export function hasLocalEpisodeCover(url) {
	const id = coverIdFromUrl(url);
	return Boolean(id) && KNOWN.has(id);
}

/**
 * Готовый набор для вывода: локальные сжатые файлы, если они есть, иначе
 * исходная ссылка на хостинг подкаста.
 * @returns {{src:string, srcset:string|null}}
 */
export function resolveEpisodeCover(url) {
	if (!hasLocalEpisodeCover(url)) return { src: url, srcset: null };

	const srcs = getEpisodeCoverSrcs(url);
	return {
		// В src — самый маленький: его берут браузеры, не понимающие srcset,
		// и им лучше получить лёгкий файл, чем тяжёлый.
		src: srcs[0].src,
		srcset: srcs.map((v) => `${v.src} ${v.width}w`).join(', '),
	};
}
