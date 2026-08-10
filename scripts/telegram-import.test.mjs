#!/usr/bin/env node
// Проверки разбора телеграма (тз/тз-7.1, раздел «Самопроверка»).
//
// ФАЙЛОМ, А НЕ ОДНОСТРОЧНИКОМ `node -e`. Обратный слэш внутри однострочника
// проходит через две системы экранирования подряд, и выражение перестаёт
// совпадать вообще ни с чем — при этом проверка не падает, а бодро отвечает
// «ничего не найдено». За проект так уже врали дважды подряд.
//
// РЕЖИМ --selftest СУЩЕСТВУЕТ НА САМОМ ДЕЛЕ, а не только в этом заголовке.
// Он портит данные нарочно и требует, чтобы каждая проверка это поймала.
// Без него «всё сошлось» не значит ничего: проверка, сломавшаяся от опечатки
// в регулярном выражении, выглядит точно так же, как проверка успешная.
// У check-css.mjs таких молчаливых вранья за проект набралось пять, и все —
// в сторону «всё хорошо».
//
//   node scripts/telegram-import.test.mjs --export=<папка ChatExport_…>
//   node scripts/telegram-import.test.mjs --export=<…> --selftest

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../src/lib/slug.mjs';
import { toPlainText } from '../src/lib/plainText.mjs';
import { extractTitle, titleLineTail, groupAlbums, buildPost, entitiesToMarkdown, bodyEntities } from './telegram-import.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback = null) => {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
};
const SELFTEST = process.argv.includes('--selftest');

// ——— Случаи заголовка, написанные ЖИВЫМ СИНТАКСИСОМ ———
//
// То есть ровно так, как их пишет telegram в text_entities, а не так, как
// удобно проверке. Подлог, повторяющий формулировку правила, проверяет
// не правило, а собственную аккуратность.

const plain = (text) => ({ type: 'plain', text });
const bold = (text) => ({ type: 'bold', text });

const TITLE_CASES = [
	{
		name: 'эмодзи перед жирным — заголовок берётся',
		entities: [plain('🖋 '), bold('Нарисуй это, потом умри'), plain('\n\nПо понятным причинам я фанат всех тайтлов про мангак.')],
		title: 'Нарисуй это, потом умри',
		tail: '',
	},
	{
		name: 'обычный текст перед жирным — заголовка нет',
		entities: [plain('Вчера мы записали '), bold('новый выпуск'), plain(' про студию Ghibli.')],
		title: null,
	},
	{
		name: 'жирное во втором абзаце — заголовка нет',
		entities: [plain('Смотрите, что нашлось в архиве.\n\n'), bold('Где слушать?'), plain('\n\nBoosty, Patreon.')],
		title: null,
	},
	{
		name: 'жирное со второй строки без пустой строки — заголовка нет',
		entities: [plain('Заметка на полях\n'), bold('Настоящий заголовок'), plain('\n\nтекст')],
		title: null,
	},
	{
		name: 'два жирных куска через разделитель — это один заголовок',
		entities: [plain('🏙 '), bold('Город'), plain(' | '), bold('Комедия на миллион'), plain('\n\n«Город» — это экранизация манги.')],
		title: 'Город | Комедия на миллион',
		tail: '',
	},
	{
		name: 'после жирного на той же строке остался текст — он уходит в тело',
		entities: [plain('🐱 '), bold('Усы, лапы и хвост'), plain(' (пост от Ксюши)\n\nНа днях посмотрела очень милое аниме.')],
		title: 'Усы, лапы и хвост',
		tail: '(пост от Ксюши)',
	},
	{
		name: 'ссылка первой — заголовка нет',
		entities: [
			{ type: 'text_link', text: 'P.S. Юико', href: 'https://t.me/podcastbaka/4126' },
			plain(' (если вы забыли, это наш маскот) тоже рекомендует книжку.'),
		],
		title: null,
	},
	{
		name: 'жирный пробел — заголовка нет',
		entities: [bold('   '), plain('обычный текст поста')],
		title: null,
	},
	{
		name: 'эмодзи-картинка канала перед жирным — заголовок берётся',
		entities: [
			{ type: 'custom_emoji', text: '🔵', document_id: '' },
			plain(' '),
			bold('Новостной дайджест'),
			plain('\n\nЧто случилось за неделю.'),
		],
		title: 'Новостной дайджест',
		tail: '',
	},
	{
		name: 'эмодзи внутри самого заголовка снимается',
		entities: [plain('☀️ '), bold('Это главная премьера лета? 🌸'), plain('\n\nХранитель камфорного дерева.')],
		title: 'Это главная премьера лета?',
		tail: '',
	},
	{
		name: 'жирного нет вовсе — заголовка нет',
		entities: [plain('Просто мысль вслух, без всякого заголовка.')],
		title: null,
	},
];

