// Робот на GitHub Actions (.github/workflows/sync-episodes.yml): по расписанию
// сверяет RSS подкаста (src/lib/podcastFeed.mjs) со списком постов и заводит
// черновик для каждого выпуска, у которого ещё нет поста — только технические
// поля (заголовок, дата, категория, audioGuid), текст и тайтлы дописывает автор
// в CMS. Уже существующие посты (в том числе черновики) не трогает никогда —
// только создаёт новые файлы, см. тз/04-выпуски-и-плеер.md.
//
// Запуск: node scripts/sync-episodes.mjs — руками не нужен, но можно и вручную.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fetchFeedItems } from '../src/lib/podcastFeed.mjs';
import { htmlToMarkdown } from '../src/lib/htmlToMarkdown.mjs';
import { downloadEpisodeCover, writeCoverManifest } from './episode-cover-lib.mjs';

export const POSTS_DIR = new URL('../src/content/posts/', import.meta.url);
export const AUDIO_GUID_RE = /^audioGuid:\s*['"]?([^'"\n]+?)['"]?\s*$/m;

async function collectKnownGuids() {
	const files = (await readdir(POSTS_DIR)).filter((name) => name.endsWith('.md'));
	const known = new Set();

	for (const file of files) {
		const text = await readFile(new URL(file, POSTS_DIR), 'utf8');
		const match = text.match(AUDIO_GUID_RE);
		if (match) known.add(match[1]);
	}

	return known;
}

// Число из ссылки на выпуск (.../ep-150) — свой, стабильный ID у Mave, проще
// и надёжнее транслитерации заголовка. Если вдруг ссылки нет (RSS отдал не то,
// чего мы ждём) — берём кусок guid, чтобы робот не упал на одном плохом пункте.
function slugFor(episode) {
	const fromLink = episode.link?.match(/\/ep-(\d+)\/?$/);
	if (fromLink) return `ep-${fromLink[1]}`;
	return `ep-${episode.guid.slice(0, 8)}`;
}

function escapeYamlSingleQuoted(value) {
	return value.replace(/'/g, "''");
}

function toFrontmatterDate(pubDate) {
	// pubDate может отсутствовать, если RSS отдал битую запись — тогда берём
	// сегодняшний день, чтобы черновик всё равно завёлся и его было видно в CMS.
	const date = pubDate ?? new Date();
	return date.toISOString().slice(0, 10);
}

// Обложку и описание не скачиваем и не храним у себя — так же, как и с аудио
// (CLAUDE.md), это ссылки прямо на хостинг подкаста. Обложка — обычная
// картинка в тексте поста, не заведена как файл поста (это отдельный,
// управляемый через CMS путь, см. тз/04-выпуски-и-плеер.md).
export function buildBody(episode) {
	const parts = [];
	if (episode.imageUrl) parts.push(`![Обложка выпуска](${episode.imageUrl})`);

	const description = htmlToMarkdown(episode.descriptionHtml);
	if (description) parts.push(description);

	return parts.join('\n\n');
}

function buildDraft(episode) {
	const title = escapeYamlSingleQuoted(episode.title);
	const guid = escapeYamlSingleQuoted(episode.guid);
	const date = toFrontmatterDate(episode.pubDate);
	const body = buildBody(episode);

	return `---
title: '${title}'
date: ${date}
category: podcast
audioGuid: '${guid}'
draft: true
---

${body}
`;
}

async function main() {
	const [known, episodes] = await Promise.all([collectKnownGuids(), fetchFeedItems()]);

	if (episodes.length === 0) {
		console.log('RSS пуст или недоступен — нечего сверять в этот раз.');
		return;
	}

	const missing = episodes.filter((episode) => !known.has(episode.guid));

	if (missing.length === 0) {
		console.log('Все выпуски из RSS уже есть постами.');
		return;
	}

	console.log(`Новых выпусков без поста: ${missing.length}.`);

	for (const episode of missing) {
		const slug = slugFor(episode);
		const path = new URL(`${slug}.md`, POSTS_DIR);
		await writeFile(path, buildDraft(episode), 'utf8');
		console.log(`→ src/content/posts/${slug}.md (${episode.title})`);

		// Сразу скачиваем и сжимаем обложку. Хостинг подкаста отдаёт квадрат
		// 2000×2000 весом 1–5 МБ и сжимать не умеет (см. src/lib/episodeCover.mjs),
		// поэтому без этого шага каждый новый выпуск возвращал бы на свою страницу
		// мегабайт картинки. Ссылка в теле поста остаётся исходной — подменой
		// занимается сборка (src/plugins/remark-episode-cover.mjs).
		//
		// Сбой не должен мешать главному: пост уже создан, а страница без сжатой
		// обложки просто покажет прямую ссылку на хостинг — тяжело, но работает.
		// Добрать потом: node scripts/fetch-episode-covers.mjs
		try {
			const result = await downloadEpisodeCover(episode.imageUrl);
			if (result.status === 'done') {
				console.log(`  обложка сжата: ${(result.sourceBytes / 1024).toFixed(0)} КБ → ${(result.outBytes / 1024).toFixed(0)} КБ`);
			}
		} catch (error) {
			console.error(`  обложку сжать не удалось: ${error.message}`);
		}
	}

	// Список скачанных обложек — его читает сборка сайта, без обновления новые
	// обложки на страницах не появятся (см. src/lib/episodeCover.mjs).
	await writeCoverManifest();

	console.log('Готово.');
}

// import.meta.url === process.argv[1] (через file://) — запускаем main() только
// при прямом вызове (node scripts/sync-episodes.mjs), не при импорте экспортов
// (используется в разовом скрипте добора обложки/описания в старые черновики).
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
	main();
}
