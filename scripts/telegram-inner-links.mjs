#!/usr/bin/env node
// Ссылки внутрь канала → ссылки внутрь сайта (тз/07, задача 7.3).
//
// В телах привезённых постов автор ссылался на свои же прошлые посты
// (`t.me/podcastbaka/<номер>`). Теперь эти посты есть на сайте, и ссылка
// обязана вести на свою страницу, а не уводить читателя обратно в телеграм.
//
// УСТРОЙСТВО ТАКОЕ ЖЕ, КАК У ОСТАЛЬНЫХ РАЗОВЫХ СКРИПТОВ ПРОЕКТА
// (telegram-import.mjs, timecodes-from-body.mjs, cover-cutout.mjs): без ключей —
// разведка и отчёт, в репозиторий не пишется ничего; запись отдельным ключом
// и отдельным запуском.
//
//   --export=<папка>   папка ChatExport_… с result.json (обязателен)
//   --year=2022        порция: посты этого года
//   --all              порция: все посты
//   --write            переписать адреса
//   --posts=<папка>    где лежат посты (по умолчанию src/content/posts)
//
// ПОРЦИЮ НАДО НАЗВАТЬ ЯВНО, умолчания нет — как у импорта. Здесь правятся
// СУЩЕСТВУЮЩИЕ файлы, а не создаются новые, поэтому цена ошибки выше: откатить
// коммит по году можно, разобраться в правке полутора тысяч файлов — нет.
//
// ЧЕГО ЭТОТ СКРИПТ НЕ ДЕЛАЕТ. Не трогает опубликованные посты (правило проекта:
// импорт в опубликованное не пишет никогда), не меняет ни одного слова текста —
// только адрес внутри ссылки, не публикует и не трогает шапку поста.
//
// ПОВТОРЯЕМОСТЬ: второй прогон не меняет ни одного файла. Переписанная ссылка
// ведёт уже не на t.me, и правило её просто не видит.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString as mdToString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';
import { groupAlbums } from './telegram-import.mjs';
import { manualTelegramPosts } from '../src/data/telegramImported.mjs';

const CHANNEL = 'podcastbaka';

// АДРЕС СТРАНИЦЫ ПОСТА СЧИТАЕТСЯ ЗДЕСЬ ОДНОЙ СТРОКОЙ и совпадает с тем, что
// отдаёт `postHref` в src/lib/externalPost.mjs. Импортировать его оттуда нельзя:
// та функция принимает объект коллекции Astro, а у нас на руках только файлы.
export const postAddress = (slug) => `/posts/${slug}/`;

/**
 * Ссылка ведёт на пост этого канала? Отдаёт номер сообщения или null.
 *
 * ЧУЖИЕ КАНАЛЫ И ЧАТ НЕ ТРОГАЕМ, И ССЫЛКУ НА САМ КАНАЛ БЕЗ НОМЕРА ТОЖЕ:
 * первая ведёт не к нам, вторая — на канал целиком, и заменять её нечем.
 * В архиве рядом живут `t.me/bakapodcast` (другое имя!), `t.me/bakapodcast_bot`,
 * `t.me/tribute/app` и десяток чужих каналов — все они обязаны остаться.
 */
export function channelMessageId(url) {
	const match = String(url).match(
		new RegExp(`^(?:https?://)?(?:www\\.)?t\\.me/${CHANNEL}/(\\d+)(?:[?#/].*)?$`, 'i'),
	);
	return match ? Number(match[1]) : null;
}

const md = unified().use(remarkParse).use(remarkGfm);

/**
 * Все ссылки тела с их местом в исходном тексте.
 *
 * СПРАШИВАЕМ РАЗБОР, А НЕ РЕГУЛЯРНОЕ ВЫРАЖЕНИЕ. Своё выражение по markdown
 * в этом проекте врало уже дважды — на подписи со скобкой внутри и на адресе
 * со скобками. Тот же движок (remark + gfm), которым собирается сайт, честно
 * отличает настоящую ссылку от квадратной скобки в тексте и заодно ловит голый
 * адрес (gfm превращает его в такую же ссылку).
 */
