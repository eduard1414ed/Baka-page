// ПАДЕЖНЫЕ ФОРМЫ НАЗВАНИЯ ТАЙТЛА — ОДНО МЕСТО НА ВЕСЬ ПРОЕКТ (тз/11, часть A).
//
// Что это. Поле `aliasesAuto` в src/content/anime/<slug>.json: «Ходячий замок» →
// «ходячего замка», «ходячему замку», «ходячим замком», «ходячем замке».
// Дальше эти формы ищутся в текстах наравне с названием — так же, как ручные
// «Варианты написания» (`aliases`).
//
// ДВА ПОЛЯ, А НЕ ОДНО, И ЭТО ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА.
//   `aliases`     — вписал человек. НЕ ПЕРЕЗАПИСЫВАЕТСЯ НИКОГДА, ни при каких
//                   обстоятельствах, даже если форма там кажется неправильной.
//   `aliasesAuto` — посчитала морфология. Пересчитывается свободно.
// Пиши мы в одно поле — первый же пересчёт стёр бы ручную правку, и доверять
// пересчёту стало бы нельзя. Это то же правило, что `manual` у полей из API
// (scripts/anime-lib.mjs).
//
// ПОЧЕМУ JAVASCRIPT, А НЕ PYTHON С `pymorphy3`, КАК ПРЕДЛАГАЛО ТЗ. Робот
// sync-anime — Node, и Python пришлось бы приводить отдельным шагом воркфлоу
// (так сделано у распознавания, sync-episodes.yml). Замер 10 августа 2026:
// `az` — это перенос словаря OpenCorpora, того же самого, на котором работает
// pymorphy3. Разборы и веса совпадают («в»: PREP 1.00 / NOUN 0.00 у обоих;
// «силы»: gent-sing 0.56 против 0.58, nomn-plur 0.26 против 0.25). Установка
// 0,9 с и 12 МБ против 11 с и 35 МБ. Второй язык внутри одного робота дороже
// любой из этих цифр.
//
// СКЛОНЯЕМ ТОЛЬКО `titleRu`. Латиница и японский не склоняются никогда.

import { createRequire } from 'node:module';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import Az from 'az';
import { MIN_PREFIX_LENGTH, fold } from '../src/lib/animeMentions.mjs';

const require = createRequire(import.meta.url);

export const ANIME_CONTENT_DIR = new URL('../src/content/anime/', import.meta.url);

// Пять косвенных падежей. Именительного тут нет намеренно: он и есть `titleRu`,
// и по нему упоминания ищутся сами.
const CASES = ['gent', 'datv', 'accs', 'ablt', 'loct'];

// Формы короче этого дают ложные срабатывания и в поле не идут (тз/11, A.2).
const MIN_FORM_LENGTH = 4;

// Части речи, которые головой фразы быть не могут. Предлог и союз в словаре
// OpenCorpora ЗАОДНО разбираются существительными («в» — как название буквы),
// с весом 0.00 — но разбор существует, и наивный поиск «первого слова
// в именительном» брал головой предлог «в» в «Провожающей в последний путь
// Фрирен». Проверено замером, а не предположено.
const NOT_A_HEAD = new Set(['PREP', 'CONJ', 'PRCL', 'INTJ', 'NPRO', 'ADVB', 'VERB', 'INFN', 'GRND', 'PRED', 'NUMR']);

let ready = null;
let morphReady = false;

/** Словари грузятся один раз на процесс: 51 мс, но не на каждое название. */
export function initMorph() {
	if (!ready) {
		// Путь к папке словарей достаём через resolve самого пакета, а не строкой:
		// строка сломалась бы от любого переезда node_modules.
		const dicts = require.resolve('az/dicts/meta.json').replace(/[/\\]meta\.json$/, '');
		ready = new Promise((ok, no) =>
			Az.Morph.init(dicts, (error) => {
				if (error) return no(error);
				morphReady = true;
				ok();
			}),
		);
	}
	return ready;
}

/**
 * Спросить словарь, не дождавшись загрузки, — значит получить пустой разбор
 * и молча пропустить правило. Ломаться тут надо ГРОМКО: проверка, ответившая
 * «всё хорошо» потому, что её не с чем было выполнять, за проект соврала уже
 * шесть раз.
 */
