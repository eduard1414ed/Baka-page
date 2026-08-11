#!/usr/bin/env node
// Проверки сбора кандидатов в тайтлы (тз/11, часть C).
//
// ФАЙЛОМ, А НЕ ОДНОСТРОЧНИКОМ `node -e`: обратный слэш внутри однострочника
// проходит через две системы экранирования подряд, и выражение перестаёт
// совпадать с чем-либо вовсе — при этом проверка не падает, а бодро отвечает
// «ничего не найдено» (CLAUDE.md, «Уроки проекта»).
//
// ЧЕМ ПИСАНЫ ПОДЛОГИ. Настоящими строками архива и настоящим справочником,
// а не выдуманными примерами. Причина записана в CLAUDE.md и оплачена дважды:
// подлог, повторяющий формулировку правила, проверяет не правило, а аккуратность
// того, кто его писал. Поэтому фразы ниже взяты из живых постов («Человека-
// бензопилы», «Тетради смерти», «Чук и Гик»), а падежные формы для сверки
// похожести считает настоящий `inflectTitle` по настоящему справочнику.
//
// САМОЕ ГЛАВНОЕ ТУТ — НЕ «НАХОДИТ», А «МОЛЧИТ». Проверка, которая одобряет всё
// подряд, отвечает «кандидатов много» и выглядит работающей.
//
//   node scripts/anime-candidates.test.mjs

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectQuotedPhrases } from '../src/lib/animeMentions.mjs';
import { initMorph, readAnimeCollection, inflectTitle } from './anime-cases-lib.mjs';
import {
	appendCache,
	bestMatch,
	hasLetters,
	nominativeGuess,
	normalizePhrase,
	phraseKey,
	readCache,
	readStoplist,
	sameTitle,
} from './anime-candidates-lib.mjs';

let failed = 0;

function check(name, ok, detail = '') {
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ок      ' : 'ПРОВАЛ  '} ${name}${detail ? ` — ${detail}` : ''}`);
}

await initMorph();

// ─── 1. Сбор фраз в кавычках ────────────────────────────────────────────────

console.log('\n=== ФРАЗЫ В КАВЫЧКАХ: ЧТО ДОСТАЁТСЯ ИЗ ТЕКСТА ===');

const quoteCases = [
	['В «Дандадане» отличная анимация', ['Дандадане'], 'ёлочки'],
	['Пересмотрел "Монстра" целиком', ['Монстра'], 'прямые кавычки телефонного автонабора'],
	['А в „Ковбое Бибопе“ этого нет', ['Ковбое Бибопе'], 'лапки'],
	['Читаю «Монстр», думаю про «Тетрадь смерти»', ['Монстр', 'Тетрадь смерти'], 'две фразы подряд в одном тексте'],
	['«Магическая битва 2» и «Призрак в доспехах (1995)»', ['Магическая битва 2', 'Призрак в доспехах (1995)'], 'номер сезона и год ВНУТРИ кавычек'],
	['Открывающая кавычка без пары «Дандадан', [], 'непарная кавычка — фразы нет'],
	['Без кавычек вовсе, обычный текст про аниме', [], 'кавычек нет — и находиться нечему'],
	['「デデデデ」 в японских скобках', ['デデデデ'], 'японские скобки — архив писан в мессенджере'],
];

for (const [text, want, why] of quoteCases) {
	const got = collectQuotedPhrases(text).map((p) => p.text);
	const ok = got.length === want.length && want.every((w, i) => got[i] === w);
	check(`${why}: ${text.slice(0, 46)}`, ok, `нашлось [${got.join(' | ')}]`);
}

// ПОДЛОГ, КОТОРЫЙ ОБЯЗАН СРАБОТАТЬ: если сбор фраз сломается и начнёт отвечать
// пустотой, весь прогон честно напечатает «фраз 0» и будет выглядеть удачным.
// Поэтому спрашиваем его на НАСТОЯЩЕМ куске поста архива.
const realPost =
	'Вышел трейлер второго сезона «Человека-бензопилы». Напомним, что первый сезон делала студия MAPPA, ' +
	'а «Тетрадь смерти» когда-то рисовала Madhouse.';
const realFound = collectQuotedPhrases(realPost).map((p) => p.text);
check(
	'настоящий кусок поста отдаёт обе фразы',
	realFound.length === 2 && realFound[0] === 'Человека-бензопилы' && realFound[1] === 'Тетрадь смерти',
	`[${realFound.join(' | ')}]`,
);

// ─── 2. Обрезка краёв и ключ фразы ──────────────────────────────────────────

