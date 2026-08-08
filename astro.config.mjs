// @ts-check
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import remarkImageFigure from './src/plugins/remark-image-figure.mjs';
import remarkEpisodeCover from './src/plugins/remark-episode-cover.mjs';
import remarkSpoiler from './src/plugins/remark-spoiler.mjs';
import remarkVideo from './src/plugins/remark-video.mjs';
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
			remarkImageFigure,
			// Обычная markdown-картинка с хостинга подкаста → сжатая копия
			// из public/episodes/. Работает по другим узлам, чем remarkImageFigure
			// (та разбирает блоки `::image` из админки), поэтому не конфликтуют.
			remarkEpisodeCover,
			remarkVideo,
			remarkAnime,
			remarkTimecode,
			remarkSpoiler,
		],
	},
});
