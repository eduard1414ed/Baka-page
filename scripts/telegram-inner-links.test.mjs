#!/usr/bin/env node
// Проверки переписывания ссылок внутрь канала (тз/07, задача 7.3).
//
// ФАЙЛОМ, А НЕ ОДНОСТРОЧНИКОМ `node -e`: обратный слэш внутри однострочника
// проходит через две системы экранирования подряд, выражение перестаёт
// совпадать с чем бы то ни было, и проверка отвечает «ничего не найдено» —
// то есть врёт ровно в сторону «всё хорошо». За проект так уже врали дважды.
//
// РЕЖИМ --selftest СУЩЕСТВУЕТ В КОДЕ, а не только в этом заголовке. Он ломает
// данные и правило нарочно и требует, чтобы КАЖДАЯ проверка покраснела.
// Проверок, которые не могут провалиться, в проекте нашлось шесть, и все они
// врали в сторону «всё хорошо».
//
//   node scripts/telegram-inner-links.test.mjs --export=<папка ChatExport_…>
//   node scripts/telegram-inner-links.test.mjs --export=<…> --selftest

import { readFileSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { groupAlbums } from './telegram-import.mjs';
import {
	channelMessageId,
	labelIsAddress,
	linksOf,
	rewriteBody,
	writeProblems,
	buildMessageMap,
	readPosts,
	captionsOf,
	postAddress,
} from './telegram-inner-links.mjs';
import { brokenLinks } from '../src/plugins/post-links-integration.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback = null) => {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
};
const SELFTEST = process.argv.includes('--selftest');

// ——— Подложенные случаи, написанные ЖИВЫМ СИНТАКСИСОМ ———
//
// То есть ровно так, как эти ссылки стоят в привезённых постах, а не так, как
// удобно проверке. Подлог, повторяющий формулировку правила, проверяет
// не правило, а собственную аккуратность.
//
// Карта целей нарочно маленькая и разная по природе: 682 — обычный пост,
// 357 — СНИМОК альбома, чья подпись лежит у сообщения 356, 4112 —
// опубликованный пост. Номера 9999 в карте нет вовсе.

const MAP = new Map([
	[682, { slug: 'obsuzhdali-v-podkaste', draft: true, viaCaption: true }],
	[356, { slug: 'lyubuemsya', draft: true, viaCaption: true }],
	[357, { slug: 'lyubuemsya', draft: true, viaCaption: false }],
	[4112, { slug: 'korolevskie-kosmicheskie-sily', draft: false, viaCaption: true }],
]);
const lookup = (id) => MAP.get(id);

