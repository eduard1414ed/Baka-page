#!/usr/bin/env node
// Проверки падежных форм (тз/11, часть A).
//
// ФАЙЛОМ, А НЕ ОДНОСТРОЧНИКОМ `node -e`: обратный слэш внутри однострочника
// проходит через две системы экранирования подряд, и выражение перестаёт
// совпадать вообще ни с чем — при этом проверка не падает, а бодро отвечает
// «ничего не найдено».
//
// ЗАЧЕМ ТУТ ПОДЛОГИ. На живом справочнике список подозрительных форм ПУСТ,
// и это ничего не значит, пока не показано, что он вообще умеет находить:
// проверка, сломанная опечаткой, выглядит точно так же. Поэтому ниже лежат
// выдуманные тайтлы, на которых она обязана заругаться, — и рядом такие,
// на которых обязана промолчать. Второе не менее важно: проверка, ругающаяся
// на всё подряд, перестаёт что-либо значить через две сессии.
//
//   node scripts/anime-cases.test.mjs

import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initMorph, inflectTitle, computeAliasesAuto, suspiciousForms, writeAliasesAuto } from './anime-cases-lib.mjs';

let failed = 0;

function check(name, ok, detail = '') {
	if (!ok) failed += 1;
	console.log(`  ${ok ? 'ок      ' : 'ПРОВАЛ  '} ${name}${detail ? ` — ${detail}` : ''}`);
}

await initMorph();

// ─── 1. Склонение: каждая строка — уже случившаяся поломка ─────────────────
//
// Все четыре нашлись замером на настоящем справочнике 10 августа 2026, и все
// четыре выглядели правдоподобно, а не ошибкой.

console.log('\n=== СКЛОНЕНИЕ ===');

const cases = [
	{
		title: 'Атака титанов',
		must: ['Атаки титанов', 'Атаку титанов', 'Атакой титанов'],
		mustNot: ['Атаки титана', 'Атаку титан'],
		why: 'зависимое слово в родительном склонять нельзя',
	},
	{
		title: 'Тетрадь смерти',
		must: ['Тетради смерти', 'Тетрадью смерти'],
		mustNot: ['Тетрадь смерть', 'Тетрадью смертью'],
		why: 'то же самое, второй случай',
	},
	{
		title: 'Ходячий замок',
		must: ['Ходячего замка', 'Ходячему замку', 'Ходячим замком', 'Ходячем замке'],
		mustNot: ['Ходячего замок', 'Ходячий замка'],
		why: 'определение и голова склоняются вместе',
	},
	{
		title: 'Магическая битва',
		must: ['Магической битвы', 'Магическую битву', 'Магической битвой'],
		mustNot: ['Магического битвы', 'Магическую битва'],
		why: 'род определения берётся у головы, а не мужской по умолчанию',
	},
	{
		title: 'Королевские космические силы: Крылья Хоннеамиз',
		must: ['Королевских космических сил', 'Королевскими космическими силами'],
		mustNot: ['Королевские космические силе', 'Королевские космические сил'],
		why: 'множественное число не теряется, подзаголовок не склоняется',
	},
	{
		title: 'Провожающая в последний путь Фрирен',
		must: ['Провожающей в последний путь Фрирен'],
		mustNot: ['Провожающая века последний путь Фрирен', 'Провожающего в последний путь Фрирен'],
		why: 'предлог не голова фразы, а причастие — голова',
	},
	{
		title: 'Бездомный бог',
		must: ['Бездомного бога', 'Бездомным богом'],
		mustNot: ['Бездомный бога'],
		why: 'одушевлённое существительное',
	},
	{
		title: 'Унесённые призраками',
		must: [],
		mustNot: ['Унёсших призраками', 'Унёсшего призраками'],
		why: 'страдательное причастие: молчим, а не подменяем слово',
	},
	{
		title: 'Мир танцует',
		must: [],
		mustNot: ['Мира танцует', 'Миру танцует'],
		why: 'название-предложение не склоняется',
	},
	{
		title: 'Steins;Gate',
		must: [],
		mustNot: [],
		why: 'латиница не склоняется никогда',
	},
];

for (const c of cases) {
	const forms = inflectTitle(c.title);
	const missing = c.must.filter((f) => !forms.includes(f));
	const wrong = c.mustNot.filter((f) => forms.includes(f));
	const empty = c.must.length === 0 && c.mustNot.length === 0 ? forms.length === 0 : true;
	check(
		`«${c.title}» — ${c.why}`,
		missing.length === 0 && wrong.length === 0 && empty,
		[
			missing.length ? `не хватает: ${missing.join(', ')}` : '',
			wrong.length ? `лишнее: ${wrong.join(', ')}` : '',
			!empty ? `должно быть пусто, а вышло: ${forms.join(', ')}` : '',
		]
			.filter(Boolean)
			.join('; '),
	);
}

