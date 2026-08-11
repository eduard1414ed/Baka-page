// КАНДИДАТЫ В ТАЙТЛЫ: ПРАВИЛА ОТБОРА — ОДНО МЕСТО НА ВЕСЬ ПРОЕКТ
// (тз/11, часть C, пункты C.1–C.4 и C.6).
//
// Что тут живёт и чего тут НЕТ.
//
//   ЕСТЬ: что считать одной и той же фразой (`phraseKey`), кого отсеивает
//   стоп-лист (`readStoplist`), что считать похожим ответом Shikimori
//   (`sameTitle`, `bestMatch`), как переспросить именительным падежом
//   (`nominativeGuess`) и как запомнить ответ, чтобы не спрашивать дважды
//   (`readCache`/`appendCache`).
//
//   НЕТ И БЫТЬ НЕ ДОЛЖНО: набора кавычек и правила «что считается упоминанием».
//   Фразы в кавычках достаёт `collectQuotedPhrases`, а справочник вычитается
//   списком названий из `buildAnimeMatcher` — обе из src/lib/animeMentions.mjs,
//   то есть тем же кодом, которым потом ищет упоминания сам сайт. Заведи сбор
//   кандидатов свои кавычки или свой список названий — и он молча разошёлся бы
//   с сайтом: тайтл, заведённый по фразе, на сайте ссылкой бы не стал.
//
// ЧТО ОТСЕИВАЕТСЯ МОЛЧА — НИЧЕГО. У каждого отказа есть название (`WHY`),
// и все они пересчитываются в отчёте. Отсев «поумнее» тут был бы первым
// искушением: полторы тысячи постов из мессенджера дают почти две тысячи фраз.
// Но выброшенное молча не пересчитает никто и никогда.

import { readFile, appendFile, mkdir } from 'node:fs/promises';
import Az from 'az';
import { buildAnimeMatcher, findMentions, fold, MIN_PREFIX_LENGTH } from '../src/lib/animeMentions.mjs';
import { initMorph } from './anime-cases-lib.mjs';

export const STOPLIST_PATH = new URL('../src/content/anime-stoplist.json', import.meta.url);

// ЧТО ВИДИТ ЭКРАН КАНДИДАТОВ — обычный JSON в репозитории. Страница
// /admin/tools/ читает его у GitHub по API, а не с сайта: файл меняется робо́том
// при каждом сохранении черновика, а сайт выкладывается руками, и с сайта
// заказчик смотрел бы позавчерашний список.
export const CANDIDATES_PATH = new URL('../src/data/animeCandidates.json', import.meta.url);

// ЧТО РЕШИЛ ЗАКАЗЧИК — второй файл, и это не прихоть. Первый пишут только
// прогоны, второй только экран: у двух писателей два файла, и столкнуться
// им негде. Держи мы всё в одном — сохранение решения и добор новых фраз
// дрались бы за один и тот же файл, а проиграл бы тот, кто медленнее.
export const DECISIONS_PATH = new URL('../src/data/animeCandidateDecisions.json', import.meta.url);

// Ответы Shikimori: прогон по архиву идёт больше часа, и повторный запуск
// не имеет права спрашивать одно и то же заново (тз/11, C.6). Папка рядом
// с проектом и в репозиторий не идёт: это кэш чужих данных, а не наши данные.
export const CACHE_DIR = new URL('../.tmp-shikimori/', import.meta.url);
export const CACHE_PATH = new URL('answers.jsonl', CACHE_DIR);

// ─── Фраза ─────────────────────────────────────────────────────────────────

