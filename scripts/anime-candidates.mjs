// СБОР КАНДИДАТОВ В ТАЙТЛЫ — ПЕРВЫЙ ПРОГОН ПО АРХИВУ (тз/11, C.1–C.4, C.6).
//
// Что делает: собирает из всех постов фразы в кавычках, вычитает справочник
// и стоп-лист, остальное спрашивает у Shikimori и печатает список кандидатов.
//
// НИЧЕГО НЕ ЗАПИСЫВАЕТ В РЕПОЗИТОРИЙ И НЕ ЗАВОДИТ НИ ОДНОГО ТАЙТЛА. Ни при
// какой частоте, ни при каком совпадении: заводит их человек, кнопкой. Устройство
// как у всех разовых прогонов проекта — сначала отчёт, потом, отдельным словом
// заказчика, применение.
//
//   node scripts/anime-candidates.mjs --dry     — БЕЗ СЕТИ: только сбор и отсев,
//                                                 числа и сколько займёт прогон
//   node scripts/anime-candidates.mjs           — полный прогон (идёт в сеть)
//   node scripts/anime-candidates.mjs --limit 40 — спросить только первые 40 фраз
//
// ПРЕРВАТЬ МОЖНО В ЛЮБОЙ МОМЕНТ (Ctrl+C). Каждый ответ Shikimori ложится
// на диск сразу, до любых следующих шагов, — запуск после перерыва продолжает
// с того места, где брошено, и заново не спрашивает ничего.
//
// ВЕЖЛИВОСТЬ К SHIKIMORI — не формальность, а условие, на котором мы им
// пользуемся: полторы секунды между запросами и тот же User-Agent, что у робота
// (scripts/anime-sources/shikimori.mjs).
//
// Полные списки ложатся в `отчёт-кандидаты.txt` рядом с проектом: кандидатов
// сотни, в переписке они не читаются. Файл в репозиторий не идёт (.gitignore).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildAnimeMatcher, collectQuotedPhrases } from '../src/lib/animeMentions.mjs';
import { readAnimeCollection } from './anime-cases-lib.mjs';
import { readPostsPlain } from './posts-plain.mjs';
import { sleep } from './anime-lib.mjs';
import * as shikimori from './anime-sources/shikimori.mjs';
import {
	WHY,
	appendCache,
	bestMatch,
	hasLetters,
	initMorph,
	nominativeGuess,
	normalizePhrase,
	phraseKey,
	readCache,
	readStoplist,
} from './anime-candidates-lib.mjs';

const REPORT_PATH = new URL('../отчёт-кандидаты.txt', import.meta.url);

// Пауза между запросами. Полторы секунды — как в scripts/fetch-anime.mjs.
const PAUSE_MS = 1500;

// Сколько ответов Shikimori смотреть у одного запроса. Пять, потому что замер
// 11 августа 2026 показал: правильный ответ приходит не обязательно первым —
// на «Тетради смерти» первой стоит «Смертельный бильярд», а нужная «Тетрадь
// смерти» второй.
const SEARCH_LIMIT = 5;

const has = (name) => process.argv.includes(`--${name}`);
const arg = (name, fallback) => {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--') ? process.argv[at + 1] : fallback;
};

const plural = (n, one, few, many) => {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return one;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
	return many;
};

