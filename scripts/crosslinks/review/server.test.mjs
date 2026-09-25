// ПЕРЕЛИНКОВКА — ПРОВЕРКА СЕРВЕРА РЕВЬЮ (сессия 2, шаг 3).
//
//   node scripts/crosslinks/review/server.test.mjs
//
// Поднимает НАСТОЯЩИЙ server.mjs на временной папке решений и на ПОДСТАВНОЙ
// копии файла кандидатов — настоящие решения, кандидаты и посты не трогаются.
// Проверяет:
//   1. одобрение, отказ, перенос места, своя цель, «играет здесь», подпись,
//      отложенное и место остановки переживают «перезагрузку» (новый сервер
//      на той же папке);
//   2. отклонённое читает find.mjs и повторно не предлагает;
//   3. сервер пишет только два файла решений (в папке нет ничего третьего,
//      в рабочей копии git ничего не поменялось);
//   4. «пост изменился» срабатывает на подставной копии: отпечаток другой —
//      пометка и место заново по первым словам; абзаца нет — место потеряно;
//      у неизменённого поста пометки нет;
//   5. кривое решение отвергается и файлов не портит.
// Каждая проверка печатает ок/ПРОВАЛ; код выхода 1, если провалилась хоть одна.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATES_FILE } from './model.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
let failed = 0;
const check = (ok, what) => {
	console.log(`${ok ? 'ок     ' : 'ПРОВАЛ '} ${what}`);
	if (!ok) failed++;
};
const gitStatus = () => execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain', '-z'], { cwd: REPO, encoding: 'utf8' });

const box = await mkdtemp(join(tmpdir(), 'crosslinks-review-'));
const dir = join(box, 'решения');
const gitBefore = gitStatus();

// Подставной файл кандидатов: у одного поста «чужой» отпечаток и сдвинутые
// номера блоков (как если бы выше вставили два абзаца); у второго — ещё и
// первые слова абзаца, которых в посте нет.
const real = JSON.parse(await readFile(CANDIDATES_FILE, 'utf8'));
const mains = real.candidates.filter((c) => c.status === 'основной');
const shifted = mains.find((c) => c.place.anchorBlock >= 3 && mains.filter((x) => x.source === c.source).length === 1);
const lost = mains.find((c) => c.source !== shifted.source && mains.filter((x) => x.source === c.source).length === 1);
const fake = structuredClone(real);
fake.fingerprints[shifted.source] = 'подставной';
fake.fingerprints[lost.source] = 'подставной';
for (const c of fake.candidates) {
	if (c.source === shifted.source && c.place) (c.place.afterBlock -= 2), (c.place.anchorBlock -= 2);
	if (c.source === lost.source && c.place) c.place.anchorWords = 'Такого абзаца в посте нет и не было';
}
const fakeFile = join(box, 'candidates.json');
await writeFile(fakeFile, JSON.stringify(fake));