function requireMorph(who) {
	if (!morphReady) throw new Error(`${who}: словари морфологии не загружены — нужен await initMorph() до вызова.`);
}

/**
 * Разговорная часть названия — до двоеточия.
 *
 * Склонять «Королевские космические силы: Крылья Хоннеамиз» целиком незачем:
 * подзаголовок вслух не произносит никто, а форма вышла бы нечитаемой строкой
 * на полстроки. Порог тот же самый и взят ИЗ animeMentions.mjs, а не переписан
 * числом: поиск упоминаний уже ищет кусок до двоеточия по этому же правилу,
 * и разъехаться им нельзя.
 */
function spokenPart(title) {
	const colon = title.indexOf(':');
	return colon >= MIN_PREFIX_LENGTH ? title.slice(0, colon).trim() : title;
}

/** Лучший разбор слова — тот, у которого наибольший вес. */
function bestParse(parses) {
	return parses.reduce((best, p) => (best && best.score >= p.score ? best : p), null);
}

/** Разбор этого же слова в именительном падеже, если он есть. */
function nominative(parses) {
	return parses.find((p) => p.tag.CAse === 'nomn') ?? null;
}

/**
 * Голова фразы и согласованные с ней определения перед ней.
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ. «Просклонять каждое слово» — самый очевидный и самый
 * неверный способ: «Атака титанов» превращается в «атаки титана», «Тетрадь
 * смерти» — в «тетрадь смерть». Зависимое слово в родительном падеже склонять
 * нельзя, оно уже стоит в нужной форме. Меняется только голова и то, что с ней
 * согласовано.
 *
 * КАК ИЩЕМ. Слева направо, пропуская служебные слова. Набираем подряд идущие
 * прилагательные и причастия в именительном, а голова — следующее за ними
 * существительное в именительном, СОГЛАСОВАННОЕ с ними родом и числом. Нет
 * такого существительного — головой становится последнее прилагательное само
 * («Унесённые призраками», «Провожающая в последний путь Фрирен»: там
 * существительного в именительном нет вовсе).
 *
 * @returns {{ head: number, headParse: object, mods: number[] } | null} номера слов
 */
function findHead(words, parsed) {
	let mods = [];
	let modParse = null;

	// Цепочка определений оборвалась, а существительного за ней не оказалось.
	// Тогда голова — само последнее определение: «Унесённые призраками»,
	// «Провожающая в последний путь Фрирен» — существительного в именительном
	// в этих названиях нет вовсе.
	const finish = () => (mods.length > 0 ? { head: mods.at(-1), headParse: modParse, mods: mods.slice(0, -1) } : null);

	for (let i = 0; i < words.length; i++) {
		const parses = parsed[i];
		const best = parses.length ? bestParse(parses) : null;
		const nom = parses.length ? nominative(parses) : null;
		const post = nom ? String(nom.tag.POST) : '';

		// Именительный падеж — единственное, что продолжает или начинает фразу.
		// Служебное слово («в», «и») в словаре ЗАОДНО разбирается существительным
		// с весом 0.00, поэтому спрашиваем ещё и про лучший разбор.
		const usable = nom && best && !NOT_A_HEAD.has(String(best.tag.POST));

		if (usable && post === 'NOUN') {
			// Существительное в именительном — голова. Определения перед ним
			// берём только согласованные: несогласованное относится не к нему.
			//
			// РОД СВЕРЯЕМ, ТОЛЬКО ЕСЛИ ОН ЕСТЬ У ОБОИХ. У прилагательного
			// во множественном числе рода не бывает вовсе, а у существительного
			// он остаётся — и сравнение «пусто против женского» объявляло
			// «Королевские космические» несогласованными с «силами». Определения
			// отбрасывались молча, и выходило «Королевские космические сил».
			const sameGender = !modParse?.tag.GNdr || !nom.tag.GNdr || modParse.tag.GNdr === nom.tag.GNdr;
			const agreed = modParse && sameGender && modParse.tag.NMbr === nom.tag.NMbr;
			return { head: i, headParse: nom, mods: agreed ? mods : [] };
		}

		if (usable && (post === 'ADJF' || post === 'PRTF')) {
			// Определение. Копим цепочку и идём дальше — вдруг за ней есть
			// существительное.
			if (modParse && (modParse.tag.GNdr !== nom.tag.GNdr || modParse.tag.NMbr !== nom.tag.NMbr)) mods = [];
			mods.push(i);
			modParse = nom;
			continue;
		}

		// Слово, которое во фразу не встаёт. Если до него уже набралась цепочка
		// определений — фраза на нём кончилась, и это её конец, а не повод
		// начать заново. Копилку тут ОБНУЛЯТЬ НЕЛЬЗЯ: «Унесённые призраками»
		// теряли из-за этого голову и не склонялись вовсе.
		const done = finish();
		if (done) return done;
		mods = [];
		modParse = null;
	}

	return finish();
}