function titleProblems(cases) {
	const problems = [];
	for (const item of cases) {
		const got = extractTitle(item.entities);
		const gotTitle = got?.title ?? null;
		if (gotTitle !== item.title) problems.push(`заголовок «${item.name}»: ждали ${JSON.stringify(item.title)}, вышло ${JSON.stringify(gotTitle)}`);
		if (item.tail !== undefined) {
			const gotTail = titleLineTail(item.entities, got);
			if (gotTail !== item.tail) problems.push(`хвост строки «${item.name}»: ждали ${JSON.stringify(item.tail)}, вышло ${JSON.stringify(gotTail)}`);
		}
	}
	return problems;
}

// ——— Адреса страниц ———
//
// Три пары взяты из НАСТОЯЩИХ файлов постов: эти адреса выдала админка,
// и наша функция обязана повторить их буква в букву.

const SLUG_CASES = [
	['Нарисуй это, потом умри', 'narisuy-eto-potom-umri'],
	['Знакомьтесь: Ёдзи Такэсигэ', 'znakomtes-yodzi-takesige'],
	['Девушки-пони: Серая Золушка | В чем секрет популярности?', 'devushki-poni-seraya-zolushka-v-chem-sekret-populyarnosti'],
];

function slugProblems(cases) {
	const problems = [];
	for (const [title, expected] of cases) {
		const got = slugify(title);
		if (got !== expected) problems.push(`адрес «${title}»: ждали «${expected}», вышло «${got}»`);
	}

	// Файлы постов существуют — сверяем с ними, а не только со списком выше.
	for (const [, expected] of SLUG_CASES) {
		try {
			readFileSync(join(root, 'src/content/posts', `${expected}.md`), 'utf8');
		} catch {
			problems.push(`пост ${expected}.md на диске не найден — образец для сверки устарел`);
		}
	}
	return problems;
}

// ——— Разбор поста 4143 против того, что опубликовано на сайте ———

