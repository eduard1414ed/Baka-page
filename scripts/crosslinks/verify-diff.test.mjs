// ПЕРЕЛИНКОВКА — ПРОВЕРКА СТРАХОВКИ (сессия 3, снятие ссылок — сессия 3б).
// Настоящие посты, решения и журнал не трогает: всё на копиях во временной папке.
//
//   node scripts/crosslinks/verify-diff.test.mjs
//
// 1. Подставные решения: четыре вписанные вставки пилота с решением «убрать
//    ссылку, слова оставить» и одна НОВАЯ вставка («Панельная ностальгия» →
//    «Как сделать из обычных предметов пингвинов») со своим вариантом Эда.
//    НАСТОЯЩАЯ вставлялка (apply.mjs --write) пишет их в копию папки постов —
//    проверка диффа зелёная, журнал на копии — с пятью снятиями.
// 2. Подлоги снятия — каждый обязан дать красный:
//    снята ссылка, которой нет в журнале; снята ссылка на другую цель;
//    снята ссылка в другом абзаце; в том же абзаце заодно изменена буква;
//    вместо «стало» из журнала записано другое; ссылка снята, а блока нет;
//    в журнале снятие, а в файле его нет.
// 3. Подлоги вставки (сессия 3): буква в тексте, пустая строка, фронтматтер,
//    лишняя пустая строка, блок посреди абзаца, конец файла, \r\n.
// 4. Вставлялка сама краснеет и возвращает файлы (--test-spoil).
// 5. Здоровое: вставка в конец файла; файл без изменений.
//
// Код возврата 0 — всё как ожидалось.
//
// ГДЕ ИДЁТ ПРОВЕРКА. Вставлялка читает посты из своего репозитория, а он
// меняется от пачки к пачке: пилот, снятый по-настоящему, проверять уже
// нечем. Поэтому проверка сама ставит временную копию репозитория
// (git worktree) на коммит BASE — до сессии 3б, пилот вписан, ссылки ещё
// стоят, — кладёт поверх СЕГОДНЯШНИЕ scripts/crosslinks и идёт там.
// Рабочая копия не трогается; в конце сверяется её отпечаток.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChange, tgMapOf, ytMapOf } from './verify-diff.mjs';
import { createHash } from 'node:crypto';

// Отпечаток постов, решений и журнала репозитория — до и после проверки.
// (Не git status: посты бывают законно изменены записанной, но не закоммиченной пачкой.)
function snapshotOf(repo) {
	const h = createHash('sha1');
	const posts = join(repo, 'src/content/posts');
	for (const f of readdirSync(posts).sort()) h.update(f).update(readFileSync(join(posts, f)));
	for (const f of ['решения.json', 'отклонено.json', 'вставлено.json']) h.update(readFileSync(join(repo, 'статус/перелинковка', f)));
	return h.digest('hex');
}
import { loadCorpus } from './lib.mjs';
import { dupLinks, fragmentFor } from './unlink.mjs';
import { fingerprint } from './review/fresh.mjs';

const BASE = '4ff56f1e';
const HERE_REPO = fileURLToPath(new URL('../../', import.meta.url));
if (!process.env.CROSSLINKS_TEST_INNER) {
	const wt = mkdtempSync(join(tmpdir(), 'crosslinks-wt-'));
	let code = 1;
	try {
		execFileSync('git', ['worktree', 'add', '-q', '--detach', wt, BASE], { cwd: HERE_REPO });
		cpSync(join(HERE_REPO, 'scripts/crosslinks'), join(wt, 'scripts/crosslinks'), { recursive: true });
		symlinkSync(join(HERE_REPO, 'node_modules'), join(wt, 'node_modules'));
		const before = snapshotOf(HERE_REPO);
		try {
			process.stdout.write(execFileSync('node', [join(wt, 'scripts/crosslinks/verify-diff.test.mjs')], { cwd: wt, encoding: 'utf8', env: { ...process.env, CROSSLINKS_TEST_INNER: '1' } }));
			code = 0;
		} catch (e) {
			process.stdout.write(e.stdout ?? String(e));
		}
		const same = snapshotOf(HERE_REPO) === before;
		console.log(`${same ? 'ок    ' : 'ПЛОХО '} рабочая копия: посты, решения и журнал не тронуты (отпечаток тот же)`);
		if (!same) code = 1;
	} finally {
		execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: HERE_REPO });
	}
	process.exit(code);
}
const REPO = HERE_REPO;
const POSTS = join(REPO, 'src/content/posts');
const DIR = join(REPO, 'статус/перелинковка');
const tmp = mkdtempSync(join(tmpdir(), 'crosslinks-verify-'));
const copy = join(tmp, 'posts');
const snapshot = () => snapshotOf(REPO);
const snapBefore = snapshot();
let bad = 0;
const say = (ok, what) => {
	if (!ok) bad++;
	console.log(`${ok ? 'ок    ' : 'ПЛОХО '} ${what}`);
};

