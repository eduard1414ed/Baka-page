import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Шесть категорий поста. Одна категория на пост.
export const categories = [
	{ id: 'podcast', label: 'Подкаст' },
	{ id: 'videoessay', label: 'Видеоэссе' },
	{ id: 'note', label: 'Заметка' },
	{ id: 'review', label: 'Обзор' },
	{ id: 'interview', label: 'Интервью' },
	{ id: 'bonus', label: 'Бонус' },
] as const;

const categoryIds = categories.map((c) => c.id) as [string, ...string[]];

const posts = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			date: z.coerce.date(),
			category: z.enum(categoryIds),
			cover: image().optional(),
			youtube: z.string().url().optional(),
			video: z.string().optional(),
			audioGuid: z.string().optional(),
			buttons: z
				.array(
					z.object({
						label: z.string(),
						url: z.string().url(),
						style: z.enum(['primary', 'secondary']).default('secondary'),
					}),
				)
				.optional(),
			transcript: z.string().optional(),
			script: z.string().optional(),
			draft: z.boolean().default(false),
		}),
});

export const collections = { posts };