/**
 * НАЗВАТЬ ПРИЗНАКИ НАДО РОВНО ТЕ, ЧТО У СЛОВА ЕСТЬ, — ЛИШНИЙ УБИВАЕТ ВЫЗОВ.
 *
 * Словарь отвечает отказом, если попросить признак, которого у нужной формы
 * не бывает. Замерено на самой библиотеке, а не выведено из рассуждения:
 *   «Магическая» + accs,femn,sing        → «магическую»
 *   «Магическая» + accs,femn,sing,inan   → ОТКАЗ (у женского рода отдельной
 *                                          неодушевлённой формы нет)
 *   «Королевские» + gent,plur            → «королевских»
 *   «Королевские» + gent,femn,plur       → ОТКАЗ (у множественного числа
 *                                          рода не бывает вовсе)
 * Поэтому спрашиваем не одним набором, а несколькими по очереди — от самого
 * подробного к самому голому, и берём первый, на который ответили. Отказ
 * молчалив: он не ошибка, он просто пустой ответ, и форма пропала бы незаметно.
 */
function modGrammemes(grammeme, gender, number, animacy) {
	const sets = [];
	// В винительном спор решает одушевлённость («вижу ходячий замок», но
	// «вижу бездомного бога») — у мужского рода и у множественного числа.
	// У женского рода одушевлённость ничего не меняет, там решает род.
	if (grammeme === 'accs' && animacy && (number === 'plur' || gender === 'masc')) {
		sets.push([grammeme, number, animacy].filter(Boolean));
	}
	sets.push([grammeme, gender, number].filter(Boolean));
	sets.push([grammeme, number].filter(Boolean));
	sets.push([grammeme]);
	return sets;
}

/** Первый набор признаков, на который словарь ответил формой. */
function tryInflect(parse, sets) {
	if (!parse) return null;
	for (const set of sets) {
		const result = parse.inflect(set);
		if (result && result.word) return result;
	}
	return null;
}

/** Слово было с большой буквы — вернём его таким же: в админку это идёт глазам. */
function keepCase(original, changed) {
	if (!original || !changed) return changed;
	const first = original[0];
	if (first !== first.toLocaleUpperCase('ru')) return changed;
	return changed[0].toLocaleUpperCase('ru') + changed.slice(1);
}

/**
 * Русское название → его падежные формы (без именительного, без повторов).
 *
 * @param {string} titleRu
 * @returns {string[]} может быть пустым — и это нормально: «Акира», «Наруто»
 *   и прочие несклоняемые морфология не трогает, дописать их формы можно руками.
 */
