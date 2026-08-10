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
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString as mdToString } from 'mdast-util-to-string';
import { slugify } from '../src/lib/slug.mjs';
import { toPlainText } from '../src/lib/plainText.mjs';
import {
	extractTitle,
	titleLineTail,
	groupAlbums,
	buildPost,
	entitiesToMarkdown,
	bodyEntities,
	selectPosts,
	postYear,
	skipReason,
	plainOf,
	ALBUM_ID_GAP,
	ALBUM_SECONDS_GAP,
	renderPost,
	frontmatterProblems,
} from './telegram-import.mjs';

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

// ——— Текст доехал целиком: ни буквы не потеряно, ни пробела не съедено ———
//
// САМАЯ СИЛЬНАЯ ИЗ ПРОВЕРОК РАЗБОРА, потому что она спрашивает не «правильно ли
// написан markdown», а «то же ли самое увидит читатель». Разметку снимает ТОТ ЖЕ
// движок, которым собирается сайт (remark + gfm), а не своё регулярное выражение:
// своё дважды соврало на живых данных — на подписи ссылки с квадратной скобкой
// внутри и на адресе, где есть скобки. Движок разбирает и то, и другое верно.
//
// Она и нашла две поломки, невидимые на последней сотне постов: пробелы
// и переводы строк, съеденные `.trim()` внутри разметки (103 поста), и ссылки,
// развалившиеся о пустую строку в подписи (52 штуки). Обе чинит `marked`
// в telegram-import.mjs.
const md = unified().use(remarkParse).use(remarkGfm);

const flat = (text) => String(text).replace(/\s+/g, ' ').trim();

// ЕДИНСТВЕННОЕ, ЧЕГО СРАВНЕНИЕ НАРОЧНО НЕ ВИДИТ, И ЭТО НАЗВАНО ЗДЕСЬ ОДНОЙ
// СТРОЧКОЙ, а не спрятано в снисходительное сравнение. Маркер списка («1.»,
// «—», «•») в начале строки в markdown становится РАЗМЕТКОЙ: номер рисует уже
// страница, в самом тексте его нет. Так задумано — escapeText нарочно
// не экранирует начало строки, потому что автор писал именно список.
// Настоящих списков в архиве 36.
//
// СНИМАЕТСЯ С ОБЕИХ СТОРОН, и это важно: у части постов автор набрал номер
// ЖИРНЫМ (`**1.** Большой выпуск`), списком такое не становится, и номер
// остаётся текстом. Снимай мы маркер только с телеграмной стороны — проверка
// объявила бы поломкой одиннадцать здоровых постов.
const dropListMarks = (text) => text.replace(/^[ \t]*(?:\d+[.)]|[-*+•])[ \t]+/gm, '');

// Список и цитата — тоже блоки, и их строки нельзя склеивать в одну: без
// разделителя «Ветер крепчает» и «Призрак в доспехах» слипаются, и проверка
// объявляет поломкой здоровый список.
const BLOCK_PARENTS = new Set(['root', 'blockquote', 'list', 'listItem']);
const nodeText = (node) =>
	BLOCK_PARENTS.has(node.type) ? node.children.map(nodeText).join('\n') : mdToString(node);

/** Что увидит читатель: markdown разобран и разметка снята. */
const readable = (markdown) => flat(dropListMarks(nodeText(md.parse(markdown))));

function textProblems(allPosts, render) {
	const problems = [];

	for (const post of allPosts) {
		if (skipReason(post)) continue;
		const entities = post.caption.text_entities ?? [];
		const body = bodyEntities(entities, extractTitle(entities));
		const want = flat(dropListMarks(plainOf(body)));
		const got = readable(render(body));
		if (want === got) continue;

		let i = 0;
		while (i < want.length && want[i] === got[i]) i += 1;
		problems.push(
			`пост №${post.id} (${post.caption.date.slice(0, 10)}) читается иначе, чем в телеграме:\n` +
				`      было:  …${want.slice(Math.max(0, i - 30), i + 30)}…\n` +
				`      стало: …${got.slice(Math.max(0, i - 30), i + 30)}…`,
		);
	}

	return problems;
}