export function linksOf(body) {
	const tree = md.parse(body);
	const out = [];
	visit(tree, 'link', (node) => {
		if (!node.position) return;
		out.push({
			url: node.url,
			label: mdToString(node),
			start: node.position.start.offset,
			end: node.position.end.offset,
		});
	});
	// По порядку в тексте: правка идёт вырезкой по месту, и порядок здесь —
	// не украшение, а условие правильности.
	return out.sort((a, b) => a.start - b.start);
}

/**
 * ВИДИМЫЙ ТЕКСТ ССЫЛКИ САМ ЯВЛЯЕТСЯ АДРЕСОМ КАНАЛА — такую не трогаем.
 *
 * Два требования заказчика здесь сталкиваются, и выполнить оба нельзя: «текст
 * ссылки не трогать» и «ссылка ведёт на сайт». Голый адрес в тексте
 * (`https://t.me/podcastbaka/194` строкой в списке материалов) и подпись,
 * набранная самим адресом (`[https://t.me/…/2274](https://t.me/…/2274)`) —
 * это одно и то же: читатель ВИДИТ адрес телеграма. Перепиши мы только цель —
 * на экране осталось бы «t.me», а нажатие уводило бы на bakapodcast.com.
 * Это хуже, чем ссылка, ведущая туда, куда написано.
 *
 * Поэтому такие остаются как есть и НАЗЫВАЮТСЯ В ОТЧЁТЕ поимённо: решение,
 * менять ли слова, — редакторское, и оно за заказчиком.
 */
export const labelIsAddress = (label) => /t\.me\//i.test(label);

/**
 * Карта «номер сообщения → пост на сайте».
 *
 * СТРОИТСЯ НЕ ПО `tgId` НАПРЯМУЮ, И ЭТО ГЛАВНАЯ ТОНКОСТЬ ЗАДАЧИ. После задачи
 * 7.5 `tgId` поста — это номер сообщения С ПОДПИСЬЮ, а не первого снимка
 * альбома: подпись автор часто ставил второму или пятому снимку. А ссылку
 * в тексте он копировал у ТОГО сообщения, которое видел, — и это мог быть
 * любой снимок пачки. Спрашивай мы один `tgId`, часть ссылок молча не нашла бы
 * цели и осталась бы вести в телеграм.
 *
 * ПОДПИСИ РАСКЛАДЫВАЮТСЯ ПЕРВЫМИ, снимки — вторым проходом и только на
 * свободные места. Иначе снимок одного альбома мог бы занять номер, который
 * является подписью другого поста, и ссылка увела бы не туда. В нынешнем
 * архиве таких столкновений ноль, но порядок назван явно: данные меняются,
 * порядок нет.
 *
 * @param {Map<number, {slug: string, draft: boolean}>} captions номер подписи → пост
 * @param {{id: number, members: {id: number}[]}[]} albums склейка из экспорта
 */
export function buildMessageMap(captions, albums) {
	const map = new Map();
	for (const [id, post] of captions) map.set(id, { ...post, viaCaption: true });

	const membersOf = new Map(albums.map((a) => [a.id, a.members.map((m) => m.id)]));
	for (const [id, post] of captions) {
		for (const member of membersOf.get(id) ?? []) {
			if (!map.has(member)) map.set(member, { ...post, viaCaption: false });
		}
	}

	return map;
}

/** Причины, по которым ссылка остаётся вести в телеграм. */
export const LEFT_REASONS = {
	noTarget: 'цель не нашлась — пост не импортирован или отсеян правилами',
	labelIsAddress: 'видимый текст ссылки сам является адресом телеграма',
	selfLink: 'ссылка ведёт на этот же пост',
	shape: 'ссылка записана необычно (заголовок в кавычках, адрес в угловых скобках) — трогать не стали',
};

