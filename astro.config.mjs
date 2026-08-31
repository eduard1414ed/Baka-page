// @ts-check
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import remarkColonText from './src/plugins/remark-colon-text.mjs';
import remarkImageFigure from './src/plugins/remark-image-figure.mjs';
import remarkEpisodeCover from './src/plugins/remark-episode-cover.mjs';
import remarkLeadCover from './src/plugins/remark-lead-cover.mjs';
import remarkAdLabel from './src/plugins/remark-ad-label.mjs';
import remarkSpoiler from './src/plugins/remark-spoiler.mjs';
import remarkVideo from './src/plugins/remark-video.mjs';
import remarkLinkList from './src/plugins/remark-link-list.mjs';
import remarkBlockLabel from './src/plugins/remark-block-label.mjs';
import remarkPostRef from './src/plugins/remark-post-ref.mjs';
import remarkAnime from './src/plugins/remark-anime.mjs';
import remarkTimecode from './src/plugins/remark-timecode.mjs';
import optimizeUploadsIntegration from './src/plugins/optimize-uploads-integration.mjs';
import ogImagesIntegration from './src/plugins/og-images-integration.mjs';
import postLinksIntegration from './src/plugins/post-links-integration.mjs';
import { SITE_URL } from './src/lib/site.mjs';

