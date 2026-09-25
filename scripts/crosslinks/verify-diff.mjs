// ПЕРЕЛИНКОВКА — ПРОВЕРКА ДИФФА (сессия 3). Страховка вставлялки.
//
//   node scripts/crosslinks/verify-diff.mjs                 — изменённые посты рабочей копии против HEAD
//   node scripts/crosslinks/verify-diff.mjs --against <ref> — против другой версии (например, main)
//   node scripts/crosslinks/verify-diff.mjs <файл> …         — только эти файлы
//
// Исключение из правила «опубликованные посты не правим» (CLAUDE.md, проект
// «Перелинковка») узкое: в пост можно ДОБАВИТЬ строку `::material{…}` и пустые
// строки вокруг неё. Больше ничего. Здесь это проверяется так:
//
//   1. Файлы сравниваются ПОБАЙТНО: строки режутся по байту \n, а читаются
//      как latin1 — любой изменённый байт, \r, потерянный перевод строки
//      в конце файла, другая кодировка видны как разница.
//   2. Новые строки блока вынимаются из «после» вместе с пустыми строками
//      вокруг, а на их место ставится промежуток той длины, что стоял
//      в «до». Длина берётся у «до», но не больше, чем пустых строк было
//      вокруг блока: промежуток можно только РАСШИРИТЬ, а не сузить.
//   3. Всё остальное обязано совпасть с «до» байт в байт.
//
// Строка блока — только такого вида, как у 71 вставки Эда: id, потом label,
// потом mode="play". Блок в шапке поста (фронтматтере) — красный свет.
//
// Ничего не пишет. Вставлялка (apply.mjs) зовёт verifyInsertOnly сама после
// записи и при красном свете возвращает файл.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * @param {Buffer|string} before
 * @param {Buffer|string} after
 * @returns {{ ok: boolean, problems: string[], added: string[] }}
 */
export function verifyInsertOnly(before, after) {
	const B = lines(before);
	const A = lines(after);
	const problems = [];
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
		return { ok: false, problems, added };
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
			if (A[x] !== B[i]) return fail(`строка ${i + 1} изменена:\n    было:  ${show(B[i]).slice(0, 120)}\n    стало: ${show(A[x]).slice(0, 120)}`);
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
	if (!added.length && Buffer.compare(Buffer.from(before), Buffer.from(after)) !== 0) return fail('файлы различаются, а нового блока нет');
	return { ok: problems.length === 0, problems, added };
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
	let bad = 0;
	for (const f of files) {
		const rel = f.startsWith('/') ? f.slice(REPO.length) : f;
		let before;
		try {
			before = execFileSync('git', ['show', `${ref}:${rel}`], { cwd: REPO, maxBuffer: 1 << 26 });
		} catch {
			console.log(`✗ ${rel}: файла нет в ${ref} — новый файл постов вставлялка не создаёт`);
			bad++;
			continue;
		}
		const r = verifyInsertOnly(before, readFileSync(resolve(REPO, rel)));
		if (r.ok) console.log(`✓ ${rel}: только новые блоки (${r.added.length})`);
		else {
			bad++;
			console.log(`✗ ${rel}:\n  ${r.problems.join('\n  ')}`);
		}
	}
	console.log(files.length ? (bad ? `КРАСНЫЙ СВЕТ: ${bad} из ${files.length}` : `Зелёный: ${files.length} из ${files.length}`) : 'Изменённых постов нет.');
	process.exitCode = bad ? 1 : 0;
}
