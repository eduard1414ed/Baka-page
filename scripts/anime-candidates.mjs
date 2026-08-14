// СБОР КАНДИДАТОВ В ТАЙТЛЫ (тз/11, C.1–C.4, C.6) — и он же готовит данные
// для экрана на /admin/tools/ (C.5).
//
// Что делает: собирает из всех постов фразы в кавычках, вычитает справочник
// и стоп-лист, остальное спрашивает у Shikimori, замеряет, что даст каждое
// решение, и складывает всё в `src/data/animeCandidates.json`.
//
// НИЧЕГО НЕ ЗАВОДИТ. Ни при какой частоте, ни при каком совпадении: тайтлы
// заводит человек кнопкой, а исполняет решение `scripts/anime-candidates-apply.mjs`.
// Устройство как у всех разовых прогонов проекта — сначала отчёт, потом,
// отдельным словом заказчика, применение.
//
//   node scripts/anime-candidates.mjs --dry        — БЕЗ СЕТИ: только сбор
//                                                    и отсев, числа и сроки
//   node scripts/anime-candidates.mjs              — полный прогон (идёт в сеть)
//   node scripts/anime-candidates.mjs --write      — то же и записать данные экрана
//   node scripts/anime-candidates.mjs --no-ask     — пересобрать данные экрана
//                                                    из уже известного, не спрашивая
//   node scripts/anime-candidates.mjs --only-drafts — спрашивать только про фразы,
//                                                    встретившиеся в ЧЕРНОВИКАХ
//   node scripts/anime-candidates.mjs --max-ask 50  — не спрашивать больше N новых
//
// ПРЕРВАТЬ МОЖНО В ЛЮБОЙ МОМЕНТ (Ctrl+C). Каждый ответ Shikimori ложится
// на диск сразу, до любых следующих шагов, — запуск после перерыва продолжает
// с того места, где брошено, и заново не спрашивает ничего.
//
// ДВА ХРАНИЛИЩА ОТВЕТОВ, И ЭТО НЕ КОПИЯ. `.tmp-shikimori/` — сырая выдача
// поисковика, лежит рядом с проектом и в репозиторий не идёт: по ней можно
// пересчитать похожесть, если правило похожести поменяется. А
// `src/data/animeCandidates.json` — уже РАЗОБРАННЫЙ исход, и он в репозитории,
// потому что робот на GitHub работает в чистой папке: сырого кэша у него нет
// и быть не может, а знать, что уже спрошено, он обязан — иначе Shikimori
// спрашивали бы об одном и том же при каждом сохранении черновика.
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
import { freeSlug } from '../src/lib/animeSlug.mjs';
import { computeAliasesAuto, readAnimeCollection } from './anime-cases-lib.mjs';
import { readPostsPlain, readTranscriptsPlain } from './posts-plain.mjs';
// Пауза между запросами к Shikimori — ОДНО ЧИСЛО НА ВЕСЬ ПРОЕКТ (хвост 56).
import { sleep, сПовторами, SHIKIMORI_PAUSE_MS as PAUSE_MS } from './anime-lib.mjs';
import * as shikimori from './anime-sources/shikimori.mjs';
import {
	CANDIDATES_PATH,
	WHY,
	appendCache,
	bestMatch,
	looksLikeShortName,
	hasLetters,
	initMorph,
	measureGain,
	nominativeGuess,
	normalizePhrase,
	phraseKey,
	prepareTexts,
	readCache,
	readCandidates,
	readStoplist,
} from './anime-candidates-lib.mjs';

const REPORT_PATH = new URL('../отчёт-кандидаты.txt', import.meta.url);

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

// Полоса прогресса — только человеку в терминале. В логе робота на GitHub
// возврат каретки не работает, и она превратилась бы в стену из восьмидесяти
// строк, в которой отчёта уже не найти.
const progress = (line) => {
	if (process.stdout.isTTY) process.stdout.write(line);
};

const minutes = (ms) => {
	const total = Math.round(ms / 1000);
	const h = Math.floor(total / 3600);
	const m = Math.round((total % 3600) / 60);
	return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
};

/**
 * Разобранный исход одного вопроса — то, что переживает прогон и ложится
 * в `src/data/animeCandidates.json`. Строится либо из свежей выдачи Shikimori,
 * либо берётся из прошлого файла у фраз, которые уже спрашивали.
 */
function outcomeOf(phrase, results) {
	const match = bestMatch(phrase, results);
	if (match) return { kind: 'candidate', match };
	if (!results || results.length === 0) return { kind: 'notfound' };

	const short = looksLikeShortName(phrase, results);
	if (short) return { kind: 'short', match: short, results: results.slice(0, SEARCH_LIMIT) };

	return { kind: 'notsimilar', answers: results.slice(0, 3).map((r) => r.titleRu ?? r.titleOriginal) };
}

