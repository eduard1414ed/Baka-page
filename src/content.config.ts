import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Категории поста. Одна категория на пост.
export const categories = [
	{ id: 'podcast', label: 'Подкаст' },
	{ id: 'videoessay', label: 'Видеоэссе' },
	{ id: 'note', label: 'Заметки' },
	{ id: 'review', label: 'Обзоры' },
	{ id: 'bonus', label: 'Бонусы' },
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
			// Пока проставляется вручную в файле поста. Автозаполнение из разметки
			// названий в тексте — следующий шаг (см. тз/03-тайтлы.md).
			anime: z.array(reference('anime')).optional(),
		}),
});

// Справочник тайтлов. Файлы — кэш данных с Shikimori, их создаёт и обновляет
// scripts/fetch-anime.mjs, сама сборка сайта Shikimori не дёргает никогда.
const anime = defineCollection({
	loader: glob({ pattern: '**/*.json', base: './src/content/anime' }),
	schema: z.object({
		id: z.string(),
		shikimoriId: z.number(),
		titleRu: z.string(),
		titleOriginal: z.string(),
		year: z.number().optional(),
		studio: z.string().optional(),
		// Путь к обложке в public/anime/ — см. src/lib/animePoster.mjs.
		poster: z.string().optional(),
		synopsis: z.string().optional(),
		url: z.string().url().optional(),
	}),
});

export const collections = { posts, anime };