// КРАЯ ФРАЗЫ ОБРЕЗАЕМ НЕ ОТ «ВСЕГО, ЧТО НЕ БУКВА», А ОТ ПЕРЕЧИСЛЕННОГО.
// В мессенджерном архиве кавычка сплошь и рядом захватывает соседний знак
// препинания — «„Монстр“,», «„Наруто“ —», — и его надо снять. А вот знаки,
// которые бывают ЧАСТЬЮ НАЗВАНИЯ, снимать нельзя: восклицательный у «Кэйон!»,
// скобка с годом у «Призрак в доспехах (1995)», цифра сезона у «Дандадан 2».
// Первая редакция резала «всё, что не буква и не цифра», и год с восклицательным
// знаком из названия исчезали — поймано проверкой, а не глазами
// (scripts/anime-candidates.test.mjs).
const EDGE = /^[\s,.;:…·|/\\—–-]+|[\s,.;:…·|/\\—–-]+$/gu;

export function normalizePhrase(text) {
	return String(text ?? '')
		.replace(EDGE, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Ключ, по которому две фразы считаются одной. `fold` — тот же, что у поиска
 * упоминаний: без регистра и без разницы «е»/«ё». Иначе «Дандадан» и «дандадан»
 * ушли бы в Shikimori двумя запросами и встали бы двумя строчками в списке.
 */
export function phraseKey(text) {
	return fold(normalizePhrase(text));
}

// Причины отказа. Список закрытый нарочно: отчёт печатает их все до одной,
// и появившаяся мимо этого списка причина оказалась бы невидимой.
export const WHY = {
	NO_LETTERS: 'ни одной буквы',
	IN_CATALOG: 'уже в справочнике',
	STOPLIST: 'в стоп-листе',
	NOT_FOUND: 'Shikimori не нашёл ничего',
	NOT_SIMILAR: 'Shikimori нашёл, но не похоже',
	NETWORK: 'не спросилось: сеть подвела',
	SHORT_NAME: 'похоже на разговорное сокращение названия',
};

// Единственный отсев ДО Shikimori, кроме справочника и стоп-листа: во фразе
// нет ни одной буквы («1995», «???»). Длину не режем вовсе, и это решение
// от замера: числа слов у фраз идут сплошной лентой (1 слово — 523 фразы,
// 2 — 574, дальше плавный спад до 14, и 44 фразы длиннее), а у настоящих
// названий справочника разброс от 1 слова до 17. Разрыва нет, значит порога
// нет: он резал бы по живому. Полторы тысячи лишних запросов стоят 40 минут
// один раз, а потерянный тайтл не найдётся уже никогда.
const HAS_LETTER = /\p{L}/u;

export function hasLetters(text) {
	return HAS_LETTER.test(String(text ?? ''));
}

// ─── Стоп-лист ─────────────────────────────────────────────────────────────

/**
 * Отклонённые фразы (тз/11, C.2). Отклонение — такое же решение, как принятие,
 * и хранится оно навсегда: тот же принцип, что у исключений упоминаний.
 *
 * ПУСТОЙ ФАЙЛ И ОТСУТСТВИЕ ФАЙЛА — ЗАКОННЫЕ СОСТОЯНИЯ. Сегодня файл пуст:
 * ни одного решения заказчик ещё не принял. А вот НЕЧИТАЕМЫЙ файл роняет
 * прогон громко: молча принятая за пустоту порча означала бы, что все прежние
 * отказы предложены заново, — и заметить это было бы некому.
 */
export async function readStoplist(path = STOPLIST_PATH) {
	let raw;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return { keys: new Set(), phrases: [] };
		throw error;
	}

	if (!raw.trim()) return { keys: new Set(), phrases: [] };

	const data = JSON.parse(raw);
	if (!Array.isArray(data)) {
		throw new Error(`Стоп-лист ${path}: ожидался список фраз, а лежит ${typeof data}.`);
	}

	const phrases = data.map((item) => String(item ?? '')).filter((item) => item.trim());
	return { keys: new Set(phrases.map(phraseKey)), phrases };
}

// ─── Что уже разобрано: данные экрана как память робота ────────────────────

/**
 * Прочитать `src/data/animeCandidates.json` и разложить его обратно в исходы
 * по фразам.
 *
 * ЗАЧЕМ ЭТО НУЖНО, ЕСЛИ ЕСТЬ КЭШ ОТВЕТОВ. Кэш `.tmp-shikimori/` лежит рядом
 * с проектом и в репозиторий не идёт — у робота на GitHub его нет вовсе.
 * А знать, о чём уже спрашивали, робот обязан: иначе каждое сохранение
 * черновика гнало бы в Shikimori одни и те же полторы тысячи фраз (тз/11, C.3).
 * Поэтому разобранный исход живёт в репозитории вместе с данными экрана.
 *
 * ЧЕГО ЭТОТ ФАЙЛ НЕ УМЕЕТ: пересчитать похожесть по новым правилам. Сырой
 * выдачи в нём нет — она осталась в кэше. Поменяли правило похожести — гоните
 * полный прогон на машине, где кэш лежит, а не ждите, что робот пересчитает.
 *
 * ОТСУТСТВИЕ ФАЙЛА ЗАКОННО (первый прогон), а НЕЧИТАЕМЫЙ роняет громко:
 * принятый молча за пустоту, он означал бы, что весь архив спрашивают заново.
 */
export async function readCandidates(path = CANDIDATES_PATH) {
	const empty = { outcomes: new Map(), details: new Map(), raw: null };

	let raw;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return empty;
		throw error;
	}
	if (!raw.trim()) return empty;

	const data = JSON.parse(raw);
	const outcomes = new Map();
	const details = new Map();

	for (const row of data.candidates ?? []) {
		const match = {
			sourceId: row.sourceId,
			titleRu: row.titleRu ?? undefined,
			titleOriginal: row.titleOriginal,
			year: row.year ?? undefined,
			url: row.url ?? undefined,
		};
		details.set(row.sourceId, {
			titleRu: row.titleRu ?? undefined,
			titleOriginal: row.titleOriginal,
			year: row.year ?? undefined,
			studio: row.studio ?? undefined,
			posterUrl: row.poster ?? undefined,
			url: row.url ?? undefined,
		});
		for (const phrase of row.phrases ?? []) outcomes.set(phraseKey(phrase), { kind: 'candidate', match });
	}

	for (const row of data.already ?? []) {
		outcomes.set(phraseKey(row.text), {
			kind: 'candidate',
			match: {
				sourceId: row.sourceId,
				titleRu: row.titleRu ?? undefined,
				titleOriginal: row.titleOriginal,
				year: row.year ?? undefined,
				url: row.url ?? undefined,
			},
		});
	}

	for (const row of data.shortName ?? []) {
		outcomes.set(phraseKey(row.text), {
			kind: 'short',
			match: {
				sourceId: row.sourceId,
				titleRu: row.titleRu ?? undefined,
				titleOriginal: row.titleOriginal,
				year: row.year ?? undefined,
				url: row.url ?? undefined,
			},
			// От всей выдачи хранятся одни номера: что за тайтл под номером,
			// спрашивается у справочника, а не у файла (см. `resultIds`
			// в scripts/anime-candidates.mjs).
			results: (row.resultIds ?? []).map((sourceId) => ({ sourceId })),
		});
	}

	for (const row of data.notSimilar ?? []) {
		outcomes.set(phraseKey(row.text), { kind: 'notsimilar', answers: row.answers ?? [] });
	}

	for (const row of data.notFound ?? []) {
		outcomes.set(phraseKey(row.text), { kind: 'notfound' });
	}

	return { outcomes, details, raw: data };
}

