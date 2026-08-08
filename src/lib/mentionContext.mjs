// Фраза вокруг найденного слова (тз/05, шаг 6).
//
// Зачем. И в списке упоминаний, и в списке предложенных исправлений человек
// решает по одному короткому куску текста: «Монстра» Урасавы — это тайтл,
// а «какой-то монстр, а не дедлайн» — обычное слово. Без фразы вокруг
// отличить одно от другого невозможно, поэтому она обязательна.

const WORDS_AROUND = 5;

// Режем по пробелам, а не по знакам препинания: запятая и кавычки должны
// остаться при своём слове, иначе фраза читается как набор обрывков.
function lastWords(text, count) {
	const words = text.split(/\s+/).filter(Boolean);
	return words.slice(Math.max(0, words.length - count)).join(' ');
}

function firstWords(text, count) {
	return text.split(/\s+/).filter(Boolean).slice(0, count).join(' ');
}

/**
 * @param {string} text — текст реплики целиком
 * @param {number} start — начало найденного куска
 * @param {number} end — конец найденного куска
 * @returns {{ before: string, match: string, after: string, cutLeft: boolean, cutRight: boolean }}
 *   cutLeft/cutRight — фразу обрезали, значит перед ней (или после) нужно
 *   многоточие. Считаем тут, а не на глаз при выводе: иначе многоточие
 *   появлялось бы и в начале реплики, где резать было нечего.
 */
export function mentionContext(text, start, end, words = WORDS_AROUND) {
	const left = text.slice(0, start);
	const right = text.slice(end);
	const before = lastWords(left, words);
	const after = firstWords(right, words);

	return {
		before,
		match: text.slice(start, end),
		after,
		cutLeft: before.length < left.trim().length,
		cutRight: after.length < right.trim().length,
	};
}
