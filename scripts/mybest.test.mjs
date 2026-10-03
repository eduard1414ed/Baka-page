// ПРОВЕРКА СТРАНИЦЫ «МОИ ДЕВЯТЬ АНИМЕ» — ДВА ПРАВИЛА, КОТОРЫЕ ВИДОМ НЕ ЯВЛЯЮТСЯ
// (задача 22).
//
//   1. `matchQuery` (src/lib/animeMentions.mjs) — какие тайтлы своего каталога
//      находит запрос читателя. Порядок и состав выдачи глазами не проверить:
//      «нашлось два» от «нашлось два, но не те» на экране не отличается.
//   2. `shortTitle` (src/lib/animeShortTitle.mjs) — короткая подпись под маркой.
//   3. Перфорация картинки (`PERF` в src/lib/mybestImage.mjs) — те же числа,
//      что у марки каталога и марки страницы в CSS. На холсте узора-градиента
//      нет, кружки рисуются кодом по своим числам, — и разъедись они с CSS,
//      на сайте и в картинке стало бы две разные перфорации, причём заметно
//      это только рядом, глазами.
//
// Две части, как у scripts/anime-clash.test.mjs: ЗАКОН — на выдуманных
// и записанных образцах, роняет проверку; ЗАМЕР — по живому справочнику,
// печатает числа и падает только на том, чего быть не может.
//
// `--selftest` подсовывает правила, сломанные так, как их сломали бы в жизни,
// и требует, чтобы закон покраснел на каждом. Без этого «всё зелёное» ничего
// не значит.
//
// Запуск: node scripts/mybest.test.mjs [--selftest]
import { readdirSync, readFileSync } from 'node:fs';
import { buildAnimeMatcher, matchQuery as realMatch, fold } from '../src/lib/animeMentions.mjs';
import { shortTitle as realShort } from '../src/lib/animeShortTitle.mjs';
import { emptyState, encodeState, decodeState, readStored } from '../src/lib/mybestState.mjs';
import { PERF } from '../src/lib/mybestImage.mjs';

const ROOT = new URL('..', import.meta.url);

const FAKE = [
	{ id: 'fma', data: { titleRu: 'Стальной алхимик', titleOriginal: 'Hagane no Renkinjutsushi', aliasesAuto: ['Стального алхимика'] } },
	// Падежи куска до двоеточия морфология кладёт и продолжению — так лежит
	// в живой карточке fullmetal-alchemist-brotherhood.json.
	{ id: 'fma-b', data: { titleRu: 'Стальной алхимик: Братство', titleOriginal: 'Fullmetal Alchemist: Brotherhood', aliasesAuto: ['Стального алхимика'] } },
	{ id: 'jjk', data: { titleRu: 'Магическая битва', titleOriginal: 'Jujutsu Kaisen' } },
	{ id: 'keion', data: { titleRu: 'Кэйон!', titleOriginal: 'K-On!', aliases: ['Кейон'] } },
	{ id: 'yona', data: { titleRu: 'Ёна на заре', titleOriginal: 'Akatsuki no Yona' } },
];

const LONG =
	'Изгнанный читер-чародей наслаждается беззаботной второй жизнью: Я могу накладывать „очки усиления“ не только на оружие, но и на что угодно, в любой момент отменяя эффект по собственной воле, а с теми, кто остался, всё нормально?';

