// Разовый скрипт: найти в телах выпусков архива списки таймкодов
// и показать, что попало бы в поле «Таймкоды» (тз/08, 9.3).
//
// ПО УМОЛЧАНИЮ НИЧЕГО НЕ ПИШЕТ. Первый запуск — только чтение и отчёт:
// из 21 предложения по исправлению названий однажды не годилось ни одного,
// и тихо применённое предложение хуже неприменённого.
//
//     node scripts/timecodes-from-body.mjs           отчёт, файлы не трогаются
//     node scripts/timecodes-from-body.mjs --write   записать одобренное
//
// СВОЕГО РАЗБОРА ВРЕМЕНИ ЗДЕСЬ НЕТ НИ СТРОЧКИ. И формат таймкода,
// и разбор списка берутся из src/lib/timecode.mjs — оттуда же, откуда их
// берут страница выпуска и метки в тексте. Заведи скрипт свою копию правил,
// он разобрал бы архив не так, как потом покажет сайт, и разошлись бы они
// молча: «1:02:11» в одном месте час с минутами, в другом минута с секундами.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { TIMECODE_SOURCE, parseTimecodeList } from '../src/lib/timecode.mjs';

const DIR = 'src/content/posts';
const WRITE = process.argv.includes('--write');

// Материалы, у которых бывает оглавление: выпуск подкаста и видеоэссе.
const CATEGORIES = new Set(['podcast', 'videoessay']);

// ЧТО СЧИТАЕТСЯ СТРОКОЙ СПИСКА — ЗДЕСЬ ТОЛЬКО МЕСТО ТАЙМКОДА В СТРОКЕ.
// Сам формат времени спрашивается у общего модуля.
//
// Строка — кандидат, если после необязательного маркера списка markdown
// она НАЧИНАЕТСЯ с таймкода. Таймкод, стоящий внутри фразы («на 12:04 мы
// обсуждали»), кандидатом не становится никогда: это текст автора,
// и трогать его нельзя.
const LIST_MARKER = '(?:[-*+•]|\\d+[.)])\\s+';
const CANDIDATE_RE = new RegExp(`^(?:${LIST_MARKER})?${TIMECODE_SOURCE}`);

// Подпись списка, скопированная из шоунотов вместе с ним. К группе относится,
// но темой не является — parseTimecodeList её и так пропускает молча.
const HEADING_RE = /^тайм.?коды\s*:?$/i;

// Разрыв между соседними темами. Замер архива: разрывов больше двух строк
// (то есть больше одной пустой строки подряд) не встречается ни разу,
// а двойка — обычный случай, когда каждая тема набрана отдельным абзацем.
const MAX_GAP = 2;

// Оглавление из одной строки оглавлением не бывает. Замер архива: такая
// группа ровно одна (ep-135, «12:04 — Новый блок»), и это вставленный пример,
// а не список. Одиночки показываем отдельно и в поле не предлагаем.
const MIN_ROWS = 2;

/** Шапка и тело поста. Шапку НЕ разбираем — читаем из неё только строки. */
function splitPost(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { head: '', body: raw };
	return { head: match[1], body: match[2] };
}

