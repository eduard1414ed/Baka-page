// @ts-check
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import remarkImageFigure from './src/plugins/remark-image-figure.mjs';
import remarkEpisodeCover from './src/plugins/remark-episode-cover.mjs';
import remarkAdLabel from './src/plugins/remark-ad-label.mjs';
import remarkSpoiler from './src/plugins/remark-spoiler.mjs';
import remarkVideo from './src/plugins/remark-video.mjs';
import remarkLinkList from './src/plugins/remark-link-list.mjs';
import remarkBlockLabel from './src/plugins/remark-block-label.mjs';
import remarkAnime from './src/plugins/remark-anime.mjs';
import remarkTimecode from './src/plugins/remark-timecode.mjs';
import optimizeUploadsIntegration from './src/plugins/optimize-uploads-integration.mjs';
import ogImagesIntegration from './src/plugins/og-images-integration.mjs';
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
	integrations: [optimizeUploadsIntegration(), ogImagesIntegration()],
	markdown: {
		// Порядок важен: спойлер должен видеть уже сгруппированные картинки/галереи.
		remarkPlugins: [
			remarkDirective,
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
			remarkAnime,
			remarkTimecode,
			remarkSpoiler,
		],
	},
});