// ——— Молчащая пачка не может стоять вплотную к подписанной ———
//
// САМАЯ ДОРОГАЯ ИЗ НАЙДЕННЫХ ОШИБОК, и нашёл её заказчик, а не проверка:
// в 2022–2023 подпись альбома часто доставалась не первому снимку, а второму
// или пятому. Склейка умела прирастать только вперёд, поэтому молчащие снимки
// оставались отдельной пачкой, выбрасывались как «сообщение без текста»,
// а посту доставался один снимок из четырёх. Цена — 28 альбомов и 95 снимков.
//
// Признак ровно такой: пачка БЕЗ подписи стоит вплотную (по времени и номеру)
// к следующей, у которой подпись есть. Такого быть не должно: телеграм
// не отправляет два альбома в одну секунду подряд.
//
// Провалиться она может — и проваливалась: на прежней склейке находит все 28.
function orphanProblems(messages, group) {
	const problems = [];
	const posts = group(messages);

	for (let i = 0; i < posts.length - 1; i += 1) {
		const pack = posts[i];
		const next = posts[i + 1];
		const tail = pack.members.at(-1);
		const head = next.members[0];

		const silent = !plainOf(pack.caption.text_entities).trim();
		const media = pack.members.every((m) => m.photo || m.media_type || m.file);
		const near =
			head.id > tail.id &&
			head.id - tail.id <= ALBUM_ID_GAP &&
			Number(head.date_unixtime) - Number(tail.date_unixtime) <= ALBUM_SECONDS_GAP;

		if (silent && media && near && plainOf(next.caption.text_entities).trim() && (head.photo || head.media_type || head.file)) {
			problems.push(
				`пачка без подписи [${pack.members.map((m) => m.id).join(',')}] стоит вплотную к посту №${next.id} — ` +
					`это его же снимки, у которых подпись пришла позже`,
			);
		}
	}

	return problems;
}

// ——— Шапка каждого поста архива обязана читаться ———
//
// КРИВАЯ ШАПКА РОНЯЕТ СБОРКУ ВСЕГО САЙТА, а не себя одну: Astro читает
// коллекцию целиком и падает на первом же файле. Поэтому проверка идёт
// по всему архиву, а не по образцу.
//
// Оплачена упавшей сборкой 10 августа 2026: правило кавычек не видело
// двоеточия в КОНЦЕ заголовка, и 70 постов-серий («Обзор всех аниме зимы:»,
// «Если вы еще не смотрели «Рок-тихоню»:») клали сайт. В последней сотне
// постов задачи 7.1 таких заголовков не было ни одного.
//
// Спрашивает она не своё правило, а сам js-yaml — тот же, которым читает
// сборка, — и сверяет не «разобралось без ошибки», а ЧТО разобралось: YAML
// умеет молча прочитать строку числом или датой.
function headProblems(allPosts, render) {
	const problems = [];
	for (const post of allPosts) {
		if (skipReason(post)) continue;
		const built = buildPost(post);
		problems.push(...frontmatterProblems(built, render(built)));
	}
	return problems;
}

// ——— Дату пишем так же, как её пишет админка ———
//
// БЕЗ КАВЫЧЕК: `date: 2026-08-09`. Образец берётся не из памяти, а из файла,
// который написала САМА Sveltia, — и если она однажды станет писать иначе,
// проверка скажет об этом, а не будет молча держать устаревшее правило.
//
// Оплачено: правило кавычек научили спрашивать сам разбор YAML — «прочитается
// ли обратно ровно то, что кладём?» — и дата честно ответила «нет, я читаюсь
// датой». Она закавычилась у всех 776 привезённых постов, схема это пережила,
// сборка прошла, и увидеть подмену можно было только глазами в файле. Цена —
// правка на пустом месте у каждого поста при первом же сохранении в админке.
const ADMIN_SAMPLE = 'src/content/posts/narisuy-eto-potom-umri.md';
const PLAIN_DATE = /^date: \d{4}-\d{2}-\d{2}$/;

function dateFormatProblems(allPosts, render) {
	const problems = [];

	const sample = readFileSync(join(root, ADMIN_SAMPLE), 'utf8').split(/^---$/m)[1] ?? '';
	const theirs = sample.split('\n').find((line) => line.startsWith('date:'));
	if (!theirs) problems.push(`в образце ${ADMIN_SAMPLE} нет строки даты — сверять не с чем`);
	else if (!PLAIN_DATE.test(theirs)) problems.push(`админка пишет дату иначе: «${theirs}» — правило устарело`);

	for (const post of allPosts) {
		if (skipReason(post)) continue;
		const built = buildPost(post);
		const ours = render(built).split(/^---$/m)[1].split('\n').find((line) => line.startsWith('date:'));
		if (!PLAIN_DATE.test(ours)) {
			problems.push(`№${built.id}: дата написана как «${ours}», а админка пишет её без кавычек`);
			break; // одного примера довольно: беда общая, а не у одного поста
		}
	}

	return problems;
}