export function inflectTitle(titleRu) {
	const spoken = spokenPart(String(titleRu ?? '').trim());
	// Ни одной кириллической буквы — склонять нечего.
	if (!/\p{Script=Cyrillic}/u.test(spoken)) return [];

	// Режем на слова и на всё, что между ними, чтобы дефисы, кавычки и знаки
	// вернулись на свои места без перебора.
	const chunks = spoken.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu) ?? [];
	const wordAt = [];
	for (let i = 0; i < chunks.length; i++) if (/[\p{L}\p{N}]/u.test(chunks[i])) wordAt.push(i);
	if (wordAt.length === 0) return [];

	const words = wordAt.map((i) => chunks[i]);
	const parsed = words.map((w) => Az.Morph(w) ?? []);

	const found = findHead(words, parsed);
	if (!found) return [];

	const { head, headParse, mods } = found;

	// СТРАДАТЕЛЬНОЕ ПРИЧАСТИЕ СКЛОНЯТЬ НЕЛЬЗЯ: словарь возводит его к глаголу
	// и склоняет уже действительное. «Унесённые» → «Унёсших», а не
	// «Унесённых» — другое слово, которого в текстах нет и быть не может.
	// Молчание тут честнее правдоподобной подмены; такое название дописывается
	// в «Варианты написания» руками.
	if (/\bpssv\b/.test(String(headParse.tag))) return [];

	// НАЗВАНИЕ-ПРЕДЛОЖЕНИЕ НЕ СКЛОНЯЕТСЯ ЦЕЛИКОМ. «Мир танцует», «Медуза
	// не умеет плавать в ночи», «Рабочее место, где вы не можете не улыбаться» —
	// это не именная группа, и «мира танцует» не скажет никто. Признак прямой:
	// после головы стоит глагол.
	for (let i = head + 1; i < words.length; i++) {
		const best = parsed[i].length ? bestParse(parsed[i]) : null;
		if (best && (String(best.tag.POST) === 'VERB' || String(best.tag.POST) === 'INFN')) return [];
	}

	// ЧТО НАЗЫВАТЬ ПРИ СКЛОНЕНИИ — У ГОЛОВЫ И У ОПРЕДЕЛЕНИЙ РАЗНОЕ, И ЛИШНЕЕ
	// ЛОМАЕТ ВЫЗОВ НАСМЕРТЬ. У существительного род и одушевлённость не
	// склоняются, они у него врождённые: попроси их — и словарь ответит
	// отказом, а форма пропадёт молча. Первая редакция просила у всех всё,
	// и «Ходячий замок» с «Магической битвой» перестали склоняться вовсе.
	// А назвать ЧИСЛО обязательно, и тоже у всех: без него словарь отвечает
	// единственным, и «Королевские космические силы» становились «силе».
	const gender = headParse.tag.GNdr;
	const number = headParse.tag.NMbr;
	const animacy = headParse.tag.ANim;
	const headIsNoun = String(headParse.tag.POST) === 'NOUN';

	const forms = new Set();

	for (const grammeme of CASES) {
		const forMods = modGrammemes(grammeme, gender, number, animacy);
		const forHead = headIsNoun ? [[grammeme, number].filter(Boolean), [grammeme]] : forMods;

		const inflectedHead = tryInflect(headParse, forHead);
		if (!inflectedHead) continue;

		const out = chunks.slice();
		out[wordAt[head]] = keepCase(words[head], inflectedHead.word);

		let ok = true;
		for (const m of mods) {
			const inflectedMod = tryInflect(nominative(parsed[m]), forMods);
			if (!inflectedMod) {
				ok = false;
				break;
			}
			out[wordAt[m]] = keepCase(words[m], inflectedMod.word);
		}
		if (!ok) continue;

		forms.add(out.join(''));
	}

	return [...forms];
}

/**
 * Что записать тайтлу в `aliasesAuto`.
 *
 * Отсев (тз/11, A.2): формы короче четырёх букв, совпадающие с уже известными
 * названиями и вариантами, дубликаты между падежами. Сравнение — через тот же
 * `fold`, которым сравнивает поиск упоминаний: иначе «Унесённые» и «Унесенные»
 * посчитались бы разными и обе легли бы в поле.
 *
 * @param {{ titleRu?: string, titleOriginal?: string, aliases?: string[] }} data
 */
export function computeAliasesAuto(data) {
	if (!data?.titleRu) return [];

	// Что уже ищется. Кусок до двоеточия входит сюда обязательно — по нему
	// поиск упоминаний ходит и так.
	const known = new Set(
		[data.titleRu, data.titleOriginal, ...(data.aliases ?? [])]
			.filter(Boolean)
			.flatMap((name) => [name, spokenPart(name)])
			.map(fold),
	);

	const out = [];
	const seen = new Set();

	for (const form of inflectTitle(data.titleRu)) {
		if (form.length < MIN_FORM_LENGTH) continue;
		const key = fold(form);
		if (known.has(key) || seen.has(key)) continue;
		seen.add(key);
		out.push(form);
	}

	return out;
}

