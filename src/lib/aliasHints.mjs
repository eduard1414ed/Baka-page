// Подсказки к полю «Варианты написания» (тз/05, шаг 6, дополнение).
//
// Два источника, оба показываются в админке кнопкой «добавить» и НИ ОДИН
// не применяется сам. Причина та же, что у исправлений названий: вариант
// ищется по 22 575 репликам живой речи, и плохой даёт ложные упоминания
// сразу по всему архиву и молча. Отменять такое пришлось бы по одному
// выпуску вручную.
//
// 1. ЧТО ЗНАЕТ ИСТОЧНИК — поле `sourceAliases` (раздел Shikimori
//    «Альтернативные названия»). Там попадается ценное («Клуб лёгкой музыки»
//    у «Кэйон!») вперемешку с мусором («K-ON! Season 1»).
//
// 2. ЧТО РЕАЛЬНО ЗВУЧИТ В АРХИВЕ — падежные формы, найденные в самих
//    расшифровках. Склонять по правилам русского языка мы не пробуем намеренно:
//    морфология наплодит десяток форм, из которых в выпусках звучат одна-две,
//    а остальные будут зря висеть в поиске. Здесь наоборот — предлагается
//    только то, что человек правда сказал, и сразу видно сколько раз.
//
// ТОЛЬКО ДЛЯ НАЗВАНИЙ ИЗ ДВУХ И БОЛЕЕ СЛОВ. Проверено на архиве: у названий
// из двух слов шума почти нет («ходячего замка», «сказание земноморья»,
// «унесенных призраками» — всё настоящее), а у названия из одного слова он
// сплошной: у «Наруто» нашлись «наружу», «нарушает», «нарушил» и ещё 15 таких
// же. Причина простая — в фразе из двух слов должны совпасть обе основы подряд,
// это сильное ограничение, а у одного слова ограничения нет никакого.

import { fold } from './animeMentions.mjs';

// Сколько форм показывать одному тайтлу: список должен читаться глазами,
// а не пролистываться.
const MAX_HINTS = 8;

// Название до двоеточия — то же правило, что в поиске упоминаний: вслух
// подзаголовок не произносит никто.
const MIN_PREFIX_LENGTH = 6;

// Основа слова: слово без последних двух букв, но не короче трёх. Этого хватает,
// чтобы «замок» и «замка» имели общую основу, и не хватает, чтобы «замок»
// склеился с чем-то посторонним.
function stem(word) {
	return word.length <= 3 ? word : word.slice(0, Math.max(3, word.length - 2));
}

function escapeRegExp(text) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function spokenPart(title) {
	const colon = title.indexOf(':');
	return colon >= MIN_PREFIX_LENGTH ? title.slice(0, colon).trim() : title;
}

/**
 * Формы названия, реально встречающиеся в тексте.
 *
 * @param {string} title — русское название тайтла
 * @param {Set<string>} known — что уже ищется (свёрнутые названия и варианты)
 * @param {string} foldedText — весь текст архива, уже свёрнутый через fold()
 * @returns {{ form: string, count: number }[]} по убыванию частоты
 */
export function findArchiveForms(title, known, foldedText) {
	const words = fold(spokenPart(title)).split(/\s+/).filter(Boolean);
	if (words.length < 2) return [];

	const pattern = words.map((word) => escapeRegExp(stem(word)) + '\\p{L}*').join('\\s+');
	// Границы слова — как в поиске упоминаний: название не должно быть куском
	// другого слова.
	const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'gu');

	const counts = new Map();
	for (const match of foldedText.matchAll(re)) {
		const form = match[0];
		if (known.has(form)) continue;
		counts.set(form, (counts.get(form) ?? 0) + 1);
	}

	return [...counts]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
		.slice(0, MAX_HINTS)
		.map(([form, count]) => ({ form, count }));
}

/**
 * Подсказки по всем тайтлам справочника.
 *
 * @param {{ id: string, data: object }[]} animeList
 * @param {{ data: { replicas: { text: string }[] } }[]} transcripts
 * @returns {Record<string, { archive: {form, count}[], source: string[] }>}
 */
export function collectAliasHints(animeList, transcripts) {
	// Весь архив одной свёрнутой строкой: свернуть 22 575 реплик один раз
	// заметно дешевле, чем делать это заново на каждый тайтл.
	const foldedText = fold(transcripts.flatMap((entry) => (entry.data.replicas ?? []).map((r) => r.text)).join('\n'));

	const hints = {};

	for (const entry of animeList) {
		const { titleRu, titleOriginal, aliases = [], sourceAliases = [] } = entry.data;

		// Что уже ищется — предлагать это второй раз незачем. Кусок названия
		// до двоеточия сюда входит обязательно: поиск упоминаний ищет и по нему
		// тоже, иначе «Королевским космическим силам» предлагалось бы добавить
		// «королевские космические силы», которые и так прекрасно находятся.
		const known = new Set(
			[titleRu, titleOriginal, ...aliases]
				.filter(Boolean)
				.flatMap((name) => [name, spokenPart(name)])
				.map(fold),
		);

		hints[entry.id] = {
			archive: titleRu ? findArchiveForms(titleRu, known, foldedText) : [],
			// Из того, что знает источник, убираем уже добавленное. Мусор вроде
			// «K-ON! Season 1» не отсеиваем: отличить его от ценного может
			// только человек, а прячась, подсказка перестанет быть честной.
			source: sourceAliases.filter((name) => !known.has(fold(name))),
		};
	}

	return hints;
}