/**
 * Решения заказчика с экрана. Пустой файл и отсутствие файла законны —
 * это обычное состояние до первого нажатия.
 */
export async function readDecisions(path = DECISIONS_PATH) {
	let raw;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return [];
		throw error;
	}
	if (!raw.trim()) return [];

	const data = JSON.parse(raw);
	if (!Array.isArray(data)) {
		throw new Error(`Решения ${path}: ожидался список, а лежит ${typeof data}.`);
	}
	return data;
}

// ─── Похоже ли то, что нашёл Shikimori ─────────────────────────────────────

// СКОЛЬКО БУКВ РАЗРЕШЕНО РАЗЛИЧАТЬСЯ В КОНЦЕ СЛОВА — 3, И ЭТО ЗАМЕР, А НЕ ВКУС.
//
// Зачем вообще допуск. Shikimori ищет с оглядкой на основу слова, поэтому
// на падежную форму он отвечает именительным: «Тетради смерти» → «Тетрадь
// смерти», «Принцессе Мононоке» → «Принцесса Мононоке». Сравнивай мы буква
// в букву — эти ответы отбрасывались бы, а они как раз правильные.
//
// Откуда 3. Замер по живому справочнику (`scripts/anime-candidates.test.mjs`):
// все настоящие падежные формы, посчитанные `inflectTitle` для 53 тайтлов,
// отличаются от своего названия не больше чем тремя буквами хвоста у каждого
// слова. При этом ни одна форма ЧУЖОГО тайтла под это правило не подходит.
// То есть 3 — не круглое число, а верхняя граница измеренного.
//
// И почему не «половина длины», как первым делом хочется: половина растёт
// вместе со словом, а окончание нет. У шестибуквенного запроса половина — три
// буквы, и «Мотоко» нашло бы «мотив». Ровно эти грабли записаны в CLAUDE.md
// про поиск по сайту.
const MAX_ENDING = 3;