const CASES = [
	{
		name: 'обычная ссылка на пост канала — адрес переписан, слова целы',
		body: 'Зато это аниме (которое мы [обсуждали в подкасте](https://t.me/podcastbaka/682)) постоянно удивляет.',
		want: 'Зато это аниме (которое мы [обсуждали в подкасте](/posts/obsuzhdali-v-podkaste/)) постоянно удивляет.',
		rewritten: 1,
	},
	{
		name: 'ссылка на СНИМОК альбома ведёт на пост его подписи',
		body: 'Подробнее — [в этом посте](https://t.me/podcastbaka/357).',
		want: 'Подробнее — [в этом посте](/posts/lyubuemsya/).',
		rewritten: 1,
	},
	{
		name: 'ссылка на несуществующий номер остаётся вести в телеграм',
		body: 'Я писал об этом [здесь](https://t.me/podcastbaka/9999).',
		want: 'Я писал об этом [здесь](https://t.me/podcastbaka/9999).',
		rewritten: 0,
		left: ['noTarget'],
	},
	{
		name: 'ссылка на чужой канал не тронута',
		body: 'Читайте [Некомату](https://t.me/nekomatawithtea/512) и [Трэш](https://t.me/in_da_tresh/77).',
		want: 'Читайте [Некомату](https://t.me/nekomatawithtea/512) и [Трэш](https://t.me/in_da_tresh/77).',
		rewritten: 0,
		left: [],
	},
	{
		// t.me/bakapodcast — ДРУГОЕ имя, не наш канал. Отличается перестановкой
		// двух слов, и правило обязано это видеть.
		name: 'похожее имя канала (bakapodcast против podcastbaka) не тронуто',
		body: 'Наш бот — [@bakapodcast_bot](https://t.me/bakapodcast_bot) и [канал](https://t.me/bakapodcast/12).',
		want: 'Наш бот — [@bakapodcast_bot](https://t.me/bakapodcast_bot) и [канал](https://t.me/bakapodcast/12).',
		rewritten: 0,
		left: [],
	},
	{
		name: 'ссылка на сам канал без номера не тронута',
		body: 'Наш потрясающий телеграм-канал: [подписаться](https://t.me/podcastbaka)',
		want: 'Наш потрясающий телеграм-канал: [подписаться](https://t.me/podcastbaka)',
		rewritten: 0,
		left: [],
	},
	{
		name: 'ссылка на закрытый чат по приглашению не тронута',
		body: 'Заходите в [чат](https://t.me/+nz2JG4WhGvQ2NjMy) и на [tribute](https://t.me/tribute/app?startapp=s26z).',
		want: 'Заходите в [чат](https://t.me/+nz2JG4WhGvQ2NjMy) и на [tribute](https://t.me/tribute/app?startapp=s26z).',
		rewritten: 0,
		left: [],
	},
	{
		name: 'две ссылки в одном абзаце — переписаны обе',
		body: 'Как первый том [переиздавался](https://t.me/podcastbaka/682) и как по нему [уже выходит](https://t.me/podcastbaka/357) манга.',
		want: 'Как первый том [переиздавался](/posts/obsuzhdali-v-podkaste/) и как по нему [уже выходит](/posts/lyubuemsya/) манга.',
		rewritten: 2,
	},
	{
		name: 'ссылка внутри заголовка переписана',
		body: '## [Итоги года](https://t.me/podcastbaka/682)\n\nТекст под заголовком.',
		want: '## [Итоги года](/posts/obsuzhdali-v-podkaste/)\n\nТекст под заголовком.',
		rewritten: 1,
	},
	{
		name: 'ссылка внутри жирного и курсива переписана, разметка цела',
		body: 'Это **важно: [читайте тут](https://t.me/podcastbaka/682)** и *[тут тоже](https://t.me/podcastbaka/356)*.',
		want: 'Это **важно: [читайте тут](/posts/obsuzhdali-v-podkaste/)** и *[тут тоже](/posts/lyubuemsya/)*.',
		rewritten: 2,
	},
	{
		// Видимый текст — сам адрес. Переписать цель значило бы показать читателю
		// «t.me», а увести его на bakapodcast.com.
		name: 'голый адрес в тексте не тронут',
		body: '1. Операторская работа в «Семье шпиона»\nhttps://t.me/podcastbaka/682\n\n2. Дальше по списку.',
		want: '1. Операторская работа в «Семье шпиона»\nhttps://t.me/podcastbaka/682\n\n2. Дальше по списку.',
		rewritten: 0,
		left: ['labelIsAddress'],
	},
	{
		name: 'подпись ссылки набрана самим адресом — не тронуто',
		body: 'Ролик тут: [https://t.me/podcastbaka/682](https://t.me/podcastbaka/682)',
		want: 'Ролик тут: [https://t.me/podcastbaka/682](https://t.me/podcastbaka/682)',
		rewritten: 0,
		left: ['labelIsAddress'],
	},
	{
		name: 'квадратная скобка в подписи не сбивает правку',
		body: 'Смотрите [обзор \\[часть 2\\]](https://t.me/podcastbaka/682) целиком.',
		want: 'Смотрите [обзор \\[часть 2\\]](/posts/obsuzhdali-v-podkaste/) целиком.',
		rewritten: 1,
	},
	{
		name: 'ссылка на этот же пост остаётся как есть',
		body: 'Продолжение [прошлого поста](https://t.me/podcastbaka/682).',
		own: 'obsuzhdali-v-podkaste',
		want: 'Продолжение [прошлого поста](https://t.me/podcastbaka/682).',
		rewritten: 0,
		left: ['selfLink'],
	},
	{
		name: 'адрес с хвостом (?comment=) тоже узнаётся',
		body: 'Обсуждение [вот здесь](https://t.me/podcastbaka/682?comment=15).',
		want: 'Обсуждение [вот здесь](/posts/obsuzhdali-v-podkaste/).',
		rewritten: 1,
	},
	{
		name: 'уже переписанная ссылка второй раз не трогается',
		body: 'Зато это аниме (которое мы [обсуждали в подкасте](/posts/obsuzhdali-v-podkaste/)) удивляет.',
		want: 'Зато это аниме (которое мы [обсуждали в подкасте](/posts/obsuzhdali-v-podkaste/)) удивляет.',
		rewritten: 0,
		left: [],
	},
];

