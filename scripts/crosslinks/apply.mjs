// ПЕРЕЛИНКОВКА — ВСТАВЛЯЛКА (сессия 3).
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
// После --write каждый изменённый файл сверяется с исходным (verify-diff.mjs):
// красный свет — файл возвращается побайтно, пост уходит в отчёт.
// Журнал — статус/перелинковка/вставлено.json (номер коммита дописывается
// после коммита: `--commit <хеш>` без отбора и без --write).

import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib.mjs';
import { parseBody } from '../archive-clean-lib.mjs';
import { toPlainText } from '../../src/lib/plainText.mjs';
import { SITE_URL } from '../../src/lib/site.mjs';
import { fingerprint, reanchor } from './review/fresh.mjs';
import { verifyInsertOnly } from './verify-diff.mjs';

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

// ——— Дописать номер коммита в журнал ———
if (opt('--commit')) {
	const journal = await readJournal();
	let n = 0;
	for (const x of journal) if (!x.commit) (x.commit = opt('--commit')), n++;
	await writeAtomic(journalFile, JSON.stringify(journal, null, 1) + '\n');
	console.log(`Номер коммита ${opt('--commit')} дописан к ${n} записям журнала.`);
	process.exit(0);
}

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
		skip('в посте уже стоит вставка на эту цель');
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
	results.push({ sid, file, before, after: Buffer.from(head + body, 'utf8'), items: items.slice().reverse() });
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
	for (const s of skippedBySource.get(sid) ?? []) console.log(`  − пропуск ${s.key.split('→')[1]}: ${s.why}`);
	console.log('');
}
const nIns = results.reduce((n, r) => n + r.items.length, 0);
console.log(`Итого: вписать ${nIns}, пропусков ${skipped.length}.`);
if (lost.length) console.log(`Место потеряно, пересмотреть на странице: ${[...new Set(lost)].join(', ')}`);

if (!WRITE) {
	console.log('\nЭто сухой прогон. Запись — тем же набором ключей плюс --write.');
	process.exit(skipped.length ? 2 : 0);
}

// ——— Запись и страховка ———
const journal = await readJournal();
const red = [];
const now = new Date().toISOString();
// --test-spoil: только для проверки страховки и только на копии постов —
// портит одну букву записанного, чтобы убедиться, что файл вернётся.
const spoil = args.includes('--test-spoil') && postsDir !== POSTS_DIR;
for (const r of results) {
	await writeFile(r.file, spoil ? Buffer.from(r.after.toString('utf8').replace('а', 'о'), 'utf8') : r.after);
	const check = verifyInsertOnly(r.before, await readFile(r.file));
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
			commit: null,
		};
		const i = journal.findIndex((x) => x.key === entry.key);
		if (i >= 0) journal[i] = entry;
		else journal.push(entry);
	}
}
journal.sort((a, b) => a.key.localeCompare(b.key));
await writeAtomic(journalFile, JSON.stringify(journal, null, 1) + '\n');
console.log(`\nЗаписано постов: ${results.length - red.length}. Проверка диффа: ${red.length ? 'КРАСНЫЙ СВЕТ' : 'зелёная по всем файлам'}.`);
for (const x of red) console.log(`  ✗ ${x}`);
console.log(`Журнал: ${journalFile}`);
process.exitCode = red.length ? 1 : skipped.length ? 2 : 0;