console.log('\n=== КРАЯ ФРАЗЫ И КЛЮЧ ===');

check('край обрезается: «Дандадан,» → «Дандадан»', normalizePhrase('Дандадан,') === 'Дандадан', normalizePhrase('Дандадан,'));
check('скобка с годом ВНУТРИ фразы остаётся', normalizePhrase('Призрак в доспехах (1995)') === 'Призрак в доспехах (1995)', normalizePhrase('Призрак в доспехах (1995)'));
check('восклицательный знак — часть названия, а не край', normalizePhrase('Кэйон!') === 'Кэйон!', normalizePhrase('Кэйон!'));
check('тире и запятая с краю снимаются', normalizePhrase(' — Наруто, ') === 'Наруто', normalizePhrase(' — Наруто, '));
check('регистр и ё не разводят одну фразу на две', phraseKey('ЁДЗИ') === phraseKey('едзи'));
check('фраза без букв опознаётся', hasLetters('1995') === false && hasLetters('Санда') === true);

// ─── 3. Похожесть названия — замер по живому справочнику ────────────────────
//
// ЗДЕСЬ ЖИВЁТ ЧИСЛО «ТРИ БУКВЫ ХВОСТА». Проверяется оно не рассуждением,
// а прогоном по всему справочнику: все настоящие падежные формы обязаны
// сойтись со своим названием, и ни одна — с чужим.

console.log('\n=== ПОХОЖЕСТЬ: ЗАМЕР ПО ВСЕМУ СПРАВОЧНИКУ ===');

const entries = await readAnimeCollection();
const titles = entries.map((e) => e.data.titleRu).filter(Boolean);

// СВЕРЯЕМ С ТЕМ ЖЕ, ЧТО СКЛОНЯЛОСЬ. Морфология склоняет разговорную часть
// названия — до двоеточия («Апокалипсис» из «Апокалипсис: Отель»), поэтому
// сравнивать её формы с ПОЛНЫМ названием бессмысленно: замер ругался бы
// на здоровый код. Первая редакция этого замера так и делала.
const spoken = (title) => {
	const colon = title.indexOf(':');
	return colon >= 6 ? title.slice(0, colon).trim() : title;
};

let ownOk = 0;
let ownFail = [];
let strangers = [];

for (const entry of entries) {
	const titleRu = entry.data.titleRu;
	if (!titleRu) continue;
	const forms = inflectTitle(titleRu);

	for (const form of forms) {
		if (sameTitle(form, titleRu) || sameTitle(form, spoken(titleRu))) ownOk++;
		else ownFail.push(`${titleRu} ← ${form}`);

		// А вот с ЧУЖИМ названием форма сходиться не имеет права.
		for (const other of titles) {
			if (other === titleRu) continue;
			if (sameTitle(form, other)) strangers.push(`${form} (из «${titleRu}») сошлось с «${other}»`);
		}
	}
}

check(`все падежные формы справочника сходятся со своим названием (${ownOk} форм)`, ownFail.length === 0, ownFail.slice(0, 5).join('; '));
check('ни одна форма не сошлась с ЧУЖИМ названием', strangers.length === 0, strangers.slice(0, 5).join('; '));

// ─── 4. Похожесть: что обязано быть отвергнуто ──────────────────────────────

console.log('\n=== ПОХОЖЕСТЬ: ЧТО ОБЯЗАНО БЫТЬ ОТВЕРГНУТО ===');

const similarity = [
	['Тетради смерти', 'Тетрадь смерти', true, 'падеж — расхождение только в хвосте слова'],
	['Стального алхимика', 'Стальной алхимик', true, 'падеж в обоих словах'],
	['Человека-бензопилы', 'Человек-бензопила', true, 'дефис считается пробелом'],
	['Принцессе Мононоке', 'Принцесса Мононоке', true, 'падеж в первом слове'],
	['Shirobako', 'Shirobako', true, 'латиница буква в букву'],
	['Ходячего замка', 'Ходячий замок', true, 'беглая гласная: «замка»/«замок» — правилом хвоста не берётся, берётся словарём'],
	['Бака', 'Баки', true, 'ЦЕНА СЛОВАРЯ: он считает это формами одного слова, и «Баки» станет кандидатом. Отклоняется стоп-листом'],
	['Мотоко', 'Мотив', false, 'три общие буквы — не совпадение (те же грабли, что у поиска по сайту)'],
	['Дандадан', 'Дандадан 2', false, 'разное число слов — это другой тайтл, а не описка'],
	['Комильфо', 'Комильфо: Красавчик', false, 'сравнение идёт и с куском до двоеточия, но тут его нет'],
	['Строки', 'Строка', true, 'цена правила: короткое обычное слово может сойтись — на то и стоп-лист'],
	['Чук и Гик', 'Чук и Гек', false, 'слово короче четырёх букв обязано совпадать буква в букву'],
	['Кэйон!', 'Кэйон', true, 'восклицательный знак — не буква и не слово'],
	['Баку', 'Бакуман', false, 'РАЗНИЦА В ДЛИНЕ: четыре буквы совпали, но слово втрое длиннее — это не падеж'],
	['Гандам', 'Гандам: Объединение I', false, 'то же самое, и кусок до двоеточия тут не спасает'],
];