/** Абзацы голым текстом: разметка снята общим кодом, склейки абзацев видно. */
const paragraphs = (markdown) =>
	markdown
		.split(/\n{2,}/)
		// Обратные слэши экранирования на читаемый текст не влияют.
		.map((block) => toPlainText(block.replace(/\\([*_`[\]#>\\])/g, '$1')))
		.filter(Boolean);

// РУЧНЫЕ ПРАВКИ ЗАКАЗЧИКА В ОПУБЛИКОВАННОМ ПОСТЕ. Разбор обязан совпасть
// с сайтом ВЕЗДЕ, КРОМЕ ЭТОГО СПИСКА, — тогда любое новое расхождение
// проверка поймает, а известное не будет каждый раз выдаваться за поломку.
//
// Откуда они взялись. Перенося пост руками, заказчик обернул названия аниме
// в разметку тайтла `:anime[…]` — и вместе с этим снял вокруг них кавычки-
// ёлочки и поправил падеж. Это редакторские решения, а не потеря данных:
// чинить надо было бы пост, а трогать опубликованное запрещено.
//
// СПИСОК ЖИВЁТ ЗДЕСЬ, А НЕ ВНУТРИ СРАВНЕНИЯ, ровно затем, чтобы его было
// видно глазами: «известных отличий три» — это утверждение, за которое
// кто-то отвечает, а не побочное действие снисходительного сравнения.
const HAND_EDITS = [['Белую коробку', 'Белая коробка']];

/** Ёлочки вокруг названий тайтлов заказчик снял вместе с разметкой. */
const dropGuillemets = (text) => text.replace(/[«»]/g, '');

function post4143Problems(built, publishedBody) {
	const problems = [];

	if (built.title !== 'Нарисуй это, потом умри') problems.push(`заголовок разобран как «${built.title}»`);
	if (built.slug !== 'narisuy-eto-potom-umri') problems.push(`адрес разобран как «${built.slug}»`);
	if (built.date !== '2026-08-07') problems.push(`дата разобрана как «${built.date}», а в телеграме 2026-08-07`);

	const links = built.body.match(/\]\(https:\/\/t\.me\/podcastbaka\/\d+\)/g) ?? [];
	if (links.length !== 3) problems.push(`ссылок в тексте ${links.length}, а в телеграме их три`);

	// Ёлочки ниже снимаются с ОБЕИХ сторон перед сравнением — значит их пропажу
	// сравнение не заметило бы. Спрашиваем про них отдельно и прямо.
	if (!built.body.includes('«Рабочее место, где вы не можете не улыбаться»')) {
		problems.push('кавычки-ёлочки вокруг названия из телеграма в разборе потерялись');
	}

	const normalise = (text) => {
		let out = dropGuillemets(text);
		for (const [was, became] of HAND_EDITS) out = out.split(was).join(became);
		return out.trim();
	};

	const ours = paragraphs(built.body).map(normalise);
	const theirs = paragraphs(publishedBody).map(dropGuillemets).map((t) => t.trim());

	if (ours.length !== theirs.length) {
		problems.push(`абзацев у нас ${ours.length}, на сайте ${theirs.length} — абзацы склеены или разорваны`);
	} else {
		for (let i = 0; i < ours.length; i += 1) {
			if (ours[i] !== theirs[i]) {
				problems.push(`абзац ${i + 1} расходится:\n      наш:  ${ours[i].slice(0, 130)}\n      сайт: ${theirs[i].slice(0, 130)}`);
			}
		}
	}

	return problems;
}

// ——— Запуск ———

function report(name, problems) {
	if (problems.length === 0) {
		console.log(`  чисто — ${name}`);
		return 0;
	}
	console.log(`  НАЙДЕНО (${problems.length}) — ${name}`);
	for (const p of problems) console.log(`    • ${p}`);
	return problems.length;
}

async function main() {
	const exportDir = arg('export');
	if (!exportDir) {
		console.error('Нужен ключ --export=<папка ChatExport_…>');
		process.exit(1);
	}

	const messages = JSON.parse(readFileSync(join(exportDir, 'result.json'), 'utf8')).messages;
	const post = groupAlbums(messages).find((p) => p.id === 4143);
	if (!post) {
		console.error('В экспорте нет сообщения 4143 — сверять не с чем.');
		process.exit(1);
	}
	const built = buildPost(post);

	const publishedFile = readFileSync(join(root, 'src/content/posts/narisuy-eto-potom-umri.md'), 'utf8');
	const publishedBody = publishedFile.split(/^---$/m).slice(2).join('---');

	if (!SELFTEST) {
		console.log('ПРОВЕРКИ РАЗБОРА ТЕЛЕГРАМА\n');
		let found = 0;
		found += report('правило заголовка, 11 подложенных случаев', titleProblems(TITLE_CASES));
		found += report('адреса страниц против настоящих файлов постов', slugProblems(SLUG_CASES));
		found += report('пост 4143 против опубликованного на сайте', post4143Problems(built, publishedBody));

		console.log(
			found === 0
				? '\nВсё сошлось. Чтобы убедиться, что проверки вообще умеют находить, — запустите с ключом --selftest.'
				: `\nВСЕГО РАСХОЖДЕНИЙ: ${found}`,
		);
		process.exit(found === 0 ? 0 : 1);
	}

	// ——— Самопроверка проверок ———
	//
	// Каждой проверке подсовывается заведомо испорченное, и она ОБЯЗАНА
	// заругаться. Молчание здесь — не «всё хорошо», а «проверка мертва».
	console.log('САМОПРОВЕРКА: ломаю нарочно, проверки обязаны это поймать\n');
	const traps = [
		{
			name: 'заголовок: ждём заголовок там, где его быть не должно',
			problems: titleProblems([{ ...TITLE_CASES[1], title: 'новый выпуск' }]),
		},
		{
			name: 'заголовок: подсунут хвост строки, которого нет',
			problems: titleProblems([{ ...TITLE_CASES[0], tail: 'лишний хвост' }]),
		},
		{
			name: 'адрес: буква в адресе изменена',
			problems: slugProblems([['Нарисуй это, потом умри', 'narisuj-eto-potom-umri']]),
		},
		{
			name: 'пост 4143: абзацы склеены в один',
			problems: post4143Problems({ ...built, body: built.body.replace(/\n{2,}/g, ' ') }, publishedBody),
		},
		{
			name: 'пост 4143: ссылки из текста вычищены',
			problems: post4143Problems({ ...built, body: built.body.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') }, publishedBody),
		},
		{
			name: 'пост 4143: слово в абзаце подменено',
			problems: post4143Problems({ ...built, body: built.body.replace('комедия', 'трагедия') }, publishedBody),
		},
		{
			name: 'пост 4143: заголовок подменён',
			problems: post4143Problems({ ...built, title: 'Нарисуй это' }, publishedBody),
		},
		{
			name: 'пост 4143: кавычки-ёлочки вычищены из разбора',
			problems: post4143Problems({ ...built, body: built.body.replace(/[«»]/g, '') }, publishedBody),
		},
		{
			name: 'пост 4143: абзац потерян целиком',
			problems: post4143Problems({ ...built, body: built.body.split('\n\n').slice(0, -1).join('\n\n') }, publishedBody),
		},
	];

	let blind = 0;
	for (const trap of traps) {
		const caught = trap.problems.length > 0;
		if (!caught) blind += 1;
		console.log(`  ${caught ? 'поймано' : 'ПРОСМОТРЕНО'} — ${trap.name}`);
	}

	console.log(blind === 0 ? '\nВсе подлоги пойманы: проверки живы.' : `\nПРОВЕРКИ СЛЕПЫ В ${blind} СЛУЧАЯХ — им нельзя верить.`);
	process.exit(blind === 0 ? 0 : 1);
}

await main();

// Чтобы линтер не считал импорты лишними: обе функции используются в разборе,
// здесь они держат связь с ним явной.
void entitiesToMarkdown;
void bodyEntities;
