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
//
// Запуск с флагом --refresh перечитывает из источника ТАЙТЛЫ, КОТОРЫЕ УЖЕ ЕСТЬ
// в справочнике: нужен, когда в данных появилось новое поле (так добирались
// альтернативные названия) или когда у тайтла обновилась обложка. Правленое
// руками при этом не затирается — см. `manual` в scripts/anime-lib.mjs.

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

// Тайтлы, которые уже лежат в справочнике: id и то, откуда они взяты.
// Источник спрашиваем строго по source+sourceId из самого файла, без поиска
// по названию — иначе на обновлении можно подменить тайтл похожим.
async function collectExisting() {
	const files = (await readdir(ANIME_CONTENT_DIR)).filter((name) => name.endsWith('.json'));
	const found = [];

	for (const file of files) {
		const data = JSON.parse(await readFile(new URL(file, ANIME_CONTENT_DIR), 'utf8'));
		if (data.source && data.sourceId) found.push({ id: data.id, source: data.source, sourceId: data.sourceId });
	}

	return found;
}

async function main() {
	const refresh = process.argv.includes('--refresh');

	const targets = refresh ? await collectExisting() : [];

	if (!refresh) {
		const markers = await collectMarkers();
		for (const marker of markers) {
			if (!(await hasEntry(marker.id))) targets.push(marker);
		}
	}

	if (targets.length === 0) {
		console.log(refresh ? 'Справочник пуст — обновлять нечего.' : 'Все размеченные тайтлы уже есть в справочнике.');
		return;
	}

	console.log(refresh ? `Перечитываю из источника: ${targets.length}.` : `Новых меток без справочника: ${targets.length}.`);

	for (let i = 0; i < targets.length; i++) {
		const { id, source, sourceId } = targets[i];
		const sourceModule = SOURCES_BY_ID[source];

		if (!sourceModule) {
			console.error(`→ ${id}: неизвестный источник «${source}», пропускаю.`);
			continue;
		}

		console.log(`→ ${id}: ${refresh ? 'перечитываю' : 'добираю'} данные из ${sourceModule.label} (id ${sourceId})…`);
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

		if (i < targets.length - 1) await sleep(PAUSE_MS);
	}

	console.log('Готово.');
}

main();
