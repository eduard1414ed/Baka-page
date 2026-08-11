// ЭКРАН РАЗБОРА КАНДИДАТОВ: ПРОГОН НАСТОЯЩЕГО КОДА СТРАНИЦЫ.
//
//   node scripts/candidates-screen.test.mjs
//   node scripts/candidates-screen.test.mjs --selftest
//
// ЗАЧЕМ ЭТО ЗАВЕДЕНО. Правило проекта — «всё, что живёт в браузере, проверяет
// заказчик руками» — осталось в силе для ВИДА. Но 11 августа 2026 экран лёг
// на первом же живом применении, и легло в нём не то, что видно глазами,
// а ПОРЯДОК ВО ВРЕМЕНИ: кнопка «Применить» звала робота раньше, чем решения
// доезжали до GitHub, и робот применил 2 решения из пяти. Прошлая сессия
// гоняла эту же страницу через заглушку браузера и ничего не поймала —
// потому что спрашивала «записалось ли решение», а не «записалось ли ДО того,
// как позвали робота». Заглушка тогда жила вне репозитория и была выброшена.
// Теперь она здесь и спрашивает про время.
//
// КАК УСТРОЕНО. Скрипт страницы вынимается из `index.html` КАК ЕСТЬ, у него
// подменяется единственный адрес (`/admin/tools/github.js` → настоящий файл
// с диска), и он исполняется в Node поверх подделки браузера и подделки GitHub.
// Проверяется настоящий код обеих сторон, а не его пересказ.
//
// ВРЕМЯ В ЗАГЛУШКЕ ИДЁТ В ДЕСЯТЬ РАЗ БЫСТРЕЕ (`SPEED`): пауза перед записью
// 1200 мс становится 120, ожидание похода 5000 — 500. Проверяется ПОРЯДОК
// событий, а он от одинакового ускорения всех задержек не меняется.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const PAGE = new URL('public/admin/tools/candidates/index.html', ROOT);
const GITHUB_JS = new URL('public/admin/tools/github.js', ROOT);

const DECISIONS_FILE = 'src/data/animeCandidateDecisions.json';
const CANDIDATES_FILE = 'src/data/animeCandidates.json';
const OWNER = 'eduard1414ed';
const REPO = 'Baka-page';

const SPEED = 10;
const realSetTimeout = globalThis.setTimeout;
const sleep = (ms) => new Promise((done) => realSetTimeout(done, Math.max(0, Math.round(ms / SPEED))));

// ── Подложенные данные: настоящие пять строк, на которых всё и легло ─────────

const ROWS = [
	{ sourceId: 34443, slug: 'baki', titleRu: 'Баки!', phrases: ['Баки!', 'Баки'], year: 2018, studio: 'TMS Entertainment', postsCount: 78, count: 85, posts: ['ep-10', 'ep-11'] },
	{ sourceId: 44511, slug: 'chainsaw-man', titleRu: 'Человек-бензопила', phrases: ['Человек-бензопила', 'Человеку-бензопиле'], year: 2022, studio: 'MAPPA', postsCount: 12, count: 14, posts: ['ep-12'] },
	{ sourceId: 57334, slug: 'dandadan', titleRu: 'Дандадан', phrases: ['Дандадан', 'Дандадане'], year: 2024, studio: 'Science SARU', postsCount: 25, count: 32, posts: ['ep-13'] },
	{ sourceId: 50265, slug: 'spy-x-family', titleRu: 'Семья шпиона', phrases: ['Семья шпиона'], year: 2022, studio: 'Wit Studio', postsCount: 24, count: 30, posts: ['ep-14'] },
	{ sourceId: 42897, slug: 'horimiya', titleRu: 'Хоримия', phrases: ['Хоримия'], year: 2021, studio: 'CloverWorks', postsCount: 19, count: 29, posts: ['ep-15'] },
];

const CANDIDATES = {
	generated: '2026-08-11T09:00:00.000Z',
	postsRead: 1596,
	candidates: ROWS,
	shortName: [],
	already: [],
	notSimilar: [],
	notFound: [],
};

// ── Подделка браузера ───────────────────────────────────────────────────────

const matches = (node, sel) =>
	sel.startsWith('.') ? String(node.className ?? '').split(/\s+/).includes(sel.slice(1)) : node.tagName === sel;

