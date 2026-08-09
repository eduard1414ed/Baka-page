// ЧТО ТАКОЕ ТАЙМКОД — ОПРЕДЕЛЕНО ЗДЕСЬ И БОЛЬШЕ НИГДЕ.
//
// Времени на сайте касаются три разных места: текст выпуска (метки в шоунотах
// ищет src/plugins/remark-timecode.mjs), блок таймкодов у выпуска и видеоэссе
// (src/components/TimecodeList.astro) и расшифровка. Разойдись у них понятие
// формата — одно и то же «1:02:11» в одном месте стало бы часом с минутами,
// а в другом минутой с секундами, и промах был бы ровно на час.
//
// Формат H:MM:SS держим отдельно от M:SS: минуты бывают трёхзначными
// (выпуски длиннее часа), и без разделения секунды путались бы с минутами.
export const TIMECODE_SOURCE = '(?:(\\d{1,2}):([0-5]\\d):([0-5]\\d)|(\\d{1,3}):([0-5]\\d))';

/**
 * Разбор совпадения регулярного выражения в секунды.
 *
 * @param {RegExpMatchArray} match Совпадение по TIMECODE_SOURCE.
 * @returns {number} Секунды от начала.
 */
export function matchToSeconds(match) {
	const [, h, m, s, m2, s2] = match;
	if (h !== undefined) return Number(h) * 3600 + Number(m) * 60 + Number(s);
	return Number(m2) * 60 + Number(s2);
}

const WHOLE_RE = new RegExp(`^${TIMECODE_SOURCE}$`);

/**
 * Строка целиком — таймкод? Для значений, введённых руками в админке.
 *
 * Мусор не чиним и не угадываем: вернём null, а вызвавший скажет об этом
 * в лог сборки. Тихо подставленное «наверное, автор имел в виду» уводило бы
 * плеер не туда, и заметить это было бы нечем.
 *
 * @param {string} text Например «12:04» или «1:02:11».
 * @returns {number|null} Секунды или null, если это не таймкод.
 */
export function parseTimecode(text) {
	const match = String(text ?? '').trim().match(WHOLE_RE);
	return match ? matchToSeconds(match) : null;
}

/**
 * Секунды в вид 4:07 или 1:23:45 — обратная сторона того же формата,
 * и живёт она рядом с разбором нарочно: разъедься они, время на странице
 * перестало бы совпадать с тем, куда перематывает нажатие.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatTimecode(seconds) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const pad = (n) => String(n).padStart(2, '0');
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