for (const [phrase, name, want, why] of similarity) {
	const got = sameTitle(phrase, name);
	check(`${want ? 'похоже' : 'НЕ похоже'} «${phrase}» / «${name}» — ${why}`, got === want);
}

// Выдача Shikimori: правильный ответ приходит не первым — замер 11 августа 2026.
const shikimoriAnswer = [
	{ sourceId: 1, titleRu: 'Смертельный бильярд', titleOriginal: 'Death Billiards', year: 2013 },
	{ sourceId: 2, titleRu: 'Тетрадь смерти', titleOriginal: 'Death Note', year: 2006 },
	{ sourceId: 3, titleRu: 'Горничная смерти', titleOriginal: 'Maid of the Dead', year: 2013 },
];
const picked = bestMatch('Тетради смерти', shikimoriAnswer);
check('из выдачи берётся ПОХОЖИЙ ответ, а не первый', picked?.sourceId === 2, picked ? picked.titleRu : 'не выбрано ничего');
check('на непохожую фразу выдача отвергается целиком', bestMatch('Комильфо', shikimoriAnswer) === null);
check('пустая выдача — не кандидат', bestMatch('Кусогаки', []) === null);

// Кусок до двоеточия: в архиве говорят «Стальной алхимик», а на Shikimori
// он «Стальной алхимик: Братство».
const withColon = [{ sourceId: 9, titleRu: 'Стальной алхимик: Братство', titleOriginal: 'Fullmetal Alchemist: Brotherhood', year: 2009 }];
check('название сравнивается и куском до двоеточия', bestMatch('Стального алхимика', withColon)?.sourceId === 9);

// ВСЯ СЕРИЯ В ОДНОЙ ВЫДАЧЕ — это НАСТОЯЩИЙ ответ Shikimori на «Синюю тюрьму»,
// скопированный из кэша прогона 11 августа 2026. Настоящий тайтл (2022) стоит
// в нём ЧЕТВЁРТЫМ, а первым — часть, у которой года ещё нет вовсе.
const blueLock = [
	{ sourceId: 61743, titleRu: 'Синяя тюрьма: Блю Лок — Лига неоэгоистов', titleOriginal: 'Blue Lock: Neo Egoist League', year: undefined },
	{ sourceId: 57433, titleRu: 'Синяя тюрьма: Блю Лок против юношеской сборной Японии', titleOriginal: 'Blue Lock vs. U-20 Japan', year: 2024 },
	{ sourceId: 55071, titleRu: 'Синяя тюрьма: Блю Лок — Эпизод с Наги', titleOriginal: 'Blue Lock: Episode Nagi', year: 2024 },
	{ sourceId: 49596, titleRu: 'Синяя тюрьма: Блю Лок', titleOriginal: 'Blue Lock', year: 2022 },
];
check('из серии берётся ОРИГИНАЛ, а не первый в выдаче', bestMatch('Синяя тюрьма', blueLock)?.year === 2022, String(bestMatch('Синяя тюрьма', blueLock)?.titleRu));

// И тут же — почему подзаголовок отделяется не только двоеточием: настоящее
// название оригинала «Гуррен-Лаганн, пронзающий небеса», через запятую.
const gurren = [
	{ sourceId: 2001, titleRu: 'Гуррен-Лаганн, пронзающий небеса', titleOriginal: 'Tengen Toppa Gurren Lagann', year: 2007 },
	{ sourceId: 4155, titleRu: 'Гуррен-Лаганн: Параллельные миры 2', titleOriginal: 'Tengen Toppa Gurren Lagann: Parallel Works 2', year: 2010 },
];
check('подзаголовок через ЗАПЯТУЮ тоже отрезается', bestMatch('Гуррен-Лаганн', gurren)?.sourceId === 2001, String(bestMatch('Гуррен-Лаганн', gurren)?.titleRu));

// ─── 5. Вторая попытка именительным падежом ─────────────────────────────────