function walk(node, visit) {
	for (const kid of node.children) {
		if (kid.tagName === '#text') continue;
		if (visit(kid) === false) return false;
		if (walk(kid, visit) === false) return false;
	}
	return true;
}

function makeEl(tag) {
	const node = {
		tagName: tag,
		parent: null,
		children: [],
		dataset: {},
		className: '',
		hidden: false,
		disabled: false,
		value: '',
		listeners: {},
		_text: '',
		append(...kids) {
			for (const kid of kids) {
				if (typeof kid === 'string') {
					node.children.push({ tagName: '#text', _text: kid, children: [] });
				} else {
					kid.parent = node;
					node.children.push(kid);
				}
			}
		},
		addEventListener(type, fn) {
			(node.listeners[type] ??= []).push(fn);
		},
		querySelector(sel) {
			let found = null;
			walk(node, (kid) => {
				if (matches(kid, sel)) {
					found = kid;
					return false;
				}
			});
			return found;
		},
		querySelectorAll(sel) {
			const out = [];
			walk(node, (kid) => {
				if (matches(kid, sel)) out.push(kid);
			});
			return out;
		},
		closest(sel) {
			let here = node;
			while (here) {
				if (matches(here, sel)) return here;
				here = here.parent;
			}
			return null;
		},
		focus() {},
	};

	Object.defineProperty(node, 'textContent', {
		get() {
			if (node.children.length === 0) return node._text;
			return node.children.map((kid) => kid.textContent ?? kid._text ?? '').join('');
		},
		set(value) {
			node.children = [];
			node._text = String(value);
		},
	});
	Object.defineProperty(node, 'innerHTML', {
		get() {
			return node._html ?? node.textContent;
		},
		set(value) {
			node.children = [];
			node._text = '';
			node._html = String(value);
		},
	});
	return node;
}

function makeDocument() {
	const byId = new Map();
	return {
		byId,
		getElementById(id) {
			if (!byId.has(id)) byId.set(id, makeEl(id === 'apply' || id === 'login' ? 'button' : 'div'));
			return byId.get(id);
		},
		createElement: (tag) => makeEl(tag),
	};
}

/** Нажать кнопку так, как это делает браузер: событием, а не вызовом функции. */
function press(node) {
	let here = node;
	while (here) {
		for (const fn of here.listeners?.click ?? []) {
			const out = fn({ target: node });
			if (out && typeof out.then === 'function') return out;
		}
		here = here.parent;
	}
	return Promise.resolve();
}

// ── Подделка GitHub ─────────────────────────────────────────────────────────