// ОДНОСЛОВНАЯ форма, дающая столько новых упоминаний и больше, — почти
// наверняка обычное слово, а не название.
//
// ПОЧЕМУ СЧЁТ ВАЖЕН ТОЛЬКО У ОДНОСЛОВНЫХ. Первая редакция этой проверки
// ругалась на любую частую форму — и первым же прогоном пометила «Атаки
// титанов» (68 упоминаний), «Магической битвы» (54) и «Меланхолии Харухи
// Судзумии» (20), то есть ровно самые удачные формы во всём пересчёте.
// Проверка, ругающаяся на успех, перестаёт что-либо значить с первого дня.
// Причина та же, что измерена в src/lib/aliasHints.mjs: у фразы из двух слов
// должны совпасть подряд две основы, и это сильное ограничение, а у одного
// слова ограничения нет никакого.
export const NOISY_FORM = 10;

// Форма короче этого попадает в подозрительные — не выбрасывается, а именно
// показывается: «Кэйона» короткое, но настоящее.
export const SHORT_FORM = 6;

// СТРУКТУРНЫЕ ЗНАКИ: с ними морфология не справляется по определению.
// Двоеточие, тире, скобки, восклицательный знак, запятая — это границы частей
// названия, а склонение видит их обычными символами и честно склоняет первое
// слово, оставляя остальное как было: «Блича: Тысячелетняя кровавая война —
// Бедствие», «Кэйона!», «Призрака в доспехах (2026)», «Прощай, Лары».
//
// ДЕФИСА И ТОЧКИ В СПИСКЕ НЕТ НАМЕРЕННО: «Девушек-пони», «Гуррен-Лаганн»
// и «Ван-Пис» — обычные названия, и ругаться на них значило бы ругаться
// на успех. Дефис от тире отличается тем, что стоит ВНУТРИ слова.
const STRUCTURAL = /[:;!?,()[\]{}—–«»"'…|/]/u;

// Слово, с которого начинается название, определяет, можно ли склонять
// название целиком. Существительное, прилагательное, причастие, числительное —
// можно: это именная группа. Предлог, союз, местоимение, глагол, инфинитив —
// нельзя: «О движении Земли» уже стоит в падеже, «Быть героем Икс» начинается
// с действия, «Хоть я и бездарная злодейка» — с придаточного. Морфология
// в таких названиях находит голову где-то в середине и склоняет её, а получается
// бессмыслица: «О движении Земель», «Быть героем Икса».
const HEAD_OK = new Set(['NOUN', 'ADJF', 'ADJS', 'PRTF', 'PRTS', 'NUMR']);

/** Слова названия (без знаков между ними) — так же, как их режет inflectTitle. */
function wordsOf(title) {
	return String(title ?? '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * ПОТЕРЯ ИЛИ ПОРЧА БУКВ ВНУТРИ СЛОВА.
 *
 * Склонение имеет право поменять у слова окончание — то есть последние две
 * буквы, ровно как это уже измерено у подсказок вариантов (src/lib/aliasHints.mjs,
 * функция stem). Всё, что расходится РАНЬШЕ, — порча: «Гуррен» превратился
 * в «Гурена», буква пропала посреди слова, и на глаз это почти незаметно.
 *
 * Слова формы и слова названия стоят один к одному: inflectTitle не добавляет
 * и не убирает слов, он только подменяет некоторые. Разошлось число слов —
 * значит сравнивать нечего (форма посчитана от куска до двоеточия), и молчим.
 */
function brokenWords(spoken, form) {
	const before = wordsOf(spoken).map(fold);
	const after = wordsOf(form).map(fold);
	if (before.length === 0 || before.length !== after.length) return [];

	const broken = [];
	for (let i = 0; i < before.length; i++) {
		const need = Math.max(0, before[i].length - 2);
		let same = 0;
		while (same < need && before[i][same] === after[i][same]) same++;
		if (same < need) broken.push(`${before[i]} → ${after[i]}`);
	}
	return broken;
}

/**
 * ФОРМЫ, НА КОТОРЫЕ СТОИТ ПОСМОТРЕТЬ ГЛАЗАМИ (тз/11, отчёт пересчёта).
 *
 * Это список для человека, а не приговор: по нему не выбрасывается ничего
 * и никогда. Отдельной функцией, а не строчками внутри отчёта, ровно затем,
 * чтобы её можно было уронить подлогом: на живом справочнике она молчит,
 * и без подлога «подозрительных 0» неотличимо от сломанной проверки.
 *
 * ПЕРВАЯ РЕДАКЦИЯ ОТВЕЧАЛА «ПОДОЗРИТЕЛЬНЫХ 0» ПРИ ДЕВЯТИ ИСПОРЧЕННЫХ ФОРМАХ
 * в живом справочнике — заказчик нашёл их глазами 11 августа 2026. Причина:
 * все четыре её правила смотрели на форму как на СЛОВО (длина, столкновение
 * с чужим названием, частота) и ни одно — как на СТРОКУ, собранную из частей.
 * А ломается склонение именно на строении названия: структурные знаки
 * (двоеточие, тире, скобки, восклицательный, запятая), начало не с именной
 * группы (предлог, инфинитив, местоимение) и порча букв внутри слова.
 * Три правила ниже добавлены ровно за это, и подлоги к ним — настоящие
 * названия из справочника, а не пересказ условия (scripts/anime-cases.test.mjs).
 *
 * @param {{ id: string, titleRu?: string, titleOriginal?: string, aliases?: string[], forms: string[] }[]} list
 * @param {Map<string, number>} hitsByForm свёрнутая форма → сколько новых упоминаний даёт
 */
export function suspiciousForms(list, hitsByForm = new Map()) {
	requireMorph('suspiciousForms');

	// Кто ещё носит такую же форму и чьи названия с ней столкнутся.
	const owners = new Map();
	const names = new Map();
	for (const item of list) {
		for (const form of item.forms) {
			const key = fold(form);
			owners.set(key, [...(owners.get(key) ?? []), item.id]);
		}
		for (const name of [item.titleRu, item.titleOriginal, ...(item.aliases ?? [])].filter(Boolean)) {
			names.set(fold(name), item.id);
		}
	}

	const out = [];
	for (const item of list) {
		if (item.forms.length === 0) continue;

		const spoken = spokenPart(String(item.titleRu ?? ''));

		// Название не именная группа — спрашиваем один раз на тайтл, а не на форму.
		const firstWord = wordsOf(spoken)[0];
		const firstParse = firstWord ? bestParse(Az.Morph(firstWord) ?? []) : null;
		const notNounPhrase =
			firstWord && firstParse && !HEAD_OK.has(String(firstParse.tag.POST))
				? `название начинается не с именной группы («${firstWord}» — ${firstParse.tag.POST}), склонять его целиком нельзя`
				: null;

		for (const form of item.forms) {
			const key = fold(form);
			const hits = hitsByForm.get(key) ?? 0;
			const why = [];

			const sign = form.match(STRUCTURAL);
			if (sign) why.push(`структурный знак «${sign[0]}» — морфология с ним не справляется`);

			if (notNounPhrase) why.push(notNounPhrase);

			const broken = brokenWords(spoken, form);
			if (broken.length > 0) why.push(`внутри слова потерялись буквы (${broken.join(', ')})`);

			if (form.replace(/[^\p{L}\p{N}]/gu, '').length < SHORT_FORM) why.push('короткая');

			const sharing = (owners.get(key) ?? []).filter((id) => id !== item.id);
			if (sharing.length > 0) why.push(`совпала с формой другого тайтла (${sharing.join(', ')})`);

			const owner = names.get(key);
			if (owner && owner !== item.id) why.push(`совпала с названием тайтла «${owner}»`);

			if (form.trim().split(/\s+/).length === 1 && hits >= NOISY_FORM) {
				why.push(`одно слово и ${hits} новых упоминаний — похоже на обычное слово`);
			}

			if (why.length > 0) out.push({ form, id: item.id, title: item.titleRu, why, hits });
		}
	}

	// Сначала то, у чего причин больше — там почти наверняка настоящая порча;
	// внутри равных сверху то, что чаще встречается в архиве.
	return out.sort((a, b) => b.why.length - a.why.length || b.hits - a.hits);
}

// ─── Кому предложить галочку «только в кавычках» (тз/11, B.2) ───────────────

// Одно слово короче этого — прямое правило из ТЗ. «Наруто» и «Монстр» формально
// одинаковы, а по существу нет, поэтому САМИ НИЧЕГО НЕ ВКЛЮЧАЕМ, только
// предлагаем: решение за человеком.
export const SHORT_TITLE = 7;

/**
 * СТОИТ ЛИ ЭТОМУ НАЗВАНИЮ ГАЛОЧКА «ТОЛЬКО В КАВЫЧКАХ».
 *
 * ТЗ (B.2) называет один признак: одно слово короче семи букв. Его мало,
 * и это видно на живом справочнике: «Апокалипсис», «Троецарствие»,
 * «Стометровка», «Полное исследование», «Истории монстров» под него
 * не подходят ни одно, а их падежные формы — обычные русские слова, и в архиве
 * они звучат сами по себе.
 *
 * ВТОРОЙ ПРИЗНАК — СЛОВАРЬ. Название целиком набрано словами, которые словарь
 * ЗНАЕТ как обычные русские слова (`parser === 'Dictionary'`), — значит эту
 * фразу можно сказать, не имея в виду аниме. У выдуманных и заимствованных имён
 * словарь такого разбора не даёт вовсе, он угадывает их по концовке
 * (`SuffixKnown`): «Наруто», «Кэйон», «Фрирен», «Дандадан», «Баракамон»,
 * «Цугаи» — все шесть. Проверено замером самой библиотеки, а не выведено
 * из рассуждения.
 *
 * ПОЧЕМУ ЭТОГО ТОЖЕ НЕ ХВАТИЛО БЫ ОДНОГО. «Атака титанов» и «Ходячий замок»
 * тоже набраны обычными словами, а формы у них — самые удачные во всём
 * пересчёте: у фразы из двух слов должны совпасть подряд две основы, и это
 * сильное ограничение (измерено в src/lib/aliasHints.mjs). Поэтому признак
 * словаря — это ПОВОД ПОСМОТРЕТЬ, а не приговор, и рядом с ним отчёт
 * (scripts/anime-quotes.mjs) обязан показать замер по архиву: сколько
 * совпадений название даёт и сколько из них уже стоит в кавычках.
 *
 * @returns {{ why: string[], words: number, ordinary: number } | null}
 */
export function strictQuotesHint(titleRu) {
	requireMorph('strictQuotesHint');

	const spoken = spokenPart(String(titleRu ?? '').trim());
	const words = wordsOf(spoken);
	if (words.length === 0) return null;

	const why = [];

	if (words.length === 1 && words[0].length < SHORT_TITLE) {
		why.push(`одно слово из ${words[0].length} букв — слишком похоже на обычное`);
	}

	// Кириллицу спрашиваем у словаря, латиницу нет: он о ней ничего не знает
	// и ответил бы «не обычное слово» про любое английское название.
	const russian = words.filter((word) => /\p{Script=Cyrillic}/u.test(word));
	const ordinary = russian.filter((word) =>
		(Az.Morph(word) ?? []).some((parse) => parse.parser === 'Dictionary'),
	);

	if (russian.length > 0 && ordinary.length === russian.length) {
		why.push(
			russian.length === 1
				? 'это обычное слово русского языка — словарь знает его сам'
				: `все ${russian.length} слова обычные — такую фразу можно сказать, не имея в виду аниме`,
		);
	}

	return why.length > 0 ? { why, words: words.length, ordinary: ordinary.length } : null;
}

// ─── Чтение справочника: нужно и пересчёту, и отчёту ────────────────────────

export async function readAnimeCollection() {
	const files = (await readdir(ANIME_CONTENT_DIR)).filter((name) => name.endsWith('.json'));
	const entries = [];
	for (const file of files) {
		const url = new URL(file, ANIME_CONTENT_DIR);
		entries.push({ file, url, data: JSON.parse(await readFile(url, 'utf8')) });
	}
	return entries;
}

/**
 * Записать пересчитанные формы в файл тайтла.
 *
 * ПИШЕТСЯ РОВНО ОДНО ПОЛЕ. Остальное — вместе с `aliases`, `manual` и всем,
 * что человек правил руками, — переносится байт в байт: пересчёт форм не имеет
 * права стать поводом переписать карточку целиком.
 */
export async function writeAliasesAuto(entry, forms) {
	const next = { ...entry.data };
	if (forms.length > 0) next.aliasesAuto = forms;
	else delete next.aliasesAuto;

	await writeFile(entry.url, JSON.stringify(next, null, '\t') + '\n', 'utf8');
}

// Запускать этот файл нечем: он библиотека. Команда пересчёта —
// scripts/anime-cases.mjs, устройство то же, что у пары anime-lib.mjs
// и sync-anime.mjs.
