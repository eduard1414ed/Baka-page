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

const POSTS_DIR = new URL('../src/content/posts/', import.meta.url);
const AUDIO_GUID_RE = /^audioGuid:\s*['"]?([^'"\n]+?)['"]?\s*$/m;

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

function buildDraft(episode) {
	const title = escapeYamlSingleQuoted(episode.title);
	const guid = escapeYamlSingleQuoted(episode.guid);
	const date = toFrontmatterDate(episode.pubDate);

	return `---
title: '${title}'
date: ${date}
category: podcast
audioGuid: '${guid}'
draft: true
---
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
	}

	console.log('Готово.');
}

main();