// Совпасть должно не меньше четырёх букв основы. Без этого порога «Бака»
// и «Баки» — одно и то же слово: у четырёхбуквенных слов три буквы хвоста
// это почти всё слово.
const MIN_STEM = 4;

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

const words = (text) => fold(text).split(WORD_SPLIT).filter(Boolean);

function commonPrefix(a, b) {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

// ПРАВИЛА ХВОСТА НЕ ХВАТАЕТ, И ЭТО ПОКАЗАЛ ЗАМЕР, А НЕ РАССУЖДЕНИЕ.
// «Ходячего замка» против «Ходячий замок»: слова «замка» и «замок» расходятся
// на ПЯТОЙ букве из пяти — беглая гласная, а не окончание. То же у «Земель»
// против «Земля». Никакой порог по длине общего начала этого не берёт.
//
// Поэтому вторым путём спрашиваем словарь: у обоих слов начальная форма одна?
// «замка» → «замок», «земель» → «земля» — совпало. «Мотоко» и «мотив» словарь
// при этом разводит, то есть послаблением это не стало.
//
// ЦЕНА НАЗВАНА: «бака» и «баки» словарь считает формами одного слова («бак»),
// так что имя подкаста в списке кандидатов появится — и отклоняется оно
// стоп-листом, то есть решением человека. Это дешевле, чем терять настоящие
// тайтлы, у которых в названии беглая гласная.
const lemmaCache = new Map();

function lemmas(word) {
	if (lemmaCache.has(word)) return lemmaCache.get(word);
	let out;
	try {
		out = [...new Set((Az.Morph(word) ?? []).map((parse) => parse.normalize().word))];
	} catch (error) {
		// Спросить словарь, не дождавшись загрузки, — значит получить пустой
		// разбор и молча ослабить сравнение. Ломаемся громко.
		throw new Error(`sameTitle: словари морфологии не загружены — нужен await initMorph() до вызова (${error.message}).`);
	}
	lemmaCache.set(word, out);
	return out;
}

function sameWord(a, b) {
	if (a === b) return true;
	const prefix = commonPrefix(a, b);
	// РАЗНИЦА В ДЛИНЕ БОЛЬШЕ ДВУХ БУКВ — ЭТО УЖЕ ДРУГОЕ СЛОВО, а не падеж.
	// Без этой оговорки короткое слово сходилось с любым длинным, которое
	// с него начинается: «Баку!» ловило «Бакуман» — четыре буквы совпали,
	// и допуска на хвост хватило. Поймано на живой выдаче Shikimori.
	const sameLength = Math.abs(a.length - b.length) <= 2;
	if (sameLength && prefix >= MIN_STEM && prefix >= Math.min(a.length, b.length) - MAX_ENDING) return true;

	// Длину тут не ограничиваем НАРОЧНО, хотя первым делом хочется: замер
	// показал, что коротким словом бывает голова названия — «Бездомного бога»
	// против «Бездомный бог», «Королевских космических сил» против «…силы».
	// А «Гик» с «Гек» разводит не длина, а сам словарь: слова «Гек» он не знает
	// вовсе, и начальной формы у него нет ни одной.
	const left = lemmas(a);
	if (left.length > 0 && lemmas(b).some((form) => left.includes(form))) return true;

	// ТРЕТИЙ ПУТЬ — ОДНА БУКВА РАЗНИЦЫ, и он нужен для ИМЁН. Словарь разбирает
	// имена собственные непоследовательно: «Прощай, Лары» и «Прощай, Лара»
	// он к одной начальной форме не сводит. Одна буква разницы в слове
	// от четырёх букв при совпавшем начале — это падеж, а не другое слово;
	// «Гик» и «Гек» сюда не попадают (совпала одна буква из трёх), «Мотоко»
	// и «Мотив» тоже (четыре буквы разницы).
	if (a.length < MIN_STEM || b.length < MIN_STEM) return false;
	return prefix >= 3 && editDistance(a, b) <= 1;
}

// Расстояние редактирования, обрезанное сверху: дальше двух нам неинтересно.
function editDistance(a, b) {
	if (Math.abs(a.length - b.length) > 1) return 2;
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++) {
			next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		row = next;
	}
	return row[b.length];
}

