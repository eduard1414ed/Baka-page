// @ts-check
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import remarkImageFigure from './src/plugins/remark-image-figure.mjs';
import remarkSpoiler from './src/plugins/remark-spoiler.mjs';
import remarkVideo from './src/plugins/remark-video.mjs';
import remarkAnime from './src/plugins/remark-anime.mjs';
import optimizeUploadsIntegration from './src/plugins/optimize-uploads-integration.mjs';

// https://astro.build/config
export default defineConfig({
	integrations: [optimizeUploadsIntegration()],
	markdown: {
		// Порядок важен: спойлер должен видеть уже сгруппированные картинки/галереи.
		remarkPlugins: [remarkDirective, remarkImageFigure, remarkVideo, remarkAnime, remarkSpoiler],
	},
});