const minutes = (ms) => {
	const total = Math.round(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.round((total % 3600) / 60);
	return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
};

export async function main() {
	await initMorph();

	const dry = has('dry');
	const limit = Number(arg('limit', '0')) || 0;

	const entries = await readAnimeCollection();
	const posts = await readPostsPlain();
	const stoplist = await readStoplist();

	// Список названий справочника берём ТЕМ ЖЕ кодом, которым сайт ищет
	// упоминания: русское и оригинальное название, оба списка вариантов
	// написания, кусок до двоеточия. Свой список тут был бы второй копией
	// правила «по чему ищем» — той самой, из-за которой чинился хвост 45.
	//
	// `quotes: 'ignore'` — галочка «только в кавычках» тут ни при чём вовсе:
	// мы не ищем упоминания в тексте, а спрашиваем «знаем ли мы уже такое
	// название». Знаем — значит знаем, в кавычках оно или нет.
	const matcher = buildAnimeMatcher(
		entries.map((e) => ({ id: e.data.id, data: e.data })),
		{ quotes: 'ignore' },
	);
	const known = new Set(matcher.map((m) => m.folded));
	const knownSourceIds = new Set(entries.map((e) => e.data.sourceId).filter(Boolean));
	const titleById = new Map(entries.map((e) => [e.data.id, e.data.titleRu || e.data.titleOriginal]));
	const idBySourceId = new Map(entries.map((e) => [e.data.sourceId, e.data.id]));

	// ─── 1. Сбор фраз ────────────────────────────────────────────────────────
	//
	// ЗАГОЛОВОК ПОСТА СМОТРИМ ТОЖЕ. У привезённых из телеграма постов название
	// аниме сплошь и рядом стоит именно в заголовке — «Что не так с „Дандаданом“».
	// Транскрипты НЕ участвуют вовсе: распознавание кавычек не расставляет
	// (тз/11, C.7).

	/** @type {Map<string, {sample: string, count: number, posts: Set<string>, where: string[]}>} */
	const phrases = new Map();
	let rawCount = 0;

	for (const post of posts) {
		for (const source of [post.title, post.text]) {
			for (const found of collectQuotedPhrases(source)) {
				rawCount++;
				const sample = normalizePhrase(found.text);
				if (!sample) continue;
				const key = phraseKey(sample);
				if (!phrases.has(key)) phrases.set(key, { sample, count: 0, posts: new Set(), where: [] });
				const rec = phrases.get(key);
				rec.count++;
				rec.posts.add(post.id);
				if (rec.where.length < 3) rec.where.push(post.id);
			}
		}
	}

	// ─── 2. Отсев ДО сети ────────────────────────────────────────────────────
	//
	// ВЫБРОШЕННОГО МОЛЧА ТУТ НЕТ. У каждого отказа название из WHY, и все они
	// пересчитаны в отчёте ниже.

	const dropped = new Map(Object.values(WHY).map((why) => [why, []]));
	const drop = (why, rec) => dropped.get(why).push(rec);

	const toAsk = [];
	for (const [key, rec] of phrases) {
		if (!hasLetters(rec.sample)) drop(WHY.NO_LETTERS, rec);
		else if (known.has(key)) drop(WHY.IN_CATALOG, rec);
		else if (stoplist.keys.has(key)) drop(WHY.STOPLIST, rec);
		else toAsk.push({ key, ...rec });
	}

	// Самое частое спрашиваем первым: прогон можно прервать, и брошенным
	// окажется хвост из одиночных фраз, а не то, что встречается в десяти постах.
	toAsk.sort((a, b) => b.posts.size - a.posts.size || b.count - a.count || a.sample.localeCompare(b.sample));

	const cache = await readCache();
	const fresh = toAsk.filter((item) => !cache.has(item.sample) && !cache.has(nominativeGuess(item.sample)));

	const say = [];
	const log = (line = '') => {
		say.push(line);
		console.log(line);
	};

	log('=== ЭТАП 11, ЧАСТЬ C: СБОР КАНДИДАТОВ. НИЧЕГО НЕ ЗАПИСАНО И НЕ ЗАВЕДЕНО ===');
	log();
	log(`Постов прочитано: ${posts.length} (вместе с черновиками). Тайтлов в справочнике: ${entries.length}.`);
	log(`Фраз в кавычках найдено: ${rawCount}, из них разных: ${phrases.size}.`);
	log();
	log('ОТСЕЯНО ДО ВСЯКОЙ СЕТИ:');
	log(`  ${String(dropped.get(WHY.IN_CATALOG).length).padStart(5)}  ${WHY.IN_CATALOG}`);
	log(`  ${String(dropped.get(WHY.STOPLIST).length).padStart(5)}  ${WHY.STOPLIST} (в стоп-листе сейчас ${stoplist.phrases.length})`);
	log(`  ${String(dropped.get(WHY.NO_LETTERS).length).padStart(5)}  ${WHY.NO_LETTERS}`);
	log();
	log(`УХОДИТ В SHIKIMORI: ${toAsk.length} ${plural(toAsk.length, 'фраза', 'фразы', 'фраз')}.`);
	log(`Из них уже спрошено раньше и лежит в кэше: ${toAsk.length - fresh.length}. Спрашивать заново: ${fresh.length}.`);
	log(
		`Это примерно ${minutes(fresh.length * PAUSE_MS)} — по полторы секунды на запрос; ` +
			`у не нашедшихся будет вторая попытка именительным падежом, она добавит времени.`,
	);

	if (dry) {
		log();
		log('Ключ --dry: в сеть не ходил, ничего не спрашивал. Уберите ключ, чтобы прогнать по-настоящему.');
		return;
	}

	// ─── 3. Вопросы Shikimori ────────────────────────────────────────────────

	// СЕТЬ ПОДВОДИТ, И ОДИН ТАЙМАУТ НЕ ИМЕЕТ ПРАВА УБИВАТЬ ЧАСОВОЙ ПРОГОН.
	// Наступили 11 августа 2026: прогон упал на 450-й фразе из 1980 с
	// «Connect Timeout Error» — и выглядел при этом УДАЧНЫМ, потому что упал
	// node, а оболочка честно напечатала «код возврата 0». Смотреть надо на код
	// возврата, а не на хвост вывода (CLAUDE.md, «Уроки проекта»).
	const RETRY_PAUSES = [5000, 15000, 45000];
	// А вот если сеть отвалилась СОВСЕМ, прогон обязан кричать, а не досчитать
	// до конца с пустыми ответами: пустота от «Shikimori не знает такого тайтла»
	// в отчёте неотличима от пустоты «интернет кончился».
	const MAX_FAILED_IN_ROW = 20;
	let failedInRow = 0;

	/** @returns {Promise<object[]|null>} null — «не спросилось», не путать с [] «спрошено, пусто» */
	const ask = async (query) => {
		if (cache.has(query)) return cache.get(query);

		for (let attempt = 0; ; attempt++) {
			try {
				const results = await shikimori.search(query, SEARCH_LIMIT);
				// НА ДИСК СРАЗУ, до любых следующих шагов: прогон идёт больше часа
				// и прерваться может чем угодно.
				await appendCache(query, results);
				cache.set(query, results);
				failedInRow = 0;
				await sleep(PAUSE_MS);
				return results;
			} catch (error) {
				if (attempt < RETRY_PAUSES.length) {
					process.stdout.write(`\n  сеть подвела на «${query}» (${error.message}); жду ${RETRY_PAUSES[attempt] / 1000} с\n`);
					await sleep(RETRY_PAUSES[attempt]);
					continue;
				}
				failedInRow++;
				if (failedInRow >= MAX_FAILED_IN_ROW) {
					throw new Error(
						`Shikimori не отвечает ${failedInRow} раз подряд — прогон остановлен. ` +
							`Спрошенное лежит в кэше, запустите заново, когда сеть вернётся.`,
					);
				}
				return null;
			}
		}
	};

	const work = limit > 0 ? toAsk.slice(0, limit) : toAsk;
	log();
	log(`Спрашиваю ${work.length} ${plural(work.length, 'фразу', 'фразы', 'фраз')}. Прервать можно в любой момент — спрошенное не пропадёт.`);

	const started = Date.now();
	const candidates = [];
	// Фразы, отсеянные ПОСЛЕ вопроса Shikimori. Складываются целиком, а не
	// считаются числом: «не выбрасывай молча» — всё, что отсеялось не справочником
	// и не стоп-листом, обязано лежать в отчёте списком, иначе пересчитать его
	// потом будет нечем.
	const silent = new Map([
		[WHY.NOT_FOUND, []],
		[WHY.NOT_SIMILAR, []],
	]);
	let askedSecond = 0;

	for (const [i, item] of work.entries()) {
		let results = await ask(item.sample);

		// null — не спросилось вовсе (сеть). Это НЕ «не нашлось»: фраза уходит
		// в свой список и будет спрошена при следующем запуске.
		if (results === null) {
			silent.get(WHY.NETWORK).push(item);
			continue;
		}

		let match = bestMatch(item.sample, results);

		// ВТОРАЯ ПОПЫТКА — ТОЛЬКО КОГДА НЕ НАШЛОСЬ РОВНО НИЧЕГО. Shikimori
		// ищет по основе слова, поэтому на падежную форму он чаще отвечает
		// правильно сам; а вот «Дандадана» он не знает вовсе — там нужен
		// именительный. Похожесть при этом сверяется всё равно с ИСХОДНОЙ
		// фразой, поэтому плохая догадка не может ничего испортить.
		if (!match && results.length === 0) {
			const guess = nominativeGuess(item.sample);
			if (guess && guess !== item.sample) {
				askedSecond++;
				const second = await ask(guess);
				if (second !== null) {
					results = second;
					match = bestMatch(item.sample, results) ?? bestMatch(guess, results);
				}
			}
		}

		if (match) candidates.push({ ...item, match });
		else if (results.length === 0) silent.get(WHY.NOT_FOUND).push(item);
		else silent.get(WHY.NOT_SIMILAR).push({ ...item, results });

		if ((i + 1) % 25 === 0 || i === work.length - 1) {
			const per = (Date.now() - started) / (i + 1);
			const left = Math.max(0, work.length - i - 1);
			process.stdout.write(
				`\r  ${i + 1} / ${work.length}, кандидатов ${candidates.length}, осталось ~${minutes(left * per)}          `,
			);
		}
	}
	process.stdout.write('\n');

	// ─── 4. Подробности у прошедших сверку ───────────────────────────────────
	//
	// Студию список поиска не отдаёт, за ней нужен второй запрос. Спрашиваем
	// ОДИН РАЗ НА ТАЙТЛ, а не на фразу: «Дандадан» и «Дандадана» — две фразы
	// и один тайтл.

	const bySource = new Map();
	for (const c of candidates) {
		if (!bySource.has(c.match.sourceId)) bySource.set(c.match.sourceId, []);
		bySource.get(c.match.sourceId).push(c);
	}

	// Фраза, за которой стоит УЖЕ ЗАВЕДЁННЫЙ тайтл, кандидатом не является:
	// это просто написание, которого нет в его вариантах. Отдельной строчкой
	// в отчёте — заказчику это подсказка, что вписать в «Варианты написания».
	const alreadyKnown = [];
	for (const [sourceId, group] of [...bySource]) {
		if (!knownSourceIds.has(sourceId)) continue;
		alreadyKnown.push({ sourceId, group });
		bySource.delete(sourceId);
	}

	log();
	log(`Добираю подробности (студия, год) у ${bySource.size} ${plural(bySource.size, 'тайтла', 'тайтлов', 'тайтлов')} — по одному запросу на тайтл.`);

	const details = new Map();
	let done = 0;
	for (const sourceId of bySource.keys()) {
		const key = `id:${sourceId}`;
		if (cache.has(key)) {
			details.set(sourceId, cache.get(key));
		} else {
			try {
				const data = await shikimori.findById(sourceId);
				await appendCache(key, data);
				cache.set(key, data);
				details.set(sourceId, data);
			} catch (error) {
				// Не вышло — не беда: название и год у нас уже есть из поиска.
				log(`  тайтл ${sourceId}: подробности не пришли (${error.message})`);
			}
			await sleep(PAUSE_MS);
		}
		done++;
		if (done % 25 === 0) process.stdout.write(`\r  ${done} / ${bySource.size}          `);
	}
	process.stdout.write('\n');

	// ─── 5. Отчёт ────────────────────────────────────────────────────────────

	const list = [...bySource.entries()]
		.map(([sourceId, group]) => {
			const posts = new Set(group.flatMap((g) => [...g.posts]));
			const info = details.get(sourceId) ?? {};
			return {
				sourceId,
				posts,
				count: group.reduce((sum, g) => sum + g.count, 0),
				phrases: group.map((g) => g.sample),
				where: [...posts].slice(0, 3),
				titleRu: info.titleRu ?? group[0].match.titleRu,
				titleOriginal: info.titleOriginal ?? group[0].match.titleOriginal,
				year: info.year ?? group[0].match.year,
				studio: info.studio,
				url: info.url ?? group[0].match.url,
			};
		})
		.sort((a, b) => b.posts.size - a.posts.size || b.count - a.count);

	log();
	log('=== ЧЕМ КОНЧИЛИСЬ ВОПРОСЫ ===');
	log(`  ${String(work.length).padStart(5)}  фраз спрошено`);
	log(`  ${String(silent.get(WHY.NOT_FOUND).length).padStart(5)}  ${WHY.NOT_FOUND} (и вторая попытка тоже)`);
	log(`  ${String(silent.get(WHY.NOT_SIMILAR).length).padStart(5)}  ${WHY.NOT_SIMILAR} — ответ есть, но название не сходится`);
	log(`  ${String(alreadyKnown.length).padStart(5)}  ведут на тайтл, который в справочнике УЖЕ ЕСТЬ (написание, которого нет в его вариантах)`);
	log(`  ${String(askedSecond).padStart(5)}  фраз пришлось переспросить именительным падежом`);
	log();
	log(`=== КАНДИДАТОВ: ${list.length} ===`);
	log('Это тайтлы, которых в справочнике нет, а на Shikimori они есть и название сходится.');
	log('НИ ОДИН НЕ ЗАВЕДЁН и не будет заведён без вашего слова.');

	const show = (rows, header) => {
		log();
		log(header);
		for (const row of rows) {
			log(
				`  ${String(row.posts.size).padStart(4)} ${plural(row.posts.size, 'пост ', 'поста', 'постов')}, ` +
					`${row.count} ${plural(row.count, 'упоминание', 'упоминания', 'упоминаний')}  ` +
					`«${row.phrases[0]}»${row.phrases.length > 1 ? ` (и ещё ${row.phrases.length - 1} написание)` : ''}`,
			);
			log(
				`         → ${row.titleRu ?? '—'} | ${row.titleOriginal} | ${row.year ?? 'год неизвестен'} | ${row.studio ?? 'студия неизвестна'}`,
			);
			log(`           посты: ${row.where.join(', ')}`);
		}
	};

	show(list.slice(0, 20), '=== ДВАДЦАТЬ САМЫХ ЧАСТЫХ ===');

	// СЕРЕДИНА СПИСКА — ОТДЕЛЬНО И НАРОЧНО. Первые двадцать всегда выглядят
	// прилично; чего стоит остальное, видно только по середине.
	const mid = list.slice(Math.floor(list.length / 3), Math.floor((list.length * 2) / 3));
	const sample = [];
	for (let i = 0; i < 20 && i < mid.length; i++) sample.push(mid[Math.floor((i * mid.length) / 20)]);
	show(sample, '=== ДВАДЦАТЬ ИЗ СЕРЕДИНЫ СПИСКА (не самых частых) ===');

	// ─── Полные списки в файл ────────────────────────────────────────────────

	const out = [...say];
	const put = (line = '') => out.push(line);

	put('', `=== ВСЕ КАНДИДАТЫ ПО ЧАСТОТЕ: ${list.length} ===`);
	for (const row of list) {
		put(
			`${String(row.posts.size).padStart(4)} постов | ${row.phrases.map((p) => `«${p}»`).join(' ')} → ` +
				`${row.titleRu ?? '—'} | ${row.titleOriginal} | ${row.year ?? '?'} | ${row.studio ?? '?'} | ${row.url ?? ''}`,
		);
		put(`      посты: ${[...row.posts].slice(0, 12).join(', ')}${row.posts.size > 12 ? ' …' : ''}`);
	}

	put('', `=== ФРАЗЫ, ВЕДУЩИЕ НА УЖЕ ЗАВЕДЁННЫЙ ТАЙТЛ: ${alreadyKnown.length} ===`);
	put('Кандидатами они не являются. Это подсказка, что вписать в «Варианты написания».');
	for (const { sourceId, group } of alreadyKnown) {
		const id = idBySourceId.get(sourceId);
		put(`  ${titleById.get(id) ?? id}: ${group.map((g) => `«${g.sample}»`).join(' ')}`);
	}

	// ОТСЕЯННОЕ ПОСЛЕ ВОПРОСА — СПИСКАМИ, А НЕ ЧИСЛОМ. Тут прячется единственный
	// способ найти пропущенный тайтл: если Shikimori чего-то не нашёл или ответил
	// непохожим, это может быть и настоящее аниме с другим русским названием.
	put('', `=== СПРОШЕНО, НО ${WHY.NOT_FOUND.toUpperCase()}: ${silent.get(WHY.NOT_FOUND).length} ===`);
	for (const rec of [...silent.get(WHY.NOT_FOUND)].sort((a, b) => b.posts.size - a.posts.size)) {
		put(`  ${String(rec.posts.size).padStart(4)}  «${rec.sample}»   ${rec.where.join(', ')}`);
	}

	put('', `=== СПРОШЕНО, ОТВЕТ ЕСТЬ, НО НАЗВАНИЕ НЕ СХОДИТСЯ: ${silent.get(WHY.NOT_SIMILAR).length} ===`);
	put('Рядом — что именно ответил Shikimori: так видно, не отвергли ли мы верное.');
	for (const rec of [...silent.get(WHY.NOT_SIMILAR)].sort((a, b) => b.posts.size - a.posts.size)) {
		put(`  ${String(rec.posts.size).padStart(4)}  «${rec.sample}»  →  ${rec.results.slice(0, 3).map((r) => r.titleRu ?? r.titleOriginal).join(' / ')}`);
	}

	for (const why of [WHY.IN_CATALOG, WHY.STOPLIST, WHY.NO_LETTERS]) {
		const rows = dropped.get(why);
		put('', `=== ОТСЕЯНО ДО СЕТИ — ${why}: ${rows.length} ===`);
		for (const rec of rows.sort((a, b) => b.posts.size - a.posts.size)) {
			put(`  ${String(rec.posts.size).padStart(4)}  «${rec.sample}»`);
		}
	}

	await writeFile(REPORT_PATH, out.join('\n') + '\n', 'utf8');
	log();
	log(`Полные списки — в файле ${fileURLToPath(REPORT_PATH)}`);
	log('Ничего не заведено и не записано в репозиторий.');
}

// Русские буквы в пути к проекту: import.meta.url кодирует их, а process.argv[1]
// нет, и строчное сравнение не совпало бы НИКОГДА (CLAUDE.md, «Уроки проекта»).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	await main();
}
