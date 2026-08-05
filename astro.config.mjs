// @ts-check
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import remarkImageFigure from './src/plugins/remark-image-figure.mjs';
import remarkSpoiler from './src/plugins/remark-spoiler.mjs';

// https://astro.build/config
export default defineConfig({
	markdown: {
		// Порядок важен: спойлер должен видеть уже сгруппированные картинки/галереи.
		remarkPlugins: [remarkDirective, remarkImageFigure, remarkSpoiler],
	},
});