/**
 * Переписать адреса в теле поста.
 *
 * МЕНЯЕТСЯ РОВНО КУСОК МЕЖДУ `](` и `)`. Подпись, скобки, пробелы и всё
 * остальное остаются байт в байт: правка делается вырезкой по месту, которое
 * назвал разбор, а не пересборкой текста из дерева.
 *
 * ОБА ПРАВИЛА ПЕРЕДАЮТСЯ ПАРАМЕТРОМ ровно затем, чтобы самопроверка могла
 * подсунуть сломанные и убедиться, что это ловится. Так же сделано у отбора
 * порций в telegram-import.mjs.
 *
 * @param {string} body
 * @param {(id: number) => ({slug: string, draft: boolean, viaCaption: boolean} | undefined)} lookup
 * @param {string} ownSlug адрес самого этого поста
 */
export function rewriteBody(body, lookup, ownSlug, { messageId = channelMessageId, blockedLabel = labelIsAddress } = {}) {
	const rewritten = [];
	const left = [];
	const pieces = [];
	let cursor = 0;

	for (const link of linksOf(body)) {
		const id = messageId(link.url);
		if (id === null) continue;

		if (blockedLabel(link.label)) {
			left.push({ id, reason: 'labelIsAddress', label: link.label });
			continue;
		}

		const target = lookup(id);
		if (!target) {
			left.push({ id, reason: 'noTarget', label: link.label });
			continue;
		}
		if (target.slug === ownSlug) {
			left.push({ id, reason: 'selfLink', label: link.label });
			continue;
		}

		// Кусок исходника этой ссылки: `[подпись](адрес)`. Адрес обязан стоять
		// в конце, между последним `](` и закрывающей скобкой, и совпадать
		// с тем, что назвал разбор. Не совпал — НЕ ПРАВИМ И ГОВОРИМ ВСЛУХ:
		// у ссылки бывает заголовок в кавычках и запись адреса в угловых
		// скобках, и молча испортить её хуже, чем не тронуть.
		const raw = body.slice(link.start, link.end);
		const at = raw.lastIndexOf('](');
		if (at === -1 || !raw.endsWith(')') || raw.slice(at + 2, -1) !== link.url) {
			left.push({ id, reason: 'shape', label: link.label, raw });
			continue;
		}

		const address = postAddress(target.slug);
		pieces.push(body.slice(cursor, link.start + at + 2), address);
		cursor = link.end - 1;
		rewritten.push({ id, from: link.url, to: address, ...target });
	}

	pieces.push(body.slice(cursor));
	return { body: pieces.join(''), rewritten, left };
}

/**
 * ЗАСЛОН ПЕРЕД ЗАПИСЬЮ: что изменилось ровно то, что собирались менять.
 *
 * ЭТО НЕ УКРАШЕНИЕ. Здесь правятся полторы тысячи СУЩЕСТВУЮЩИХ файлов, каждый
 * из которых заказчик уже смотрел в админке. Кривая шапка роняет сборку всего
 * сайта, а съеденное слово в теле не заметит никто и никогда.
 *
 * Спрашивается четыре вещи, и провалиться может каждая:
 *
 *   1. ШАПКА НЕ ТРОНУТА БАЙТ В БАЙТ и по-прежнему читается тем же js-yaml,
 *      которым её читает сборка (той же версии, что у Astro).
 *   2. ВИДИМЫЙ ТЕКСТ НЕ ИЗМЕНИЛСЯ — разметку снимает тот же движок, которым
 *      собирается сайт. Съеденная подпись ссылки ловится именно здесь.
 *   3. ССЫЛОК СТОЛЬКО ЖЕ, и их адреса отличаются РОВНО в запланированных
 *      местах: ни одной лишней правки, ни одной пропущенной.
 *   4. ДЛИНА ФАЙЛА изменилась ровно на сумму разниц адресов — сдвиг на символ
 *      при вырезке по месту виден только этой арифметикой.
 *
 * @returns {string[]} список бед; пусто — писать можно
 */
