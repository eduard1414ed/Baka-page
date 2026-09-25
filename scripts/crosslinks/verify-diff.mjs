// ПЕРЕЛИНКОВКА — ПРОВЕРКА ДИФФА (сессия 3, снятие ссылок — сессия 3б).
//
//   node scripts/crosslinks/verify-diff.mjs                 — изменённые посты рабочей копии против HEAD
//   node scripts/crosslinks/verify-diff.mjs --against <ref> — против другой версии (например, main)
//   node scripts/crosslinks/verify-diff.mjs <файл> …         — только эти файлы
//
// Исключение из правила «опубликованные посты не правим» (CLAUDE.md, проект
// «Перелинковка») узкое, и правок в нём ровно два вида:
//   1. ДОБАВИТЬ строку `::material{…}` и пустые строки вокруг неё;
//   2. СНЯТЬ ССЫЛКУ-ДУБЛЬ: в строке абзаца, сразу после которого стоит вставка
//      на цель X, кусок «было» из журнала заменён на «стало» из журнала.
// Больше ничего. Здесь это проверяется так:
//
//   1. Файлы сравниваются ПОБАЙТНО: строки режутся по байту \n, а читаются
//      как latin1 — любой изменённый байт, \r, потерянный перевод строки
//      в конце файла, другая кодировка видны как разница.
//   2. Новые строки блока вынимаются из «после» вместе с пустыми строками
//      вокруг, а на их место ставится промежуток той длины, что стоял
//      в «до». Длина берётся у «до», но не больше, чем пустых строк было
//      вокруг блока: промежуток можно только РАСШИРИТЬ, а не сузить.
//   3. Строка, отличающаяся от «до», законна, только если она получается из
//      строки «до» заменами из журнала — каждая ровно один раз, «было»
//      встречается в строке ровно однажды, и больше в строке не изменилось
//      ни байта. Каждая запись журнала обязана найтись в файле ровно один раз.
//   4. У каждой замены: в «было» есть ссылка на цель X (адрес на сайте или
//      пост в телеграме), в «стало» ссылки на X нет, а за абзацем с этой
//      строкой (через пустые строки и картинки) стоит `::material{id="X"…}` —
//      новый или бывший там раньше. Нет вставки — снимать дубль нечему.
//   5. Всё остальное обязано совпасть с «до» байт в байт.
//
// Строка блока — только такого вида, как у 71 вставки Эда: id, потом label,
// потом mode="play". Блок в шапке поста (фронтматтере) — красный свет.
//
// Журнал снятий — поле `unlinks` у записи статус/перелинковка/вставлено.json.
// В командной строке новыми считаются снятия, которых нет в журнале версии
// `--against` (по умолчанию HEAD).
//
// Ничего не пишет. Вставлялка (apply.mjs) зовёт verifyChange сама после
// записи и при красном свете возвращает файл.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embeddedYoutube, occurrences, targetsOfUrl, urlsIn } from './unlink.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

export const MATERIAL_LINE = /^::material\{id="[^"\n]+"(?: label="[^"\n]*")?(?: mode="play")?\}$/;

const lines = (buf) => Buffer.from(buf).toString('latin1').split('\n');
const show = (s) => Buffer.from(s, 'latin1').toString('utf8');

/** Номер строки, закрывающей шапку `---` (или -1, если шапки нет). */
function frontEnd(L) {
	if (L[0] !== '---') return -1;
	for (let i = 1; i < L.length; i++) if (L[i] === '---') return i;
	return -1;
}

const toLatin = (s) => Buffer.from(String(s), 'utf8').toString('latin1');

/**
 * Замены из журнала, превращающие строку «до» в строку «после».
 * Кандидаты — записи, чьё «было» встречается в строке ровно однажды;
 * перебираются все наборы (их единицы — в одной строке редко больше двух).
 * @returns {number[]|null} номера использованных записей
 */