function makeServer(options = {}) {
	const server = {
		decisions: '[]\n',
		sha: 'sha-0',
		shaCounter: 0,
		putLatency: 400,
		putStatus: null, // насильный отказ на следующую запись
		putStatusOnce: false,
		writes: [],
		dispatches: [],
		runs: [],
		runAppearsAfter: 0, // через сколько миллисекунд поход появится в списке
		nextRunId: 1000,
		...options,
	};

	server.fetch = async (url, init = {}) => {
		const method = (init.method ?? 'GET').toUpperCase();
		const path = String(url).replace('https://api.github.com', '');

		if (String(url) === '/anime-index.json') {
			return new Response('[]', { status: 200 });
		}

		if (path === `/repos/${OWNER}/${REPO}`) {
			return new Response(JSON.stringify({ owner: { login: 'заказчик' }, permissions: { push: true } }), {
				status: 200,
				headers: { 'x-oauth-scopes': 'repo' },
			});
		}

		if (path.startsWith(`/repos/${OWNER}/${REPO}/contents/`)) {
			const file = decodeURIComponent(path.slice(`/repos/${OWNER}/${REPO}/contents/`.length).split('?')[0]);

			if (method === 'GET') {
				if (file === CANDIDATES_FILE) return new Response(JSON.stringify(CANDIDATES), { status: 200 });
				if (file !== DECISIONS_FILE) return new Response('нет такого', { status: 404 });
				const raw = String(init.headers?.Accept ?? '').includes('raw');
				if (raw) return new Response(server.decisions, { status: 200 });
				return new Response(
					JSON.stringify({ content: Buffer.from(server.decisions, 'utf8').toString('base64'), sha: server.sha }),
					{ status: 200 },
				);
			}

			if (method === 'PUT') {
				const body = JSON.parse(init.body);
				await sleep(server.putLatency);

				if (server.putStatus) {
					const status = server.putStatus;
					if (server.putStatusOnce) server.putStatus = null;
					return new Response('{}', { status });
				}
				// Отпечаток версии не сошёлся — ровно так GitHub отвечает,
				// когда файл записал кто-то другой.
				if ((body.sha ?? null) !== server.sha) return new Response('{}', { status: 409 });

				server.decisions = Buffer.from(body.content, 'base64').toString('utf8');
				server.sha = `sha-${++server.shaCounter}`;
				server.writes.push({ text: server.decisions, message: body.message });
				return new Response(JSON.stringify({ content: { sha: server.sha } }), { status: 200 });
			}
		}

		const dispatchAt = path.match(/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/dispatches$/);
		if (dispatchAt && method === 'POST') {
			// СНИМОК ФАЙЛА РОВНО В ЭТУ СЕКУНДУ. Робот прочитает именно его.
			server.dispatches.push({ decisionsAtCall: server.decisions });
			const run = {
				id: server.nextRunId++,
				status: 'in_progress',
				conclusion: null,
				created_at: '2026-08-11T09:37:39Z',
				run_started_at: '2026-08-11T09:37:39Z',
				updated_at: '2026-08-11T09:37:39Z',
			};
			realSetTimeout(() => server.runs.unshift(run), Math.round(server.runAppearsAfter / SPEED));
			server.lastRun = run;
			return new Response(null, { status: 204 });
		}

		if (/\/actions\/workflows\/[^/]+\/runs/.test(path) && method === 'GET') {
			const perPage = Number(new URL(`https://x${path}`).searchParams.get('per_page') ?? 5);
			return new Response(JSON.stringify({ workflow_runs: server.runs.slice(0, perPage) }), { status: 200 });
		}

		return new Response('не знаю такой ручки: ' + path, { status: 404 });
	};

	return server;
}

// ── Загрузка настоящего скрипта страницы ────────────────────────────────────

async function loadScreen(server, { patch } = {}) {
	const html = await readFile(PAGE, 'utf8');
	const found = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
	if (!found) throw new Error('в index.html нет скрипта страницы — проверка смотрит не туда');

	let source = found[1];
	if (!source.includes("from '/admin/tools/github.js'")) {
		throw new Error('скрипт страницы больше не берёт github.js — проверка смотрит не туда');
	}
	source = source.replace("'/admin/tools/github.js'", JSON.stringify(GITHUB_JS.href));
	if (patch) source = patch(source);

	// Подделки ставятся ДО загрузки: github.js читает sessionStorage прямо
	// на первой строке, а страница спрашивает document на второй.
	globalThis.sessionStorage = {
		store: new Map(),
		getItem(key) {
			return this.store.get(key) ?? null;
		},
		setItem(key, value) {
			this.store.set(key, value);
		},
		removeItem(key) {
			this.store.delete(key);
		},
	};
	globalThis.sessionStorage.setItem('baka-gh-token', 'подложенный-токен');
	globalThis.location = { hostname: 'bakapodcast.com' };
	globalThis.window = { open: () => null, addEventListener: () => {}, removeEventListener: () => {} };
	globalThis.document = makeDocument();
	globalThis.fetch = server.fetch;
	globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, Math.max(0, Math.round((ms ?? 0) / SPEED)), ...rest);
	globalThis.clearTimeout = globalThis.clearTimeout ?? (() => {});

	// Каждый прогон — свой модуль: у страницы есть состояние, и второй сеанс
	// поверх первого проверял бы не то. Отсюда метка в адресе.
	const url = `data:text/javascript;base64,${Buffer.from(`// ${Math.random ? '' : ''}\n${source}`, 'utf8').toString('base64')}`;
	await import(url + `#${server.nextRunId}-${server.shaCounter}-${source.length}-${globalThis.__screenRun ?? 0}`);
	globalThis.__screenRun = (globalThis.__screenRun ?? 0) + 1;

	// Вход и загрузка списка идут сами; дождёмся, чтобы строки появились.
	const document_ = globalThis.document;
	for (let i = 0; i < 200; i++) {
		if (document_.getElementById('cand-groups').querySelectorAll('li').length > 0) break;
		await sleep(50);
	}
	const el = {
		apply: document_.getElementById('apply'),
		applyNote: document_.getElementById('apply-note'),
		applyStatus: document_.getElementById('apply-status'),
		groups: document_.getElementById('cand-groups'),
	};
	const rowByKey = (key) => el.groups.querySelectorAll('li').find((li) => li.dataset.key === key);
	const button = (key, act) => {
		const li = rowByKey(key);
		if (!li) throw new Error(`строки ${key} на экране нет`);
		const found = li.querySelectorAll('button').find((node) => node.dataset.act === act);
		if (!found) throw new Error(`у строки ${key} нет кнопки «${act}»`);
		return found;
	};
	return { el, rowByKey, button, press: (key, act) => press(button(key, act)) };
}