export function writeProblems(slug, oldText, newText, plan) {
	const problems = [];
	const say = (text) => problems.push(`${slug}: ${text}`);

	const oldParts = oldText.split(/^---$/m);
	const newParts = newText.split(/^---$/m);
	const oldHead = oldParts[1] ?? '';
	const newHead = newParts[1] ?? '';

	if (oldHead !== newHead) say('шапка изменилась, а трогать её мы не собирались');
	try {
		if (!yaml.load(newHead)) say('шапка не читается — там пусто');
	} catch (error) {
		say(`шапка не читается — ${String(error.message).split('\n')[0]}`);
	}

	const oldBody = oldParts.slice(2).join('---');
	const newBody = newParts.slice(2).join('---');

	const visible = (text) => mdToString(md.parse(text)).replace(/\s+/g, ' ').trim();
	if (visible(oldBody) !== visible(newBody)) say('видимый текст изменился — правка задела не только адрес');

	const before = linksOf(oldBody);
	const after = linksOf(newBody);
	if (before.length !== after.length) {
		say(`ссылок было ${before.length}, стало ${after.length}`);
	} else {
		const changed = [];
		for (let i = 0; i < before.length; i += 1) {
			if (before[i].url !== after[i].url) changed.push([before[i].url, after[i].url]);
		}
		const wanted = plan.map((p) => [p.from, p.to]);
		if (changed.length !== wanted.length) {
			say(`адресов сменилось ${changed.length}, а собирались сменить ${wanted.length}`);
		} else {
			for (let i = 0; i < changed.length; i += 1) {
				if (changed[i][0] !== wanted[i][0] || changed[i][1] !== wanted[i][1]) {
					say(`сменился не тот адрес: ${changed[i][0]} → ${changed[i][1]}, а собирались ${wanted[i][0]} → ${wanted[i][1]}`);
				}
			}
		}
	}

	const growth = plan.reduce((sum, p) => sum + p.to.length - p.from.length, 0);
	if (newText.length !== oldText.length + growth) {
		say(`длина файла изменилась на ${newText.length - oldText.length}, а адреса дают ${growth}`);
	}

	return problems;
}

// ——— Чтение постов ———

/**
 * Все посты репозитория: адрес, шапка, тело, черновик ли, номер в телеграме.
 *
 * ГАЛОЧКА «ЧЕРНОВИК» ЧИТАЕТСЯ js-yaml, А НЕ ВЫРАЖЕНИЕМ. Отсутствие поля значит
 * ОПУБЛИКОВАН — так стоит у старых постов, — и ошибка здесь стоила бы правки
 * в опубликованном посте, то есть ровно того, что запрещено.
 */
export function readPosts(postsDir) {
	const posts = [];
	for (const name of readdirSync(postsDir).filter((n) => n.endsWith('.md'))) {
		const text = readFileSync(join(postsDir, name), 'utf8');
		const parts = text.split(/^---$/m);
		let head = {};
		try {
			head = yaml.load(parts[1] ?? '') ?? {};
		} catch {
			head = {};
		}
		posts.push({
			slug: basename(name, '.md'),
			file: join(postsDir, name),
			text,
			body: parts.slice(2).join('---'),
			draft: head.draft === true,
			tgId: typeof head.tgId === 'number' ? head.tgId : null,
			date: head.date instanceof Date ? head.date.toISOString().slice(0, 10) : String(head.date ?? ''),
		});
	}
	return posts;
}