export async function main() {
	await initMorph();

	const dry = has('dry');
	const noAsk = has('no-ask');
	const write = has('write');
	const onlyDrafts = has('only-drafts');
	const limit = Number(arg('limit', '0')) || 0;
	const maxAsk = Number(arg('max-ask', '0')) || 0;

	const entries = await readAnimeCollection();
	const posts = await readPostsPlain();
	const stoplist = await readStoplist();
	const previous = await readCandidates();

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
		{ quotes: 'ignore', speech: false },
	);
	const known = new Set(matcher.map((m) => m.folded));
	const knownSourceIds = new Set(entries.map((e) => e.data.sourceId).filter(Boolean));
	const titleById = new Map(entries.map((e) => [e.data.id, e.data.titleRu || e.data.titleOriginal]));
	const idBySourceId = new Map(entries.map((e) => [e.data.sourceId, e.data.id]));
	const dataById = new Map(entries.map((e) => [e.data.id, e.data]));

	// ─── 1. Сбор фраз ────────────────────────────────────────────────────────
	//
	// ЗАГОЛОВОК ПОСТА СМОТРИМ ТОЖЕ. У привезённых из телеграма постов название
	// аниме сплошь и рядом стоит именно в заголовке — «Что не так с „Дандаданом“».
	// Транскрипты НЕ участвуют вовсе: распознавание кавычек не расставляет
	// (тз/11, C.7).

	/** @type {Map<string, {sample: string, count: number, posts: Set<string>, inDraft: boolean}>} */
	const phrases = new Map();
	let rawCount = 0;

	for (const post of posts) {
		for (const source of [post.title, post.text]) {
			for (const found of collectQuotedPhrases(source)) {
				rawCount++;
				const sample = normalizePhrase(found.text);
				if (!sample) continue;
				const key = phraseKey(sample);
				if (!phrases.has(key)) phrases.set(key, { sample, count: 0, posts: new Set(), inDraft: false });
				const rec = phrases.get(key);
				rec.count++;
				rec.posts.add(post.id);
				if (post.draft) rec.inDraft = true;
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
		else toAsk.push({ key, ...rec, where: [...rec.posts].slice(0, 3) });
	}

	// Самое частое спрашиваем первым: прогон можно прервать, и брошенным
	// окажется хвост из одиночных фраз, а не то, что встречается в десяти постах.
	toAsk.sort((a, b) => b.posts.size - a.posts.size || b.count - a.count || a.sample.localeCompare(b.sample));

	const cache = await readCache();

	// ЧТО СЧИТАЕТСЯ «УЖЕ СПРОШЕННЫМ». Сырой кэш есть только на машине, где
	// гоняли полный прогон; у робота на GitHub его нет вовсе, и знание
	// «об этом уже спрашивали» приезжает к нему разобранными исходами
	// из прошлого файла. Спрашиваем заново только то, чего нет ни там, ни там.
	const knownOutcome = (item) =>
		cache.has(item.sample) || cache.has(nominativeGuess(item.sample)) || previous.outcomes.has(item.key);

	const fresh = toAsk.filter((item) => !knownOutcome(item));
	// РОБОТ РАЗБИРАЕТ ТОЛЬКО ЧЕРНОВИКИ (тз/11, C.3): опубликованный пост уже
	// прошёл через черновик, и перепроверять его при правке не надо.
	const askable = onlyDrafts ? fresh.filter((item) => item.inDraft) : fresh;

	const say = [];
	const log = (line = '') => {
		say.push(line);
		console.log(line);
	};

	log('=== ЭТАП 11, ЧАСТЬ C: СБОР КАНДИДАТОВ. НИ ОДИН ТАЙТЛ НЕ ЗАВЕДЁН ===');
	log();
	log(`Постов прочитано: ${posts.length} (вместе с черновиками). Тайтлов в справочнике: ${entries.length}.`);
	log(`Фраз в кавычках найдено: ${rawCount}, из них разных: ${phrases.size}.`);
	log();
	log('ОТСЕЯНО ДО ВСЯКОЙ СЕТИ:');
	log(`  ${String(dropped.get(WHY.IN_CATALOG).length).padStart(5)}  ${WHY.IN_CATALOG}`);
	log(`  ${String(dropped.get(WHY.STOPLIST).length).padStart(5)}  ${WHY.STOPLIST} (в стоп-листе сейчас ${stoplist.phrases.length})`);
	log(`  ${String(dropped.get(WHY.NO_LETTERS).length).padStart(5)}  ${WHY.NO_LETTERS}`);
	log();
	log(`ВСЕГО ФРАЗ К РАЗБОРУ: ${toAsk.length} ${plural(toAsk.length, 'фраза', 'фразы', 'фраз')}.`);
	log(`Из них исход уже известен: ${toAsk.length - fresh.length}. Спрашивать заново: ${fresh.length}.`);
	if (onlyDrafts && askable.length !== fresh.length) {
		log(`Из новых встречаются в черновиках: ${askable.length}. Остальные стоят только в опубликованных постах — их не перепроверяем (тз/11, C.3).`);
	}
	log(
		`Это примерно ${minutes(askable.length * PAUSE_MS)} — по полторы секунды на запрос; ` +
			`у не нашедшихся будет вторая попытка именительным падежом, она добавит времени.`,
	);

	if (dry) {
		log();
		log('Ключ --dry: в сеть не ходил, ничего не спрашивал. Уберите ключ, чтобы прогнать по-настоящему.');
		return { asked: 0, fresh: 0, freshAll: 0 };
	}

	// ─── 3. Вопросы Shikimori ────────────────────────────────────────────────

	// СЕТЬ ПОДВОДИТ, И ОДИН ТАЙМАУТ НЕ ИМЕЕТ ПРАВА УБИВАТЬ ЧАСОВОЙ ПРОГОН.
	// Наступили 11 августа 2026: прогон упал на 450-й фразе из 1980 с
	// «Connect Timeout Error» — и выглядел при этом УДАЧНЫМ, потому что упал
	// node, а оболочка честно напечатала «код возврата 0». Смотреть надо на код
	// возврата, а не на хвост вывода (CLAUDE.md, «Уроки проекта»).
	// Сам повтор живёт в `anime-lib.mjs` (`сПовторами`) — там же, откуда его
	// берёт применение решений: вторая копия разошлась бы молча.
	const RETRY_PAUSES = [5000, 15000, 45000];
	// А вот если сеть отвалилась СОВСЕМ, прогон обязан кричать, а не досчитать
	// до конца с пустыми ответами: пустота от «Shikimori не знает такого тайтла»
	// в отчёте неотличима от пустоты «интернет кончился».
	const MAX_FAILED_IN_ROW = 20;
	let failedInRow = 0;
	let askedNow = 0;

	/** @returns {Promise<object[]|null>} null — «не спросилось», не путать с [] «спрошено, пусто» */
	const ask = async (query) => {
		if (cache.has(query)) return cache.get(query);
		if (noAsk) return null;

		try {
			const results = await сПовторами(() => shikimori.search(query, SEARCH_LIMIT), {
				паузы: RETRY_PAUSES,
				назвать: query,
				сказать: (text) => process.stdout.write(`\n${text}\n`),
			});
			// НА ДИСК СРАЗУ, до любых следующих шагов: прогон идёт больше часа
			// и прерваться может чем угодно.
			await appendCache(query, results);
			cache.set(query, results);
			failedInRow = 0;
			askedNow++;
			await sleep(PAUSE_MS);
			return results;
		} catch (error) {
			failedInRow++;
			if (failedInRow >= MAX_FAILED_IN_ROW) {
				throw new Error(
					`Shikimori не отвечает ${failedInRow} раз подряд — прогон остановлен. ` +
						`Спрошенное лежит в кэше, запустите заново, когда сеть вернётся.`,
				);
			}
			return null;
		}
	};

	const work = limit > 0 ? toAsk.slice(0, limit) : toAsk;
	const askableKeys = new Set(askable.map((item) => item.key));

	log();
	log(
		noAsk
			? `Ключ --no-ask: в сеть не иду, разбираю ${work.length} ${plural(work.length, 'фразу', 'фразы', 'фраз')} по уже известному.`
			: `Разбираю ${work.length} ${plural(work.length, 'фразу', 'фразы', 'фраз')}. Прервать можно в любой момент — спрошенное не пропадёт.`,
	);

	const started = Date.now();
	/** @type {Map<string, object>} ключ фразы → разобранный исход */
	const outcomes = new Map();
	// Фразы, которых так и не спросили. Складываются списком, а не считаются
	// числом: «не выбрасывай молча» — иначе пересчитать их потом будет нечем.
	const notAsked = [];
	let askedSecond = 0;
	let cappedByMax = 0;

	for (const [i, item] of work.entries()) {
		const stored = previous.outcomes.get(item.key);

		// Порядок ровно такой: сначала сырая выдача (она свежее и по ней можно
		// пересчитать похожесть), потом разобранный исход прошлого прогона.
		if (!cache.has(item.sample) && stored) {
			outcomes.set(item.key, stored);
			continue;
		}

		if (!cache.has(item.sample)) {
			if (!askableKeys.has(item.key)) {
				notAsked.push({ ...item, why: 'опубликованный пост, черновиков с этой фразой нет' });
				continue;
			}
			if (maxAsk > 0 && askedNow >= maxAsk) {
				cappedByMax++;
				notAsked.push({ ...item, why: `упёрлись в предел --max-ask ${maxAsk}` });
				continue;
			}
		}

		let results = await ask(item.sample);

		// null — не спросилось вовсе (сеть или --no-ask). Это НЕ «не нашлось»:
		// фраза уходит в свой список и будет спрошена при следующем запуске.
		if (results === null) {
			notAsked.push({ ...item, why: noAsk ? 'не спрашивали: ключ --no-ask' : 'не спросилось: сеть подвела' });
			continue;
		}

		// ВТОРАЯ ПОПЫТКА — ТОЛЬКО КОГДА НЕ НАШЛОСЬ РОВНО НИЧЕГО. Shikimori
		// ищет по основе слова, поэтому на падежную форму он чаще отвечает
		// правильно сам; а вот «Дандадана» он не знает вовсе — там нужен
		// именительный. Похожесть при этом сверяется всё равно с ИСХОДНОЙ
		// фразой, поэтому плохая догадка не может ничего испортить.
		if (results.length === 0 && !bestMatch(item.sample, results)) {
			const guess = nominativeGuess(item.sample);
			if (guess && guess !== item.sample) {
				askedSecond++;
				const second = await ask(guess);
				if (second !== null && second.length > 0) results = second;
			}
		}

		outcomes.set(item.key, outcomeOf(item.sample, results));

		if ((i + 1) % 25 === 0 || i === work.length - 1) {
			const per = (Date.now() - started) / (i + 1);
			const left = Math.max(0, work.length - i - 1);
			progress(`\r  ${i + 1} / ${work.length}, разобрано ${outcomes.size}, осталось ~${minutes(left * per)}          `);
		}
	}
	progress('\n');

	// ─── 4. Раскладка по группам ─────────────────────────────────────────────

	// ЧТО ИМЕННО НОВОГО ЗА ЭТОТ ЗАХОД. По этому числу робот решает, писать ли
	// письмо: «сходил, ничего нового» через неделю перестают читать, а вместе
	// с ним перестают читать и письма о находках.
	const freshKeys = new Set(work.filter((item) => !previous.outcomes.has(item.key)).map((item) => item.key));

	const byKey = new Map(work.map((item) => [item.key, item]));
	const groups = { candidate: [], short: [], notsimilar: [], notfound: [] };
	for (const [key, outcome] of outcomes) {
		const item = byKey.get(key);
		if (item) groups[outcome.kind].push({ ...item, ...outcome });
	}

	// Кандидаты собираются ПО ТАЙТЛУ, а не по фразе: «Дандадан» и «Дандадана» —
	// две фразы и один тайтл, и кнопка у них одна.
	const bySource = new Map();
	for (const c of groups.candidate) {
		if (!bySource.has(c.match.sourceId)) bySource.set(c.match.sourceId, []);
		bySource.get(c.match.sourceId).push(c);
	}

	// Фраза, за которой стоит УЖЕ ЗАВЕДЁННЫЙ тайтл, кандидатом не является:
	// это просто написание, которого нет в его вариантах. Ей нужна кнопка
	// «Это уже есть», а не «Завести».
	const alreadyKnown = [];
	for (const [sourceId, group] of [...bySource]) {
		if (!knownSourceIds.has(sourceId)) continue;
		alreadyKnown.push({ sourceId, animeId: idBySourceId.get(sourceId), group });
		bySource.delete(sourceId);
	}

	// ─── 5. Подробности у прошедших сверку ───────────────────────────────────
	//
	// Студию и обложку список поиска не отдаёт, за ними нужен второй запрос.
	// Спрашиваем ОДИН РАЗ НА ТАЙТЛ, а не на фразу.

	log();
	log(`Добираю подробности (студия, год, обложка) у ${bySource.size} ${plural(bySource.size, 'тайтла', 'тайтлов', 'тайтлов')}.`);

	const details = new Map();
	let done = 0;
	for (const sourceId of bySource.keys()) {
		const key = `id:${sourceId}`;
		if (cache.has(key)) {
			details.set(sourceId, cache.get(key));
		} else if (previous.details.has(sourceId)) {
			// У робота на GitHub сырого кэша нет вовсе: студия и обложка приезжают
			// к нему из прошлых данных экрана. Не сделай мы этого — каждое
			// сохранение черновика стирало бы обложки у всех 680 строк.
			details.set(sourceId, previous.details.get(sourceId));
		} else if (!noAsk) {
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
		if (done % 25 === 0) progress(`\r  ${done} / ${bySource.size}          `);
	}
	progress('\n');

	// ─── 6. Замер: что даст каждое решение ───────────────────────────────────
	//
	// Мерим ТЕМ ЖЕ кодом, которым сайт ищет упоминания, и на живом справочнике:
	// новое название конкурирует со старыми, и мерить его в одиночку значило бы
	// пообещать ссылки там, где ссылка уже стоит.

	const liveGuids = new Set(posts.filter((p) => !p.draft && p.guid).map((p) => p.guid));
	const transcripts = await readTranscriptsPlain();

	// В постах ссылку ставит разметка тела, а не заголовка, — поэтому меряем
	// по телу. Фразы при этом собирались и из заголовков: это разные вопросы,
	// «есть ли тут название» и «станет ли оно ссылкой».
	const postTexts = prepareTexts(posts.map((p) => ({ id: p.id, text: p.text, live: !p.draft })));
	const transcriptTexts = prepareTexts(
		transcripts.map((t) => ({
			id: t.id,
			// Через перевод строки: название не может стоять на стыке двух
			// реплик, а границы слова так остаются на месте.
			text: t.replicas.map((r) => r.text ?? '').join('\n'),
			live: liveGuids.has(t.id),
		})),
	);

	const basePosts = buildAnimeMatcher(
		entries.map((e) => ({ id: e.data.id, data: e.data })),
		{ quotes: 'apply', speech: false },
	);
	const baseTranscripts = matcher;

	const gainFor = (probe) => ({
		posts: measureGain(probe, basePosts, postTexts, 'apply'),
		transcripts: measureGain(probe, baseTranscripts, transcriptTexts, 'ignore'),
	});

	log(`Меряю прибавку у ${bySource.size + alreadyKnown.length + groups.short.length} строк по ${postTexts.length} постам и ${transcriptTexts.length} расшифровкам…`);

	// ─── 7. Данные экрана ────────────────────────────────────────────────────

	// СКОЛЬКО ПОСТОВ ПОКАЗЫВАТЬ. Полный список нужен только глазам, и хранить
	// его целиком незачем: число постов у каждой строки пересчитывается из
	// архива при КАЖДОМ прогоне, а не берётся из файла. Полные списки весили
	// больше половины файла, который заказчик грузит при открытии экрана.
	const SHOW_POSTS = 12;
	const someOf = (set) => [...set].slice(0, SHOW_POSTS);

	const takenSlugs = new Set(entries.map((e) => e.data.id));

	const candidates = [...bySource.entries()]
		.map(([sourceId, group]) => {
			const posts_ = new Set(group.flatMap((g) => [...g.posts]));
			const info = details.get(sourceId) ?? {};
			const titleRu = info.titleRu ?? group[0].match.titleRu;
			const titleOriginal = info.titleOriginal ?? group[0].match.titleOriginal;
			// Падежи считаются при заведении (writeAnimeEntry), значит и в замер
			// они обязаны входить: без них «Атака титанов» насчитала бы себе
			// вдвое меньше, чем даст на самом деле.
			const aliasesAuto = computeAliasesAuto({ titleRu, titleOriginal, aliases: [] });
			return {
				sourceId,
				slug: '',
				phrases: group.map((g) => g.sample),
				postsCount: posts_.size,
				posts: someOf(posts_),
				count: group.reduce((sum, g) => sum + g.count, 0),
				titleRu: titleRu ?? null,
				titleOriginal,
				year: info.year ?? group[0].match.year ?? null,
				studio: info.studio ?? null,
				poster: info.posterUrl ?? null,
				url: info.url ?? group[0].match.url ?? null,
				gain: gainFor({ titleRu, titleOriginal, aliasesAuto }),
			};
		})
		.sort((a, b) => b.postsCount - a.postsCount || b.count - a.count);

	// Адрес будущей страницы считается тем же правилом, что и в админке
	// (src/lib/animeSlug.mjs). Занятыми считаются и уже розданные в этом же
	// списке — иначе два разных тайтла с одинаковым оригинальным названием
	// получили бы один адрес.
	for (const row of candidates) {
		row.slug = freeSlug(row.titleOriginal, takenSlugs);
		takenSlugs.add(row.slug);
	}

	const aliasRow = (sample, posts_, count, target, extra) => {
		const data = target ? dataById.get(target) : null;
		return {
			text: sample,
			postsCount: posts_.size ?? posts_.length,
			posts: someOf(posts_),
			count,
			animeId: target ?? null,
			animeTitle: target ? (titleById.get(target) ?? target) : null,
			...extra,
			gain: gainFor({ aliases: [sample], strictQuotes: data?.strictQuotes === true }),
		};
	};

	// Фраза ведёт на тайтл, который уже заведён: ей нужна кнопка «Это уже есть».
	const already = alreadyKnown.flatMap(({ sourceId, animeId, group }) =>
		group.map((g) =>
			aliasRow(g.sample, g.posts, g.count, animeId, {
				sourceId,
				titleRu: g.match.titleRu ?? null,
				titleOriginal: g.match.titleOriginal,
				year: g.match.year ?? null,
				url: g.match.url ?? null,
			}),
		),
	);

	// Разговорное сокращение. Звёздочка — «тайтл УЖЕ в справочнике»: ищется
	// по ВСЕЙ выдаче, а не по первому совпавшему, потому что у «Фрирен» первым
	// подходит сиквел, и пометка не встала бы у самой дорогой строки списка.
	const shortName = groups.short
		.map((rec) => {
			const mine = (rec.results ?? []).find((r) => knownSourceIds.has(r.sourceId));
			const animeId = mine ? idBySourceId.get(mine.sourceId) : null;
			// Тайтл нашёлся у нас — и показываем ЕГО данные, а не ответ поисковика:
			// русское название заказчик мог поправить руками, и в списке должно
			// стоять то, что он увидит в справочнике.
			const own = animeId ? dataById.get(animeId) : null;
			const shown = own ?? rec.match;
			return aliasRow(rec.sample, rec.posts, rec.count, animeId, {
				titleRu: shown.titleRu ?? null,
				titleOriginal: shown.titleOriginal,
				year: shown.year ?? null,
				url: shown.url ?? null,
				sourceId: shown.sourceId,
				// ВСЯ ВЫДАЧА ОДНИМИ НОМЕРАМИ. Звёздочка «тайтл уже в справочнике»
				// ищется по всей пятёрке ответов, а не по показанной строке:
				// у «Фрирен» первым подходит сиквел, и пометка не встала бы
				// у самой дорогой строки списка. Хранить сами названия при этом
				// незачем — тайтл, который в справочнике есть, мы и так знаем
				// по номеру. Названиями это весило 110 КБ, номерами — пять.
				resultIds: (rec.results ?? []).map((r) => r.sourceId),
			});
		})
		.sort((a, b) => b.postsCount - a.postsCount || b.count - a.count);

	// У отвергнутых групп примеров хватает трёх: строк там полторы тысячи,
	// и по каждой заказчик решает не «куда это отнести», а «не потеряли ли мы
	// тут настоящий тайтл».
	const plainRows = (rows, extra = () => ({})) =>
		rows
			.map((rec) => ({ text: rec.sample, postsCount: rec.posts.size, posts: [...rec.posts].slice(0, 3), count: rec.count, ...extra(rec) }))
			.sort((a, b) => b.postsCount - a.postsCount || b.count - a.count);

	const notSimilar = plainRows(groups.notsimilar, (rec) => ({ answers: rec.answers }));
	const notFound = plainRows(groups.notfound);

	// Новое за этот заход — по группам. Считается по ключам, а не по номерам
	// тайтлов: одна и та же фраза не может быть новой дважды.
	const freshIn = (rows, field) => rows.filter((row) => (field === 'phrases' ? row.phrases : [row.text]).some((p) => freshKeys.has(phraseKey(p)))).length;
	const newly = {
		candidates: freshIn(candidates, 'phrases'),
		already: freshIn(already),
		shortName: freshIn(shortName),
		notSimilar: freshIn(notSimilar),
		notFound: freshIn(notFound),
	};
	const freshTotal = newly.candidates + newly.already + newly.shortName;

	const data = {
		generated: new Date().toISOString(),
		postsRead: posts.length,
		phrasesFound: rawCount,
		phrasesDistinct: phrases.size,
		inCatalog: dropped.get(WHY.IN_CATALOG).length,
		inStoplist: dropped.get(WHY.STOPLIST).length,
		notAsked: notAsked.length,
		candidates,
		already,
		shortName,
		notSimilar,
		notFound,
	};

	// ─── 8. Отчёт ────────────────────────────────────────────────────────────

	log();
	if (freshKeys.size > 0) {
		log(`=== НОВОГО ЗА ЭТОТ ЗАХОД: ${freshKeys.size} ${plural(freshKeys.size, 'фраза', 'фразы', 'фраз')} ===`);
		log(`  кандидатов: ${newly.candidates}, ведут на заведённый тайтл: ${newly.already}, разговорных сокращений: ${newly.shortName}`);
		log(`  не нашлось: ${newly.notFound}, ответ не сходится: ${newly.notSimilar}`);
		if (freshTotal > 0) {
			log('  СТРОК, ЖДУЩИХ ВАШЕГО РЕШЕНИЯ: ' + freshTotal);
			for (const row of candidates.filter((r) => r.phrases.some((p) => freshKeys.has(phraseKey(p))))) {
				log(`    «${row.phrases[0]}» → ${row.titleRu ?? row.titleOriginal} (${row.year ?? 'год неизвестен'}), даст ${row.gain.posts.texts} ссылок в постах`);
			}
			for (const row of [...already, ...shortName].filter((r) => freshKeys.has(phraseKey(r.text)))) {
				log(`    «${row.text}» → ${row.animeTitle ?? row.titleRu ?? row.titleOriginal}${row.animeId ? ' ★ тайтл уже в справочнике' : ''}`);
			}
		}
		log();
	}
	log('=== ЧЕМ КОНЧИЛИСЬ ВОПРОСЫ ===');
	log(`  ${String(work.length).padStart(5)}  фраз к разбору`);
	log(`  ${String(notFound.length).padStart(5)}  ${WHY.NOT_FOUND} (и вторая попытка тоже)`);
	log(`  ${String(notSimilar.length).padStart(5)}  ${WHY.NOT_SIMILAR} — ответ есть, но название не сходится`);
	log(`  ${String(shortName.length).padStart(5)}  ${WHY.SHORT_NAME} («Фрирен» вместо «Провожающая в последний путь Фрирен») — СМОТРЕТЬ ГЛАЗАМИ`);
	log(`  ${String(already.length).padStart(5)}  ведут на тайтл, который в справочнике УЖЕ ЕСТЬ`);
	log(`  ${String(askedSecond).padStart(5)}  фраз пришлось переспросить именительным падежом`);
	if (notAsked.length > 0) log(`  ${String(notAsked.length).padStart(5)}  так и не спрошено — списком в файле отчёта`);
	if (cappedByMax > 0) log(`  ⚑ предел --max-ask ${maxAsk} остановил ${cappedByMax} ${plural(cappedByMax, 'вопрос', 'вопроса', 'вопросов')} — запустите ещё раз`);
	log();
	log(`=== КАНДИДАТОВ: ${candidates.length} ===`);
	log('Это тайтлы, которых в справочнике нет, а на Shikimori они есть и название сходится.');
	log('НИ ОДИН НЕ ЗАВЕДЁН и не будет заведён без вашего слова.');

	const show = (rows, header) => {
		log();
		log(header);
		for (const row of rows) {
			log(
				`  ${String(row.postsCount).padStart(4)} ${plural(row.postsCount, 'пост ', 'поста', 'постов')}, ` +
					`${row.count} ${plural(row.count, 'упоминание', 'упоминания', 'упоминаний')}  ` +
					`«${row.phrases[0]}»${row.phrases.length > 1 ? ` (и ещё ${row.phrases.length - 1} написание)` : ''}`,
			);
			log(`         → ${row.titleRu ?? '—'} | ${row.titleOriginal} | ${row.year ?? 'год неизвестен'} | ${row.studio ?? 'студия неизвестна'}`);
			log(
				`           даст: ${row.gain.posts.texts} ссылок в постах (на сайте ${row.gain.posts.live}), ` +
					`${row.gain.transcripts.mentions} упоминаний в ${row.gain.transcripts.texts} выпусках (на сайте ${row.gain.transcripts.live})`,
			);
		}
	};

	show(candidates.slice(0, 20), '=== ДВАДЦАТЬ САМЫХ ЧАСТЫХ ===');

	// СЕРЕДИНА СПИСКА — ОТДЕЛЬНО И НАРОЧНО. Первые двадцать всегда выглядят
	// прилично; чего стоит остальное, видно только по середине.
	const mid = candidates.slice(Math.floor(candidates.length / 3), Math.floor((candidates.length * 2) / 3));
	const sample = [];
	for (let i = 0; i < 20 && i < mid.length; i++) sample.push(mid[Math.floor((i * mid.length) / 20)]);
	show(sample, '=== ДВАДЦАТЬ ИЗ СЕРЕДИНЫ СПИСКА (не самых частых) ===');

	// ─── Полные списки в файл ────────────────────────────────────────────────

	const out = [...say];
	// Принимает НЕСКОЛЬКО строк: первая редакция брала одну, а звалась с двумя
	// («пустая строка» плюс заголовок раздела) — и все подписи разделов в файле
	// молча пропали, а списки остались. Ошибки при этом не было никакой.
	const put = (...lines) => out.push(...(lines.length ? lines : ['']));

	const gainLine = (gain) =>
		`+${gain.posts.texts} ссылок в постах (${gain.posts.live} на сайте), ` +
		`+${gain.transcripts.mentions} упоминаний в ${gain.transcripts.texts} выпусках (${gain.transcripts.live} на сайте)`;

	put('', `=== ВСЕ КАНДИДАТЫ ПО ЧАСТОТЕ: ${candidates.length} ===`);
	for (const row of candidates) {
		put(
			`${String(row.postsCount).padStart(4)} постов | ${row.phrases.map((p) => `«${p}»`).join(' ')} → ` +
				`${row.titleRu ?? '—'} | ${row.titleOriginal} | ${row.year ?? '?'} | ${row.studio ?? '?'} | ${row.url ?? ''}`,
		);
		put(`      адрес: /anime/${row.slug}/ · даст ${gainLine(row.gain)}`);
		put(`      посты: ${row.posts.join(', ')}${row.postsCount > row.posts.length ? ' …' : ''}`);
	}

	put('', `=== ФРАЗЫ, ВЕДУЩИЕ НА УЖЕ ЗАВЕДЁННЫЙ ТАЙТЛ: ${already.length} ===`);
	put('Кандидатами они не являются. Это подсказка, что вписать в «Варианты написания».');
	for (const row of already) {
		put(`  ${String(row.postsCount).padStart(4)}  «${row.text}»  →  ${row.animeTitle}`);
		put(`        даст ${gainLine(row.gain)}`);
	}

	// ОТСЕЯННОЕ ПОСЛЕ ВОПРОСА — СПИСКАМИ, А НЕ ЧИСЛОМ. Тут прячется единственный
	// способ найти пропущенный тайтл: если Shikimori чего-то не нашёл или ответил
	// непохожим, это может быть и настоящее аниме с другим русским названием.
	put('', `=== СПРОШЕНО, НО ${WHY.NOT_FOUND.toUpperCase()}: ${notFound.length} ===`);
	for (const row of notFound) {
		put(`  ${String(row.postsCount).padStart(4)}  «${row.text}»   ${row.posts.slice(0, 3).join(', ')}`);
	}

	put('', `=== ПОХОЖЕ НА РАЗГОВОРНОЕ СОКРАЩЕНИЕ — СМОТРЕТЬ ГЛАЗАМИ: ${shortName.length} ===`);
	put('Фраза стоит СЛОВАМИ внутри найденного названия: «Фрирен» внутри «Провожающая');
	put('в последний путь Фрирен». Кандидатами они не стали нарочно — ослабь правило,');
	put('и «аниме года» сойдётся с «Аниме-историями». Но тут же лежит самое ценное:');
	put('сокращения тайтлов, КОТОРЫЕ УЖЕ В СПРАВОЧНИКЕ, — их надо вписать');
	put('в «Варианты написания», и ссылки появятся сразу по всему архиву.');
	for (const row of shortName) {
		put(
			`  ${String(row.postsCount).padStart(4)}  «${row.text}»  →  ${row.titleRu ?? row.titleOriginal}` +
				`${row.animeId ? '   ★ ТАЙТЛ УЖЕ В СПРАВОЧНИКЕ — впишите фразу в «Варианты написания»' : ''}`,
		);
		put(`        даст ${gainLine(row.gain)}`);
		put(`        посты: ${row.posts.slice(0, 6).join(', ')}${row.postsCount > 6 ? ' …' : ''}`);
	}

	put('', `=== СПРОШЕНО, ОТВЕТ ЕСТЬ, НО НАЗВАНИЕ НЕ СХОДИТСЯ: ${notSimilar.length} ===`);
	put('Рядом — что именно ответил Shikimori: так видно, не отвергли ли мы верное.');
	for (const row of notSimilar) {
		put(`  ${String(row.postsCount).padStart(4)}  «${row.text}»  →  ${(row.answers ?? []).join(' / ')}`);
	}

	if (notAsked.length > 0) {
		put('', `=== ТАК И НЕ СПРОШЕНО: ${notAsked.length} ===`);
		for (const rec of notAsked.sort((a, b) => b.posts.size - a.posts.size)) {
			put(`  ${String(rec.posts.size).padStart(4)}  «${rec.sample}»   ${rec.why}`);
		}
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

	if (write) {
		// ПЕРЕПИСЫВАЕМ, ТОЛЬКО ЕСЛИ ЧТО-ТО ПРАВДА ПОМЕНЯЛОСЬ. Робот просыпается
		// на КАЖДОЕ сохранение черновика, а время прогона меняется всегда —
		// сравнивай мы файлы целиком, каждое сохранение давало бы коммит
		// «список кандидатов», в котором нет ни одной новости.
		const bare = (item) => JSON.stringify({ ...item, generated: null });
		if (previous.raw && bare(previous.raw) === bare(data)) {
			log('Список кандидатов не изменился — файл не переписан.');
		} else {
			// БЕЗ ОТСТУПОВ, И ЭТО НАРОЧНО. Файл читают двое — экран в браузере
			// и этот же скрипт, — а человек его не правит никогда: отступы стоили
			// бы половины веса на странице, которую заказчик открывает каждый раз.
			await writeFile(CANDIDATES_PATH, JSON.stringify(data) + '\n', 'utf8');
			log(`Данные экрана записаны: src/data/animeCandidates.json`);
		}
	} else {
		log('Данные экрана НЕ записаны (нужен ключ --write).');
	}
	log('Ни один тайтл не заведён.');

	return { asked: askedNow, fresh: freshTotal, freshAll: freshKeys.size, data };
}

// Русские буквы в пути к проекту: import.meta.url кодирует их, а process.argv[1]
// нет, и строчное сравнение не совпало бы НИКОГДА (CLAUDE.md, «Уроки проекта»).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	await main();
}