function headField(head, name) {
	const match = head.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'));
	return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

/** Есть ли у поста непустое поле «Таймкоды». */
function hasTimecodesField(head) {
	const match = head.match(/^timecodes:\s*(.*)$/m);
	if (!match) return false;
	const inline = match[1].trim();
	// «|-» и «|» значат, что значение лежит следующими строками с отступом.
	return inline.startsWith('|') || inline.startsWith('>') ? true : inline !== '' && inline !== "''";
}

/**
 * Группы строк-кандидатов в теле поста.
 *
 * @returns {{ start: number, lines: {n: number, text: string}[], heading: string|null, gaps: number[] }[]}
 */
function findGroups(body) {
	const lines = body.split('\n');
	const hits = [];

	lines.forEach((line, i) => {
		if (CANDIDATE_RE.test(line.trim())) hits.push(i);
	});

	const groups = [];
	let current = [];

	for (const i of hits) {
		if (current.length && i - current[current.length - 1] > MAX_GAP) {
			groups.push(current);
			current = [];
		}
		current.push(i);
	}
	if (current.length) groups.push(current);

	return groups.map((idx) => {
		// Подпись «Таймкоды» — ближайшая непустая строка перед группой.
		let heading = null;
		for (let i = idx[0] - 1; i >= 0 && i >= idx[0] - 3; i--) {
			const text = lines[i].trim().replace(/^[#*\s]+|[*\s]+$/g, '');
			if (!text) continue;
			if (HEADING_RE.test(text)) heading = lines[i].trim();
			break;
		}
		const gaps = idx.slice(1).map((n, k) => n - idx[k]);
		return {
			start: idx[0],
			heading,
			gaps,
			lines: idx.map((n) => ({ n: n + 1, text: lines[n].trim() })),
		};
	});
}

/** Как список набран в теле — для решения, вырезать его оттуда или нет. */
function bodyShape(group) {
	const solid = group.gaps.every((g) => g === 1);
	const spaced = group.gaps.every((g) => g === 2);
	const marker = group.lines.some((l) => new RegExp(`^${LIST_MARKER}`).test(l.text));
	const parts = [];
	if (marker) parts.push('маркерами markdown');
	else if (solid) parts.push('сплошным куском');
	else if (spaced) parts.push('каждая тема отдельным абзацем');
	else parts.push('вперемешку');
	parts.push(group.heading ? 'с подписью «Таймкоды» сверху' : 'без подписи сверху');
	return parts.join(', ');
}

/** Значение поля так, как его пишет Sveltia: блок «|-» с отступом в два пробела. */
function yamlBlock(text) {
	return `timecodes: |-\n${text.split('\n').map((l) => `  ${l}`).join('\n')}`;
}

// ─────────────────────────────────────────────────────────────────────────────

const files = readdirSync(DIR).filter((f) => f.endsWith('.md')).sort();

let episodesTotal = 0; // выпуски и видеоэссе, включая черновики
const already = [];   // поле уже заполнено — не трогаем
const found = [];     // список в теле найден
const missing = [];   // списка в теле нет
const singles = [];   // одиночная строка — не список
const otherCat = [];  // таймкоды нашлись у материала не той категории
const warnings = [];  // строки, которые разбор не понял

for (const file of files) {
	const raw = readFileSync(`${DIR}/${file}`, 'utf8');
	const { head, body } = splitPost(raw);
	const category = headField(head, 'category');
	const post = {
		file,
		title: headField(head, 'title'),
		category,
		draft: headField(head, 'draft') === 'true',
	};

	const groups = findGroups(body);

	if (!CATEGORIES.has(category)) {
		if (groups.length) otherCat.push({ ...post, groups });
		continue;
	}

	episodesTotal++;

	if (hasTimecodesField(head)) {
		already.push({ ...post, inBody: groups.length > 0 });
		continue;
	}

	const real = groups.filter((g) => g.lines.length >= MIN_ROWS);
	for (const g of groups) {
		if (g.lines.length < MIN_ROWS) singles.push({ ...post, group: g });
	}

	if (!real.length) {
		missing.push(post);
		continue;
	}

	// Разбор — ТОЛЬКО общим parseTimecodeList. Подпись «Таймкоды» отдаём ему
	// вместе со списком: он умеет её пропускать, и проверять это второй раз
	// значило бы завести здесь второе правило.
	for (const group of real) {
		const source = [group.heading, ...group.lines.map((l) => l.text)].filter(Boolean).join('\n');
		const rowWarnings = [];
		const rows = parseTimecodeList(source, (m) => rowWarnings.push(m));

		const lost = group.lines.length - rows.length;
		for (const message of rowWarnings) warnings.push({ ...post, message });

		found.push({ ...post, group, rows, lost, warnings: rowWarnings });
	}
}

// ─────────────────────────────────────────── отчёт

const foundFiles = new Set(found.map((f) => f.file));
const totalRows = found.reduce((n, f) => n + f.rows.length, 0);
const totalLines = found.reduce((n, f) => n + f.group.lines.length, 0);

console.log('╔══ РАЗБОР ТАЙМКОДОВ ИЗ ТЕЛ ВЫПУСКОВ ═══════════════════════════════════');
console.log('║ Ничего не записано. Это чтение и печать.');
console.log('╚═══════════════════════════════════════════════════════════════════════\n');

console.log('СЧЁТ');
console.log(`  файлов в src/content/posts: ${files.length}`);
console.log(`  из них выпуски и видеоэссе (с черновиками): ${episodesTotal}`);
console.log(`  поле «Таймкоды» уже заполнено: ${already.length} — не трогаем`);
console.log(`  список в теле найден: ${foundFiles.size} выпусков, ${found.length} списков`);
console.log(`  списка в теле нет: ${missing.length}`);
console.log(`  строк в найденных списках: ${totalLines}`);
console.log(`  из них разобралось: ${totalRows}`);
console.log(`  не разобралось: ${totalLines - totalRows}`);
console.log(`  одиночных строк (не список): ${singles.length}`);
console.log(`  таймкоды у материала другой категории: ${otherCat.length}\n`);

console.log('ПОЛЕ УЖЕ ЗАПОЛНЕНО — ЭТИ ВЫПУСКИ НЕ ТРОГАЮТСЯ');
for (const p of already) {
	console.log(`  ${p.file}  ${p.title}`);
	console.log(`      список в теле ${p.inBody ? 'ЕЩЁ ЕСТЬ — вышел бы дважды' : 'убран из тела'}`);
}
console.log('');

const SHOW = Number(process.env.SHOW || 4);
console.log(`РАЗБОР ЦЕЛИКОМ — ПЕРВЫЕ ${SHOW} ВЫПУСКА`);
for (const f of found.slice(0, SHOW)) {
	console.log(`\n  ─── ${f.file} · ${f.title}`);
	console.log(`      в теле: строки ${f.group.lines[0].n}–${f.group.lines[f.group.lines.length - 1].n}, ${bodyShape(f.group)}`);
	console.log('      ЧТО СТОИТ В ТЕЛЕ:');
	if (f.group.heading) console.log(`        │ ${f.group.heading}`);
	for (const l of f.group.lines) console.log(`        │ ${l.text}`);
	console.log('      ЧТО ПОПАЛО БЫ В ПОЛЕ (шапка поста):');
	for (const line of yamlBlock(f.rows.map((r) => `${r.time} — ${r.title}`).join('\n')).split('\n')) {
		console.log(`        │ ${line}`);
	}
	console.log('      ЧТО ПОКАЖЕТ СТРАНИЦА:');
	for (const r of f.rows) console.log(`        │ ${String(r.seconds).padStart(6)} с  ${r.time.padStart(8)}  ${r.title}`);
	if (f.warnings.length) for (const w of f.warnings) console.log(`      ! ${w}`);
}
console.log('');

console.log('НЕ РАЗОБРАЛОСЬ — ПО СТРОКАМ');
if (!warnings.length) console.log('  (пусто — разобрались все строки всех найденных списков)');
for (const w of warnings) console.log(`  ${w.file}: ${w.message}`);
console.log('');

console.log('ОДИНОЧНЫЕ СТРОКИ — В ПОЛЕ НЕ ПРЕДЛАГАЮТСЯ, РЕШАТЬ ВАМ');
if (!singles.length) console.log('  (пусто)');
for (const s of singles) {
	console.log(`  ${s.file} строка ${s.group.lines[0].n}: «${s.group.lines[0].text}»`);
}
console.log('');

if (otherCat.length) {
	console.log('ТАЙМКОДЫ У МАТЕРИАЛА ДРУГОЙ КАТЕГОРИИ — НЕ ТРОГАЕМ');
	for (const p of otherCat) console.log(`  ${p.file} (${p.category}): ${p.groups.length} групп`);
	console.log('');
}

console.log('ЕСЛИ СПИСОК ОСТАВИТЬ В ТЕЛЕ — ОН ВЫЙДЕТ НА СТРАНИЦЕ ДВАЖДЫ');
console.log(`  таких выпусков: ${found.length}`);
const shapes = new Map();
for (const f of found) {
	const shape = bodyShape(f.group);
	shapes.set(shape, (shapes.get(shape) || 0) + 1);
}
for (const [shape, n] of [...shapes].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${String(n).padStart(4)} — ${shape}`);
}
console.log('');

console.log('СПИСКА В ТЕЛЕ НЕТ');
console.log(`  ${missing.length} выпусков:`);
console.log('  ' + missing.map((p) => p.file.replace('.md', '')).join(', '));
console.log('');

// ─────────────────────────────────────────── запись, только по ключу

if (!WRITE) {
	console.log('Записать: node scripts/timecodes-from-body.mjs --write');
	process.exit(0);
}

// Поле ставится ПЕРЕД audioGuid: ровно там его держит Sveltia в обоих
// выпусках, где заказчик заполнил поле руками (ep-107 и ep-146). Нет
// audioGuid — в конец шапки.
let written = 0;
for (const f of found) {
	const path = `${DIR}/${f.file}`;
	const raw = readFileSync(path, 'utf8');
	const { head, body } = splitPost(raw);
	const block = yamlBlock(f.rows.map((r) => `${r.time} — ${r.title}`).join('\n'));

	const lines = head.split('\n');
	const at = lines.findIndex((l) => /^audioGuid:/.test(l));
	if (at === -1) lines.push(...block.split('\n'));
	else lines.splice(at, 0, ...block.split('\n'));

	writeFileSync(path, `---\n${lines.join('\n')}\n---\n${body}`);
	written++;
	console.log(`записан ${f.file}`);
}
console.log(`\nЗаписано выпусков: ${written}. Тела постов не тронуты.`);
