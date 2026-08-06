// Робот на GitHub Actions (.github/workflows/sync-anime.yml): после каждого пуша
// в src/content/posts ищет в текстах меток :anime[...]{id="" source="" source-id=""}
// (ставит кнопка «Аниме» в тексте) и ::anime-ref{id="" source="" source-id=""}
// (ставит поле «Тайтлы поста», для тайтлов, которых в тексте вообще нет) —
// обе формы регистрирует public/admin/index.html. Которых ещё нет
// в справочнике (src/content/anime/) — донабирает данные, точно по
// source+sourceId, без поиска по названию, значит без риска перепутать похожие
// тайтлы (см. тз/03-тайтлы.md, «подводные камни»).
//
// Запуск: node scripts/sync-anime.mjs — руками не нужен, но можно и вручную,
// например чтобы сразу проверить, что робот всё нашёл правильно.

import { readdir, readFile, access } from 'node:fs/promises';
import * as shikimori from './anime-sources/shikimori.mjs';
import * as anilist from './anime-sources/anilist.mjs';
import { writeAnimeEntry, sleep, ANIME_CONTENT_DIR } from './anime-lib.mjs';

const SOURCES_BY_ID = { shikimori, anilist };
const PAUSE_MS = 1200;

const POSTS_DIR = new URL('../src/content/posts/', import.meta.url);

const MARKER_RE = /:{1,2}anime(?:-ref)?(?:\[[^\]]*\])?\{id="([^"]+)"\s+source="([^"]+)"\s+source-id="(\d+)"\}/g;

async function collectMarkers() {
	const files = (await readdir(POSTS_DIR)).filter((name) => name.endsWith('.md'));
	const found = new Map(); // id -> {id, source, sourceId}

	for (const file of files) {
		const text = await readFile(new URL(file, POSTS_DIR), 'utf8');
		for (const match of text.matchAll(MARKER_RE)) {
			const [, id, source, sourceIdRaw] = match;
			if (!found.has(id)) found.set(id, { id, source, sourceId: Number(sourceIdRaw) });
		}
	}

	return [...found.values()];
}

async function hasEntry(id) {
	try {
		await access(new URL(`${id}.json`, ANIME_CONTENT_DIR));
		return true;
	} catch {
		return false;
	}
}

async function main() {
	const markers = await collectMarkers();
	const missing = [];
	for (const marker of markers) {
		if (!(await hasEntry(marker.id))) missing.push(marker);
	}

	if (missing.length === 0) {
		console.log('Все размеченные тайтлы уже есть в справочнике.');
		return;
	}

	console.log(`Новых меток без справочника: ${missing.length}.`);

	for (let i = 0; i < missing.length; i++) {
		const { id, source, sourceId } = missing[i];
		const sourceModule = SOURCES_BY_ID[source];

		if (!sourceModule) {
			console.error(`→ ${id}: неизвестный источник «${source}», пропускаю.`);
			continue;
		}

		console.log(`→ ${id}: добираю данные из ${sourceModule.label} (id ${sourceId})…`);
		try {
			const result = await sourceModule.findById(sourceId);
			if (!result) {
				console.error(`  тайтл с id ${sourceId} в ${sourceModule.label} не нашёлся (мог быть удалён).`);
				continue;
			}
			await writeAnimeEntry(id, sourceModule, result);
			console.log(`  сохранено: src/content/anime/${id}.json`);
		} catch (error) {
			console.error(`  ошибка: ${error.message}`);
		}

		if (i < missing.length - 1) await sleep(PAUSE_MS);
	}

	console.log('Готово.');
}

main();
