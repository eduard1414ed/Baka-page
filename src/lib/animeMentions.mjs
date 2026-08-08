// Поиск названий тайтлов в обычном тексте (тз/05, шаг 5, вторая половина).
//
// Зачем отдельный механизм, а не remark-anime.mjs. Тот работает с деревом
// markdown: посты — это markdown, транскрипты — JSON, через remark они не
// пойдут вообще. Общего кода у них почти нет: remark-anime ищет ОДНО первое
// упоминание тайтла из поля `anime` поста, а тут нужны ВСЕ упоминания всех
// тайтлов справочника сразу (см. ниже про два разных правила).
//
// Чистые функции: ни сети, ни файлов. Вызываются при сборке — и из
// src/components/Transcript.astro (разметка в тексте), и из
// src/lib/animeMentionIndex.mjs (таймкоды для страницы тайтла).

const MIN_NAME_LENGTH = 2;

// Название до двоеточия ищем отдельно: в справочнике «Королевские космические
// силы: Крылья Хоннеамиз», а вслух говорят «Королевские космические силы» —
// в ep-135, выпуске про этот самый тайтл, полное название не звучит ни разу,
// и без этого правила у него нашёлся бы НОЛЬ упоминаний. Подзаголовок после
// двоеточия есть у доброй половины аниме, и вслух его не произносит никто.
//
// Порог в 6 символов — от ложных срабатываний: короткий кусок до двоеточия
// («Он и она: …») слишком похож на обычную речь. Полностью риск он не снимает:
// назовите тайтл «Твоё имя: …» — и слова «твоё имя» в разговоре станут
// упоминанием. Лечится правкой titleRu в src/content/anime/<slug>.json.
const MIN_PREFIX_LENGTH = 6;

// Без учёта регистра и без разницы между «е» и «ё» — то же правило, что
// у поиска внутри транскрипта. Причина та же: распознавание сплошь пишет
// «Унесенные» там, где в справочнике «Унесённые». Замена один символ на один,
// поэтому позиции найденного в исходной строке не сбиваются.
export function fold(text) {
	return String(text).toLowerCase().replace(/ё/g, 'е');
}

