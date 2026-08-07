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

// https://astro.build/config
export default defineConfig({
	integrations: [optimizeUploadsIntegration()],
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
