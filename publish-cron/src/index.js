/**
 * Отложенная публикация (тз/09-отложенный-постинг.md). Раз в минуту (см. wrangler.jsonc)
 * смотрит на маленький список запланированных постов, который сайт сам публикует
 * по адресу /publish-queue.json при каждой сборке. Если время какого-то поста
 * наступило — снимает у него галочку «Черновик» прямо в GitHub через API
 * и коммитит изменение. Коммит запускает уже существующую автосборку на
 * Cloudflare — сайт публикует пост сам, без участия человека.
 *
 * Если публиковать нечего — не делает вообще ничего (ни одного запроса
 * к GitHub), чтобы не тратить впустую сборки (лимит автосборок в месяц).
 */

const REPO = 'eduard1414ed/Baka-page';
const BRANCH = 'main';

/**
 * Декодирует base64 из GitHub API в текст, с поддержкой кириллицы (UTF-8).
 * @param {string} base64 - Содержимое файла в base64 (может быть с переносами строк).
 * @returns {string} Исходный текст.
 */
function decodeBase64(base64) {
	const binary = atob(base64.replace(/\n/g, ''));
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Кодирует текст в base64 для GitHub API, с поддержкой кириллицы (UTF-8).
 * @param {string} text - Исходный текст.
 * @returns {string} base64.
 */
function encodeBase64(text) {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	bytes.forEach((byte) => {
		binary += String.fromCharCode(byte);
	});
	return btoa(binary);
}

/**
 * Снимает галочку «Черновик» у одного поста в GitHub.
 * @param {string} path - Путь к файлу поста в репозитории.
 * @param {{ GITHUB_TOKEN: string }} env - Секреты воркера.
 * @returns {Promise<'published' | 'skipped'>} Что произошло с постом.
 */
async function publishOne(path, env) {
	const headers = {
		Authorization: `Bearer ${env.GITHUB_TOKEN}`,
		'User-Agent': 'baki-publish-cron',
		Accept: 'application/vnd.github+json',
	};

	const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}`, { headers });

	if (!getRes.ok) {
		throw new Error(`Не смог прочитать ${path} из GitHub: ${getRes.status}`);
	}

	const file = await getRes.json();
	const content = decodeBase64(file.content);
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

	// Пост уже опубликован (например, кто-то сам снял «Черновик» вручную) —
	// ничего не делаем, это не ошибка.
	if (!frontmatterMatch || !/^draft:\s*true\s*$/m.test(frontmatterMatch[1])) {
		return 'skipped';
	}

	const updated = content.replace(/^draft:\s*true\s*$/m, 'draft: false');

	const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
		method: 'PUT',
		headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			message: `Опубликовать по расписанию: ${path}`,
			content: encodeBase64(updated),
			sha: file.sha,
			branch: BRANCH,
		}),
	});

	if (!putRes.ok) {
		throw new Error(`Не смог опубликовать ${path}: ${putRes.status} ${await putRes.text()}`);
	}

	return 'published';
}

/**
 * Одна проверка: посмотреть очередь, опубликовать всё, чему пришло время.
 * @param {{ GITHUB_TOKEN: string, SITE: Fetcher }} env - Секреты и привязки воркера.
 * @returns {Promise<{ checked: number, due: number, published: string[], skipped: string[] }>} Итог проверки.
 */
async function run(env) {
	// Через Service Binding, а не публичный workers.dev-адрес — см. wrangler.jsonc.
	const queueRes = await env.SITE.fetch('https://bakapodcast.com/publish-queue.json');

	if (!queueRes.ok) {
		throw new Error(`Не смог получить publish-queue.json: ${queueRes.status}`);
	}

	/** @type {{ path: string, publishAt: string }[]} */
	const queue = await queueRes.json();
	const now = Date.now();
	const due = queue.filter((item) => new Date(item.publishAt).getTime() <= now);

	const published = [];
	const skipped = [];
	const errors = [];

	// Публикуем по очереди, а не все разом — если что-то одно сломается,
	// остальные посты всё равно должны выйти.
	for (const item of due) {
		try {
			const result = await publishOne(item.path, env);
			(result === 'published' ? published : skipped).push(item.path);
		} catch (err) {
			errors.push(err instanceof Error ? err.message : String(err));
		}
	}

	if (errors.length > 0) {
		// Бросаем ошибку, чтобы запуск засчитался неудачным в логах Cloudflare —
		// на это настроено уведомление на почту (см. тз/09, пункт 7).
		throw new Error(errors.join('; '));
	}

	return { checked: queue.length, due: due.length, published, skipped };
}

export default {
	async scheduled(event, env, ctx) {
		ctx.waitUntil(run(env));
	},

	// Ручной запуск для проверки — без него пришлось бы ждать реальной минуты
	// по расписанию, чтобы убедиться, что робот работает.
	async fetch(request, env) {
		const url = new URL(request.url);

		if (request.method === 'POST' && url.pathname === '/run' && env.RUN_TOKEN && request.headers.get('x-run-token') === env.RUN_TOKEN) {
			try {
				const result = await run(env);
				return new Response(JSON.stringify(result, null, 2), { headers: { 'Content-Type': 'application/json' } });
			} catch (err) {
				return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		return new Response('', { status: 404 });
	},
};
