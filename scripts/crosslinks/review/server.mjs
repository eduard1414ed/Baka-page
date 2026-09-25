// ПЕРЕЛИНКОВКА — СЕРВЕР СТРАНИЦЫ РЕВЬЮ (сессия 2).
//
//   node scripts/crosslinks/review/server.mjs [--dir <папка решений>] [--candidates <файл>] [--port <номер>]
//
// Печатает адрес страницы; остановить — Ctrl+C.
//
// ЧТО ОН МОЖЕТ, А ЧЕГО НЕТ — ЖЁСТКО:
//   - слушает только 127.0.0.1: с другого компьютера страницы не видно;
//   - ПИШЕТ РОВНО ДВА ФАЙЛА: решения.json и отклонено.json в папке решений
//     (по умолчанию статус/перелинковка/). Других путей для записи в коде нет:
//     единственная функция записи принимает имя из списка и падает на чужом;
//   - посты, код сайта, настройки — только читает. В посты вставки ставит
//     сессия 3, по решениям, а не эта страница.
//
// ЗАПИСЬ АТОМАРНАЯ: сначала временный файл рядом («.решения.json.tmp»),
// потом переименование поверх. Обрыв посреди записи оставляет прежний файл
// целым, а не огрызок (урок «журнал пишется целиком или никак»).
//
// ФОРМАТ ФАЙЛОВ — вход для сессии 3, описан в отчёте 08:
//   решения.json   { approved: [...], deferred: [...], cursor }
//   отклонено.json [ { key, source, target, reason, reasonText, comment, … } ]
// Записи отсортированы по ключу — чтобы дифф в git показывал решение, а не
// перестановку.
//
// --dir и --candidates нужны проверке: сервер поднимается на копии папки
// решений и на подставном файле кандидатов, не трогая настоящих.

import http from 'node:http';
import net from 'node:net';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReview, REPO, CANDIDATES_FILE } from './model.mjs';
import { reanchor } from './fresh.mjs';
import { dupLinks, dupKind, fragmentFor, targetsOfUrl, youtubeId, urlsIn } from '../unlink.mjs';