// Буква или цифра. Название не должно быть куском другого слова: «Наруто»
// внутри «нарутовский» — не упоминание тайтла. Проверяем символ слева и справа
// от совпадения. \p{L} покрывает и кириллицу, и латиницу, поэтому отдельных
// правил для «K-On!» и «Кэйон!» не нужно.
function isWordChar(char) {
	return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

// Одно название из справочника → что по нему искать (см. MIN_PREFIX_LENGTH).
function searchNames(title) {
	const names = [title];
	const colon = title.indexOf(':');
	if (colon >= MIN_PREFIX_LENGTH) names.push(title.slice(0, colon).trim());
	return names;
}

/**
 * Справочник тайтлов → список названий для поиска.
 *
 * Берём русское и оригинальное название, как remark-anime.mjs, плюс варианты
 * написания из поля `aliases`. Варианты и закрывают то, чего названия не ловят:
 * падежи («Ходячего замка»), разговорное произношение («K-On!» вместо «Кэйон!»)
 * и искажения распознавания («Фринен»). Правила для них те же самые — регистр,
 * «е»/«ё» и границы слова разбираются ниже одинаково для всех названий.
 *
 * Сортировка по длине от длинного к короткому нужна, чтобы длинное название
 * побеждало короткое, когда одно вложено в другое — в том числе чтобы полное
 * название побеждало свой же кусок до двоеточия.
 *
 * @param {{ id: string, data: { titleRu?: string, titleOriginal: string, aliases?: string[] } }[]} entries
 */
export function buildAnimeMatcher(entries) {
	const names = [];
	const seen = new Set();

	for (const entry of entries) {
		for (const title of [entry.data?.titleRu, entry.data?.titleOriginal, ...(entry.data?.aliases ?? [])]) {
			if (!title) continue;

			for (const raw of searchNames(title)) {
				if (raw.length < MIN_NAME_LENGTH) continue;
				const folded = fold(raw);
				const key = entry.id + ' ' + folded;
				if (seen.has(key)) continue;
				seen.add(key);
				names.push({ id: entry.id, name: raw, folded });
			}
		}
	}

	names.sort((a, b) => b.folded.length - a.folded.length);
	return names;
}

/**
 * Все упоминания названий в одном куске текста.
 * Возвращает список { id, start, end } по возрастанию позиции, без наложений.
 *
 * `start` — не только место для нарезки текста, но и половина якоря
 * для исключений упоминаний (вторая половина — номер реплики,
 * см. src/lib/mentionExceptions.mjs). Поэтому искать надо по реплике,
 * а не по склеенному тексту блока: в склейке позиции были бы чужие.
 */
export function findMentions(text, matcher) {
	if (!text || matcher.length === 0) return [];

	const haystack = fold(text);
	const found = [];
	// Занятые куски строки: длинное название уже забрало этот отрезок, короткое
	// внутри него второй раз не считаем.
	const taken = new Uint8Array(haystack.length);

	for (const { id, folded } of matcher) {
		let at = haystack.indexOf(folded);

		while (at !== -1) {
			const end = at + folded.length;
			const free = !taken.subarray(at, end).some((busy) => busy === 1);
			const boundaries = !isWordChar(haystack[at - 1]) && !isWordChar(haystack[end]);

			if (free && boundaries) {
				found.push({ id, start: at, end });
				taken.fill(1, at, end);
			}

			at = haystack.indexOf(folded, at + 1);
		}
	}

	found.sort((a, b) => a.start - b.start);
	return found;
}

// Убранные руками упоминания (см. src/lib/mentionExceptions.mjs) на страницу
// не попадают вовсе и в индекс не идут. По умолчанию не убрано ничего.
const KEEP_ALL = { isHidden: () => false };

/**
 * Текст ОДНОЙ реплики → куски для вывода: обычный текст и упоминания.
 * Каждый кусок — { text } или { text, animeId, offset }.
 * Убранные руками упоминания возвращаются обычным текстом.
 *
 * @param {number} replicaIndex — место реплики в исходном массиве, якорь исключений
 */
export function splitByMentions(text, matcher, replicaIndex = -1, exceptions = KEEP_ALL) {
	const mentions = findMentions(text, matcher).filter(
		(mention) => !exceptions.isHidden(mention.id, replicaIndex, mention.start),
	);
	if (mentions.length === 0) return [{ text }];

	const parts = [];
	let cursor = 0;

	for (const mention of mentions) {
		if (mention.start > cursor) parts.push({ text: text.slice(cursor, mention.start) });
		parts.push({
			text: text.slice(mention.start, mention.end),
			animeId: mention.id,
			offset: mention.start,
		});
		cursor = mention.end;
	}

	if (cursor < text.length) parts.push({ text: text.slice(cursor) });
	return parts;
}

/**
 * Блоки транскрипта → какие тайтлы в каком месте упомянуты.
 * Возвращает Map: id тайтла → массив таймкодов (секунды, по возрастанию,
 * без повторов).
 *
 * Таймкод — начало БЛОКА, а не отдельной реплики. Так число под ссылкой на
 * странице тайтла совпадает с плашкой, которая стоит у этого куска в самом
 * транскрипте, и список не превращается в «11:57, 11:57, 12:10, 12:10» —
 * в ep-102 «Наруто» звучит четыре раза внутри двух блоков.
 *
 * Ищем при этом ПО РЕПЛИКАМ (block.parts), а не по склеенному тексту блока:
 * позиция внутри реплики — половина якоря для исключений, и в склейке она
 * оказалась бы чужой.
 *
 * @param {{ start: number, parts: { index: number, text: string }[] }[]} blocks — результат groupReplicas()
 */
export function collectMentions(blocks, matcher, exceptions = KEEP_ALL) {
	const byAnime = new Map();

	for (const block of blocks) {
		const seenHere = new Set();

		for (const part of block.parts) {
			for (const mention of findMentions(part.text, matcher)) {
				if (exceptions.isHidden(mention.id, part.index, mention.start)) continue;
				if (seenHere.has(mention.id)) continue;
				seenHere.add(mention.id);

				const times = byAnime.get(mention.id) ?? [];
				times.push(block.start);
				byAnime.set(mention.id, times);
			}
		}
	}

	return byAnime;
}