const PILOT = ['a-vot-i-leto-2147→ep-133', 'a-vot-i-leto-2147→ep-8', 'a-vot-i-leto-2147→letniy-roman-na-maksimalkah', 'samaya-dolgaya-manga-v-istorii-shonen-jump→vedmnadzor-anime-sitkom-kotoryy-my-zasluzhili'];
const NEW = { source: 'panelnaya-nostalgiya-po-schastlivomu-detstvu', target: 'kak-sdelat-iz-obychnyh-predmetov-pingvinov' };
const NEW_TEXT = 'Новый фильм режиссера Хироясу Исиды (о нём был отдельный пост прошлым летом) — «Дрейфующий дом» как раз рассказывает про такого духа.';

try {
	// ——— Подставные решения ———
	const { posts } = await loadCorpus();
	const by = new Map(posts.map((p) => [p.id, p]));
	const real = JSON.parse(readFileSync(join(DIR, 'решения.json'), 'utf8'));
	const journalReal = JSON.parse(readFileSync(join(DIR, 'вставлено.json'), 'utf8'));
	const anchorOfInserted = (p, target) => {
		let j = p.blocks.findIndex((b) => b.kind === 'material' && b.target === target) - 1;
		while (j >= 0 && p.blocks[j].kind === 'image') j--;
		return p.blocks[j];
	};
	const unlinkRec = (block, target, mode, text) =>
		dupLinks(block, target).map((l) => {
			const f = fragmentFor(block, l, mode, text);
			if (f.error) throw new Error(`${target}: ${f.error}`);
			return { raw: l.raw, mode, ...(text ? { text } : {}), from: f.from, to: f.to };
		});
	const approved = PILOT.map((key) => {
		const r = real.approved.find((a) => a.key === key);
		return { ...r, unlink: unlinkRec(anchorOfInserted(by.get(r.source), r.target), r.target, 'words') };
	});
	const src = by.get(NEW.source);
	const aBlock = src.blocks.find((b) => dupLinks(b, NEW.target).length);
	approved.push({
		key: `${NEW.source}→${NEW.target}`,
		...NEW,
		batch: 'проверка',
		place: { afterBlock: aBlock.n, anchorBlock: aBlock.n, anchorWords: aBlock.plain.split(/\s+/u).slice(0, 10).join(' ') },
		fingerprint: await fingerprint(NEW.source),
		play: false,
		label: null,
		unlink: unlinkRec(aBlock, NEW.target, 'custom', NEW_TEXT),
	});
	const decisions = join(tmp, 'решения.json');
	const journal = join(tmp, 'вставлено.json');
	writeFileSync(decisions, JSON.stringify({ approved, deferred: [] }));
	writeFileSync(journal, JSON.stringify(journalReal));
	const keys = approved.map((a) => a.key).join(',');

	// ——— 1. Настоящая вставлялка на копиях ———
	cpSync(POSTS, copy, { recursive: true });
	const run = (extra = [], j = journal) => execFileSync('node', [join(REPO, 'scripts/crosslinks/apply.mjs'), '--keys', keys, '--write', '--posts-dir', copy, '--decisions', decisions, '--journal', j, ...extra], { cwd: REPO, encoding: 'utf8' });
	let out = '';
	try {
		out = run();
	} catch (e) {
		out = e.stdout;
	}
	say(/зелёная по всем файлам/.test(out) && /вписать 1, снять ссылок 5/.test(out), 'вставлялка на копиях: 1 вставка, 5 снятий, проверка диффа зелёная');
	const changed = readdirSync(copy).filter((f) => Buffer.compare(readFileSync(join(copy, f)), readFileSync(join(POSTS, f))) !== 0);
	say(changed.length === 3, `изменено копий: ${changed.length} (ждём 3: ${changed.join(', ')})`);
	const j2 = JSON.parse(readFileSync(journal, 'utf8'));
	const nUn = j2.reduce((n, x) => n + (x.unlinks?.length ?? 0), 0);
	say(nUn === 5 && j2.length === journalReal.length + 1, `журнал на копии: снятий ${nUn} (ждём 5), записей ${j2.length} (ждём ${journalReal.length + 1})`);
	say(!j2.some((x) => x.source === NEW.source && 'commit' in x), 'у новой записи журнала нет номера коммита (решение 3б)');

	const tgToId = tgMapOf(POSTS);
	const ytToIds = ytMapOf(POSTS);
	const unl = (id) => j2.filter((x) => x.source === id).flatMap((x) => (x.unlinks ?? []).map((u) => ({ target: x.target, from: u.from, to: u.to })));
	for (const f of changed) {
		const id = f.slice(0, -3);
		const r = verifyChange(readFileSync(join(POSTS, f)), readFileSync(join(copy, f)), { unlinks: unl(id), tgToId, ytToIds });
		say(r.ok, `${f}: зелёный, новых блоков ${r.added.length}, снятий ${r.unlinked}${r.ok ? '' : ' — ' + r.problems.join('; ')}`);
	}
	const leto = readFileSync(join(copy, 'a-vot-i-leto-2147.md'), 'utf8');
	say(leto.includes('\nПодробнее можно послушать в нашем бонусном выпуске.\n') && !leto.includes('](/posts/ep-133/)'), '«А вот и лето»: ссылки на №133 больше нет, слова на месте');

	// ——— 2. Подлоги снятия ———
	// want — кусок ожидаемой причины: подлог обязан покраснеть ИМЕННО на своём
	// правиле, а не на случайной соседней разнице.
	const red = (name, before, spoiled, unlinks, want = null) => {
		const r = verifyChange(before, spoiled, { unlinks, tgToId, ytToIds });
		const why = r.problems.join(' | ');
		const ok = !r.ok && (!want || why.includes(want));
		say(ok, `подлог «${name}» → ${r.ok ? 'ЗЕЛЁНЫЙ (проверка слепа!)' : (ok ? 'красный: ' : 'красный, НО НЕ ПО ТОЙ ПРИЧИНЕ: ') + r.problems[0].split('\n')[0]}`);
	};
	const B = readFileSync(join(POSTS, 'a-vot-i-leto-2147.md'), 'utf8');
	const A = leto;
	const U = unl('a-vot-i-leto-2147');
	red('снята ссылка, которой нет в журнале', B, A, U.filter((u) => u.target !== 'ep-8'), 'не по журналу');
	// другая цель: снята ссылка на «Слова пузырятся» (обзор), а в журнале она записана как снятие ссылки на №133
	const other = B.match(/\[в текстовом обзоре\.\]\(\/posts\/obzor-filma[^)]*\)/u)[0];
	red('снята ссылка на другую цель', B, B.replace(other, 'в текстовом обзоре.'), [{ target: 'ep-133', from: other, to: 'в текстовом обзоре.' }], 'нет ссылки на эту цель');
	// другой абзац: в «Панельной ностальгии» ссылка снята, а вставка стоит после СЛЕДУЮЩЕГО абзаца
	const PB = readFileSync(join(POSTS, `${NEW.source}.md`), 'utf8');
	const PA = readFileSync(join(copy, `${NEW.source}.md`), 'utf8');
	const PU = unl(NEW.source);
	// Вставка на цель стоит после СЛЕДУЮЩЕГО абзаца, а ссылка снята в этом:
	// всё по образцу вставлялки, кроме места — красный обязан дать вопрос «какой абзац».
	const block = PA.match(/::material\{id="kak-sdelat[^\n]*/u)[0];
	const moved = PB.replace(PU[0].from, () => PU[0].to).replace(/(\nПо сюжету мальчик[^\n]*)\n\n/u, (m, l) => `${l}\n\n\n${block}\n\n\n`);
	red('снята ссылка в другом абзаце', PB, moved, PU, 'не в абзаце перед вставкой');
	red('в том же абзаце заодно изменена буква', PB, PA.replace('Новый фильм режиссера', 'Новый фильм режиссёра'), PU, 'не по журналу');
	red('вместо «стало» из журнала записано другое', PB, PA.replace('о нём был отдельный пост', 'о нём был пост'), PU, 'не по журналу');
	red('ссылка снята, а блок вставки не добавлен', PB, PB.replace(PU[0].from, () => PU[0].to), PU, 'не в абзаце перед вставкой');
	red('в журнале снятие, а в файле его нет', PB, PA.replace(PU[0].to, () => PU[0].from), PU, 'в файле не найдено');

	// ——— 3. Подлоги вставки (сессия 3) ———
	const bodyStart = PA.indexOf('\n---', 3) + 4;
	const at = PA.indexOf('а', bodyStart);
	red('изменённая буква в тексте', PB, PA.slice(0, at) + 'о' + PA.slice(at + 1), PU);
	const gap = PA.indexOf('\n\n', bodyStart + 5);
	red('удалённая пустая строка', PB, PA.slice(0, gap) + PA.slice(gap + 1), PU);
	red('изменённый фронтматтер', PB, PA.replace(/^title: (.*)$/m, 'title: $1 '), PU);
	red('лишняя пустая строка без блока', PB, PA.replace('\n\n', '\n\n\n'), PU);
	const para = PA.indexOf('\n', PA.indexOf('\n\n', bodyStart + 5) + 2);
	red('блок посреди абзаца', PB, PA.slice(0, para) + '\n::material{id="ep-1"}' + PA.slice(para), PU);
	red('потерян перевод строки в конце файла', PB, PA.replace(/\n$/, ''), PU);
	red('\\r\\n вместо \\n', PB, PA.replaceAll('\n', '\r\n'), PU);

	// ——— 4. Вставлялка сама возвращает файлы при красном свете ———
	cpSync(POSTS, copy, { recursive: true });
	writeFileSync(join(tmp, 'вставлено-2.json'), JSON.stringify(journalReal));
	let spoiled = '';
	try {
		run(['--test-spoil'], join(tmp, 'вставлено-2.json'));
	} catch (e) {
		spoiled = e.stdout;
	}
	const back = readdirSync(copy).every((x) => Buffer.compare(readFileSync(join(copy, x)), readFileSync(join(POSTS, x))) === 0);
	say(/КРАСНЫЙ СВЕТ/.test(spoiled) && back, `вставлялка с порчей: красный свет, все копии возвращены побайтно (${back ? 'да' : 'НЕТ'})`);
	const j3 = JSON.parse(readFileSync(join(tmp, 'вставлено-2.json'), 'utf8'));
	say(j3.length === journalReal.length && !j3.some((x) => x.unlinks?.length), 'в журнал красные вставки и снятия не попали');

	// ——— YouTube: ролик, встроенный в пост цели, — та же цель (решение Эда 3б) ———
	const ytB = '---\ntitle: x\n---\n\nПро него мы поговорили [в спешале](https://youtu.be/uT0zSFjRc5Y?si=x).\n';
	const ytA = '---\ntitle: x\n---\n\nПро него мы поговорили в спешале.\n\n\n::material{id="ep-74"}\n';
	const ytU = [{ target: 'ep-74', from: '[в спешале](https://youtu.be/uT0zSFjRc5Y?si=x)', to: 'в спешале' }];
	const yt = verifyChange(ytB, ytA, { unlinks: ytU, tgToId, ytToIds });
	say(yt.ok && yt.unlinked === 1, `снята ссылка на ролик №74 на YouTube — зелёный${yt.ok ? '' : ': ' + yt.problems.join('; ')}`);
	const ytB2 = ytB.replace('uT0zSFjRc5Y', 'Lv1OjQh3Rjk');
	red('снята ссылка на чужой ролик YouTube', ytB2, ytA, [{ ...ytU[0], from: ytU[0].from.replace('uT0zSFjRc5Y', 'Lv1OjQh3Rjk') }], 'нет ссылки на эту цель');

	// ——— 5. Здоровое вне пачки ———
	const eof = verifyChange('---\ntitle: x\n---\n\nАбзац.\n', '---\ntitle: x\n---\n\nАбзац.\n\n\n::material{id="ep-1"}\n');
	say(eof.ok, `вставка в конец файла — зелёный${eof.ok ? '' : ': ' + eof.problems.join('; ')}`);
	const same = verifyChange(PB, PB);
	say(same.ok && same.added.length === 0, 'файл без изменений — зелёный, новых блоков 0');
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
say(snapshot() === snapBefore, 'копия репозитория: посты, решения и журнал не тронуты (отпечаток тот же)');
console.log(bad ? `\nПЛОХО: ${bad}` : '\nВсе проверки прошли.');
process.exitCode = bad ? 1 : 0;