/**
 * Похожа ли фраза на название. Слова сравниваются попарно, и их должно быть
 * поровну: «Дандадан» и «Дандадан 2» — разные тайтлы, а не одно название
 * с опечаткой.
 *
 * Дефис считается пробелом (слова разбиваются по нему тоже): иначе
 * «Человека-бензопилы» против «Человек-бензопила» — это одно длинное слово
 * с расхождением посередине, и правило хвоста на него не работает вовсе.
 */
export function sameTitle(phrase, name) {
	const left = words(phrase);
	const right = words(name);
	if (left.length === 0 || left.length !== right.length) return false;
	return left.every((word, i) => sameWord(word, right[i]));
}

// Название до двоеточия сравниваем отдельно — тем же порогом, что и поиск
// упоминаний (MIN_PREFIX_LENGTH из animeMentions.mjs, копии числа быть
// не должно): в архиве говорят «Стальной алхимик», а на Shikimori он
// «Стальной алхимик: Братство».
// Подзаголовок у Shikimori отделяется не только двоеточием: «Гуррен-Лаганн,
// пронзающий небеса», «Призрак в доспехах — Невинность». Порог длины взят
// у поиска упоминаний, а вот список разделителей тут СВОЙ, и это не копия
// правила: там вопрос «по чему искать упоминания в тексте», здесь — «похож ли
// ответ поисковика на фразу». Второй вопрос имеет право быть шире.
const SUBTITLE = /[:,—–]/;

function nameVariants(result) {
	const out = [];
	for (const name of [result.titleRu, result.titleOriginal]) {
		if (!name) continue;
		out.push({ name, whole: true });
		const at = name.search(SUBTITLE);
		if (at >= MIN_PREFIX_LENGTH) out.push({ name: name.slice(0, at).trim(), whole: false });
	}
	return out;
}

// Насколько хорошо ответ подошёл фразе. Больше — лучше, 0 — не подошёл вовсе.
function score(phrase, result) {
	let best = 0;
	for (const { name, whole } of nameVariants(result)) {
		const exact = fold(phrase) === fold(name);
		const value = exact ? (whole ? 4 : 3) : sameTitle(phrase, name) ? (whole ? 2 : 1) : 0;
		if (value > best) best = value;
	}
	return best;
}