function law(matchQuery, shortTitle, encode = encodeState) {
	const fails = [];
	const m = buildAnimeMatcher(FAKE, { quotes: 'ignore', speech: false });
	const expect = (what, got, want) => {
		if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${what}: ждали ${JSON.stringify(want)}, вышло ${JSON.stringify(got)}`);
	};

	// Поиск.
	expect('полное название находит оба тайтла, точный первым', matchQuery('стальной алхимик', m), ['fma', 'fma-b']);
	expect('недописанное последнее слово', matchQuery('стальн', m), ['fma', 'fma-b']);
	expect('начало слова внутри названия', matchQuery('битв', m), ['jjk']);
	expect('кусок середины слова не находит', matchQuery('итва', m), []);
	expect('падежная форма', matchQuery('стального алхимика', m), ['fma', 'fma-b']);
	expect('название целиком внутри длинного запроса', matchQuery('кэйон! второй сезон', m), ['keion']);
	expect('ручной вариант написания', matchQuery('кейон', m), ['keion']);
	expect('латиница', matchQuery('k-on', m), ['keion']);
	expect('«е» и «ё» одно', matchQuery('ена на заре', m), ['yona']);
	expect('регистр и лишние пробелы', matchQuery('  МАГИЧЕСКАЯ   битва ', m), ['jjk']);
	expect('одна буква не ищет', matchQuery('м', m), []);
	expect('чушь не находит ничего', matchQuery('ыврапролд', m), []);

	// Короткая подпись.
	expect('настоящее длинное название', shortTitle(LONG), 'Изгнанный читер-чародей наслаждается беззаботной второй жизнью');
	// Режется только длиннее SHORT_TITLE_LIMIT (50), поэтому образцы длинные.
	expect('продолжение остаётся целым', shortTitle('Стальной алхимик: Братство'), 'Стальной алхимик: Братство');
	expect('ровно на пороге не режется', shortTitle('Х'.repeat(20) + ': ' + 'Y'.repeat(28)), 'Х'.repeat(20) + ': ' + 'Y'.repeat(28));
	expect('двоеточие', shortTitle('Хоть я и бездарная злодейка: Сказка о том, как бабочка и крыса'), 'Хоть я и бездарная злодейка');
	expect('точка', shortTitle('Жизнь перерождённого мудреца в другом мире. Получение второй профессии'), 'Жизнь перерождённого мудреца в другом мире');
	expect('восклицательный остаётся', shortTitle('Стать настоящей героиней! Непопулярная героиня и секретное задание'), 'Стать настоящей героиней!');
	expect('пачка знаков остаётся целиком', shortTitle('Волейбол!! Второй сезон про очень длинную дорогу к национальному'), 'Волейбол!!');
	expect('знак у самого начала не режет (Re:Zero)', shortTitle('Re:Zero. Жизнь с нуля в альтернативном мире, третий сезон'), 'Re:Zero');
	expect('точка в сокращении у начала не режет', shortTitle('Dr. Stone и очень длинная приписка без единого знака препинания'), 'Dr. Stone и очень длинная приписка без единого знака препинания');
	expect('точка между цифрами не режет', shortTitle('Евангелион 3.0+1.01: Как-то раз, давным-давно, в далёкой галактике'), 'Евангелион 3.0+1.01');
	expect('без знаков — как есть', shortTitle('Соседнему королевству продали святую, помолвку которой разорвали'), 'Соседнему королевству продали святую, помолвку которой разорвали');
	expect('лишние пробелы', shortTitle('  Кэйон!  '), 'Кэйон!');

	// Ссылка на девятку: что ушло в адрес, то и вернулось.
	const nine = emptyState();
	nine.caption = '9 аниме детства';
	nine.slots[0] = { src: 'cat', id: 'fullmetal-alchemist', title: 'Стальной алхимик', year: 2003, poster: '/anime/x-320w.webp' };
	nine.slots[2] = { src: 'shiki', id: '1818', title: 'Клеймор', year: 2007, poster: 'https://shikimori.io/p.webp', label: 'Клеймор!' };
	nine.slots[3] = { src: 'anilist', id: '4081', title: 'Natsume Yuujinchou. Season 1', year: 2008 };
	nine.slots[5] = { src: 'manual', title: 'Ковбой Бибоб: фильм. Часть 2' };
	const back = decodeState(encode(nine));
	expect(
		'ссылка: клетки по местам, у каталога только адрес, у внешних номер, год и название',
		back?.slots,
		[
			{ src: 'cat', id: 'fullmetal-alchemist' },
			null,
			{ src: 'shiki', id: '1818', title: 'Клеймор', year: 2007, label: 'Клеймор!' },
			{ src: 'anilist', id: '4081', title: 'Natsume Yuujinchou. Season 1', year: 2008 },
			null,
			{ src: 'manual', title: 'Ковбой Бибоб: фильм. Часть 2' },
			null,
			null,
			null,
		],
	);
	expect('ссылка: подпись над картинкой', back?.caption, '9 аниме детства');
	expect('пустая девятка — голый адрес', encodeState(emptyState()), '');
	expect('адрес без девятки — не девятка', decodeState('?utm_source=telegram'), null);
	expect('мусор в адресе — пустые клетки, а не поломка', decodeState('?t=%3Cscript%3E&t=s.abc.2000.X&t=m.')?.slots.slice(0, 3), [null, null, null]);
	expect('чужое в хранилище — не девятка', readStored('{"slots":5}'), null);

	return fails;
}

// ПЕРФОРАЦИЯ: числа холста против CSS. Ищем оба узора (верхний край и боковой)
// В КАЖДОМ файле; не нашёлся — тоже беда: узор переписали, и сверять нечем.
const PERF_FILES = ['src/components/AnimeCard.astro', 'src/pages/mybest/index.astro'];
const NUM = '(\\d+(?:\\.\\d+)?)';
const EDGE = new RegExp(`radial-gradient\\(circle at ${NUM}px 0, var\\(--paper\\) ${NUM}px, transparent [\\d.]+px\\) 0 0 / ${NUM}px ${NUM}px repeat-x`, 'g');
const SIDE = new RegExp(`radial-gradient\\(circle at 0 ${NUM}px, var\\(--paper\\) ${NUM}px, transparent [\\d.]+px\\) 0 0 / ${NUM}px ${NUM}px repeat-y`, 'g');

function perfLaw(sources, perf) {
	const fails = [];
	for (const [name, css] of Object.entries(sources)) {
		const edge = [...css.matchAll(EDGE)];
		const side = [...css.matchAll(SIDE)];
		if (edge.length !== 1 || side.length !== 1) {
			fails.push(`${name}: узоров перфорации ${edge.length} и ${side.length}, ждали по одному — правило переписали?`);
			continue;
		}
		const [, eOffset, eRadius, eStep] = edge[0].map(Number);
		const [, sOffset, sRadius, , sStep] = side[0].map(Number);
		const got = { radius: [eRadius, sRadius], step: [eStep, sStep], offset: [eOffset, sOffset] };
		for (const [key, values] of Object.entries(got))
			for (const v of values) if (v !== perf[key]) fails.push(`${name}: ${key} в CSS ${v}, на холсте ${perf[key]}`);
		if (!new RegExp(`top: -${perf.shift}px`).test(css)) fails.push(`${name}: сдвиг полосы за край не ${perf.shift}px`);
	}
	return fails;
}

const perfSources = Object.fromEntries(PERF_FILES.map((f) => [f, readFileSync(new URL(f, ROOT), 'utf8')]));

// Подлоги перфорации разводят ОДНУ копию, как и случится в жизни: правят шаг
// у марки страницы и не правят у каталога и холста.
const BROKEN_PERF = {
	'шаг марки страницы 20 вместо 18': () =>
		perfLaw({ ...perfSources, [PERF_FILES[1]]: perfSources[PERF_FILES[1]].replace('0 0 / 18px 12px repeat-x', '0 0 / 20px 12px repeat-x') }, PERF),
	'кружок на холсте 4 вместо 5': () => perfLaw(perfSources, { ...PERF, radius: 4 }),
	'боковой узор переписан другой записью': () =>
		perfLaw({ ...perfSources, [PERF_FILES[0]]: perfSources[PERF_FILES[0]].replace('circle at 0 6px', 'circle at 0px 6px') }, PERF),
};

// Сломанные так, как их сломали бы в жизни.
const BROKEN = {
	'поиск требует целое слово (как findMentions)': [
		(q, m) => realMatch(q, m).filter((id) => m.some((n) => n.id === id && (fold(q).trim() === n.folded || fold(q).includes(n.folded)))),
		realShort,
	],
	'поиск отдаёт один тайтл на кусок (исключительность упоминаний)': [(q, m) => realMatch(q, m).slice(0, 1), realShort],
	'поиск ищет подстроку где угодно': [
		(q, m) => {
			const f = fold(q).trim();
			if (f.length < 2) return [];
			return [...new Set(m.filter((n) => n.folded.includes(f)).map((n) => n.id))];
		},
		realShort,
	],
	'обрезка режет по первому знаку, даже у начала': [realMatch, (t) => String(t).trim().split(/[:.?!]/)[0].trim()],
	'обрезка без порога (режет и короткие)': [
		realMatch,
		(t) => {
			const s = String(t).replace(/\s+/g, ' ').trim();
			const at = s.slice(6).search(/[:.]/);
			return at === -1 ? s : s.slice(0, at + 6).trim();
		},
	],
	'ссылка теряет правленые подписи': [
		realMatch,
		realShort,
		(state) => encodeState({ ...state, slots: state.slots.map((s) => s && { ...s, label: undefined }) }),
	],
	'обрезка не знает про числа': [
		realMatch,
		(t) => {
			const s = String(t).trim();
			const at = s.slice(6).search(/[:.?!]/);
			return at === -1 ? s : s.slice(0, at + 6 + (/[?!]/.test(s[at + 6]) ? 1 : 0)).trim();
		},
	],
};

let code = 0;

if (process.argv.includes('--selftest')) {
	for (const [name, [m, s, e]] of Object.entries(BROKEN)) {
		const fails = law(m, s, e);
		console.log(fails.length > 0 ? `✓ подлог «${name}» пойман (${fails.length})` : `✗ подлог «${name}» НЕ пойман`);
		if (fails.length === 0) code = 1;
	}
	for (const [name, run] of Object.entries(BROKEN_PERF)) {
		const fails = run();
		console.log(fails.length > 0 ? `✓ подлог «${name}» пойман (${fails.length})` : `✗ подлог «${name}» НЕ пойман`);
		if (fails.length === 0) code = 1;
	}
	const clean = [...law(realMatch, realShort), ...perfLaw(perfSources, PERF)];
	console.log(clean.length === 0 ? '✓ на настоящем коде закон зелёный' : `✗ на настоящем коде закон красный:\n  ${clean.join('\n  ')}`);
	if (clean.length) code = 1;
	process.exit(code);
}

const fails = [...law(realMatch, realShort), ...perfLaw(perfSources, PERF)];
if (fails.length) {
	console.log('✗ ЗАКОН:\n  ' + fails.join('\n  '));
	code = 1;
} else console.log('✓ закон: поиск, короткая подпись, перфорация картинки = CSS — все случаи');

// ЗАМЕР по живому справочнику.
const dir = new URL('src/content/anime/', ROOT);
const all = readdirSync(dir)
	.filter((f) => f.endsWith('.json'))
	.map((f) => ({ id: f.slice(0, -5), data: JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }));
const m = buildAnimeMatcher(all, { quotes: 'ignore', speech: false });
let lost = 0;
for (const { id, data } of all) {
	const own = data.titleRu || data.titleOriginal;
	if (!realMatch(own, m).includes(id)) {
		lost++;
		console.log(`✗ тайтл не находится по собственному названию: ${id} «${own}»`);
	}
}
if (lost) code = 1;
const cut = all.filter(({ data }) => realShort(data.titleRu || data.titleOriginal) !== (data.titleRu || data.titleOriginal).trim()).length;
console.log(`замер: тайтлов ${all.length}, каждый находится по своему названию; подпись укорочена у ${cut}`);
process.exit(code);