console.log('\n=== ВТОРАЯ ПОПЫТКА: ИМЕНИТЕЛЬНЫЙ ПАДЕЖ ===');

const guesses = [
	['Стального алхимика', 'стальной алхимик', 'настоящая фраза из 15 постов архива'],
	['Человека-бензопилы', 'человек-бензопила', 'дефис не теряется'],
	['Тетради смерти', 'тетрадь смерть', 'грамматически кривая, но как ЗАПРОС годится'],
];
for (const [phrase, want, why] of guesses) {
	const got = nominativeGuess(phrase);
	check(`«${phrase}» → «${want}» (${why})`, got.toLowerCase() === want, `получилось «${got}»`);
}
check(
	'незнакомое слово словарь глаголом не переделывает («Дандадана» → не «дандадать»)',
	!nominativeGuess('Дандадана').toLowerCase().includes('дандадать'),
	nominativeGuess('Дандадана'),
);
check('фраза в именительном второй попытки не требует', nominativeGuess('Дандадан') === 'Дандадан');

// ─── 6. Стоп-лист: пустой, отсутствующий, битый ─────────────────────────────

console.log('\n=== СТОП-ЛИСТ: ПУСТОТА, ОТСУТСТВИЕ, ПОРЧА ===');

const dir = await mkdtemp(join(tmpdir(), 'baka-stoplist-'));
const at = (name) => pathToFileURL(join(dir, name));

check('файла нет вовсе — пустой список, без падения', (await readStoplist(at('нет.json'))).keys.size === 0);

await writeFile(at('пустой.json'), '', 'utf8');
check('файл пустой — пустой список, без падения', (await readStoplist(at('пустой.json'))).keys.size === 0);

await writeFile(at('пустой-список.json'), '[]\n', 'utf8');
check('пустой список — тоже норма', (await readStoplist(at('пустой-список.json'))).keys.size === 0);

await writeFile(at('живой.json'), JSON.stringify(['Кинопоиск', 'Бака!', '  '], null, '\t'), 'utf8');
const live = await readStoplist(at('живой.json'));
check('отклонённая фраза узнаётся без регистра', live.keys.has(phraseKey('кинопоиск')), [...live.keys].join(', '));
check('пустые строчки в списке не считаются', live.phrases.length === 2, String(live.phrases.length));

await writeFile(at('битый.json'), '{ это не список', 'utf8');
let threw = false;
try {
	await readStoplist(at('битый.json'));
} catch {
	threw = true;
}
check('НЕЧИТАЕМЫЙ файл роняет прогон громко, а не считается пустым', threw);

await writeFile(at('чужой.json'), '{"фразы": []}', 'utf8');
let threwShape = false;
try {
	await readStoplist(at('чужой.json'));
} catch {
	threwShape = true;
}
check('файл не того вида — тоже громко', threwShape);

// ─── 7. Кэш ответов ─────────────────────────────────────────────────────────

console.log('\n=== КЭШ: ЗАПИСАЛОСЬ — ЗНАЧИТ НЕ СПРОСИТСЯ ЗАНОВО ===');

const cachePath = at('кэш.jsonl');
check('кэша нет — пустая карта, без падения', (await readCache(cachePath)).size === 0);
await appendCache('Дандадана', [], cachePath);
await appendCache('Тетради смерти', [{ sourceId: 2, titleRu: 'Тетрадь смерти' }], cachePath);
const cache = await readCache(cachePath);
check('оба ответа прочитались обратно', cache.size === 2, `записей ${cache.size}`);
check('ПУСТОЙ ответ тоже помнится — иначе его спрашивали бы каждый раз', cache.has('Дандадана') && cache.get('Дандадана').length === 0);
check('непустой ответ помнится целиком', cache.get('Тетради смерти')?.[0]?.titleRu === 'Тетрадь смерти');

await appendCache('битая', [], cachePath);
await writeFile(cachePath, (await readCache(cachePath)) && '{ не json\n' + JSON.stringify({ q: 'целая', results: [] }) + '\n', 'utf8');
const afterJunk = await readCache(cachePath);
check('битая строчка кэша пропускается, целые читаются', afterJunk.size === 1 && afterJunk.has('целая'), `записей ${afterJunk.size}`);

await rm(dir, { recursive: true, force: true });

console.log(
	failed === 0
		? '\nВсе проверки прошли: и находит, и молчит там, где должна молчать.'
		: `\nПРОВАЛОВ: ${failed} — верить этим проверкам нельзя.`,
);
process.exit(failed === 0 ? 0 : 1);