/**
 * Лучший ответ из выдачи Shikimori — или null.
 *
 * СМОТРИМ ВСЮ ВЫДАЧУ, А НЕ ПЕРВУЮ СТРОЧКУ: замер 11 августа 2026 показал, что
 * на «Тетради смерти» правильная «Тетрадь смерти» приходит ВТОРОЙ, а первым
 * стоит «Смертельный бильярд». Спрашивай мы только первую — потеряли бы тайтл
 * и не узнали бы об этом.
 *
 * И БЕРЁМ НЕ ПЕРВЫЙ ПОДОШЕДШИЙ, А САМЫЙ ТОЧНЫЙ. Совпадение буква в букву
 * сильнее совпадения по падежу, а полное название сильнее куска до двоеточия.
 * Первая редакция брала первый подошедший — и «Гуррен-Лаганн» уезжал
 * на «Гуррен-Лаганн: Параллельные миры 2», а «Призрака в доспехах» на «Призрак
 * в доспехах: Вознесение», потому что сиквелы у Shikimori в выдаче стоят выше.
 * Ошибка эта тихая: тайтл выглядит найденным, а завёлся бы не тот.
 *
 * ПРИ РАВНОМ СЧЁТЕ ПОБЕЖДАЕТ САМЫЙ РАННИЙ ГОД — то есть оригинал, а не его
 * продолжения и спешлы. На «Синюю тюрьму» Shikimori отвечает пятью частями
 * серии, и настоящая («Синяя тюрьма: Блю Лок», 2022) стоит в выдаче четвёртой;
 * на «Гуррен-Лаганн» — тем же порядком. Года нет вовсе (анонс без даты) —
 * такой ответ уходит в конец: у анонса и года ещё нет, а у оригинала он есть.
 *
 * РАЗЛИЧИТЬ ВСЁ ЭТО ПРАВИЛО НЕ МОЖЕТ И НЕ ДОЛЖНО. У «Истребителя демонов»
 * есть тайтл 1994 года с ровно таким названием, и он победит современный
 * по точности совпадения. Поэтому у кандидата в отчёте стоят год, студия
 * и ссылка: решение — за человеком, а не за счётом.
 */
export function bestMatch(phrase, results) {
	let best = null;
	let bestScore = 0;

	for (const result of results ?? []) {
		const value = score(phrase, result);
		if (value === 0) continue;
		if (value > bestScore || (value === bestScore && (result.year ?? Infinity) < (best.year ?? Infinity))) {
			bestScore = value;
			best = result;
		}
	}

	return best ? { ...best, exact: bestScore >= 3 } : null;
}

/**
 * ФРАЗА — ЭТО КУСОК НАЗВАНИЯ, А НЕ НАЗВАНИЕ ЦЕЛИКОМ. Разговорное сокращение:
 * «Фрирен» вместо «Провожающая в последний путь Фрирен», «Евангелион» вместо
 * «Евангелион нового поколения», «ДжоДжо» вместо «Невероятное приключение
 * ДжоДжо».
 *
 * ПОЧЕМУ ЭТО ОТДЕЛЬНАЯ ГРУППА, А НЕ КАНДИДАТ. Правило похожести требует равного
 * числа слов, и правильно делает: ослабь его — и «аниме года» сойдётся
 * с «Аниме-историями», а «поиск» с «Поиском исходных данных». Замер по кэшу
 * прогона: таких фраз 185, и настоящих среди них меньшинство. Поэтому они
 * не становятся кандидатами молча, но и не пропадают: отчёт показывает их
 * отдельным списком, для глаз.
 *
 * ЭТО САМАЯ ДОРОГАЯ ЧАСТЬ ОТЧЁТА. «Фрирен» стоит в 41 посте, тайтл в справочнике
 * есть, а ссылки нет ни одной: справочник знает только полное название. Лечится
 * одной строкой в поле «Варианты написания» — и сразу по всему архиву.
 *
 * Ищем ПОСЛЕДОВАТЕЛЬНОСТЬ слов, а не подстроку: «до» внутри «Гандам» — не то же
 * самое, что «Фрирен» внутри «…путь Фрирен».
 */