// ─── 2. Ручное поле неприкосновенно ────────────────────────────────────────

console.log('\n=== РУЧНОЕ НЕ ТРОГАЕТСЯ ===');

const manual = computeAliasesAuto({ titleRu: 'Ходячий замок', aliases: ['Ходячего замка', 'Ходячему замку'] });
check(
	'форма, уже вписанная руками, второй раз не предлагается',
	!manual.includes('Ходячего замка') && !manual.includes('Ходячему замку'),
	manual.join(', '),
);
check('но остальные формы при этом остаются', manual.includes('Ходячим замком'), manual.join(', '));

const short = computeAliasesAuto({ titleRu: 'Око' });
check('форма короче четырёх букв выброшена', !short.includes('Ока'), short.join(', ') || 'пусто');

// Запись: пересчёт форм не имеет права переписать карточку целиком.
const dir = await mkdtemp(join(tmpdir(), 'baka-cases-'));
const file = join(dir, 'test.json');
const original = {
	id: 'test',
	source: 'shikimori',
	sourceId: 1,
	titleRu: 'Ходячий замок',
	titleOriginal: 'Howl no Ugoku Shiro',
	aliases: ['Ходячего замка'],
	manual: ['synopsis'],
	synopsis: 'Своими словами.',
};
await writeFile(file, JSON.stringify(original, null, '\t') + '\n', 'utf8');
await writeAliasesAuto({ url: pathToFileURL(file), data: original }, ['Ходячим замком']);
const written = JSON.parse(await readFile(file, 'utf8'));
check('поле «Варианты написания» пережило запись', JSON.stringify(written.aliases) === JSON.stringify(original.aliases));
check('признак ручной правки пережил запись', JSON.stringify(written.manual) === JSON.stringify(original.manual));
check('своё описание пережило запись', written.synopsis === original.synopsis);
check('падежные формы записаны', JSON.stringify(written.aliasesAuto) === JSON.stringify(['Ходячим замком']));

await writeAliasesAuto({ url: pathToFileURL(file), data: written }, []);
const cleared = JSON.parse(await readFile(file, 'utf8'));
check('пустой пересчёт убирает поле, а не пишет пустой список', !('aliasesAuto' in cleared));
check('и снова ничего чужого не потерял', cleared.synopsis === original.synopsis);
await rm(dir, { recursive: true, force: true });

// ─── 3. Подлоги: умеет ли список подозрительных вообще находить ────────────
//
// Написаны так, как такое приходит в жизни, а не пересказом условия проверки:
// пересказ проверяет не проверку, а аккуратность того, кто её писал.

console.log('\n=== ПОДЛОГИ: СПИСОК ПОДОЗРИТЕЛЬНЫХ ===');

const traps = [
	{
		name: 'однословная форма, которой полон архив',
		list: [{ id: 'monster', titleRu: 'Монстр', forms: ['Монстра'] }],
		hits: new Map([['монстра', 47]]),
		catch: true,
	},
	{
		name: 'форма одного тайтла совпала с названием другого',
		list: [
			{ id: 'bitva', titleRu: 'Битва', forms: ['Битвы'] },
			{ id: 'bitvy', titleRu: 'Битвы', forms: [] },
		],
		hits: new Map(),
		catch: true,
	},
	{
		name: 'два тайтла насчитали одну и ту же форму',
		list: [
			{ id: 'skazanie-akane', titleRu: 'Сказание об Аканэ', forms: ['Сказания'] },
			{ id: 'skazaniya-zemnomorya', titleRu: 'Сказания Земноморья', forms: ['Сказания'] },
		],
		hits: new Map(),
		catch: true,
	},
	{
		name: 'форма короче шести букв',
		list: [{ id: 'oko', titleRu: 'Око', forms: ['Оком'] }],
		hits: new Map(),
		catch: true,
	},
	{
		name: 'МОЛЧАНИЕ: обычная двусловная форма, которой полон архив',
		list: [{ id: 'shingeki', titleRu: 'Атака титанов', forms: ['Атаки титанов'] }],
		hits: new Map([['атаки титанов', 68]]),
		catch: false,
	},
	{
		name: 'МОЛЧАНИЕ: длинная однословная форма, встреченная дважды',
		list: [{ id: 'stometrovka', titleRu: 'Стометровка', forms: ['Стометровки'] }],
		hits: new Map([['стометровки', 2]]),
		catch: false,
	},
];

for (const trap of traps) {
	const found = suspiciousForms(trap.list, trap.hits);
	const caught = found.length > 0;
	check(
		trap.name,
		caught === trap.catch,
		caught ? found.map((f) => `«${f.form}»: ${f.why.join(', ')}`).join(' | ') : 'молчит',
	);
}