// https://astro.build/config
export default defineConfig({
	// Главный адрес сайта. Без него Astro не знает, на каком домене живёт сайт,
	// и не из чего было бы построить абсолютные ссылки — а они обязательны
	// в canonical, og:image, карте сайта и RSS: относительный путь там
	// не понимают ни поисковик, ни телеграм.
	site: SITE_URL,
	// ПОРЯДОК ВАЖЕН: Astro выполняет хуки сборки по очереди, а картинки превью
	// рисуются в том числе из jpeg-копий, которые создаёт первый шаг.
	// Поменяете местами — превью выпусков останутся без исходников.
	// Третий ничего не делает с файлами — только говорит вслух про ссылки
	// в никуда у опубликованных постов, поэтому его место в списке безразлично.
	integrations: [optimizeUploadsIntegration(), ogImagesIntegration(), postLinksIntegration()],
	markdown: {
		// Порядок важен: спойлер должен видеть уже сгруппированные картинки/галереи.
		remarkPlugins: [
			remarkDirective,
			// Двоеточие перед словом («Re:Zero», «Erid:2Vtz…», «в 20:00») разбор
			// считает меткой и слово после него теряет. Возвращаем такие места
			// в текст ДО всех остальных плагинов — они должны видеть текст целым.
			remarkColonText,
			// Обычная markdown-картинка с хостинга подкаста → сжатая копия
			// из public/episodes/. Он же убирает из текста картинку, которая
			// уже показана в шапке выпуска или бонуса.
			//
			// ИДЁТ ДО remarkImageFigure, И ЭТО ОБЯЗАТЕЛЬНО: тот превращает блок
			// `::image` в готовую вёрстку с подписью и номером, и после него
			// узла-директивы, который надо убрать, в дереве уже нет. Раньше
			// плагин стоял после — тогда он умел убирать только markdown-картинку
			// с хостинга подкаста, а её remarkImageFigure и не трогает.
			remarkEpisodeCover,
			// Обложка поста в начало текста, если картинок в тексте нет ни одной.
			// СТРОГО ЗДЕСЬ: после remarkEpisodeCover — иначе обложка выпуска,
			// которую тот вот-вот уберёт из тела, посчиталась бы картинкой
			// в тексте; до remarkAdLabel и remarkImageFigure — чтобы маркировка
			// рекламы встала под наш кадр, а сам кадр разобрал тот же код,
			// что и обычные иллюстрации. Зачем это нужно — в шапке плагина.
			remarkLeadCover,
			// Маркировка рекламы из поля поста. МЕЖДУ ЭТИМИ ДВУМЯ И НИГДЕ БОЛЬШЕ:
			// после remarkEpisodeCover — чтобы не встать под обложку выпуска,
			// которую тот только что убрал из тела; до remarkImageFigure —
			// чтобы `::image` и `::video` были ещё директивами и медиа можно было
			// отличить от текста. Зачем это нужно — в шапке самого плагина.
			remarkAdLabel,
			remarkImageFigure,
			remarkVideo,
			// Собирает подряд идущие `::link` в одну врезку — до спойлера,
			// чтобы внутри спрятанного блока врезка была уже одним узлом,
			// а не россыпью отдельных маркеров.
			remarkLinkList,
			// Подпись блока внутри текста — тоже до спойлера, чтобы спрятанный
			// блок уносил её вместе с собой одним куском.
			remarkBlockLabel,
			// Врезка на другой материал сайта. СТРОГО ЗДЕСЬ:
			//   после remarkBlockLabel — врезка сама рисует свою подпись
			//     `[ ещё по теме ]`, и чужая подпись, поставленная автором
			//     отдельным блоком, к этому моменту уже разобрана;
			//   до remarkAnime — иначе название тайтла внутри заголовка врезки
			//     стало бы ссылкой на тайтл ВНУТРИ ссылки на материал, а вложенных
			//     ссылок не бывает: у слова пропало бы нажатие целиком;
			//   до remarkSpoiler — чтобы спрятанный блок уносил врезку с собой
			//     одним куском, как уже уносит галерею и список ссылок.
			remarkPostRef,
			remarkAnime,
			remarkTimecode,
			remarkSpoiler,
		],
	},
	// ── ИМЕНА ФАЙЛОВ СТИЛЕЙ И СКРИПТОВ — БЕЗ ХЕША СОДЕРЖИМОГО ──
	//
	// ЗАЧЕМ. Хеш в имени меняется от любой правки стиля, а имя файла стоит
	// ссылкой в КАЖДОЙ собранной странице: 1398 из 1403. То есть правка одного
	// цвета переписывала все страницы сайта, и заливка зеркала стоила
	// 1405 операций записи вместо девяти. Замер 14 августа 2026: за три дня
	// 33 290 операций при бесплатных 10 000 в месяц.
	//
	// ПОЧЕМУ ЭТО НЕ ОТДАЁТ ЧИТАТЕЛЮ СТАРЫЙ САЙТ. Хеш в имени нужен затем,
	// чтобы файл можно было кэшировать навсегда, — а мы его навсегда
	// не кэшируем: обе копии отдают `public, max-age=0, must-revalidate`,
	// то есть браузер переспрашивает сервер при каждом заходе. Проверено
	// запросом к живым `bakapodcast.com` и `ru.bakapodcast.com`.
	// Со стабильным именем момент выкладки становится даже безопаснее:
	// сейчас старый файл стирается, и читатель со старой страницей на руках
	// получает 404 вместо стилей.
	//
	// ЛОВУШКА, ИЗ-ЗА КОТОРОЙ ЗДЕСЬ ФУНКЦИЯ, А НЕ СТРОКА `[name]`. Имя бандла
	// сборщик берёт у исходного файла, и таких имён по несколько: `index` есть
	// у главной и у каталога, `[slug]` — у страницы поста и у страницы тайтла.
	// Сними хеш в лоб — два разных файла затрут друг друга, и половина сайта
	// останется без стилей. Поэтому имя выводится из ПУТИ исходника, который
	// уникален; путь сборщик отдаёт в `originalFileNames`.
	//
	// У общих кусков (Layout, PostCard, AnimeBadge…) `originalFileNames` пуст,
	// но их собственные имена уникальны — берём как есть.
	//
	// КАРТИНКИ ХЕШ СОХРАНЯЮТ. У них имя берётся от файла на диске, разные
	// картинки легко зовутся одинаково, а подмена картинки на чужую тише
	// и хуже, чем лишняя заливка. Экономии от них всё равно нет: имя картинки
	// стоит на одной странице, а не на всех.
	vite: {
		build: {
			rollupOptions: {
				output: {
					assetFileNames(info) {
						const имя = String(info.names?.[0] ?? info.name ?? '');
						if (!имя.endsWith('.css')) return '_astro/[name].[hash][extname]';
						return `_astro/${стабильноеИмя(info, имя)}[extname]`;
					},
					entryFileNames: '_astro/[name].js',
					chunkFileNames: '_astro/[name].js',
				},
			},
		},
	},
});

/**
 * Устойчивое имя для файла стилей: одно и то же от сборки к сборке
 * и разное у разных исходников.
 */
function стабильноеИмя(info, имя) {
	const исходник = String(info.originalFileNames?.[0] ?? '');
	const m = исходник.match(/^virtual:astro:page:src\/pages\/(.+?)@_@astro$/);
	// `src/pages/anime/[slug]` → `anime-slug`; квадратные скобки убираем,
	// косые превращаем в дефис — иначе получилась бы вложенная папка.
	if (m) return m[1].replace(/[[\]]/g, '').replace(/\//g, '-');
	return имя.replace(/\.css$/, '');
}
