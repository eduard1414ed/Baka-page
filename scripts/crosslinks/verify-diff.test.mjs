// ПЕРЕЛИНКОВКА — ПРОВЕРКА СТРАХОВКИ (сессия 3). Настоящие посты не трогает.
//
//   node scripts/crosslinks/verify-diff.test.mjs
//
// 1. Копирует папку постов во временную, прогоняет НАСТОЯЩУЮ вставлялку
//    (apply.mjs --write --posts-dir <копия> --journal <копия>) по пачке 1
//    и сверяет каждую копию с оригиналом: зелёный.
// 2. Подлоги на копиях — проверка обязана покраснеть на каждом:
//    изменённая буква в тексте, удалённая пустая строка, изменённый фронтматтер;
//    и ещё три: лишняя пустая строка без блока, блок внутри абзаца,
//    потерянный перевод строки в конце файла.
// 3. Здоровое, которого в пачке нет: вставка в самый конец файла — зелёный.
// 4. Вставлялка сама краснеет и возвращает файл: подлог её собственного
//    вывода (--tamper-after-write в тесте не нужен — проверяем verifyInsertOnly
//    на тех же данных, что она зовёт).
//
// Код возврата 0 — всё как ожидалось.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyInsertOnly } from './verify-diff.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const POSTS = join(REPO, 'src/content/posts');
const tmp = mkdtempSync(join(tmpdir(), 'crosslinks-verify-'));
const copy = join(tmp, 'posts');
let bad = 0;
const say = (ok, what) => {
	if (!ok) bad++;
	console.log(`${ok ? 'ок    ' : 'ПЛОХО '} ${what}`);
};

try {
	cpSync(POSTS, copy, { recursive: true });
	const out = execFileSync('node', [join(REPO, 'scripts/crosslinks/apply.mjs'), '--batch', '1', '--write', '--posts-dir', copy, '--journal', join(tmp, 'вставлено.json')], { cwd: REPO, encoding: 'utf8' });
	say(/зелёная по всем файлам/.test(out), 'вставлялка на копиях: «проверка диффа зелёная по всем файлам»');

	const changed = readdirSync(copy).filter((f) => Buffer.compare(readFileSync(join(copy, f)), readFileSync(join(POSTS, f))) !== 0);
	say(changed.length === 15, `изменено копий: ${changed.length} (ждём 15)`);
	for (const f of changed) {
		const r = verifyInsertOnly(readFileSync(join(POSTS, f)), readFileSync(join(copy, f)));
		say(r.ok, `${f}: зелёный, новых блоков ${r.added.length}${r.ok ? '' : ' — ' + r.problems.join('; ')}`);
	}
	const journal = JSON.parse(readFileSync(join(tmp, 'вставлено.json'), 'utf8'));
	say(journal.length === 22, `журнал на копии: ${journal.length} записей (ждём 22)`);

	// ——— Подлоги: берём настоящую пару «до/после» и портим «после» ———
	const f = changed.find((x) => x.startsWith('spisok-pyati')) ?? changed[0];
	const before = readFileSync(join(POSTS, f), 'utf8');
	const after = readFileSync(join(copy, f), 'utf8');
	const red = (name, spoiled) => {
		if (spoiled === after) return say(false, `подлог «${name}» ничего не заменил — проверять нечего`);
		const r = verifyInsertOnly(before, spoiled);
		say(!r.ok, `подлог «${name}» → ${r.ok ? 'ЗЕЛЁНЫЙ (проверка слепа!)' : 'красный: ' + r.problems[0].split('\n')[0]}`);
	};
	const fmEnd = after.indexOf('\n---', 3);
	const bodyStart = fmEnd + 4;
	// буква в тексте: первая русская «а» в теле → «о»
	const at = after.indexOf('а', bodyStart);
	red('изменённая буква в тексте', after.slice(0, at) + 'о' + after.slice(at + 1));
	// удалённая пустая строка — вдали от вставок: первый двойной перевод строки в теле
	const gap = after.indexOf('\n\n', bodyStart + 5);
	red('удалённая пустая строка', after.slice(0, gap) + after.slice(gap + 1));
	// фронтматтер: у заголовка дописан пробел
	red('изменённый фронтматтер', after.replace(/^title: (.*)$/m, 'title: $1 '));
	red('лишняя пустая строка без блока', after.replace('\n\n', '\n\n\n'));
	const para = after.indexOf('\n', after.indexOf('\n\n', bodyStart + 5) + 2);
	red('блок посреди абзаца', after.slice(0, para) + '\n::material{id="ep-1"}' + after.slice(para));
	red('потерян перевод строки в конце файла', after.replace(/\n$/, ''));
	red('\\r\\n вместо \\n', after.replaceAll('\n', '\r\n'));

	// ——— Вставлялка сама возвращает файл при красном свете ———
	cpSync(POSTS, copy, { recursive: true });
	let spoiled = '';
	try {
		execFileSync('node', [join(REPO, 'scripts/crosslinks/apply.mjs'), '--batch', '1', '--write', '--test-spoil', '--posts-dir', copy, '--journal', join(tmp, 'вставлено-2.json')], { cwd: REPO, encoding: 'utf8' });
	} catch (e) {
		spoiled = e.stdout;
	}
	const back = readdirSync(copy).every((x) => Buffer.compare(readFileSync(join(copy, x)), readFileSync(join(POSTS, x))) === 0);
	say(/КРАСНЫЙ СВЕТ/.test(spoiled) && back, `вставлялка с порчей: красный свет, все 15 копий возвращены побайтно (${back ? 'да' : 'НЕТ'})`);
	say(JSON.parse(readFileSync(join(tmp, 'вставлено-2.json'), 'utf8')).length === 0, 'в журнал красные вставки не попали');

	// ——— Здоровое вне пачки: вставка в самый конец файла ———
	const eof = verifyInsertOnly('---\ntitle: x\n---\n\nАбзац.\n', '---\ntitle: x\n---\n\nАбзац.\n\n\n::material{id="ep-1"}\n');
	say(eof.ok, `вставка в конец файла — зелёный${eof.ok ? '' : ': ' + eof.problems.join('; ')}`);
	const same = verifyInsertOnly(before, before);
	say(same.ok && same.added.length === 0, 'файл без изменений — зелёный, новых блоков 0');
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
const clean = execFileSync('git', ['status', '--porcelain', '-z', '--', 'src/content/posts/'], { cwd: REPO }).length === 0;
say(clean, 'настоящие посты не тронуты (git status по src/content/posts пуст)');
console.log(bad ? `\nПЛОХО: ${bad}` : '\nВсе проверки прошли.');
process.exitCode = bad ? 1 : 0;
