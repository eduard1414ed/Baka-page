// Каталог тайтлов: один список на три страницы — сам каталог `/anime/`,
// блок каталога на главной и (через счётчик упоминаний) страницу тайтла.
//
// Считает три вещи, и все три обязаны совпадать везде:
//   * порядок добавления и номер `CAT. 001` (см. src/data/animeOrder.js);
//   * сколько раз тайтл упоминался — тем же кодом, что рисует упоминания
//     на самой странице тайтла, иначе в каталоге было бы «1 упоминание»,
//     а внутри три карточки;
//   * по какому тексту тайтл ищется в каталоге.
//
// УКАЗАТЕЛЬ УПОМИНАНИЙ СЧИТАЕТСЯ ДОРОГО: он разбирает все расшифровки архива
// (141 файл, 24 900 реплик). За сборку его просят три страницы, поэтому здесь
// он запоминается. Ключ — размеры трёх коллекций: если страница вдруг придёт
// с другим набором данных, ответ будет посчитан заново, а не выдан чужой.

import { sharedMentionIndex, postsForAnime } from './animeMentionIndex.mjs';
// Приведение текста к сравнимому виду и запись латиницы кириллицей — в одном
// месте на сборку и на браузер: скрипт каталога приводит запрос той же
// функцией, которой сборка привела данные.
import { foldCatalog, latinSearchForms } from './translit.mjs';
import { ANIME_ORDER } from '../data/animeOrder.js';

let cache = null;
let orderCache = null;

/**
 * Порядок добавления и номер `CAT. 001` — БЕЗ подсчёта упоминаний.
 *
 * Номер нужен двоим: каталогу (там он часть карточки) и горизонтальной марке,
 * которая стоит на главной и в блоках «Упоминается». Марке при этом не нужны
 * ни посты, ни расшифровки — а указатель упоминаний разбирает 141 файл, и звать
 * его ради одного числа было бы дорого. Поэтому порядок считается отдельно,
 * а `buildCatalog` берёт его отсюда же: правило «кто каким по счёту» живёт
 * в одном месте, и разъехаться номерам негде.
 *
 * @returns {Map<string, { order: number, code: string }>}
 */
export function catalogCodes(animeList) {
	if (orderCache && orderCache.key === animeList.length) return orderCache.codes;

	// Чего нет в списке порядка — в конец, по имени. Число берём заведомо
	// больше длины списка: «неизвестно когда» это «позже всех известных».
	const rank = new Map(ANIME_ORDER.map((id, position) => [id, position]));
	const last = ANIME_ORDER.length;

	const codes = new Map(
		[...animeList]
			.sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last) || a.id.localeCompare(b.id))
			.map((entry, position) => [entry.id, { order: position + 1, code: `CAT. ${String(position + 1).padStart(3, '0')}` }]),
	);

	orderCache = { key: animeList.length, codes };
	return codes;
}

/**
 * @returns {{
 *   entry: object, id: string, title: string, count: number,
 *   order: number, code: string, search: string
 * }[]} В порядке добавления в справочник.
 */
export function buildCatalog({ posts, transcripts, animeList }) {
	const key = `${posts.length}:${transcripts.length}:${animeList.length}`;
	if (cache && cache.key === key) return cache.entries;

	const index = sharedMentionIndex({ posts, transcripts, animeList });
	const codes = catalogCodes(animeList);

	const entries = [...animeList]
		.sort((a, b) => (codes.get(a.id)?.order ?? 0) - (codes.get(b.id)?.order ?? 0))
		.map((entry) => {
			const { titleRu, titleOriginal, studio, aliases } = entry.data;

			// Ищем по русскому названию, оригинальному, студии и вариантам
			// написания. Плюс латинская часть, переписанная кириллицей: без неё
			// «гибли» не находил ни одного из трёх тайтлов Ghibli, хотя это
			// самый вероятный запрос в каталог, не являющийся названием.
			const latin = [titleOriginal, studio].filter(Boolean).join(' ');
			const searchable = [titleRu, latin, ...(aliases ?? []), ...latinSearchForms(latin)]
				.filter(Boolean)
				.join(' ');

			return {
				entry,
				id: entry.id,
				// У тайтлов из AniList русского названия не бывает вовсе —
				// тогда заголовком идёт оригинальное, и это не ошибка.
				title: titleRu || titleOriginal,
				count: postsForAnime(entry.id, posts, index).length,
				...codes.get(entry.id),
				search: foldCatalog(searchable),
			};
		});

	cache = { key, entries };
	return entries;
}