export function looksLikeShortName(phrase, results) {
	const left = words(phrase);
	if (left.length === 0) return null;

	for (const result of results ?? []) {
		for (const { name } of nameVariants(result)) {
			const right = words(name);
			for (let at = 0; at + left.length <= right.length; at++) {
				if (left.every((word, i) => word === right[at + i])) return { ...result, matchedName: name };
			}
		}
	}

	return null;
}

// ─── Вторая попытка: именительный падеж ────────────────────────────────────

// Существительное и прилагательное. Только их и приводим к именительному:
// у «Дандадана» словарь первым разбором выдаёт ГЛАГОЛ «дандадать» (слово ему
// незнакомо, и он гадает по концовке), и запрос «дандадать» — это уже не поиск,
// а выдумка. Замер самой библиотеки, а не рассуждение о том, как она устроена.
const CAN_NORMALIZE = new Set(['NOUN', 'ADJF']);

/**
 * Фраза → её же слова в именительном падеже, наивно, слово за словом.
 * Совпало с исходной фразой — вернётся она сама.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. Shikimori на «Дандадана» отвечает ПУСТОТОЙ, а на «Дандадан»
 * находит тайтл. Половина частых фраз архива стоит в падеже («Человека-
 * бензопилы» — 24 поста, «Стального алхимика» — 15), и без второй попытки
 * они молчали бы.
 *
 * ДОГАДКА ЗДЕСЬ БЕЗОПАСНА, и вот почему: она идёт ТОЛЬКО когда первый запрос
 * не нашёл ничего, а похожесть ответа сверяется всё равно с ИСХОДНОЙ фразой.
 * Плохая догадка («принцесса нок» из «Принцессе Мононоке») просто не найдёт
 * ничего или найдёт непохожее — то есть стоит полторы секунды, а не ошибки
 * в справочнике.
 *
 * Требует загруженных словарей (initMorph) и падает без них громко — иначе
 * вторая попытка молча перестала бы работать, а выглядело бы это как «часть
 * фраз не нашлась».
 */
export function nominativeGuess(phrase) {
	const source = normalizePhrase(phrase);
	if (!source) return source;

	const parts = source.split(/([^\p{L}\p{N}]+)/u);
	const out = parts.map((part, i) => {
		if (i % 2 === 1 || !part) return part;
		const parses = Az.Morph(part) ?? [];
		const good = parses.find((parse) => CAN_NORMALIZE.has(String(parse.tag.POST ?? parse.tag)));
		if (!good) return part;
		const normalized = good.normalize().word;
		return normalized || part;
	});

	const guess = out.join('');
	return fold(guess) === fold(source) ? source : guess;
}

export { initMorph };

// ─── Замер: что даст решение ДО того, как его примут ───────────────────────
//
// ТРЕБОВАНИЕ ЗАКАЗЧИКА 11 АВГУСТА 2026: «прежде чем я нажму „Завести“ или „Это
// уже есть“, я должен видеть, что это даст». В прошлой сессии эти числа
// («Фрирен» +57/+192, «Цугаи» три ложных из пяти) считались отдельными
// прогонами по просьбе — теперь считаются у каждой строки заранее.
//
// СЧИТАЕМ НАСТОЯЩИМ `findMentions`, А НЕ СВОИМ ПОИСКОМ. Своя проверка
// совпадения была бы второй копией правила «что считается упоминанием» — той
// самой, из-за которой чинился хвост 45, — и разошлась бы с сайтом молча:
// заказчику назвали бы прибавку, которой на сайте не случится.
//
// ЗАЧЕМ ТУТ СПРАВОЧНИК. Новое название конкурирует со старыми: длинное имя
// забирает кусок текста, и короткое внутри него уже не считается. Мерь мы
// в одиночку — «Фрирен» насчитала бы себе и те места, где стоит «Провожающая
// в последний путь Фрирен» и ссылка уже есть.
//
// ПОЧЕМУ ЭТО НЕ МЕДЛЕННО. Прямой счёт — 843 решения на 1736 текстов через
// матчер из двухсот названий — это четверть миллиарда поисков подстроки.
// Поэтому сначала грубый вопрос «встречается ли вообще» по готовой свёрнутой
// копии текста, и полный разбор идёт только там, где ответ «да»: у одного
// названия это два-три текста из полутора тысяч.