function matchLine(b, a, pool, used) {
	const cand = pool.map((u, k) => k).filter((k) => !used[k] && occurrences(b, pool[k].fromL) === 1);
	for (let mask = 1; mask < 1 << cand.length; mask++) {
		const pick = cand.filter((_, i) => mask & (1 << i));
		let cur = b;
		let okAll = true;
		for (const k of pick) {
			if (occurrences(cur, pool[k].fromL) !== 1) {
				okAll = false;
				break;
			}
			cur = cur.replace(pool[k].fromL, () => pool[k].toL);
		}
		if (okAll && cur === a) return pick;
	}
	return null;
}

// Между абзацем и вставкой могут стоять картинки и служебная строка раздела
// `##### Количество серий: 6` (так же в apply.mjs, isImageNode).
const IMAGE_LINE = /^(?:!\[|::(?:image|gallery|video)\b|#{5,6}\s)/u;

/**
 * @param {Buffer|string} before
 * @param {Buffer|string} after
 * @param {{ unlinks?: {target:string, from:string, to:string}[], tgToId?: (n:string)=>string|null }} [opts]
 *        unlinks — снятия, которые должны быть в этом файле (из журнала)
 * @returns {{ ok: boolean, problems: string[], added: string[], unlinked: number }}
 */
export function verifyChange(before, after, { unlinks = [], tgToId = () => null, ytToIds = () => [] } = {}) {
	const B = lines(before);
	const A = lines(after);
	const problems = [];
	const pool = unlinks.map((u) => ({ ...u, fromL: toLatin(u.from), toL: toLatin(u.to) }));
	const used = pool.map(() => false);
	const usedAt = pool.map(() => -1); // строка «после»
	const count = (L, s) => L.filter((x) => x === s).length;

	// Новые строки блока: те, которых в «после» больше, чем в «до».
	const isNew = new Array(A.length).fill(false);
	const seen = new Map();
	for (let j = 0; j < A.length; j++) {
		if (!A[j].startsWith('::material')) continue;
		const k = (seen.get(A[j]) ?? 0) + 1;
		seen.set(A[j], k);
		if (k > count(B, A[j])) isNew[j] = true;
	}
	const added = A.filter((_, j) => isNew[j]).map(show);
	for (const l of added) if (!MATERIAL_LINE.test(l)) problems.push(`строка блока не по образцу: ${l}`);
	const fe = frontEnd(A);
	A.forEach((l, j) => {
		if (!isNew[j]) return;
		if (j <= fe) problems.push(`блок в шапке поста, строка ${j + 1}`);
		// Вплотную к строке текста блок читается частью абзаца или списка:
		// пустая строка обязана быть и перед ним, и после (в конце файла «после» —
		// это завершающий перевод строки).
		if (A[j - 1] !== '' || A[j + 1] !== '') problems.push(`блок на строке ${j + 1} стоит вплотную к тексту, без пустой строки`);
	});

	// Разбор: «после» = куски, между ними — [пустые, блок, пустые].
	let i = 0; // позиция в «до»
	let j = 0; // позиция в «после»
	const fail = (why) => {
		problems.push(why);
		return { ok: false, problems, added, unlinked: 0 };
	};
	while (j < A.length) {
		// Где следующий новый блок?
		let m = j;
		while (m < A.length && !isNew[m]) m++;
		// Кусок до пустых строк перед блоком — обязан совпасть с «до» как есть.
		let pieceEnd = m;
		if (m < A.length) while (pieceEnd > j && A[pieceEnd - 1] === '') pieceEnd--;
		for (let x = j; x < pieceEnd; x++, i++) {
			if (i >= B.length) return fail(`строка ${x + 1} «после» лишняя: ${show(A[x]).slice(0, 80)}`);
			if (A[x] !== B[i]) {
				const pick = matchLine(B[i], A[x], pool, used);
				if (!pick) return fail(`строка ${i + 1} изменена не по журналу:\n    было:  ${show(B[i]).slice(0, 160)}\n    стало: ${show(A[x]).slice(0, 160)}`);
				for (const k of pick) (used[k] = true), (usedAt[k] = x);
			}
		}
		if (m >= A.length) break;
		// Пустые до блока, блок, пустые после (и следующие блоки подряд).
		let blanks = m - pieceEnd;
		let k = m;
		while (k < A.length && (isNew[k] || A[k] === '')) {
			if (A[k] === '') blanks++;
			k++;
		}
		// Конец файла: последний элемент разбиения — пустая строка после \n.
		const atEof = k >= A.length;
		let orig = 0;
		while (i + orig < B.length && B[i + orig] === '') orig++;
		if (atEof) {
			// «…текст\n» → «…текст\n\n\n::material{…}\n»: хвост «до» — одна пустая
			// (признак завершающего перевода строки), и она обязана остаться.
			if (i + orig !== B.length) return fail(`после блока в конце файла в «до» было ещё: ${show(B[i + orig] ?? '').slice(0, 80)}`);
			if (orig > blanks) return fail(`в конце файла убраны пустые строки или перевод строки (было ${orig}, стало ${blanks})`);
			if (A[A.length - 1] !== '') return fail('потерян перевод строки в конце файла');
			i = B.length;
			j = A.length;
			break;
		}
		if (orig > blanks) return fail(`у строки ${i + 1} «до» убраны пустые строки: было ${orig}, вокруг блока ${blanks}`);
		if (orig === 0 && pieceEnd > 0) return fail(`блок вставлен внутрь абзаца (у строки ${i + 1} «до» не было пустой строки)`);
		i += orig;
		j = k;
	}
	if (i !== B.length) return fail(`из «до» пропали строки начиная с ${i + 1}: ${show(B[i]).slice(0, 80)}`);

	// Снятия: каждое найдено, ссылка — на ту цель, и стоит она перед вставкой.
	pool.forEach((u, k) => {
		const name = `снятие «${u.from.slice(0, 60)}» (цель ${u.target})`;
		if (!used[k]) return problems.push(`${name}: в журнале есть, в файле не найдено`);
		const hits = (url) => targetsOfUrl(url, tgToId, ytToIds).includes(u.target);
		if (!urlsIn(u.from).some(hits)) problems.push(`${name}: в «было» нет ссылки на эту цель`);
		if (urlsIn(u.to).some(hits)) problems.push(`${name}: в «стало» осталась ссылка на эту цель`);
		// Абзац со строкой → конец абзаца → через пустые и картинки → вставка на цель.
		let y = usedAt[k];
		while (y + 1 < A.length && A[y + 1] !== '') y++;
		y++;
		while (y < A.length && (A[y] === '' || IMAGE_LINE.test(A[y]))) {
			if (A[y] !== '' && IMAGE_LINE.test(A[y])) {
				// картинка — пропускаем её строки до пустой
				while (y < A.length && A[y] !== '') y++;
			} else y++;
		}
		const m = y < A.length ? show(A[y]).match(/^::material\{id="([^"]+)"/u) : null;
		if (m?.[1] !== u.target) problems.push(`${name}: ссылка снята не в абзаце перед вставкой на эту цель (дальше идёт «${show(A[y] ?? '').slice(0, 50)}»)`);
	});
	if (!added.length && !pool.length && Buffer.compare(Buffer.from(before), Buffer.from(after)) !== 0) return fail('файлы различаются, а нового блока нет');
	return { ok: problems.length === 0, problems, added, unlinked: used.filter(Boolean).length };
}

/** Прежнее имя: только новые блоки, без снятий. */
export const verifyInsertOnly = (before, after) => verifyChange(before, after);

// ——— Журнал снятий: что добавилось по сравнению с версией ref ———
export function newUnlinks(journalNow, journalRef) {
	const was = new Set((journalRef ?? []).flatMap((x) => (x.unlinks ?? []).map((u) => JSON.stringify([x.source, x.target, u.from, u.to]))));
	return (journalNow ?? []).flatMap((x) => (x.unlinks ?? []).filter((u) => !was.has(JSON.stringify([x.source, x.target, u.from, u.to]))).map((u) => ({ source: x.source, target: x.target, from: u.from, to: u.to })));
}

/** Номер поста в телеграме → id поста сайта (поле tgId), по папке постов. */
export function tgMapOf(postsDir) {
	const map = new Map();
	for (const f of readdirSync(postsDir).filter((x) => x.endsWith('.md'))) {
		const m = readFileSync(join(postsDir, f), 'utf8').match(/^tgId:\s*['"]?(\d+)/mu);
		if (m) map.set(m[1], f.slice(0, -3));
	}
	return (n) => map.get(String(n)) ?? null;
}

/** Ролик YouTube → посты, в которые он встроен (::video), по папке постов. */
export function ytMapOf(postsDir) {
	const map = new Map();
	for (const f of readdirSync(postsDir).filter((x) => x.endsWith('.md')))
		for (const v of embeddedYoutube(readFileSync(join(postsDir, f), 'utf8'))) map.set(v, [...(map.get(v) ?? []), f.slice(0, -3)]);
	return (v) => map.get(v) ?? [];
}

// ——— Командная строка ———
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const ref = args.includes('--against') ? args[args.indexOf('--against') + 1] : 'HEAD';
	let files = args.filter((a, n) => !a.startsWith('--') && args[n - 1] !== '--against');
	if (!files.length) {
		const out = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--name-only', '-z', ref, '--', 'src/content/posts/'], { cwd: REPO });
		files = out.toString('utf8').split('\0').filter(Boolean);
	}
	const JOURNAL = 'статус/перелинковка/вставлено.json';
	const journalNow = JSON.parse(readFileSync(join(REPO, JOURNAL), 'utf8'));
	let journalRef = [];
	try {
		journalRef = JSON.parse(execFileSync('git', ['show', `${ref}:${JOURNAL}`], { cwd: REPO, maxBuffer: 1 << 26 }).toString('utf8'));
	} catch {
		// Журнала в ref ещё не было — новые все.
	}
	const fresh = newUnlinks(journalNow, journalRef);
	const tgToId = tgMapOf(join(REPO, 'src/content/posts'));
	const ytToIds = ytMapOf(join(REPO, 'src/content/posts'));
	let bad = 0;
	const seen = new Set();
	for (const f of files) {
		const rel = f.startsWith('/') ? f.slice(REPO.length) : f;
		const id = rel.split('/').pop().replace(/\.md$/u, '');
		seen.add(id);
		let before;
		try {
			before = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: REPO, maxBuffer: 1 << 26 });
		} catch {
			console.log(`✗ ${rel}: файла нет в ${ref} — новый файл постов вставлялка не создаёт`);
			bad++;
			continue;
		}
		const r = verifyChange(before, readFileSync(resolve(REPO, rel)), { unlinks: fresh.filter((u) => u.source === id), tgToId, ytToIds });
		if (r.ok) console.log(`✓ ${rel}: новых блоков ${r.added.length}, снятых ссылок ${r.unlinked}`);
		else {
			bad++;
			console.log(`✗ ${rel}:\n  ${r.problems.join('\n  ')}`);
		}
	}
	for (const u of fresh.filter((u) => !seen.has(u.source))) {
		bad++;
		console.log(`✗ ${u.source}: в журнале новое снятие «${u.from.slice(0, 60)}», а файл поста не изменён`);
	}
	const n = files.length;
	console.log(n || fresh.length ? (bad ? `КРАСНЫЙ СВЕТ: ${bad}` : `Зелёный: ${n} из ${n}`) : 'Изменённых постов нет.');
	process.exitCode = bad ? 1 : 0;
}