function caseProblems(cases, rewrite) {
	const problems = [];
	for (const item of cases) {
		const got = rewrite(item.body, lookup, item.own ?? 'chuzhoy-post');
		if (got.body !== item.want) {
			problems.push(`«${item.name}»:\n      ждали: ${item.want}\n      вышло: ${got.body}`);
		}
		if (got.rewritten.length !== item.rewritten) {
			problems.push(`«${item.name}»: переписано ${got.rewritten.length}, а ждали ${item.rewritten}`);
		}
		if (item.left) {
			const reasons = got.left.map((l) => l.reason).sort().join(',');
			const want = [...item.left].sort().join(',');
			if (reasons !== want) problems.push(`«${item.name}»: оставлено по причинам [${reasons}], а ждали [${want}]`);
		}
	}
	return problems;
}

// ——— Опубликованный пост не трогается ВООБЩЕ ———
//
// Это правило проекта, и проверяется оно не рассуждением, а прогоном скрипта
// на КОПИЯХ постов: настоящие файлы при этом не трогаются вовсе. Сверяется
// побайтно — «не изменился» здесь значит «ни одного байта».

function sandbox(files) {
	const dir = mkdtempSync(join(tmpdir(), 'baka-links-'));
	for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, 'utf8');
	return dir;
}

const head = (fields) => '---\n' + Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n\n';

const SANDBOX_FILES = {
	'opublikovannyy.md':
		head({ title: "'Знакомьтесь: Ёдзи Такэсигэ'", date: '2026-07-27', category: 'note', draft: false, tgId: 4200 }) +
		'Про это я писал [в прошлом посте](https://t.me/podcastbaka/682).\n',
	'chernovik.md':
		head({ title: "'Обычный черновик'", date: '2026-07-28', category: 'note', draft: true, tgId: 4201 }) +
		'Про это я писал [в прошлом посте](https://t.me/podcastbaka/682).\n',
	'obsuzhdali-v-podkaste.md':
		head({ title: "'Обсуждали в подкасте'", date: '2022-09-01', category: 'note', draft: true, tgId: 682 }) +
		'Текст поста-цели.\n',
};

/**
 * Прогон правила по песочнице. Возвращает содержимое файлов после прогона.
 *
 * Повторяет то, что делает `main`, кроме отчёта: отбор черновиков, правку
 * и заслон, включая порядок «сначала вся порция в памяти, потом на диск».
 * Второй копией правила это не является — правку и заслон считают
 * `rewriteBody` и `writeProblems`, те же самые.
 */
