// Разово скачать и сжать обложки всех выпусков.
//
//   node scripts/fetch-episode-covers.mjs --dry-run   посмотреть, что будет
//   node scripts/fetch-episode-covers.mjs             сделать
//
// Запускать руками. Идемпотентно: уже сжатые обложки пропускает, ничего не
// перекачивая, — можно запускать повторно после новых выпусков. Но обычно этого
// не нужно: робот scripts/sync-episodes.mjs делает то же самое для каждого
// нового выпуска сам.
//
// Почему копируем обложки к себе, а аудио — нет: см. src/lib/episodeCover.mjs.

import { readdir, readFile } from 'node:fs/promises';
import { fetchFeedItems } from '../src/lib/podcastFeed.mjs';
import { coverIdFromUrl } from '../src/lib/episodeCover.mjs';
import { downloadEpisodeCover, coverAlreadyDone, writeCoverManifest } from './episode-cover-lib.mjs';

const POSTS_DIR = new URL('../src/content/posts/', import.meta.url);
const dryRun = process.argv.includes('--dry-run');

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} КБ`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

// Собираем адреса из двух мест, а не только из фида: обложка может остаться
// в теле уже написанного поста после того, как в фиде её заменили.
async function collectCoverUrls() {
	const urls = new Map(); // id обложки -> адрес (дедупликация: у 6 выпусков обложка общая)

	const add = (url) => {
		const id = coverIdFromUrl(url);
		if (id && !urls.has(id)) urls.set(id, url);
	};

	const items = await fetchFeedItems();
	for (const item of items) add(item.imageUrl);
	console.log(`Из RSS: ${items.length} выпусков.`);

	const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
	let fromPosts = 0;
	for (const file of files) {
		const text = await readFile(new URL(file, POSTS_DIR), 'utf8');
		for (const match of text.matchAll(/https:\/\/cdn\.mave\.digital\/\S+?\.(?:jpg|jpeg|png)/gi)) {
			const before = urls.size;
			add(match[0]);
			if (urls.size > before) fromPosts += 1;
		}
	}
	console.log(`Из текстов постов добавилось обложек, которых нет в RSS: ${fromPosts}.`);

	return [...urls.values()];
}

async function main() {
	const urls = await collectCoverUrls();
	const todo = urls.filter((url) => !coverAlreadyDone(url));

	console.log(`\nУникальных обложек: ${urls.length}. Уже сжато: ${urls.length - todo.length}. К работе: ${todo.length}.`);

	if (todo.length === 0) {
		// Список всё равно перезаписываем: он мог отстать от папки, например если
		// файлы приехали из чужого коммита, а список — нет.
		const total = await writeCoverManifest();
		console.log(`Всё уже сделано, качать нечего. В списке обложек: ${total}.`);
		return;
	}

	// По замеру на живых обложках: оригинал около 1 МБ, на выходе примерно
	// 166 КБ на обложку в двух размерах вместе.
	console.log(`Скачать придётся примерно ${mb(todo.length * 1_000_000)}, в репозитории останется около ${mb(todo.length * 170_000)}.`);

	if (dryRun) {
		console.log('\n--dry-run: ничего не делаю. Уберите флаг, чтобы выполнить.');
		return;
	}

	let done = 0;
	let failed = 0;
	let sourceBytes = 0;
	let outBytes = 0;

	for (const [index, url] of todo.entries()) {
		const id = coverIdFromUrl(url);
		try {
			const result = await downloadEpisodeCover(url);
			if (result.status === 'done') {
				done += 1;
				sourceBytes += result.sourceBytes;
				outBytes += result.outBytes;
				console.log(`[${index + 1}/${todo.length}] ${id}: ${kb(result.sourceBytes)} → ${kb(result.outBytes)}`);
			}
		} catch (error) {
			// Одна недоступная обложка не должна валить весь прогон: страница
			// такого выпуска просто останется с прямой ссылкой на хостинг.
			failed += 1;
			console.error(`[${index + 1}/${todo.length}] ${id}: ОШИБКА — ${error.message}`);
		}
	}

	// Обязательно: именно этот список читает сборка сайта, без него сжатые
	// обложки на страницах не появятся.
	const total = await writeCoverManifest();

	console.log(`\nГотово. Сжато: ${done}. Ошибок: ${failed}. В списке обложек: ${total}.`);
	if (done > 0) {
		console.log(`Было ${mb(sourceBytes)}, стало ${mb(outBytes)} — в ${(sourceBytes / outBytes).toFixed(0)} раз меньше.`);
	}
	if (failed > 0) {
		console.log('Сбойные можно добрать повторным запуском — готовые он пропустит.');
	}
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
