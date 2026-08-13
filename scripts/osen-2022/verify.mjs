#!/usr/bin/env node
// Сверка сборника «Обзор всех аниме осени 2022» с первоисточником.
//
//   node scripts/osen-2022/verify.mjs             — сверить
//   node scripts/osen-2022/verify.mjs --selftest  — спросить проверки подлогами
//
// ПЕРВОИСТОЧНИК ЗДЕСЬ НЕ DTF, А САМИ ПОСТЫ КАНАЛА, лежащие в git под
// закреплённым коммитом: осеннего марафона на DTF нет вовсе. Спросить чужой
// сервер не у кого, поэтому единственная защита от «текст поехал» —
// сравнение с тем, что импорт когда-то привёз из телеграма.
//
// ПОЛОВИНА САМОПРОВЕРКИ — «МОЛЧИТ ЛИ ОНА НА ЗДОРОВОМ ФАЙЛЕ». Без неё сломанная
// проверка отвечает «нашла» на что угодно, и каждый подлог выглядит пойманным:
// в проекте так уже уехала в дело `check-layout` с выражением, не совпадавшим
// ни с чем.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postPath } from '../dtf/source.mjs';
import { shortStudio } from '../dtf/captions.mjs';
import { handEdited } from '../dtf/guard.mjs';
import { PARTS, COVER, SOURCE_COMMIT, readPart, titleOf, isoDate, build } from './build.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SLUG = 'obzor-vseh-anime-oseni-2022';
const SELFTEST = process.argv.includes('--selftest');

const bodyOf = (raw) => raw.split(/^---$/m).slice(2).join('---');

/**
 * Текст к сравнению. Курсив приводим к звёздочкам: админка при первом же
 * сохранении переписывает `*(так)*` в `_(так)_` — разметка та же, знаки
 * другие, и без этого сверка краснела бы на каждом посте, который заказчик
 * открыл и сохранил.
 */
const plain = (text) =>
	text.replace(/_([^_\n]+)_/g, '*$1*')
		.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

/** Разбор сборника на куски по тайтлам. Заголовок → его блоки до следующего. */
function sections(raw) {
	const blocks = bodyOf(raw).split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
	const head = [];
	const out = [];
	for (const block of blocks) {
		const title = /^#### (?:\[(.+)\]\(([^)]*)\)|(.+))$/.exec(block);
		if (title) { out.push({ name: title[1] ?? title[3], href: title[2] ?? null, blocks: [] }); continue; }
		(out.length ? out[out.length - 1].blocks : head).push(block);
	}
	return { head, out };
}

async function cards() {
	const { readAnimeCollection } = await import(new URL('../anime-cases-lib.mjs', import.meta.url).href);
	return new Map((await readAnimeCollection()).map((e) => [e.data.id, e.data]));
}

// ─── Проверки ─────────────────────────────────────────────────────────────

/**
 * Текст каждого обзора — ЗНАК В ЗНАК с постом канала.
 *
 * Отключается, когда пост правил заказчик: «текст сходится с первоисточником»
 * — утверждение о ПЕРЕНОСЕ, и верно оно ровно до первой его правки. Оставь мы
 * это законом — первое же сохранение в админке заперло бы проверку.
 */
export function checkText(raw) {
	const bad = [];
	const { out } = sections(raw);
	const byName = new Map();
	for (const part of PARTS) {
		const { head, body } = readPart(part.file);
		byName.set(titleOf(head), body);
	}
	for (const section of out) {
		const source = byName.get(section.name);
		if (source === undefined) { bad.push(`тайтла «${section.name}» нет среди одиннадцати постов канала`); continue; }
		const mine = plain(section.blocks.filter((b) => !b.startsWith('::')).join('\n\n'));
		const theirs = plain(source.split(/\n\n+/).filter((b) => !b.trim().startsWith('::')).join('\n\n'));
		if (mine !== theirs) {
			const at = [...mine].findIndex((ch, i) => ch !== theirs[i]);
			bad.push(`«${section.name}»: текст разошёлся с постом канала на знаке ${at} — «…${mine.slice(Math.max(0, at - 30), at + 30)}…»`);
		}
	}
	for (const name of byName.keys()) if (!out.some((s) => s.name === name)) bad.push(`тайтл «${name}» потерян в сборнике`);
	return bad;
}

/**
 * Раскладка. Три правки заказчика от 13 августа, ради которых она и написана:
 * обложка первым блоком тела и без подписи; иллюстрация СРАЗУ после заголовка
 * своего тайтла; подпись начинается с названия тайтла и называет студию.
 */