/** Номер подписи → пост. Два источника, как и у импорта: поле и ручной журнал. */
export function captionsOf(posts) {
	const bySlug = new Map(posts.map((p) => [p.slug, p]));
	const captions = new Map();

	for (const [id, slug] of Object.entries(manualTelegramPosts)) {
		const post = bySlug.get(slug);
		if (post) captions.set(Number(id), { slug, draft: post.draft });
	}
	for (const post of posts) {
		if (post.tgId !== null) captions.set(post.tgId, { slug: post.slug, draft: post.draft });
	}

	return captions;
}

// ——— Отчёт и запуск ———

const arg = (name, fallback = null) => {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
	const exportDir = arg('export');
	if (!exportDir) {
		console.error('Нужен ключ --export=<папка ChatExport_…>: без него не построить карту снимков альбома.');
		process.exit(1);
	}

	// fileURLToPath, а не .pathname: в пути к проекту русские буквы и пробел.
	const root = fileURLToPath(new URL('..', import.meta.url));
	const postsDir = arg('posts', join(root, 'src/content/posts'));
	const write = has('write');
	const year = arg('year');
	const all = has('all');

	if (!year && !all) {
		console.error('Не названа порция. Нужен один из ключей: --year=2022 или --all.');
		process.exit(1);
	}

	const posts = readPosts(postsDir);
	const albums = groupAlbums(JSON.parse(readFileSync(join(exportDir, 'result.json'), 'utf8')).messages);
	const captions = captionsOf(posts);
	const map = buildMessageMap(captions, albums);
	const lookup = (id) => map.get(id);

	const portion = year ? `${year} год` : 'все посты';
	console.log(`Экспорт: ${exportDir}`);
	console.log(`Постов в репозитории ${posts.length}; из них черновиков ${posts.filter((p) => p.draft).length}.`);
	console.log(`Карта «номер сообщения → пост»: ${map.size} номеров, из них снимков альбома ${[...map.values()].filter((m) => !m.viaCaption).length}.`);
	console.log(`ПОРЦИЯ: ${portion}.`);
	console.log(write ? '\nРЕЖИМ ЗАПИСИ: адреса будут переписаны.\n' : '\nРАЗВЕДКА: не пишется ничего.\n');

	// ——— Разбор ———
	const planned = [];
	const leftAll = [];
	const publishedLinks = [];
	let outOfPortion = 0;

	for (const post of posts) {
		const result = rewriteBody(post.body, lookup, post.slug);
		const touched = result.rewritten.length + result.left.length;
		if (!touched) continue;

		// ОПУБЛИКОВАННЫЕ НЕ ТРОГАЕМ ВОВСЕ — правило проекта сильнее пользы.
		// Но и не молчим: заказчик просил знать число.
		if (!post.draft) {
			publishedLinks.push({ slug: post.slug, links: touched });
			continue;
		}

		if (year && post.date.slice(0, 4) !== String(year)) {
			outOfPortion += touched;
			continue;
		}

		leftAll.push(...result.left.map((l) => ({ ...l, slug: post.slug })));
		if (result.rewritten.length) planned.push({ post, result });
	}

	// ——— Цифры ———
	const rewritten = planned.reduce((sum, p) => sum + p.result.rewritten.length, 0);
	const viaPhoto = planned.reduce((sum, p) => sum + p.result.rewritten.filter((r) => !r.viaCaption).length, 0);
	const toDraft = planned.reduce((sum, p) => sum + p.result.rewritten.filter((r) => r.draft).length, 0);

	const byReason = new Map();
	for (const l of leftAll) byReason.set(l.reason, [...(byReason.get(l.reason) ?? []), l]);

	console.log(`=== ПЕРЕПИСЫВАЕМ: ${rewritten} ссылок в ${planned.length} постах ===`);
	for (const { post, result } of planned) {
		console.log(`  ${post.slug}`);
		for (const r of result.rewritten) {
			console.log(`      №${r.id}${r.viaCaption ? '' : ' (снимок альбома)'} → ${r.to}${r.draft ? '  [цель — черновик]' : ''}`);
		}
	}

	console.log(`\n=== ОСТАВЛЯЕМ КАК ЕСТЬ: ${leftAll.length} ===`);
	for (const [reason, list] of byReason) {
		console.log(`\n  ${LEFT_REASONS[reason] ?? reason} — ${list.length}`);
		for (const l of list) console.log(`    №${l.id}  ${l.slug}  «${l.label.slice(0, 60)}»`);
	}

	const noTarget = byReason.get('noTarget') ?? [];
	const targets = new Map();
	for (const l of noTarget) targets.set(l.id, (targets.get(l.id) ?? 0) + 1);
	if (targets.size) {
		console.log(`\n=== ЦЕЛЬ НЕ НАШЛАСЬ, РАЗНЫХ СООБЩЕНИЙ: ${targets.size} ===`);
		console.log('  (пост не импортирован или отсеян правилами — это нормальный исход)');
		for (const [id, count] of [...targets].sort((a, b) => a[0] - b[0])) {
			console.log(`  https://t.me/${CHANNEL}/${id}  — ссылок на него ${count}`);
		}
	}

	const byYear = new Map();
	for (const { post } of planned) {
		const y = post.date.slice(0, 4) || '????';
		byYear.set(y, (byYear.get(y) ?? 0) + 1);
	}

	console.log('\n=== ЦИФРЫ ===');
	console.log(`  порция: ${portion}`);
	console.log(`  ссылок переписано: ${rewritten}`);
	console.log(`    из них указывали на СНИМОК альбома, а не на подпись: ${viaPhoto}`);
	console.log(`    из них ведут на пост, который ещё черновик: ${toDraft}`);
	console.log(`  ссылок оставлено: ${leftAll.length}`);
	for (const [reason, list] of byReason) console.log(`    ${LEFT_REASONS[reason] ?? reason}: ${list.length}`);
	console.log(`  файлов будет изменено: ${planned.length}`);
	for (const [y, n] of [...byYear].sort()) console.log(`    ${y}: ${n}`);
	console.log(`  ссылок в ОПУБЛИКОВАННЫХ постах (не трогаем): ${publishedLinks.reduce((s, p) => s + p.links, 0)} в ${publishedLinks.length} постах`);
	for (const p of publishedLinks) console.log(`    ${p.slug} — ${p.links}`);
	if (year) console.log(`  ссылок в черновиках других годов (эта порция их не касается): ${outOfPortion}`);

	if (!write) {
		console.log('\nНичего не записано. Чтобы записать — тот же запуск с ключом --write.');
		return;
	}

	// ——— Запись ———
	//
	// СНАЧАЛА ВСЯ ПОРЦИЯ ГОТОВИТСЯ В ПАМЯТИ И ПРОВЕРЯЕТСЯ, и только потом
	// ложится на диск. Так же, как у импорта, и по той же причине: половина
	// записанной порции — худшее из состояний.
	const prepared = [];
	const broken = [];
	for (const { post, result } of planned) {
		const text = post.text.split(/^---$/m).slice(0, 2).join('---') + '---' + result.body;
		broken.push(...writeProblems(post.slug, post.text, text, result.rewritten));
		prepared.push({ post, text });
	}

	if (broken.length) {
		console.error(`\nПРАВКА НЕ СОШЛАСЬ У ${broken.length} МЕСТ — НЕ ЗАПИСАНО НИЧЕГО.`);
		for (const line of broken) console.error(`  • ${line}`);
		process.exit(1);
	}

	for (const { post, text } of prepared) writeFileSync(post.file, text, 'utf8');
	console.log(`\nИзменено файлов: ${prepared.length}. Тексты не тронуты — сменились только адреса ссылок.`);
}

// Сравнение ПУТЯМИ, а не строками: `import.meta.url` кодирует русские буквы
// в пути к проекту, а `process.argv[1]` — нет, и строчное сравнение
// не совпадает никогда. Скрипт при этом молча ничего не делает и выходит с 0.
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
	await main();
}