function runOn(dir, { onlyDrafts = true } = {}) {
	const posts = readPosts(dir);
	const map = buildMessageMap(captionsOf(posts), []);
	const problems = [];
	const prepared = [];

	for (const post of posts) {
		if (onlyDrafts && !post.draft) continue;
		const result = rewriteBody(post.body, (id) => map.get(id), post.slug);
		if (!result.rewritten.length) continue;
		const text = post.text.split(/^---$/m).slice(0, 2).join('---') + '---' + result.body;
		problems.push(...writeProblems(post.slug, post.text, text, result.rewritten));
		prepared.push({ post, text });
	}

	if (!problems.length) for (const { post, text } of prepared) writeFileSync(post.file, text, 'utf8');

	const after = {};
	for (const name of readdirSync(dir)) after[name] = readFileSync(join(dir, name), 'utf8');
	return { after, problems };
}

function publishedProblems(runner) {
	const dir = sandbox(SANDBOX_FILES);
	try {
		const { after } = runner(dir);
		const problems = [];

		if (after['opublikovannyy.md'] !== SANDBOX_FILES['opublikovannyy.md']) {
			problems.push('опубликованный пост изменён, а трогать его запрещено');
		}
		if (!after['chernovik.md'].includes('](/posts/obsuzhdali-v-podkaste/)')) {
			problems.push('в черновике адрес не переписан');
		}

		// ВТОРОЙ ПРОГОН НЕ МЕНЯЕТ НИ ОДНОГО ФАЙЛА. Проверяется запуском,
		// а не рассуждением: правило «переписанная ссылка больше не t.me»
		// звучит очевидно ровно до первой ошибки в нём.
		const second = runner(dir).after;
		for (const name of Object.keys(after)) {
			if (second[name] !== after[name]) problems.push(`второй прогон изменил ${name}`);
		}

		return problems;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ——— Заслон обязан ловить правку, которая задела не адрес ———
//
// Он и есть главная страховка задачи: правятся полторы тысячи существующих
// файлов, и съеденное слово в теле не заметит никто и никогда. Значит заслон
// надо не описать, а УРОНИТЬ — четырьмя способами, каждый из которых
// в жизни выглядел бы как обычная опечатка в правке.

const GOOD_OLD = head({ title: "'Пост'", date: '2026-01-01', category: 'note', draft: true, tgId: 1 }) +
	'Текст со [ссылкой](https://t.me/podcastbaka/682) внутри.\n';
const GOOD_PLAN = [{ from: 'https://t.me/podcastbaka/682', to: '/posts/obsuzhdali-v-podkaste/' }];
const GOOD_NEW = GOOD_OLD.replace('https://t.me/podcastbaka/682', '/posts/obsuzhdali-v-podkaste/');

const GUARD_TRAPS = [
	{ name: 'заслон: вместе с адресом съедено слово подписи', text: GOOD_NEW.replace('[ссылкой]', '[ссылк]') },
	{ name: 'заслон: тронута шапка', text: GOOD_NEW.replace('category: note', 'category: bonus') },
	{ name: 'заслон: шапка стала нечитаемой', text: GOOD_NEW.replace("title: 'Пост'", 'title: Пост: и двоеточие') },
	{ name: 'заслон: переписан не тот адрес', text: GOOD_OLD.replace('https://t.me/podcastbaka/682', '/posts/chuzhoy-post/') },
	{ name: 'заслон: ссылка потерялась целиком', text: GOOD_OLD.replace('[ссылкой](https://t.me/podcastbaka/682)', 'ссылкой') },
];

const guardProblems = (check) => check('post', GOOD_OLD, GOOD_NEW, GOOD_PLAN);

// ——— Живой архив: правка не задевает ничего, кроме адресов ———
//
// САМАЯ СИЛЬНАЯ ИЗ ПРОВЕРОК, потому что спрашивает не про выдуманные случаи,
// а про полторы тысячи настоящих файлов. Заслон гоняется по всем постам,
// которые правило собирается тронуть, — и молчание здесь означает, что
// видимый текст, шапка и все остальные ссылки остались на местах.

function archiveProblems(postsDir, exportDir, rewrite) {
	const posts = readPosts(postsDir);
	const albums = groupAlbums(JSON.parse(readFileSync(join(exportDir, 'result.json'), 'utf8')).messages);
	const map = buildMessageMap(captionsOf(posts), albums);
	const problems = [];
	let touched = 0;

	for (const post of posts) {
		if (!post.draft) continue;
		const result = rewrite(post.body, (id) => map.get(id), post.slug);
		if (!result.rewritten.length) continue;
		touched += 1;
		const text = post.text.split(/^---$/m).slice(0, 2).join('---') + '---' + result.body;
		problems.push(...writeProblems(post.slug, post.text, text, result.rewritten));
	}

	// Проверка, которая не может провалиться, — ложь в сторону «всё хорошо».
	// Если правило вдруг перестало находить хоть что-нибудь, молчание заслона
	// не значит ничего, и об этом надо сказать вслух.
	if (touched === 0) problems.push('правило не тронуло ни одного поста — заслону нечего было проверять');
	return problems;
}

// ——— Карта строится не по одному tgId ———
//
// Ссылка в тексте указывает на ТО сообщение, которое автор видел, а подпись
// альбома с 2022 по 2023 год часто доставалась не первому снимку. Спрашивай
// карта один `tgId` — часть ссылок молча не нашла бы цели.
//
// Проверок здесь ДВЕ, и вторая нарочно гоняется на выдуманных данных, а не
// на живых. В нынешнем архиве столкновений «снимок одного альбома = подпись
// другого поста» ноль — то есть на живых данных эта проверка не смогла бы
// провалиться ни при какой поломке порядка, а значит не проверяла бы ничего.
// Столкновение подкладывается руками, и тогда порядок «подписи первыми»
// становится настоящим утверждением.

function mapPhotoProblems(build, albums, captions) {
	const map = build(captions, albums);
	let viaPhoto = 0;
	for (const value of map.values()) if (!value.viaCaption) viaPhoto += 1;
	return viaPhoto === 0 ? ['в карте нет ни одного снимка альбома — она построена по одному tgId'] : [];
}

// Пост «первый» — альбом из трёх сообщений с подписью у первого. Номер 401 —
// его снимок И одновременно подпись поста «второй»: ровно тот случай, ради
// которого подписи раскладываются раньше снимков.
const CLASH_CAPTIONS = new Map([
	[400, { slug: 'pervyy', draft: true }],
	[401, { slug: 'vtoroy', draft: true }],
]);
const CLASH_ALBUMS = [{ id: 400, members: [{ id: 400 }, { id: 401 }, { id: 402 }] }];

function mapOrderProblems(build) {
	const map = build(CLASH_CAPTIONS, CLASH_ALBUMS);
	const problems = [];
	for (const [id, post] of CLASH_CAPTIONS) {
		const got = map.get(id);
		if (got?.slug !== post.slug) problems.push(`номер ${id} — подпись поста «${post.slug}», а карта ведёт на «${got?.slug ?? '(никуда)'}»`);
	}
	if (map.get(402)?.slug !== 'pervyy') problems.push('снимок 402 не приписан к своему посту');
	return problems;
}

// ——— Предупреждение сборки: ссылки в никуда у опубликованных ———
//
// НА ЖИВЫХ ДАННЫХ ЭТА ПРОВЕРКА МОЛЧИТ И БУДЕТ МОЛЧАТЬ ДОЛГО: сейчас ни один
// опубликованный пост не ссылается на черновик. Значит спрашивать её надо
// на выдуманных постах — иначе она ничем не отличалась бы от сломанной.
//
// Случаев пять, и молчание в двух последних так же важно, как ругань в первых
// трёх: проверка, которая ругается на всё подряд, перестаёт что-либо значить
// через две сессии.

const post = (fields) => ({ draft: false, external: false, title: 'Пост', body: '', ...fields });

const WARN_CASES = [
	{
		name: 'опубликованный ссылается на черновик — обязана заругаться',
		posts: new Map([
			['opublikovannyy', post({ body: 'Читайте [прошлый пост](/posts/chernovik/).' })],
			['chernovik', post({ draft: true })],
		]),
		want: 1,
	},
	{
		name: 'опубликованный ссылается на несуществующий пост — обязана заругаться',
		posts: new Map([['opublikovannyy', post({ body: 'Читайте [это](/posts/takogo-net/).' })]]),
		want: 1,
	},
	{
		name: 'опубликованный ссылается на пост-ссылку (страницы у неё нет) — обязана заругаться',
		posts: new Map([
			['opublikovannyy', post({ body: 'Читайте [это](/posts/na-kinopoiske/).' })],
			['na-kinopoiske', post({ external: true })],
		]),
		want: 1,
	},
	{
		name: 'опубликованный ссылается на опубликованный — обязана молчать',
		posts: new Map([
			['opublikovannyy', post({ body: 'Читайте [это](/posts/drugoy/).' })],
			['drugoy', post({})],
		]),
		want: 0,
	},
	{
		name: 'ЧЕРНОВИК ссылается на черновик — обязана молчать',
		posts: new Map([
			['chernovik-odin', post({ draft: true, body: 'Читайте [это](/posts/chernovik-dva/).' })],
			['chernovik-dva', post({ draft: true })],
		]),
		want: 0,
	},
];

function warnProblems(cases, check) {
	const problems = [];
	for (const item of cases) {
		const got = check(item.posts).length;
		if (got !== item.want) problems.push(`«${item.name}»: сказано про ${got} ссылок, а ждали ${item.want}`);
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
	for (const p of problems.slice(0, 20)) console.log(`    • ${p}`);
	if (problems.length > 20) console.log(`    … и ещё ${problems.length - 20}`);
	return problems.length;
}

async function main() {
	const exportDir = arg('export');
	if (!exportDir) {
		console.error('Нужен ключ --export=<папка ChatExport_…>');
		process.exit(1);
	}
	const postsDir = join(root, 'src/content/posts');
	const posts = readPosts(postsDir);
	const albums = groupAlbums(JSON.parse(readFileSync(join(exportDir, 'result.json'), 'utf8')).messages);
	const captions = captionsOf(posts);

	if (!SELFTEST) {
		console.log('ПРОВЕРКИ ССЫЛОК ВНУТРЬ КАНАЛА\n');
		let found = 0;
		found += report(`правило правки, ${CASES.length} подложенных случаев живым синтаксисом`, caseProblems(CASES, rewriteBody));
		found += report('опубликованный пост не тронут, второй прогон ничего не меняет', publishedProblems(runOn));
		found += report('карта берёт и снимки альбома, а не один tgId', mapPhotoProblems(buildMessageMap, albums, captions));
		found += report('подпись сильнее снимка (подложенное столкновение номеров)', mapOrderProblems(buildMessageMap));
		found += report('заслон молчит на здоровой правке', guardProblems(writeProblems));
		found += report(`предупреждение сборки о ссылках в никуда, ${WARN_CASES.length} случаев`, warnProblems(WARN_CASES, brokenLinks));
		found += report('живой архив: правка не задевает ничего, кроме адресов', archiveProblems(postsDir, exportDir, rewriteBody));

		console.log(
			found === 0
				? '\nВсё сошлось. Чтобы убедиться, что проверки вообще умеют находить, — запустите с ключом --selftest.'
				: `\nВСЕГО РАСХОЖДЕНИЙ: ${found}`,
		);
		process.exit(found === 0 ? 0 : 1);
	}

	// ——— Самопроверка проверок ———
	//
	// Каждой подсовывается заведомо испорченное правило или данные, и она
	// ОБЯЗАНА заругаться. Молчание здесь — не «всё хорошо», а «проверка мертва».
	console.log('САМОПРОВЕРКА: ломаю нарочно, проверки обязаны это поймать\n');

	// Сломанные правила написаны так, как их пишут в жизни, а не так, как ждёт
	// проверка: это разные способы ошибиться, каждый по-своему правдоподобный.
	//
	// Оба правила разбора адреса подсовываются ПАРАМЕТРОМ — тем самым, который
	// у `rewriteBody` заведён ровно для этого.

	/** Имя канала в адресе не проверяется: годится любой `t.me/что-угодно/N`. */
	const anyChannelId = (url) => {
		const m = String(url).match(/^(?:https?:\/\/)?t\.me\/[^/]+\/(\d+)/i);
		return m ? Number(m[1]) : null;
	};

	const traps = [
		{
			name: 'правка: снимок альбома целью не считается (карта по одному tgId)',
			problems: caseProblems(CASES, (body, look, own) =>
				rewriteBody(body, (id) => (look(id)?.viaCaption ? look(id) : undefined), own),
			),
		},
		{
			name: 'правка: имя канала в адресе не проверяется (годится любой t.me/…/N)',
			problems: caseProblems(CASES, (body, look, own) => rewriteBody(body, look, own, { messageId: anyChannelId })),
		},
		{
			name: 'правка: голый адрес переписывается наравне с остальными',
			problems: caseProblems(CASES, (body, look, own) => rewriteBody(body, look, own, { blockedLabel: () => false })),
		},
		{
			name: 'правка: подпись ссылки обрезана вместе с адресом',
			problems: caseProblems(CASES, (body, look, own) => {
				const out = rewriteBody(body, look, own);
				return { ...out, body: out.body.replace(/\[([^\]]{3})[^\]]*\]\(\/posts\//g, '[$1](/posts/') };
			}),
		},
		{
			name: 'правило: опубликованные посты правятся наравне с черновиками',
			problems: publishedProblems((dir) => runOn(dir, { onlyDrafts: false })),
		},
		{
			name: 'карта: построена по одному tgId, снимки альбома забыты',
			problems: mapPhotoProblems((caps) => new Map([...caps].map(([id, p]) => [id, { ...p, viaCaption: true }])), albums, captions),
		},
		{
			name: 'карта: снимки раскладываются раньше подписей',
			problems: mapOrderProblems((caps, alb) => {
				const map = new Map();
				const membersOf = new Map(alb.map((a) => [a.id, a.members.map((m) => m.id)]));
				// Сначала снимки, потом подписи — то есть ровно наоборот.
				for (const [id, post] of caps) for (const m of membersOf.get(id) ?? []) map.set(m, { ...post, viaCaption: false });
				for (const [id, post] of caps) if (!map.has(id)) map.set(id, { ...post, viaCaption: true });
				return map;
			}),
		},
		...GUARD_TRAPS.map((trap) => ({
			name: trap.name,
			problems: writeProblems('post', GOOD_OLD, trap.text, GOOD_PLAN),
		})),
		{
			name: 'живой архив: правка сдвигает адрес на символ',
			problems: archiveProblems(postsDir, exportDir, (body, look, own) => {
				const out = rewriteBody(body, look, own);
				return { ...out, body: out.body.replace('](/posts/', '](posts/') };
			}),
		},
		{
			name: 'предупреждение: черновики спрашиваются наравне с опубликованными',
			problems: warnProblems(WARN_CASES, (posts) =>
				brokenLinks(new Map([...posts].map(([slug, p]) => [slug, { ...p, draft: false }]))),
			),
		},
		{
			name: 'предупреждение: цель-черновик считается годной',
			problems: warnProblems(WARN_CASES, (posts) =>
				brokenLinks(posts).filter((b) => b.why !== 'ещё черновик'),
			),
		},
		{
			name: 'предупреждение: ссылки на посты не находятся вовсе',
			problems: warnProblems(WARN_CASES, () => []),
		},
		{
			name: 'живой архив: правило вдруг ничего не находит',
			problems: archiveProblems(postsDir, exportDir, (body) => ({ body, rewritten: [], left: [] })),
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

// Держим связь с разбором явной: обе функции — часть проверяемого правила.
void channelMessageId;
void labelIsAddress;
void linksOf;
void postAddress;