async function startServer() {
	const p = spawn(process.execPath, [join(HERE, 'server.mjs'), '--dir', dir, '--candidates', fakeFile, '--port', '4530'], { stdio: ['ignore', 'pipe', 'pipe'] });
	let out = '';
	p.stderr.on('data', (d) => (out += d));
	const url = await new Promise((ok, fail) => {
		p.stdout.on('data', (d) => {
			out += d;
			const m = out.match(/http:\/\/127\.0\.0\.1:\d+\//);
			if (m) ok(m[0]);
		});
		p.on('exit', () => fail(new Error('сервер не поднялся:\n' + out)));
	});
	return { p, url };
}
const stop = (s) => new Promise((ok) => (s.p.once('exit', ok), s.p.kill()));

let code = 0;
try {
	let s = await startServer();
	const get = async (path) => (await fetch(s.url + path)).json();
	const post = (path, body) => fetch(s.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

	const data = await get('api/data');
	check(new URL(s.url).hostname === '127.0.0.1', 'сервер слушает только 127.0.0.1');
	const P = (id) => data.posts.find((p) => p.id === id);

	// 4. Свежесть.
	const sh = P(shifted.source).candidates.find((c) => c.key === shifted.key);
	check(P(shifted.source).changed === true, `«пост изменился» у подставного поста ${shifted.source}`);
	check(sh.place.afterBlock === shifted.place.afterBlock && !sh.placeLost, `место найдено заново по первым словам (блок ${sh.place.afterBlock}, в подставном было ${shifted.place.afterBlock - 2})`);
	const lo = P(lost.source).candidates.find((c) => c.key === lost.key);
	check(P(lost.source).changed === true && lo.placeLost === true, `абзаца нет — место объявлено потерянным (${lost.source})`);
	const calm = data.posts.find((p) => p.id !== shifted.source && p.id !== lost.source);
	check(calm.changed === false, `у неизменённого поста пометки нет (${calm.id})`);

	// 1. Решения.
	const two = data.posts.find((p) => p.candidates.filter((c) => c.status === 'основной').length >= 3 && p.id !== shifted.source && p.id !== lost.source);
	const [m1, m2, m3] = two.candidates.filter((c) => c.status === 'основной');
	const motive = data.posts.find((p) => p.candidates.some((c) => c.status === 'основной' && c.kind === 'motive' && data.targets[c.target].canPlay));
	const mc = motive.candidates.find((c) => c.kind === 'motive');
	const rec = (p, c, extra) => ({ key: c.key, source: p.id, target: c.target, from: 'main', kind: c.kind, confidence: c.confidence, channels: c.channels, batch: p.batch, place: c.place, fingerprint: p.fingerprint, moved: false, manual: false, play: false, label: null, decidedAt: new Date().toISOString(), ...extra });
	const manualTarget = Object.keys(data.targets).find((t) => t !== two.id && !two.candidates.some((c) => c.target === t));

	const r = [
		await post('api/decision', rec(motive, mc, { state: 'approved', play: true, label: 'Моя подпись' })),
		await post('api/decision', rec(two, m1, { state: 'rejected', reason: 'weak', comment: null })),
		await post('api/decision', rec(two, m2, { state: 'approved', moved: true, place: { afterBlock: 1, anchorBlock: 1, anchorWords: 'x' } })),
		await post('api/decision', rec(two, m3, { state: 'deferred' })),
		await post('api/decision', { ...rec(two, { key: `${two.id}→${manualTarget}`, target: manualTarget, kind: 'manual', confidence: '—', channels: [] }, { state: 'approved', manual: true, from: 'manual' }) }),
		await post('api/cursor', { post: two.id }),
	];
	check(r.every((x) => x.ok), 'шесть записей приняты сервером');

	// 5. Кривое — отвергается, файлы не портит.
	const before = await readFile(join(dir, 'решения.json'), 'utf8');
	const bad = await Promise.all([
		post('api/decision', rec(two, m1, { state: 'выложено' })),
		post('api/decision', { ...rec(two, m1, { state: 'approved' }), target: 'чужая' }),
		post('api/decision', rec(two, m1, { state: 'rejected', reason: 'просто так' })),
		post('api/decision', { key: 'нет→такого', source: 'нет', target: 'такого', state: 'approved' }),
	]);
	check(bad.every((x) => x.status === 500), 'кривые решения отвергнуты (неизвестное состояние, чужой ключ, чужая причина, нет поста)');
	check((await readFile(join(dir, 'решения.json'), 'utf8')) === before, 'после отказов файл решений не изменился');

	// «Перезагрузка» — новый сервер на той же папке.
	await stop(s);
	s = await startServer();
	const st = await (await fetch(s.url + 'api/state')).json();
	const find = (k) => st.decisions.find((d) => d.key === k);
	check(find(mc.key)?.state === 'approved' && find(mc.key).play === true && find(mc.key).label === 'Моя подпись', 'после перезапуска: одобрение с «играет здесь» и подписью на месте');
	check(find(m1.key)?.state === 'rejected' && find(m1.key).reason === 'weak', 'после перезапуска: отказ с причиной на месте');
	check(find(m2.key)?.moved === true && find(m2.key).place.afterBlock === 1, 'после перезапуска: перенесённое место на месте');
	check(find(m3.key)?.state === 'deferred', 'после перезапуска: отложенное на месте');
	check(find(`${two.id}→${manualTarget}`)?.manual === true, 'после перезапуска: своя цель на месте');
	check(st.cursor?.post === two.id, 'после перезапуска: страница откроется на том же посте');
	// Отмена решения.
	await fetch(s.url + 'api/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: m3.key, remove: true }) });
	const st2 = await (await fetch(s.url + 'api/state')).json();
	check(!st2.decisions.some((d) => d.key === m3.key), '«вернуть не решено» убирает запись');
	await stop(s);

	// 3. Пишет только два файла.
	const files = (await readdir(dir)).sort();
	check(JSON.stringify(files) === JSON.stringify(['отклонено.json', 'решения.json']), `в папке решений только два файла: ${files.join(', ')}`);
	check(gitStatus() === gitBefore, 'рабочая копия git не изменилась (сервер не писал в репозиторий)');

	// 2. find.mjs читает отклонённое.
	const out = join(box, 'find');
	execFileSync(process.execPath, [join(HERE, '../find.mjs'), '--rejected', join(dir, 'отклонено.json'), '--out', out], { encoding: 'utf8' });
	const again = JSON.parse(await readFile(join(out, 'candidates.json'), 'utf8'));
	check(again.rejectedCount === 1, `find.mjs прочитал отклонённых: ${again.rejectedCount}`);
	check(!again.candidates.some((c) => c.key === m1.key), `отклонённая пара ${m1.key} больше не предлагается`);
	check(again.candidates.some((c) => c.key === m2.key), 'одобренная пара осталась (контроль: поиск работает)');
} catch (e) {
	console.error(e);
	code = 1;
} finally {
	await rm(box, { recursive: true, force: true });
}
console.log(failed ? `\nПРОВАЛЕНО ПРОВЕРОК: ${failed}` : '\nВсе проверки прошли.');
process.exitCode = failed || code ? 1 : 0;