// ── Проверки ────────────────────────────────────────────────────────────────

const cases = [];
const say = (name, ok, detail) => {
	cases.push({ name, ok, detail });
	console.log(`  ${ok ? 'ок  ' : 'СБОЙ'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

/**
 * ГЛАВНАЯ ПРОВЕРКА, И ОНА ПРО ВРЕМЯ.
 *
 * Отмечаем решение, ждём, пока запись пойдёт в GitHub, и ПОКА ОНА ИДЁТ
 * отмечаем второе и жмём «Применить». Робот обязан быть позван по файлу,
 * в котором лежат ОБА решения. 11 августа он был позван по файлу с одним.
 */
async function проверитьГонку(patch) {
	const server = makeServer({ putLatency: 400 });
	const screen = await loadScreen(server, { patch });

	await screen.press('cand:34443', 'stop');
	// Пауза перед записью 1200 мс; ждём чуть дольше — запись пошла и идёт.
	await sleep(1350);
	await screen.press('cand:44511', 'create');
	const applying = press(screen.el.apply);
	await applying;
	// Дать доехать всему, что осталось в очереди.
	await sleep(2000);

	const call = server.dispatches[0];
	return { server, screen, call };
}

async function main() {
	console.log('=== ЭКРАН КАНДИДАТОВ: ПРОГОН НАСТОЯЩЕГО КОДА СТРАНИЦЫ ===\n');

	{
		const { server, call } = await проверитьГонку();
		const inFile = call ? JSON.parse(call.decisionsAtCall) : [];
		say(
			'робот позван ПОСЛЕ того, как решения записаны',
			Boolean(call) && inFile.length === 2,
			`робота позвали ${server.dispatches.length} раз(а), в файле у него было решений: ${inFile.length} (ждали 2)`,
		);
	}

	{
		// Запись не вышла — звать робота нельзя вовсе: он применил бы старое.
		const server = makeServer({ putLatency: 100, putStatus: 500 });
		const screen = await loadScreen(server);
		await screen.press('cand:34443', 'stop');
		await press(screen.el.apply);
		await sleep(1500);
		say(
			'решения не сохранились — робота не зовём',
			server.dispatches.length === 0,
			`робота позвали ${server.dispatches.length} раз(а), ждали 0`,
		);
		say(
			'после несохранения кнопка снова нажимается',
			screen.el.apply.disabled === false && screen.el.applyStatus.className === 'status bad',
			`кнопка серая: ${screen.el.apply.disabled}; строчка: ${screen.el.applyStatus.textContent.slice(0, 90)}`,
		);
	}

	{
		// Столкновение с роботом: он записал файл, пока мы решали. Наш заход
		// обязан перечитать, слить и записать снова — не стерев его пометок.
		const server = makeServer({ putLatency: 100 });
		const screen = await loadScreen(server);
		server.decisions =
			JSON.stringify([{ id: 'cand:99999', what: 'stop', phrases: ['Чужое'], applied: '2026-08-11T09:38:00Z' }], null, '\t') + '\n';
		server.sha = 'sha-от-робота';

		await screen.press('cand:34443', 'stop');
		await press(screen.el.apply);
		await sleep(2500);

		const final = JSON.parse(server.decisions);
		const чужое = final.find((item) => item.id === 'cand:99999');
		const своё = final.find((item) => item.id === 'cand:34443');
		say(
			'столкновение с роботом пережито: его пометка цела, моё решение записано',
			Boolean(чужое?.applied) && Boolean(своё) && server.dispatches.length === 1,
			`в файле ${final.length} решений; пометка робота: ${чужое?.applied ?? 'ПОТЕРЯНА'}; робота позвали ${server.dispatches.length} раз(а)`,
		);
	}

	{
		// Поход появляется в списке не мгновенно. Экран не имеет права принять
		// за свой ПРЕДЫДУЩИЙ поход — тот уже завершён и отчитается чужим исходом.
		const server = makeServer({ putLatency: 100, runAppearsAfter: 12000 });
		server.runs = [
			{
				id: 999,
				status: 'completed',
				conclusion: 'success',
				created_at: '2026-08-11T08:00:00Z',
				run_started_at: '2026-08-11T08:00:00Z',
				updated_at: '2026-08-11T08:01:00Z',
			},
		];
		const screen = await loadScreen(server);
		await screen.press('cand:34443', 'stop');
		await press(screen.el.apply);
		await sleep(7000); // два-три захода слежения, свой поход ещё не появился

		const рано = screen.el.applyStatus.innerHTML ?? '';
		say(
			'чужой поход не выдаётся за свой',
			!рано.includes('Готово') && screen.el.apply.disabled === true,
			`строчка: «${String(рано).slice(0, 80)}»; кнопка серая: ${screen.el.apply.disabled}`,
		);

		// Свой поход появился и кончился сбоем — экран обязан сказать это.
		await sleep(8000);
		if (server.lastRun) {
			server.lastRun.status = 'completed';
			server.lastRun.conclusion = 'failure';
		}
		await sleep(9000);
		const потом = String(screen.el.applyStatus.innerHTML ?? '');
		say(
			'исход своего похода доходит до экрана',
			потом.includes('закончился сбоем'),
			`строчка: «${потом.slice(0, 110)}»`,
		);
	}

	const bad = cases.filter((item) => !item.ok).length;
	console.log(bad === 0 ? `\nВсе ${cases.length} проверок прошли.` : `\nНЕ ПРОШЛО: ${bad} из ${cases.length}.`);
	return bad;
}

// ── Самопроверка: а умеет ли эта проверка вообще находить? ───────────────────
//
// Подлог — НАСТОЯЩИЙ сломанный код 11 августа, слово в слово, а не пересказ
// правила. Возвращаем в скрипт страницы ту самую строчку «идёт запись — отложу
// на потом и выйду», и главная проверка обязана покраснеть.

const СЛОМАННОЕ_ОЖИДАНИЕ = `
			function saveDecisions() {
				clearTimeout(saveTimer);
				if (savingNow) { scheduleSave(); return Promise.resolve(); }
				const mine = Promise.resolve().then(() => writeDecisions(0));
				savingNow = mine.then(() => { savingNow = null; }, () => { savingNow = null; });
				return mine;
			}
`;

async function selftest() {
	console.log('=== САМОПРОВЕРКА: ПОДЛОЖЕН СЛОМАННЫЙ КОД 11 АВГУСТА ===\n');

	const patch = (source) => {
		const from = source.indexOf('\t\t\tfunction saveDecisions()');
		if (from < 0) throw new Error('в скрипте страницы нет функции saveDecisions — подлог не встал');
		const to = source.indexOf('\t\t\tasync function writeDecisions(', from);
		if (to < 0) throw new Error('в скрипте страницы нет writeDecisions — подлог не встал');
		return source.slice(0, from) + СЛОМАННОЕ_ОЖИДАНИЕ + source.slice(to);
	};

	const { server, call } = await проверитьГонку(patch);
	const inFile = call ? JSON.parse(call.decisionsAtCall) : [];
	const поймано = !(Boolean(call) && inFile.length === 2);

	console.log(`  робота позвали ${server.dispatches.length} раз(а)`);
	console.log(`  решений в файле на тот миг: ${inFile.length} (при здоровом коде — 2)`);
	console.log(
		поймано
			? '\n  ок    ПРОВЕРКА КРАСНЕЕТ НА СЛОМАННОМ КОДЕ — значит она умеет находить.'
			: '\n  СБОЙ  проверка НЕ ЗАМЕТИЛА сломанного кода. Она бесполезна.',
	);
	return поймано ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const bad = process.argv.includes('--selftest') ? await selftest() : await main();
	process.exit(bad === 0 ? 0 : 1);
}