// ─── 4. Подлоги настоящими названиями справочника ───────────────────────────
//
// ЗАЧЕМ ВТОРОЙ НАБОР. Первый написан выдуманными тайтлами и выдуманными
// формами — то есть проверяет ровно те правила, под которые сочинён. А 11 августа
// 2026 заказчик нашёл ГЛАЗАМИ девять испорченных форм в живом справочнике,
// про которые отчёт говорил «подозрительных: 0». Проверка была не сломана —
// она смотрела не туда: на форму как на слово, а не как на строку из частей.
//
// Поэтому здесь подлог не сочиняется вовсе. Берётся настоящее название
// из справочника, формы ему считает настоящий inflectTitle, и вопрос ровно
// один: назовёт ли их проверка. Так подлог не может случайно повторить
// формулировку правила — он повторяет ЖИЗНЬ.

console.log('\n=== ПОДЛОГИ: НАСТОЯЩИЕ НАЗВАНИЯ СПРАВОЧНИКА ===');

const real = [
	{ title: 'Блич: Тысячелетняя кровавая война — Бедствие', catch: true, why: 'двоеточие и тире внутри' },
	{ title: 'Кэйон!', catch: true, why: 'восклицательный знак' },
	{ title: 'Призрак в доспехах (2026)', catch: true, why: 'год в скобках' },
	{ title: 'Гуррен-Лаганн, пронзающий небеса', catch: true, why: 'запятая, и «Гуррен» стал «Гуреной»' },
	{ title: 'Прощай, Лара', catch: true, why: 'запятая, и начинается с глагола' },
	{ title: 'Ты и я — полные противоположности 2', catch: true, why: 'тире, и начинается с местоимения' },
	{ title: 'О движении Земли', catch: true, why: 'начинается с предлога: «О движении Земель»' },
	{ title: 'Быть героем Икс', catch: true, why: 'начинается с инфинитива: «Быть героем Икса»' },
	{
		title: 'Хоть я и бездарная злодейка: Сказка о том, как бабочка и крыса поменялись местами в девичьем дворе',
		catch: true,
		why: 'начинается с союза: «Хоть я и бездарной злодейки»',
	},
	{ title: 'Атака титанов', catch: false, why: 'МОЛЧАНИЕ: самая удачная форма во всём пересчёте' },
	{ title: 'Ходячий замок', catch: false, why: 'МОЛЧАНИЕ: определение и голова, всё честно' },
	{ title: 'Королевские космические силы: Крылья Хоннеамиз', catch: false, why: 'МОЛЧАНИЕ: подзаголовок отрезан' },
	{ title: 'Девушки-пони: Серая Золушка', catch: false, why: 'МОЛЧАНИЕ: дефис — не тире' },
	{ title: 'Мобильный воин Гандам 00', catch: false, why: 'МОЛЧАНИЕ: цифры в конце сами по себе не порча' },
	{ title: 'Меланхолия Харухи Судзумии', catch: false, why: 'МОЛЧАНИЕ: имя после головы не трогается' },
];

for (const item of real) {
	const forms = inflectTitle(item.title);
	const found = suspiciousForms([{ id: 'x', titleRu: item.title, forms }]);
	const caught = found.length > 0;
	check(
		`«${item.title}» — ${item.why}`,
		caught === item.catch,
		caught ? found.map((f) => `«${f.form}»: ${f.why.join('; ')}`).join(' | ') : `формы: ${forms.join(', ') || 'нет'}`,
	);
}

// А это не подлог, а вопрос к самой проверке: она обязана ломаться громко,
// если словари морфологии не загружены. Иначе три новых правила молча
// пропускались бы, и отчёт снова врал бы в сторону «всё хорошо».
console.log('\n=== ПРОВЕРКА ЛОМАЕТСЯ ГРОМКО ===');
{
	const { spawnSync } = await import('node:child_process');
	const probe = [
		"import { suspiciousForms } from './scripts/anime-cases-lib.mjs';",
		"suspiciousForms([{ id: 'x', titleRu: 'Кэйон!', forms: ['Кэйона!'] }]);",
	].join('\n');
	const run = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
		cwd: new URL('../', import.meta.url),
		encoding: 'utf8',
	});
	check(
		'без initMorph() проверка падает, а не отвечает «всё хорошо»',
		run.status !== 0 && /словари морфологии не загружены/.test(run.stderr),
		run.status === 0 ? 'вернула успех — значит правила молча пропускаются' : 'упала с внятной причиной',
	);
}

console.log(
	failed === 0
		? '\nВсе проверки прошли, все подлоги пойманы, всё лишнее пропущено мимо.'
		: `\nПРОВАЛОВ: ${failed} — верить этим проверкам нельзя.`,
);
process.exit(failed === 0 ? 0 : 1);
