// @ts-check
import { defineConfig } from 'astro/config';
import remarkDirective from 'remark-directive';
import remarkImageFigure from './src/plugins/remark-image-figure.mjs';

// https://astro.build/config
export default defineConfig({
	markdown: {
		remarkPlugins: [remarkDirective, remarkImageFigure],
	},
});
