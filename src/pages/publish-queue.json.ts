import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// Список запланированных постов — для робота отложенной публикации
// (Cloudflare Cron Trigger, см. тз/09-отложенный-постинг.md). Список маленький
// (только черновики с заданным publishAt), чтобы роботу не пришлось разбирать
// весь сайт каждую минуту. Генерируется при каждой сборке, значит после
// публикации/переноса даты список обновится на следующем пуше.
export const prerender = true;

export const GET: APIRoute = async () => {
	const posts = await getCollection('posts', ({ data }) => data.draft && !!data.publishAt);

	const queue = posts
		.map((post) => ({
			// Путь к файлу поста в репозитории — по нему робот находит файл через
			// GitHub API и снимает галочку «Черновик».
			path: `src/content/posts/${post.id}.md`,
			publishAt: post.data.publishAt!.toISOString(),
		}))
		.sort((a, b) => a.publishAt.localeCompare(b.publishAt));

	return new Response(JSON.stringify(queue), {
		headers: { 'Content-Type': 'application/json' },
	});
};