/** id, под которым в матчер кладётся примеряемое название. У тайтла такого не бывает. */
export const PROBE_ID = ' проба';

/**
 * Тексты к замеру: свёрнутая копия считается один раз, а не на каждое решение.
 *
 * @param {{ id: string, text: string, live: boolean }[]} texts
 */
export function prepareTexts(texts) {
	return texts.map((item) => ({ ...item, folded: fold(item.text) }));
}

/**
 * Сколько упоминаний даст новое название.
 *
 * @param {{ titleRu?: string, titleOriginal?: string, aliases?: string[], aliasesAuto?: string[] }} probe
 *        карточка, какой она станет: для нового тайтла — его названия,
 *        для варианта написания — одна строка в `aliases`.
 * @param {object[]} baseMatcher матчер живого справочника (той же строгости
 *        по кавычкам, что и место, где считаем).
 * @param {ReturnType<typeof prepareTexts>} texts
 * @param {'apply'|'ignore'} quotes действует ли тут галочка «только в кавычках»
 * @returns {{ mentions: number, texts: number, live: number }}
 *          `mentions` — всего упоминаний, `texts` — в скольких постах
 *          (или выпусках), `live` — сколько из них видно на сайте сегодня.
 */
export function measureGain(probe, baseMatcher, texts, quotes) {
	const extra = buildAnimeMatcher([{ id: PROBE_ID, data: probe }], { quotes });
	if (extra.length === 0) return { mentions: 0, texts: 0, live: 0 };

	const wanted = extra.map((item) => item.folded);
	const merged = [...baseMatcher, ...extra].sort((a, b) => b.folded.length - a.folded.length);

	let mentions = 0;
	let hit = 0;
	let live = 0;

	for (const item of texts) {
		// Грубый вопрос по свёрнутой копии. Пропустить настоящее упоминание он
		// не может: `findMentions` тоже начинает с поиска этой самой подстроки,
		// просто потом ещё проверяет границы слова и кавычки.
		if (!wanted.some((name) => item.folded.includes(name))) continue;

		const found = findMentions(item.text, merged).filter((m) => m.id === PROBE_ID).length;
		if (found === 0) continue;

		mentions += found;
		hit++;
		if (item.live) live++;
	}

	return { mentions, texts: hit, live };
}

// ─── Кэш ответов Shikimori ─────────────────────────────────────────────────

/**
 * Прочитанный кэш: запрос → выдача. Битую строчку пропускаем молча — кэш
 * это удобство, а не данные: не прочли, значит спросим ещё раз.
 */
export async function readCache(path = CACHE_PATH) {
	let raw;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT') return new Map();
		throw error;
	}

	const out = new Map();
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		try {
			const item = JSON.parse(line);
			if (typeof item.q === 'string') out.set(item.q, item.results ?? []);
		} catch {
			// битая строчка — пропускаем
		}
	}
	return out;
}

/**
 * Ответ записывается на диск СРАЗУ, до любых следующих шагов. Прогон идёт
 * больше часа, и прерваться он может чем угодно — сетью, ноутбуком, вашим
 * Ctrl+C. Всё, что успело спроситься, обязано пережить это и не спрашиваться
 * заново: полторы секунды между запросами — условие, на котором мы Shikimori
 * пользуемся, и тратить их дважды на одно и то же нельзя.
 */
export async function appendCache(query, results, path = CACHE_PATH) {
	await mkdir(new URL('./', path), { recursive: true });
	await appendFile(path, JSON.stringify({ q: query, results }) + '\n', 'utf8');
}