// ——— Порции по годам: никого не потеряли и никого не задвоили ———
//
// Архив везётся годами, отдельным коммитом на порцию. Значит у отбора ровно две
// обязанности, и обе проверяются здесь на ЖИВОМ архиве, а не на выдуманном:
//
//   1. Порции всех годов вместе дают ВЕСЬ архив, и ни один пост не попадает
//      в две сразу. Это главная проверка: потерянный пост не появится нигде,
//      и заметить его пропажу будет некому — в отчёте порции его просто нет.
//   2. Год порции совпадает с датой, которая ЛЯЖЕТ В ФАЙЛ поста. Дату файла
//      считает `buildPost` своим путём, поэтому это не пересказ фильтра:
//      сломай `postYear` — и порция разойдётся с содержимым привезённых файлов,
//      а первая проверка этого не заметит вовсе (пост никуда не денется,
//      он просто уедет в чужой коммит).
//
// Отбор передаётся ПАРАМЕТРОМ ровно затем, чтобы самопроверка могла подсунуть
// сломанный и убедиться, что это ловится.
function portionProblems(allPosts, select) {
	const problems = [];
	const years = [...new Set(allPosts.map(postYear))].sort();
	const seen = new Map();

	for (const year of years) {
		for (const post of select(allPosts, { year })) {
			if (seen.has(post.id)) {
				problems.push(`пост №${post.id} попал сразу в две порции: ${seen.get(post.id)} и ${year}`);
				continue;
			}
			seen.set(post.id, year);

			const fileYear = buildPost(post).date.slice(0, 4);
			if (fileYear !== year) {
				problems.push(`пост №${post.id} едет в порции ${year}, а в файле у него дата ${buildPost(post).date}`);
			}
		}
	}

	for (const post of allPosts) {
		if (!seen.has(post.id)) problems.push(`пост №${post.id} (${post.caption.date.slice(0, 10)}) не попал ни в одну порцию`);
	}
	if (seen.size !== allPosts.length) problems.push(`в порциях постов ${seen.size}, а в архиве ${allPosts.length}`);

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

// ——— Бонус: разбор поста 4142 против того, что заказчик собрал руками ———
//
// САМАЯ СИЛЬНАЯ ПРОВЕРКА ИЗ ВОЗМОЖНЫХ. «Девушки-пони» — единственный бонусный
// пост на сайте, и заказчик сделал его РУКАМИ из телеграм-поста №4142: сам
// выбрал категорию, сам разложил ссылки по строкам поля «Ссылки площадок»,
// сам оставил «Закрытый TG-канал» пустым. Значит правильный ответ известен
// заранее и написан не мной. Разбор обязан повторить его буква в букву.

/** Четыре строки `bonusLinks` из готового файла поста. */
function bonusLinksFromFile(file) {
	const block = file.match(/^bonusLinks:\n((?:[ \t]+\S+:.*\n)+)/m);
	if (!block) return null;

	const links = {};
	for (const line of block[1].split('\n').filter(Boolean)) {
		const match = line.match(/^\s+(\w+):\s*(.*)$/);
		if (!match) continue;
		links[match[1]] = match[2].replace(/^'(.*)'$/, '$1').trim();
	}
	return links;
}

function post4142Problems(built, publishedFile) {
	const problems = [];

	if (built.category !== 'bonus') problems.push(`категория разобрана как «${built.category}», а пост бонусный`);

	const theirs = bonusLinksFromFile(publishedFile);
	if (!theirs) {
		problems.push('в посте «Девушки-пони» больше нет блока bonusLinks — образец для сверки устарел');
		return problems;
	}

	const ours = built.bonusLinks ?? {};
	for (const id of Object.keys(theirs)) {
		// Сравнение СТРОГОЕ, посимвольное. Смягчать его нельзя: у Patreon
		// в метке «поделиться» стоит `copyLink` с прописной буквой, и вся
		// разница между «адрес сохранён» и «адрес испорчен» — ровно в ней.
		if ((ours[id] ?? '') !== theirs[id]) {
			problems.push(`строка «${id}»:\n      наша:  ${ours[id] || '(пусто)'}\n      ваша:  ${theirs[id] || '(пусто)'}`);
		}
	}

	// Спрашиваем отдельно и прямо: сравнение выше промолчало бы, окажись
	// у нас лишняя строка, которой в вашем файле нет вовсе.
	for (const id of Object.keys(ours)) {
		if (!(id in theirs)) problems.push(`в разборе завелась лишняя строка «${id}»`);
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
	const allPosts = groupAlbums(messages);
	const post = allPosts.find((p) => p.id === 4143);
	if (!post) {
		console.error('В экспорте нет сообщения 4143 — сверять не с чем.');
		process.exit(1);
	}
	const built = buildPost(post);

	const publishedFile = readFileSync(join(root, 'src/content/posts/narisuy-eto-potom-umri.md'), 'utf8');
	const publishedBody = publishedFile.split(/^---$/m).slice(2).join('---');

	const bonusPost = allPosts.find((p) => p.id === 4142);
	if (!bonusPost) {
		console.error('В экспорте нет сообщения 4142 — бонусный пост сверять не с чем.');
		process.exit(1);
	}
	const bonusBuilt = buildPost(bonusPost);
	const bonusFile = readFileSync(
		join(root, 'src/content/posts/devushki-poni-seraya-zolushka-v-chem-sekret-populyarnosti.md'),
		'utf8',
	);

	if (!SELFTEST) {
		console.log('ПРОВЕРКИ РАЗБОРА ТЕЛЕГРАМА\n');
		let found = 0;
		found += report('правило заголовка, 11 подложенных случаев', titleProblems(TITLE_CASES));
		found += report('адреса страниц против настоящих файлов постов', slugProblems(SLUG_CASES));
		found += report('пост 4143 против опубликованного на сайте', post4143Problems(built, publishedBody));
		found += report('бонус 4142 против собранного вами руками', post4142Problems(bonusBuilt, bonusFile));
		found += report('снимки без подписи не оторваны от своего поста', orphanProblems(messages, groupAlbums));
		found += report('шапка каждого поста архива читается', headProblems(allPosts, (b) => renderPost(b)));
		found += report('дата написана так же, как её пишет админка', dateFormatProblems(allPosts, (b) => renderPost(b)));
		found += report('порции по годам на живом архиве', portionProblems(allPosts, selectPosts));
		found += report('текст доехал целиком — весь архив, слово в слово', textProblems(allPosts, entitiesToMarkdown));

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
		{
			name: 'бонус 4142: категория съехала на «Заметку»',
			problems: post4142Problems({ ...bonusBuilt, category: 'note' }, bonusFile),
		},
		{
			name: 'бонус 4142: адрес приведён к нижнему регистру (copyLink → copylink)',
			problems: post4142Problems(
				{ ...bonusBuilt, bonusLinks: Object.fromEntries(Object.entries(bonusBuilt.bonusLinks).map(([k, v]) => [k, v.toLowerCase()])) },
				bonusFile,
			),
		},
		{
			name: 'бонус 4142: в «Закрытый TG-канал» вписан общий адрес',
			problems: post4142Problems(
				{ ...bonusBuilt, bonusLinks: { ...bonusBuilt.bonusLinks, tgClosed: 'https://t.me/tribute/app?startapp=s26z' } },
				bonusFile,
			),
		},
		{
			name: 'бонус 4142: ссылка на Boosty потерялась',
			problems: post4142Problems({ ...bonusBuilt, bonusLinks: { ...bonusBuilt.bonusLinks, boosty: '' } }, bonusFile),
		},
		{
			// ПРЕЖНЯЯ СКЛЕЙКА, слово в слово: прирастать умеет только вперёд,
			// подпись обязана быть у первого сообщения пачки. Это не выдуманная
			// поломка, а та, что прожила в коде от задачи 7.1 до 10 августа 2026.
			name: 'альбомы: подпись обязана стоять первой (как было до починки)',
			problems: orphanProblems(messages, (list) => {
				const posts = [];
				for (const message of list) {
					const last = posts.at(-1);
					const prev = last?.members.at(-1);
					const own = (message.text_entities ?? []).map((e) => e.text ?? '').join('').trim();
					const media = Boolean(message.photo || message.media_type || message.file);
					const near =
						prev &&
						message.id > prev.id &&
						message.id - prev.id <= ALBUM_ID_GAP &&
						Number(message.date_unixtime) - Number(prev.date_unixtime) <= ALBUM_SECONDS_GAP;
					if (near && !own && media && message.type === 'message') {
						last.members.push(message);
						continue;
					}
					posts.push({ id: message.id, members: [message], caption: message });
				}
				return posts;
			}),
		},
		{
			// РОВНО ТА ПОЛОМКА, ЧТО УРОНИЛА СБОРКУ: заголовок с двоеточием
			// на конце записан без кавычек. Для YAML это начало вложенного
			// словаря, и файл перестаёт читаться целиком.
			name: 'шапка: заголовок записан без кавычек (как было до починки)',
			problems: headProblems(allPosts, (b) =>
				renderPost(b).replace(/^title: '(.*)'$/m, (_, t) => 'title: ' + t.replace(/''/g, "'")),
			),
		},
		{
			name: 'шапка: дата закавычена (как вышло на порции 2023 года)',
			problems: dateFormatProblems(allPosts, (b) =>
				renderPost(b).replace(/^date: (.+)$/m, "date: '$1'"),
			),
		},
		// ПОДЛОГИ ТЕКСТА — ЭТО РОВНО ТО, КАК РАЗБОР БЫЛ НАПИСАН ДО 10 АВГУСТА 2026.
		// Не выдуманная поломка, а настоящая, прожившая в коде от задачи 7.1:
		// на последней сотне постов она не проявлялась почти никак, а на архиве
		// испортила бы 103 поста и 52 ссылки. Проверка обязана видеть её.
		{
			name: 'текст: пробелы съедены внутри разметки (как было до починки)',
			problems: textProblems(allPosts, (entities) =>
				(entities ?? [])
					.map((e) => (e.type === 'bold' && (e.text ?? '').trim() ? `**${e.text.trim()}**` : (e.text ?? '')))
					.join(''),
			),
		},
		{
			name: 'текст: подпись ссылки развалилась о пустую строку (как было до починки)',
			problems: textProblems(allPosts, (entities) =>
				(entities ?? []).map((e) => (e.type === 'text_link' ? `[${e.text}](${e.href})` : (e.text ?? ''))).join(''),
			),
		},
		{
			name: 'текст: у каждого поста потерян последний абзац',
			problems: textProblems(allPosts, (entities) => entitiesToMarkdown(entities).split('\n\n').slice(0, -1).join('\n\n')),
		},
		// ПОДЛОГИ ОТБОРА НАПИСАНЫ ТАК, КАК ЭТО ПИШУТ В ЖИЗНИ, а не так, как удобно
		// проверке. Первые три — настоящие способы промахнуться с годом; четвёртый
		// проверяет ВТОРУЮ половину проверки отдельно: пост, уехавший в чужую
		// порцию, не теряется и не двоится, и первая половина о нём промолчит.
		{
			name: 'порции: год взят диапазоном дат, а верхняя граница без времени',
			problems: portionProblems(allPosts, (posts, { year }) =>
				posts.filter((p) => p.caption.date >= `${year}-01-01` && p.caption.date <= `${year}-12-31`),
			),
		},
		{
			name: 'порции: год сравнивается числом, а из ключа приходит строка',
			problems: portionProblems(allPosts, (posts, { year }) => posts.filter((p) => postYear(p) === Number(year))),
		},
		{
			name: 'порции: отбор отдаёт весь архив каждому году',
			problems: portionProblems(allPosts, (posts) => posts),
		},
		{
			name: 'порции: один пост уехал в чужой год',
			problems: portionProblems(allPosts, (posts, { year }) =>
				posts.filter((p) => (p.id === 5 ? year === '2023' : postYear(p) === String(year))),
			),
		},
		{
			name: 'бонус 4142: метка «поделиться» отрезана от адреса',
			problems: post4142Problems(
				{ ...bonusBuilt, bonusLinks: { ...bonusBuilt.bonusLinks, boosty: bonusBuilt.bonusLinks.boosty.split('?')[0] } },
				bonusFile,
			),
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
