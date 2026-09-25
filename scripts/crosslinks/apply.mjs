// ПЕРЕЛИНКОВКА — ВСТАВЛЯЛКА (сессия 3; снятие дублей — сессия 3б).
//
//   npm run crosslinks:apply -- --batch 1            — сухой прогон по пачке
//   npm run crosslinks:apply -- --posts a,b          — по списку постов
//   npm run crosslinks:apply -- --keys 'a→b,c→d'     — по ключам решений
//   … --write                                         — записать в посты
//
// Без отбора не делает ничего. Без --write — сухой прогон: показывает, что
// и куда вписала бы, и не пишет ни одного файла.
//
// ПЕРЕД --write ЗАКРОЙТЕ ВСЕ ВКЛАДКИ АДМИНКИ. Открытая вкладка Sveltia держит
// свою копию поста и при сохранении пишет её целиком — вставка пропадёт молча
// (CLAUDE.md, урок «Открытая вкладка админки держит СВОЮ копию поста»).
//
// Вход — статус/перелинковка/решения.json, раздел approved (отложенные
// не вписываются). Для каждой одобренной вставки:
//   1. цель существует и опубликована СЕЙЧАС, а «играет здесь» ей по силам
//      (src/lib/postRef.mjs) — иначе пропуск с причиной;
//   2. в посте ещё нет ::material на эту цель — иначе пропуск «уже стоит»;
//   3. место: отпечаток файла совпал с решением — после блока afterBlock;
//      не совпал — заново по первым словам абзаца (review/fresh.mjs, reanchor);
//      не нашлось — пропуск, пост в список «место потеряно, пересмотреть
//      на странице».
// Несколько вставок в одном посте — с конца к началу: смещения блоков выше
// от этого не меняются. После каждой вставки текст разбирается заново
// и проверяется, что следующая встаёт после того же абзаца.
//
// ВИД СТРОКИ — как у 71 вставки Эда (замер 25.09.2026): `::material{id="…"}`,
// параметры в порядке id, label, mode; перед блоком две пустые строки, после —
// не меньше двух (или конец файла). Файл в остальном не меняется: вставка
// идёт в строку сразу за последним знаком блока, а пустые строки после неё
// остаются прежние.
//
// СНЯТИЕ ДУБЛЯ (сессия 3б, исключение CLAUDE.md, пункт 2). У решения может
// быть поле `unlink` — список решений Эда по ссылкам на ту же цель в абзаце-
// якоре: { raw, mode: words | custom | keep, from, to }. После вставки блока
// (или у вставки, вписанной раньше, — тогда блок не трогается) кусок `from`
// ищется в абзаце-якоре — в том, после которого стоит вставка на эту цель
// (через картинки), — и должен найтись там РОВНО ОДИН раз. Нашёлся — заменяется
// на `to`; нет или дважды — снятие пропускается, пост в «место потеряно».
// Абзац-якорь сверяется по первым словам с решением.
//
// После --write каждый изменённый файл сверяется с исходным (verify-diff.mjs)
// вместе со снятиями этого прогона: красный свет — файл возвращается побайтно,
// пост уходит в отчёт. Журнал — статус/перелинковка/вставлено.json: запись
// на вставку, снятия — её полем `unlinks`. Номер коммита в журнал НЕ пишется
// (решение Эда 3б): пачка — один коммит, найти его —
// `git log -- статус/перелинковка/вставлено.json`.

import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib.mjs';
import { parseBody } from '../archive-clean-lib.mjs';
import { toPlainText } from '../../src/lib/plainText.mjs';
import { SITE_URL } from '../../src/lib/site.mjs';
import { fingerprint, reanchor } from './review/fresh.mjs';
import { verifyChange, tgMapOf, ytMapOf } from './verify-diff.mjs';
import { occurrences } from './unlink.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DIR = join(REPO, 'статус/перелинковка');
const POSTS_DIR = join(REPO, 'src/content/posts');

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : null);
const WRITE = args.includes('--write');
const decisionsFile = opt('--decisions') ?? join(DIR, 'решения.json');
const journalFile = opt('--journal') ?? join(DIR, 'вставлено.json');
const postsDir = opt('--posts-dir') ?? POSTS_DIR;