export async function checkLayout(raw) {
	const bad = [];
	const byId = await cards();
	const body = bodyOf(raw);
	const blocks = body.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);

	if (!blocks[0]?.startsWith(`::image{src="${COVER}"`)) bad.push('обложка не первым блоком тела');
	else if (/caption="/.test(blocks[0])) bad.push('у обложки появилась подпись — по решению заказчика её быть не должно');

	const { out } = sections(raw);
	if (out.length !== PARTS.length) bad.push(`тайтлов ${out.length}, а постов канала ${PARTS.length}`);

	for (const section of out) {
		const first = section.blocks[0];
		if (!first?.startsWith('::image{')) { bad.push(`«${section.name}»: под заголовком нет картинки`); continue; }
		const caption = /caption="([^"]*)"/.exec(first)?.[1];
		if (!caption) { bad.push(`«${section.name}»: у картинки нет подписи`); continue; }
		if (!caption.startsWith(section.name)) bad.push(`«${section.name}»: подпись начинается не с названия тайтла — «${caption}»`);
		// Студия сверяется С КАРТОЧКОЙ САЙТА, а не с тем, что в подписи что-то
		// написано: она показывается в каталоге и правится заказчиком,
		// и разойдись подпись с карточкой — у тайтла было бы две разные студии
		// на соседних страницах.
		const id = section.href?.replace(/^\/anime\/|\/$/g, '');
		const studio = id ? byId.get(id)?.studio : null;
		if (!studio) bad.push(`«${section.name}»: студию не у кого спросить — нет карточки`);
		else if (caption !== `${section.name}, студия ${shortStudio(studio)}`) {
			bad.push(`«${section.name}»: подпись «${caption}» не совпадает со студией карточки «${shortStudio(studio)}»`);
		}
	}

	const srcs = [...body.matchAll(/^::image\{src="([^"]+)"/gm)].map((m) => m[1]);
	if (srcs.length !== PARTS.length + 1) bad.push(`картинок ${srcs.length}, а должно быть ${PARTS.length + 1} (обложка + кадры)`);
	for (const src of new Set(srcs)) {
		if (!fs.existsSync(path.join(ROOT, 'public', src))) bad.push(`нет файла картинки: ${src}`);
	}

	// Второй уровень в теле поста — это заголовок страницы, а не раздела:
	// поставленный внутри материала, он ломает лестницу заголовков.
	if (/^## /m.test(body)) bad.push('в теле есть заголовок второго уровня');
	return bad;
}

/**
 * Порядок тайтлов = порядок выхода в канале.
 *
 * СЧЁТОМ ЭТО НЕ ПОЙМАТЬ: переставленные местами два тайтла оставляют и число
 * тайтлов, и число картинок прежними. Первый прогон сборщика выстроил сборник
 * по названию дня недели («Fri, Mon, Sat, Sun, Wed») — выглядело это просто
 * странным порядком, а не ошибкой.
 */
export function checkOrder(raw) {
	const dates = new Map(PARTS.map((part) => {
		const { head } = readPart(part.file);
		return [titleOf(head), isoDate(head.date)];
	}));
	const mine = sections(raw).out.map((s) => s.name);
	const right = [...dates.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([name]) => name);
	const bad = [];
	for (let i = 0; i < Math.min(mine.length, right.length); i++) {
		if (mine[i] !== right[i]) {
			bad.push(`порядок: на месте ${i + 1} стоит «${mine[i]}» (${dates.get(mine[i]) ?? '?'}), а по дате выхода — «${right[i]}» (${dates.get(right[i])})`);
			break;
		}
	}
	return bad;
}

/**
 * Подводка на месте И ДО ПЕРВОГО ТАЙТЛА.
 *
 * Наличием это не проверить: уехавшая ниже первого обзора подводка бесполезна,
 * а текст при этом весь на месте. То же правило, что у предупреждения
 * о спойлерах в «Оси но ко».
 */
export function checkIntro(raw) {
	const body = bodyOf(raw);
	const intro = body.indexOf('Здесь одиннадцать сериалов');
	const first = body.indexOf('#### ');
    if (intro < 0) return ['подводка потеряна'];
	if (first >= 0 && intro > first) return ['подводка уехала ниже первого тайтла'];
	return [];
}

// ─── Прогон ───────────────────────────────────────────────────────────────
async function runAll() {
	const file = postPath(SLUG);
	if (!fs.existsSync(file)) { console.log(`✗ файла нет: ${SLUG}.md`); return 1; }
	const raw = fs.readFileSync(file, 'utf8');

	// Правил ли пост заказчик — спрашиваем У САМОГО СБОРЩИКА, тем же признаком,
	// что стоит заслоном при записи. Два ответа на один вопрос разъехались бы.
	const { text } = await build({ write: false });
	const edited = handEdited(file, text) !== null;

	const problems = [
		...(edited ? [] : checkText(raw)),
		...(await checkLayout(raw)),
		...checkOrder(raw),
		...checkIntro(raw),
	];

	console.log(`=== обзор всех аниме осени 2022 (первоисточник — посты канала, коммит ${SOURCE_COMMIT}) ===`);
	if (problems.length) { problems.slice(0, 8).forEach((p) => console.log('   ✗', p)); return problems.length; }
	const images = (raw.match(/^::image/gm) || []).length;
	console.log(edited
		? `   ✓ пост правил заказчик — сверка с постами канала не применялась; целостность в порядке: картинок ${images}`
		: `   ✓ сходится с постами канала знак в знак: тайтлов ${PARTS.length}, картинок ${images}`);
	return 0;
}

// ─── Подлоги ──────────────────────────────────────────────────────────────
async function selftest() {
	const raw = fs.readFileSync(postPath(SLUG), 'utf8');

	// Названия и подписи достаём ИЗ ДАННЫХ, а не вписываем именем: вписанные,
	// они протухнут от первой же правки заказчика в админке, и подлог начнёт
	// падать на здоровом посте.
	const names = sections(raw).out.map((s) => s.name);
	const secondCaption = /caption="([^"]*)"/.exec(sections(raw).out[1].blocks[0])[1];

	/** Подделать — и УБЕДИТЬСЯ, ЧТО ПОДДЕЛКА СОСТОЯЛАСЬ. */
	const forge = (from, to, text = raw) => {
		const forged = text.replace(from, to);
		if (forged === text) throw new Error(`подлог не сработал: в тексте нет ${from}`);
		return forged;
	};
	const swapBlocks = (find, offset = 1) => {
		const blocks = raw.split(/\n\n/);
		const i = blocks.findIndex(find);
		if (i < 0) throw new Error('подлог не сработал: блок не найден');
		[blocks[i], blocks[i + offset]] = [blocks[i + offset], blocks[i]];
		return blocks.join('\n\n');
	};

	const cases = [
		['потерян целый тайтл', async () => checkText(forge(new RegExp(`#### \\[${names[2]}\\]\\([^)]*\\)`), ''))],
		['из обзора выброшен абзац', async () => checkText(forge(/\n\nОн становится оружием кошко-девочки[^\n]*/, ''))],
		['в обзоре изменена одна буква', async () => checkText(forge('первый исекай в этом сезоне', 'первый исекай в этом сезоме'))],
		['картинка встала перед заголовком', async () => checkLayout(swapBlocks((b) => b.startsWith(`#### [${names[1]}]`)))],
		['у тайтла пропала картинка', async () => checkLayout(forge(/\n\n::image\{src="\/images\/uploads\/osen-2022-05\.webp"[^\n]*/, ''))],
		['в подписи нет студии', async () => checkLayout(forge(/ caption="([^",]+), студия [^"]*"/, ' caption="$1"'))],
		['подпись уехала к чужому тайтлу', async () => checkLayout(forge(` caption="${secondCaption}"`, ` caption="${/caption="([^"]*)"/.exec(sections(raw).out[2].blocks[0])[1]}"`))],
		['файла картинки нет', async () => checkLayout(forge('osen-2022-09.webp', 'osen-2022-99.webp'))],
		['обложка не первым блоком', async () => checkLayout(swapBlocks((b) => b.startsWith(`::image{src="${COVER}"`)))],
		['у обложки появилась подпись', async () => checkLayout(forge(`::image{src="${COVER}" alt=""`, `::image{src="${COVER}" alt="" caption="Кадр из аниме"`))],
		['два тайтла поменялись местами', async () => {
			const a = new RegExp(`#### \\[${names[0]}\\]\\([^)]*\\)`);
			const b = new RegExp(`#### \\[${names[1]}\\]\\([^)]*\\)`);
			const [ta, tb] = [a.exec(raw)[0], b.exec(raw)[0]];
			return checkOrder(raw.replace(a, '@@A@@').replace(b, ta).replace('@@A@@', tb));
		}],
		['заголовок тайтла съехал на третий уровень', async () => checkLayout(forge(new RegExp(`#### (\\[${names[3]}\\])`), '### $1'))],
		['подводка потеряна', async () => checkIntro(forge(/Здесь одиннадцать сериалов[^\n]*\n\n/, ''))],
		['подводка уехала ниже первого тайтла', async () => {
			const line = /Здесь одиннадцать сериалов[^\n]*/.exec(raw)[0];
			return checkIntro(forge(/Здесь одиннадцать сериалов[^\n]*\n\n/, '').replace(/(#### \[[^\n]*\n\n::image[^\n]*)/, `$1\n\n${line}`));
		}],
	];

	let bad = 0;
	console.log('=== ПОДЛОГИ: каждый обязан быть пойман ===');
	for (const [name, run] of cases) {
		const found = await run();
		if (found.length) console.log(`   ✓ поймано: ${name} — ${found[0].slice(0, 90)}`);
		else { console.log(`   ✗✗ ПРОПУЩЕНО: ${name}`); bad++; }
	}

	// ВТОРАЯ ПОЛОВИНА, БЕЗ КОТОРОЙ ПЕРВАЯ НИЧЕГО НЕ ЗНАЧИТ.
	console.log('\n=== ЗДОРОВЫЙ ФАЙЛ: все проверки обязаны молчать ===');
	const quiet = [
		['текст', checkText(raw)],
		['раскладка', await checkLayout(raw)],
		['порядок', checkOrder(raw)],
		['подводка', checkIntro(raw)],
	];
	for (const [name, found] of quiet) {
		if (found.length) { console.log(`   ✗✗ ЛОЖНАЯ ТРЕВОГА: ${name} — ${found[0]}`); bad++; }
		else console.log(`   ✓ молчит: ${name}`);
	}
	return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	process.exit(SELFTEST ? (await selftest() ? 1 : 0) : ((await runAll()) ? 1 : 0));
}