const HERE = fileURLToPath(new URL('./', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const DIR = resolve(opt('--dir', join(REPO, 'статус/перелинковка')));
const CANDIDATES = resolve(opt('--candidates', CANDIDATES_FILE));
const FIRST_PORT = Number(opt('--port', 4470));

const FILES = { decisions: 'решения.json', rejected: 'отклонено.json' };
const REASON_TEXT = { weak: 'слабая связь', place: 'не то место', better: 'цель неудачная, есть лучше', none: 'посту не нужна вставка', other: 'другое' };
const STATES = new Set(['approved', 'rejected', 'deferred']);

// ——— Единственная запись на диск ———
async function writeOwn(name, value) {
	if (!Object.values(FILES).includes(name)) throw new Error(`Запись в ${name} запрещена: сервер пишет только ${Object.values(FILES).join(' и ')}`);
	await mkdir(DIR, { recursive: true });
	const file = join(DIR, name);
	const tmp = join(DIR, `.${name}.tmp`);
	await writeFile(tmp, JSON.stringify(value, null, 1) + '\n');
	await rename(tmp, file);
}

async function readJson(name, dflt) {
	try {
		return JSON.parse(await readFile(join(DIR, name), 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return dflt;
		// Файл есть, но не читается — молча начать с пустого значило бы
		// при первом же решении затереть всё, что там было.
		throw new Error(`Файл ${name} не читается (${e.message}). Сервер не запустится, пока его не починят.`);
	}
}

const byKey = (a, b) => a.key.localeCompare(b.key);

// ——— Данные ———
if (!existsSync(CANDIDATES)) throw new Error(`Нет файла кандидатов ${CANDIDATES}`);
console.log('Собираю кандидатов и тексты постов…');
const data = await buildReview({ file: CANDIDATES });
const postsById = new Map(data.posts.map((p) => [p.id, p]));
const targetIds = new Set(Object.keys(data.targets));
let decisions = await readJson(FILES.decisions, { approved: [], deferred: [], cursor: null });
decisions.approved ??= [];
decisions.deferred ??= [];
let rejected = await readJson(FILES.rejected, []);
if (!Array.isArray(rejected)) throw new Error(`${FILES.rejected}: ожидался массив`);
// Прежний формат find.mjs — строки «источник→цель»; превращаем в объекты при чтении.
rejected = rejected.map((x) => (typeof x === 'string' ? { key: x, source: x.split('→')[0], target: x.split('→')[1], reason: null } : x));

function allRecords() {
	return [...decisions.approved.map((r) => ({ ...r, state: 'approved' })), ...decisions.deferred.map((r) => ({ ...r, state: 'deferred' })), ...rejected.map((r) => ({ ...r, state: 'rejected' }))];
}

/** Решение, принятое до правки поста, — место заново по первым словам. */
function freshRecord(r) {
	const p = postsById.get(r.source);
	if (!p || !r.place || !r.fingerprint || r.fingerprint === p.fingerprint) return r;
	const re = reanchor(p.blocks, r.place);
	return re ? { ...r, place: { ...r.place, ...re }, reanchored: true } : { ...r, placeLost: true };
}

// ——— Дубль ссылки в абзаце-якоре (сессия 3б) ———
// Абзац-якорь: у вписанной вставки — текстовый блок прямо перед ней, иначе —
// абзац места решения. Так же ищет apply.mjs (anchorBefore).
function anchorBlockOf(rec) {
	const p = postsById.get(rec.source);
	if (!p) return null;
	const n = p.inserted.includes(rec.target) ? p.insertedAnchor[rec.target] : (rec.place?.anchorBlock ?? rec.place?.afterBlock);
	return n == null ? null : data.corpus.get(rec.source)?.blocks[n] ?? null;
}

/** Решение по одной ссылке → { raw, kind, mode, text?, from, to } или ошибка. */
function resolveUnlink(rec, u) {
	const block = anchorBlockOf(rec);
	const link = dupLinks(block, rec.target).find((l) => l.raw === u?.raw);
	if (!link) throw new Error('этой ссылки на цель в абзаце-якоре нет — обновите страницу');
	const kind = dupKind(link);
	if (u.mode === 'keep') return { raw: link.raw, kind, mode: 'keep', from: null, to: null };
	if (u.mode !== 'words' && u.mode !== 'custom') throw new Error(`неизвестный режим ${u.mode}`);
	const f = fragmentFor(block, link, u.mode, u.text);
	if (f.error) throw new Error(f.error);
	// Ссылка на ту же цель в своём варианте: адрес на сайте — или тот же ролик, что у снятой.
	if (urlsIn(f.to).some((url) => targetsOfUrl(url, () => null).includes(rec.target) || (link.youtube && youtubeId(url) === link.youtube))) throw new Error('в своём варианте осталась ссылка на ту же цель');
	// pre/post — остаток предложения вокруг куска, только для показа на странице.
	return { raw: link.raw, kind, mode: u.mode, ...(u.mode === 'custom' ? { text: String(u.text) } : {}), from: f.from, to: f.to, pre: f.pre, post: f.post };
}

// Решения по одному ключу пишутся по очереди: два быстрых нажатия подряд
// не должны читать и писать файлы одновременно.
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

async function saveDecision(rec) {
	if (typeof rec?.key !== 'string') throw new Error('нет ключа');
	// Снятие ссылки считается ДО того, как прежнее решение убрано из памяти:
	// ошибка здесь не должна стоить уже записанного решения.
	const unlink = !rec.remove && rec.state === 'approved' && Array.isArray(rec.unlink) ? rec.unlink.map((u) => resolveUnlink(freshRecord(rec), u)) : null;
	decisions.approved = decisions.approved.filter((r) => r.key !== rec.key);
	decisions.deferred = decisions.deferred.filter((r) => r.key !== rec.key);
	const wasRejected = rejected.some((r) => r.key === rec.key);
	rejected = rejected.filter((r) => r.key !== rec.key);
	let saved = null;
	if (!rec.remove) {
		const [source, target] = rec.key.split('→');
		if (source !== rec.source || target !== rec.target) throw new Error(`ключ ${rec.key} не совпадает с источником и целью`);
		if (!postsById.has(source)) throw new Error(`источника ${source} нет среди постов ревью`);
		if (!targetIds.has(target)) throw new Error(`цели ${target} нет среди опубликованных`);
		if (!STATES.has(rec.state)) throw new Error(`неизвестное состояние ${rec.state}`);
		const { state, remove, placeLost, reanchored, ...clean } = rec;
		// Снятие ссылки: только у одобренной вставки, «было/стало» считает сервер.
		if (unlink) clean.unlink = unlink;
		else delete clean.unlink;
		if (state === 'rejected') {
			if (!REASON_TEXT[clean.reason]) throw new Error(`неизвестная причина ${clean.reason}`);
			rejected.push({ ...clean, reasonText: REASON_TEXT[clean.reason] });
		} else decisions[state].push(clean);
		saved = { ...clean, state };
	}
	decisions.approved.sort(byKey);
	decisions.deferred.sort(byKey);
	rejected.sort(byKey);
	await writeOwn(FILES.decisions, decisions);
	if (wasRejected || rec.state === 'rejected') await writeOwn(FILES.rejected, rejected);
	// Строка в вывод на каждое решение: пропажу записи (сессия 3б — «вернуть
	// не решено», нажатое случайно) иначе не восстановить, кто и когда.
	const un = saved?.unlink?.map((u) => u.mode).join(',');
	console.log(`${new Date().toLocaleTimeString('ru-RU')} ${rec.remove ? 'УБРАНО (не решено)' : saved.state}${un ? ` · ссылка: ${un}` : ''} — ${rec.key}`);
	return saved;
}

// ——— HTTP ———
const STATIC = {
	'/': ['index.html', 'text/html; charset=utf-8'],
	'/index.html': ['index.html', 'text/html; charset=utf-8'],
	'/app.js': ['app.js', 'text/javascript; charset=utf-8'],
	'/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const FONTS = new Set(['Literata-Variable.woff2', 'Inter-Variable.woff2', 'IBMPlexMono-Regular.woff2', 'IBMPlexMono-SemiBold.woff2']);

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
	res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
	res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function body(req) {
	let s = '';
	for await (const chunk of req) {
		s += chunk;
		if (s.length > 1e6) throw new Error('слишком большой запрос');
	}
	return JSON.parse(s);
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, 'http://x');
		const path = decodeURIComponent(url.pathname);
		if (req.method === 'GET' && STATIC[path]) {
			const [file, type] = STATIC[path];
			return send(res, 200, await readFile(join(HERE, file)), type);
		}
		if (req.method === 'GET' && path.startsWith('/fonts/') && FONTS.has(path.slice(7))) {
			return send(res, 200, await readFile(join(REPO, 'public/fonts', path.slice(7))), 'font/woff2');
		}
		if (req.method === 'GET' && path === '/api/data') return send(res, 200, data);
		if (req.method === 'GET' && path === '/api/state') return send(res, 200, { decisions: allRecords().map(freshRecord), cursor: decisions.cursor });
		if (req.method === 'POST' && path === '/api/decision') {
			const rec = await body(req);
			const saved = await serial(() => saveDecision(rec));
			return send(res, 200, { ok: true, rec: saved });
		}
		if (req.method === 'POST' && path === '/api/unlink-preview') {
			const q = await body(req);
			const block = anchorBlockOf(freshRecord({ source: q.source, target: q.target, place: q.place }));
			const link = dupLinks(block, q.target).find((l) => l.raw === q.raw);
			if (!link) return send(res, 200, { error: 'ссылки в абзаце нет' });
			return send(res, 200, fragmentFor(block, link, 'custom', q.text));
		}
		if (req.method === 'POST' && path === '/api/cursor') {
			const c = await body(req);
			if (!postsById.has(c?.post)) throw new Error('нет такого поста');
			await serial(async () => {
				decisions.cursor = { post: c.post, at: new Date().toISOString() };
				await writeOwn(FILES.decisions, decisions);
			});
			return send(res, 200, { ok: true });
		}
		send(res, 404, 'нет такого адреса', 'text/plain; charset=utf-8');
	} catch (e) {
		console.error('ОШИБКА:', e.message);
		send(res, 500, e.message, 'text/plain; charset=utf-8');
	}
});

// Порт свободен, если на нём никто не отвечает (урок «заученный номер порта —
// мина»): чужой сервер, ответивший не тем, — это занято.
const busy = (port) =>
	new Promise((ok) => {
		const s = net.connect({ port, host: '127.0.0.1' });
		s.once('connect', () => (s.destroy(), ok(true)));
		s.once('error', () => ok(false));
	});
let port = FIRST_PORT;
while (await busy(port)) if (++port > FIRST_PORT + 30) throw new Error(`Свободного порта ${FIRST_PORT}…${FIRST_PORT + 30} нет`);
server.listen(port, '127.0.0.1', () => {
	const n = allRecords().length;
	console.log(`Постов на ревью: ${data.posts.length}. Решений уже есть: ${n}. Решения пишутся в ${DIR}`);
	if (!data.hasFingerprints) console.log('ВНИМАНИЕ: в файле кандидатов нет отпечатков постов — «пост изменился» не сработает. Перезапустите find.mjs.');
	console.log(`\nСтраница ревью: http://127.0.0.1:${port}/\n(остановить — Ctrl+C)`);
});