const firstWords = (t, n = 10) => (t ?? '').split(/\s+/u).filter(Boolean).slice(0, n).join(' ');

async function writeAtomic(file, text) {
	const tmp = `${file}.tmp-${process.pid}`;
	await writeFile(tmp, text);
	await rename(tmp, file);
}

async function readJournal() {
	try {
		return JSON.parse(await readFile(journalFile, 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return [];
		throw new Error(`Не читается журнал ${journalFile}: ${e.message}`);
	}
}

/** Строка блока: id, label, mode — как у вставок Эда. */
export function materialLine({ target, label, play }) {
	let s = `::material{id="${target}"`;
	if (label) s += ` label="${String(label).replaceAll('"', '&quot;')}"`;
	if (play) s += ' mode="play"';
	return s + '}';
}

/**
 * Вписать строку блока после символа `end` тела (конец блока afterBlock).
 * Две пустые строки перед блоком; после — прежние пустые строки, но не меньше двух.
 */
export function insertAt(body, end, line) {
	let k = 0;
	while (body[end + k] === '\n') k++;
	const atEof = end + k === body.length;
	const extra = atEof ? '' : '\n'.repeat(Math.max(0, 3 - k));
	return body.slice(0, end) + '\n\n\n' + line + extra + body.slice(end);
}

/** Узлы верхнего уровня тела: смещения и начало текста — для проверки места. */
function nodes(body) {
	return parseBody(body).children.map((n) => ({
		start: n.position.start.offset,
		end: n.position.end.offset,
		type: n.type,
		name: n.name ?? null,
		id: n.attributes?.id ?? null,
		words: firstWords(toPlainText(body.slice(n.position.start.offset, n.position.end.offset))),
	}));
}

/**
 * Узел, который стоит между абзацем-якорем и вставкой и не мешает ей:
 * картинка (абзац из одних картинок, блок картинки/галереи/видео) или
 * служебная строка раздела `##### Количество серий: 6` (lib.mjs: заголовок
 * 5-го уровня раздела не открывает). Настоящий заголовок — мешает.
 */
function isImageNode(n) {
	if (n.type === 'heading' && n.depth >= 5) return true;
	if (n.type === 'leafDirective' || n.type === 'containerDirective') return ['image', 'gallery', 'video'].includes(n.name);
	if (n.type !== 'paragraph') return false;
	const kids = (n.children ?? []).filter((c) => !(c.type === 'text' && !c.value.trim()));
	return kids.length > 0 && kids.every((c) => c.type === 'image');
}

/**
 * Абзац-якорь вставки на цель: текстовый узел прямо перед блоком
 * `::material{id=цель}` (картинки между ними пропускаются). Нет — null.
 */
function anchorBefore(body, target) {
	const kids = parseBody(body).children;
	const mi = kids.findIndex((n) => n.type === 'leafDirective' && n.name === 'material' && n.attributes?.id === target);
	if (mi < 0) return null;
	let j = mi - 1;
	while (j >= 0 && isImageNode(kids[j])) j--;
	const a = kids[j];
	if (!a || !['paragraph', 'list', 'blockquote'].includes(a.type)) return null;
	const start = a.position.start.offset;
	const end = a.position.end.offset;
	return { start, end, words: firstWords(toPlainText(body.slice(start, end))) };
}

const journalBefore = await readJournal();
/** Снятие уже в журнале (вписано раньше)? */
const unlinkDone = (rec, u) => journalBefore.some((x) => x.key === rec.key && (x.unlinks ?? []).some((y) => y.from === u.from && y.to === u.to));
/** Снятия решения, которые надо сделать в этом прогоне. */
const todoUnlinks = (rec) => (rec.unlink ?? []).filter((u) => (u.mode === 'words' || u.mode === 'custom') && typeof u.from === 'string' && typeof u.to === 'string' && !unlinkDone(rec, u));

const byPosts = list(opt('--posts'));
const byKeys = list(opt('--keys'));
const byBatch = opt('--batch');
if (!byPosts && !byKeys && !byBatch) {
	console.log('Не выбрано, что вписывать. Укажите --batch N, --posts a,b или --keys «a→b,…».\nБез --write — сухой прогон. Ничего не сделано.');
	process.exit(0);
}

const decisions = JSON.parse(await readFile(decisionsFile, 'utf8'));
const chosen = (decisions.approved ?? []).filter(
	(a) => (!byPosts || byPosts.includes(a.source)) && (!byKeys || byKeys.includes(a.key)) && (!byBatch || String(a.batch) === String(byBatch)),
);
if (!chosen.length) {
	console.log('Под отбор не попало ни одного одобренного решения. Ничего не сделано.');
	process.exit(0);
}

const { posts } = await loadCorpus();
const byId = new Map(posts.map((p) => [p.id, p]));
const rawOf = new Map();

const skipped = []; // { key, why }
const lost = []; // посты «место потеряно»
const plan = new Map(); // источник → [{ rec, place, line }]
const unlinkOnly = new Map(); // источник → [rec] — вставка уже стоит, снять только ссылку
const already = []; // вставка уже стоит, снимать нечего

for (const a of chosen) {
	const src = byId.get(a.source);
	const tgt = byId.get(a.target);
	const skip = (why) => skipped.push({ key: a.key, source: a.source, why });
	if (!src) {
		skip('поста-источника больше нет');
		continue;
	}
	if (!tgt) {
		skip('цели больше нет в архиве');
		continue;
	}
	if (!tgt.published) {
		skip('цель сейчас не опубликована (черновик или отложенная публикация)');
		continue;
	}
	// tgt.canPlay — то же правило сайта (canPlayInline), посчитанное в корпусе.
	if (a.play && !tgt.canPlay) {
		skip(`«играет здесь» невозможно: цель — ${tgt.external ? 'материал с чужого сайта' : tgt.category === 'bonus' ? 'бонус без своего аудио' : 'не выпуск и не видеоэссе'}`);
		continue;
	}
	if (src.blocks.some((b) => b.kind === 'material' && b.target === a.target)) {
		if (todoUnlinks(a).length) {
			if (!unlinkOnly.has(a.source)) unlinkOnly.set(a.source, []);
			unlinkOnly.get(a.source).push(a);
		} else already.push(a);
		continue;
	}
	let place = a.place;
	let how = 'по номеру (файл поста не менялся)';
	if (a.fingerprint !== (await fingerprint(a.source, postsDir))) {
		place = reanchor(src.blocks, a.place);
		how = 'заново по первым словам абзаца (файл поста изменился после решения)';
	}
	if (!place || place.afterBlock == null || place.afterBlock >= src.blocks.length) {
		skip('место потеряно — пересмотреть на странице ревью');
		lost.push(a.source);
		continue;
	}
	const anchor = src.blocks[place.anchorBlock ?? place.afterBlock];
	if (firstWords(anchor?.plain, 10) !== firstWords(place.anchorWords, 10)) {
		skip(`абзац места начинается не со слов решения («${firstWords(anchor?.plain, 6)}…» вместо «${firstWords(place.anchorWords, 6)}…»)`);
		lost.push(a.source);
		continue;
	}
	if (!plan.has(a.source)) plan.set(a.source, []);
	if (plan.get(a.source).some((x) => x.place.afterBlock === place.afterBlock)) {
		skip('две вставки после одного и того же блока — вторая не вписана');
		continue;
	}
	plan.get(a.source).push({ rec: a, place, how, line: materialLine(a), end: src.blocks[place.afterBlock].end, targetTitle: tgt.title });
}

// ——— Вписывание: в памяти, с конца к началу, с проверкой после каждой ———
const results = []; // { source, before, after, items }
for (const sid of unlinkOnly.keys()) if (!plan.has(sid)) plan.set(sid, []);
for (const [sid, items] of plan) {
	const file = join(postsDir, `${sid}.md`);
	const before = await readFile(file);
	const raw = before.toString('utf8');
	const end = raw.indexOf('\n---', 3);
	const head = raw.startsWith('---') && end > 0 ? raw.slice(0, end + 4) : '';
	let body = raw.slice(head.length);
	const original = nodes(body);
	items.sort((x, y) => y.place.afterBlock - x.place.afterBlock);
	const done = [];
	let broken = null;
	for (const it of items) {
		body = insertAt(body, it.end, it.line);
		done.push(it);
		// Остальные (выше по тексту) обязаны встать после тех же абзацев: узлы
		// до них не сдвинулись, а новый блок стоит сразу за своим.
		const now = nodes(body);
		for (const x of done) {
			const extraAbove = done.filter((y) => y.place.afterBlock < x.place.afterBlock).length;
			const at = x.place.afterBlock + extraAbove;
			const m = now[at + 1];
			const anchorNow = now[(x.place.anchorBlock ?? x.place.afterBlock) + extraAbove];
			const anchorWas = original[x.place.anchorBlock ?? x.place.afterBlock];
			if (m?.name !== 'material' || m.id !== x.rec.target || anchorNow?.words !== anchorWas?.words) broken = `вставка на «${x.rec.target}» встала не после того абзаца`;
		}
		if (broken) break;
	}
	if (broken) {
		for (const it of items) skipped.push({ key: it.rec.key, source: sid, why: `пост не вписан целиком: ${broken}` });
		continue;
	}
	// Снятие дублей — после всех вставок: абзац-якорь ищется у готового блока.
	const unlinked = []; // { rec, u, anchorWords }
	const recs = [...items.map((it) => it.rec), ...(unlinkOnly.get(sid) ?? [])];
	const shape = nodes(body).map((n) => `${n.type}:${n.name ?? ''}:${n.id ?? ''}`).join('|');
	for (const rec of recs) {
		for (const u of todoUnlinks(rec)) {
			const why = (w) => {
				skipped.push({ key: rec.key, source: sid, why: `ссылка не снята (${w}) — место потеряно, пересмотреть на странице: «${u.from.slice(0, 70)}»` });
				lost.push(sid);
			};
			const a = anchorBefore(body, rec.target);
			if (!a) {
				why('нет абзаца перед вставкой');
				continue;
			}
			if (a.words !== firstWords(rec.place?.anchorWords, 10)) {
				why(`абзац перед вставкой начинается со слов «${firstWords(a.words, 6)}…», а не как в решении`);
				continue;
			}
			const para = body.slice(a.start, a.end);
			const n = occurrences(para, u.from);
			if (n !== 1) {
				why(n ? `кусок встречается в абзаце ${n} раза` : 'куска в абзаце нет');
				continue;
			}
			body = body.slice(0, a.start) + para.replace(u.from, () => u.to) + body.slice(a.end);
			unlinked.push({ rec, u, anchorWords: a.words });
		}
	}
	if (nodes(body).map((n) => `${n.type}:${n.name ?? ''}:${n.id ?? ''}`).join('|') !== shape) {
		for (const x of unlinked) skipped.push({ key: x.rec.key, source: sid, why: 'после снятия ссылки поменялось строение текста — пост не вписан' });
		continue;
	}
	if (!items.length && !unlinked.length) continue;
	results.push({ sid, file, before, after: Buffer.from(head + body, 'utf8'), items: items.slice().reverse(), unlinked });
}

// ——— Отчёт ———
const skippedBySource = new Map();
for (const s of skipped) {
	if (!skippedBySource.has(s.source)) skippedBySource.set(s.source, []);
	skippedBySource.get(s.source).push(s);
}
const sources = [...new Set(chosen.map((a) => a.source))].sort();
console.log(`${WRITE ? 'ЗАПИСЬ' : 'СУХОЙ ПРОГОН (ничего не пишется)'}: решений ${chosen.length}, постов ${sources.length}.\n`);
for (const sid of sources) {
	const r = results.find((x) => x.sid === sid);
	console.log(`■ ${byId.get(sid)?.title ?? sid}\n  ${SITE_URL}/posts/${sid}/`);
	for (const it of r?.items ?? []) {
		const extras = [it.rec.play ? 'играет здесь' : null, it.rec.label ? `подпись «${it.rec.label}»` : null, it.rec.manual ? 'своя цель' : null].filter(Boolean);
		console.log(`  + после абзаца, начинающегося со слов «${firstWords(it.place.anchorWords, 8)}…», — «${it.targetTitle}»${extras.length ? ` (${extras.join(', ')})` : ''}`);
		console.log(`      ${it.line}${it.how.startsWith('заново') ? `\n      место найдено ${it.how}` : ''}`);
	}
	for (const x of r?.unlinked ?? []) {
		console.log(`  ✂ снять ссылку на «${byId.get(x.rec.target)?.title ?? x.rec.target}» (${x.u.mode === 'words' ? 'слова остаются' : 'свой вариант'}) в абзаце «${firstWords(x.anchorWords, 8)}…»`);
		console.log(`      было:  ${x.u.from}\n      стало: ${x.u.to}`);
	}
	for (const a of already.filter((x) => x.source === sid)) console.log(`  · ${a.target}: вставка уже стоит, снимать нечего`);
	for (const s of skippedBySource.get(sid) ?? []) console.log(`  − пропуск ${s.key.split('→')[1]}: ${s.why}`);
	console.log('');
}
const nIns = results.reduce((n, r) => n + r.items.length, 0);
const nUn = results.reduce((n, r) => n + r.unlinked.length, 0);
console.log(`Итого: вписать ${nIns}, снять ссылок ${nUn}, уже стояло ${already.length}, пропусков ${skipped.length}.`);
if (lost.length) console.log(`Место потеряно, пересмотреть на странице: ${[...new Set(lost)].join(', ')}`);

if (!WRITE) {
	console.log('\nЭто сухой прогон. Запись — тем же набором ключей плюс --write.');
	process.exit(skipped.length ? 2 : 0);
}

// ——— Запись и страховка ———
const journal = journalBefore;
const tgToId = tgMapOf(postsDir);
const ytToIds = ytMapOf(postsDir);
const red = [];
const now = new Date().toISOString();
// --test-spoil: только для проверки страховки и только на копии постов —
// портит одну букву записанного, чтобы убедиться, что файл вернётся.
const spoil = args.includes('--test-spoil') && postsDir !== POSTS_DIR;
for (const r of results) {
	await writeFile(r.file, spoil ? Buffer.from(r.after.toString('utf8').replace('а', 'о'), 'utf8') : r.after);
	const check = verifyChange(r.before, await readFile(r.file), { unlinks: r.unlinked.map((x) => ({ target: x.rec.target, from: x.u.from, to: x.u.to })), tgToId, ytToIds });
	if (!check.ok) {
		await writeFile(r.file, r.before);
		const back = Buffer.compare(await readFile(r.file), r.before) === 0;
		red.push(`${r.sid}: ${check.problems.join('; ')} — файл ${back ? 'возвращён побайтно' : 'НЕ ВЕРНУЛСЯ, смотрите git'}`);
		continue;
	}
	for (const it of r.items) {
		const entry = {
			key: it.rec.key,
			source: r.sid,
			target: it.rec.target,
			afterWords: firstWords(it.place.anchorWords, 10),
			line: it.line,
			insertedAt: now,
		};
		const i = journal.findIndex((x) => x.key === entry.key);
		if (i >= 0) journal[i] = entry;
		else journal.push(entry);
	}
	for (const x of r.unlinked) {
		const e = journal.find((y) => y.key === x.rec.key);
		if (!e) throw new Error(`в журнале нет записи вставки ${x.rec.key} — снятие некуда записать`);
		(e.unlinks ??= []).push({ mode: x.u.mode, from: x.u.from, to: x.u.to, anchorWords: x.anchorWords, at: now });
	}
}
journal.sort((a, b) => a.key.localeCompare(b.key));
await writeAtomic(journalFile, JSON.stringify(journal, null, 1) + '\n');
console.log(`\nЗаписано постов: ${results.length - red.length}. Проверка диффа: ${red.length ? 'КРАСНЫЙ СВЕТ' : 'зелёная по всем файлам'}.`);
for (const x of red) console.log(`  ✗ ${x}`);
console.log(`Журнал: ${journalFile}`);
process.exitCode = red.length ? 1 : skipped.length ? 2 : 0;
