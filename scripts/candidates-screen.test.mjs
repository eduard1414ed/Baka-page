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
// САМА ПОДДЕЛКА БРАУЗЕРА ЛЕЖИТ В `scripts/browser-stub.mjs` — она общая
// с проверкой страницы роботов, и второй копии у неё нет.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { loadPageScript, press, realSetTimeout, sleep, SPEED } from './browser-stub.mjs';

const ROOT = new URL('../', import.meta.url);
const PAGE = new URL('public/admin/tools/candidates/index.html', ROOT);
const GITHUB_JS = new URL('public/admin/tools/github.js', ROOT);

const DECISIONS_FILE = 'src/data/animeCandidateDecisions.json';
const CANDIDATES_FILE = 'src/data/animeCandidates.json';
const HIDDEN_FILE = 'src/data/animeCandidateHidden.json';
const OWNER = 'eduard1414ed';
const REPO = 'Baka-page';

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

// ── Подделка GitHub ─────────────────────────────────────────────────────────

function makeServer(options = {}) {
	const server = {
		// ФАЙЛОВ У ЭКРАНА ТРИ, И ЭТО НЕ МЕЛОЧЬ ПОДДЕЛКИ. Решения и скрытые
		// лежат ОТДЕЛЬНО друг от друга, и хранилище тут такое же: одна запись
		// не имеет права задеть чужой файл. Список кандидатов держим полем —
		// его переписывает робот, и проверка «скрытое пережило пересбор»
		// подменяет его целиком.
		files: new Map([[DECISIONS_FILE, { text: '[]\n', sha: 'sha-0' }]]),
		candidates: JSON.parse(JSON.stringify(CANDIDATES)),
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

	// Проверки ниже говорят про файл решений двумя короткими словами
	// (`server.decisions`, `server.sha`) — они описывают случившиеся 11 августа
	// поломки, и переписывать их ради второго файла значило бы переписывать
	// показания. Поэтому старые имена остались, а за ними хранилище файлов.
	Object.defineProperty(server, 'decisions', {
		get: () => server.files.get(DECISIONS_FILE)?.text ?? null,
		set: (text) => server.files.set(DECISIONS_FILE, { text, sha: server.files.get(DECISIONS_FILE)?.sha ?? 'sha-0' }),
	});
	Object.defineProperty(server, 'sha', {
		get: () => server.files.get(DECISIONS_FILE)?.sha ?? null,
		set: (sha) => server.files.set(DECISIONS_FILE, { text: server.files.get(DECISIONS_FILE)?.text ?? '[]\n', sha }),
	});
	server.hidden = () => {
		const text = server.files.get(HIDDEN_FILE)?.text;
		return text ? JSON.parse(text) : null;
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
				if (file === CANDIDATES_FILE) return new Response(JSON.stringify(server.candidates), { status: 200 });
				const now = server.files.get(file);
				// Файла нет вовсе — так отвечает GitHub про ещё не заведённый
				// файл скрытых, и экран обязан это пережить.
				if (!now) return new Response('нет такого', { status: 404 });
				const raw = String(init.headers?.Accept ?? '').includes('raw');
				if (raw) return new Response(now.text, { status: 200 });
				return new Response(
					JSON.stringify({ content: Buffer.from(now.text, 'utf8').toString('base64'), sha: now.sha }),
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
				// когда файл записал кто-то другой. У ещё не заведённого файла
				// отпечатка нет ни у него, ни в запросе.
				const now = server.files.get(file) ?? null;
				if ((body.sha ?? null) !== (now?.sha ?? null)) return new Response('{}', { status: 409 });

				const text = Buffer.from(body.content, 'base64').toString('utf8');
				const sha = `sha-${++server.shaCounter}`;
				server.files.set(file, { text, sha });
				server.writes.push({ file, text, message: body.message });
				return new Response(JSON.stringify({ content: { sha } }), { status: 200 });
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
	const document_ = await loadPageScript({
		pageUrl: PAGE,
		githubJsUrl: GITHUB_JS,
		fetch: server.fetch,
		buttonIds: ['apply', 'login'],
		patch,
	});

	// Вход и загрузка списка идут сами; дождёмся, чтобы строки появились.
	for (let i = 0; i < 200; i++) {
		if (document_.getElementById('cand-groups').querySelectorAll('li').length > 0) break;
		await sleep(50);
	}
	const el = {
		apply: document_.getElementById('apply'),
		applyNote: document_.getElementById('apply-note'),
		applyStatus: document_.getElementById('apply-status'),
		groups: document_.getElementById('cand-groups'),
		counts: document_.getElementById('cand-counts'),
	};
	const headings = () => el.groups.querySelectorAll('h3').map((node) => node.textContent);
	const acts = (key) => {
		const li = el.groups.querySelectorAll('li').find((node) => node.dataset.key === key);
		if (!li) throw new Error(`строки ${key} на экране нет`);
		return li.querySelectorAll('button').map((node) => node.dataset.act);
	};
	const rowByKey = (key) => el.groups.querySelectorAll('li').find((li) => li.dataset.key === key);
	const button = (key, act) => {
		const li = rowByKey(key);
		if (!li) throw new Error(`строки ${key} на экране нет`);
		const found = li.querySelectorAll('button').find((node) => node.dataset.act === act);
		if (!found) throw new Error(`у строки ${key} нет кнопки «${act}»`);
		return found;
	};
	return { el, rowByKey, button, headings, acts, press: (key, act) => press(button(key, act)) };
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

/**
 * СКРЫТИЕ. Нажимаем «Скрыть» у первой строки и даём записи доехать.
 *
 * Ключ строки берётся у ПЕРВОЙ строки подложенных данных, а не вписан именем:
 * вписанное имя протухает от чужой работы — на этом уже подорвались 11 августа,
 * когда «Баки!» ушло в стоп-лист и перестало быть кандидатом.
 */
const ПЕРВЫЙ_КЛЮЧ = `cand:${ROWS[0].sourceId}`;

async function сценарийСкрытия(patch) {
	const server = makeServer({ putLatency: 100 });
	const screen = await loadScreen(server, { patch });
	const счётДо = screen.el.counts.textContent;
	const заголовкиДо = screen.headings();

	await screen.press(ПЕРВЫЙ_КЛЮЧ, 'hide');
	await sleep(2500);

	return { server, screen, счётДо, заголовкиДо };
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

	{
		// ПАДЕНИЕ ПОХОДА НЕ ЗНАЧИТ «НЕ СДЕЛАНО НИЧЕГО». 11 августа вечером робот
		// применил четыре решения из пяти и упал на пятом от `fetch failed`;
		// экран сказал одно слово «сбоем», и это читалось как «пропало всё».
		const server = makeServer({ putLatency: 100 });
		const screen = await loadScreen(server);
		await screen.press('cand:34443', 'stop');
		await press(screen.el.apply);
		await sleep(1500);

		// Робот отработал: четыре записаны, пятое не вышло от сети.
		server.decisions =
			JSON.stringify(
				[
					{ id: 'cand:34443', what: 'stop', applied: '2026-08-11T10:20:00Z' },
					{ id: 'cand:57334', what: 'create', title: 'Дандадан', applied: '2026-08-11T10:20:10Z' },
					{ id: 'cand:44511', what: 'create', title: 'Человек-бензопила', error: 'fetch failed' },
				],
				null,
				'\t',
			) + '\n';
		server.sha = 'sha-от-робота';
		if (server.lastRun) {
			server.lastRun.status = 'completed';
			server.lastRun.conclusion = 'failure';
		}
		await sleep(9000);

		const строчка = String(screen.el.applyStatus.innerHTML ?? '');
		say(
			'у сбоя названо, ЧТО именно не вышло и что остальное записано',
			строчка.includes('Не вышло 1 решение') &&
				строчка.includes('Человек-бензопила') &&
				строчка.includes('fetch failed') &&
				строчка.includes('Остальные применены'),
			`строчка: «${строчка.replace(/<[^>]+>/g, '').slice(0, 190)}»`,
		);
	}

	{
		// «СКРЫТЬ» — НЕ РЕШЕНИЕ. Главное про эту кнопку: файл решений она
		// не трогает вовсе, и робот применения о ней не узнаёт ничем.
		const { server, screen, счётДо, заголовкиДо } = await сценарийСкрытия();

		say(
			'скрытие не пишет ни слова в файл решений и не открывает «Применить»',
			JSON.parse(server.decisions).length === 0 && screen.el.apply.disabled === true,
			`в файле решений записей: ${JSON.parse(server.decisions).length} (ждали 0); ` +
				`кнопка «Применить» серая: ${screen.el.apply.disabled}`,
		);

		say(
			'скрытое записано своим файлом',
			JSON.stringify(server.hidden()) === JSON.stringify([ПЕРВЫЙ_КЛЮЧ]),
			`в файле скрытых: ${JSON.stringify(server.hidden())}`,
		);

		const заголовки = screen.headings();
		say(
			'строка уехала в раздел «Скрытые», и там у неё одна кнопка — вернуть',
			screen.acts(ПЕРВЫЙ_КЛЮЧ).join(',') === 'unhide' &&
				заголовки.some((text) => text.includes('Скрытые: 1')),
			`кнопки строки: [${screen.acts(ПЕРВЫЙ_КЛЮЧ).join(', ')}]; заголовки: ${заголовки.join(' | ')}`,
		);

		// 2.5 из задания: скрытие убирает с глаз, а не из подсчётов. Заголовок
		// группы обязан по-прежнему считать ВСЕ свои строки.
		const былоВГруппе = заголовкиДо[0];
		const сталоВГруппе = заголовки[0];
		say(
			'счётчики от скрытия не поменялись',
			счётДо === screen.el.counts.textContent && сталоВГруппе.startsWith(былоВГруппе),
			`счёт сверху: «${счётДо}» → «${screen.el.counts.textContent}»; ` +
				`заголовок группы: «${былоВГруппе}» → «${сталоВГруппе}»`,
		);

		// ОБРАТИМО. Вернули — строка снова живая, файл скрытых пуст.
		await screen.press(ПЕРВЫЙ_КЛЮЧ, 'unhide');
		await sleep(2500);
		say(
			'возврат работает: строка снова решается, скрытых не осталось',
			screen.acts(ПЕРВЫЙ_КЛЮЧ).includes('stop') && JSON.stringify(server.hidden()) === '[]',
			`кнопки строки: [${screen.acts(ПЕРВЫЙ_КЛЮЧ).join(', ')}]; в файле скрытых: ${JSON.stringify(server.hidden())}`,
		);
	}

	{
		// ПЕРЕСБОР СПИСКА. Робот переписывает `animeCandidates.json` ЦЕЛИКОМ
		// после каждого применения и после каждого сохранения черновика.
		// Скрытое обязано это пережить — на похожем в проекте уже подрывались:
		// пометка «применено» терялась ровно так.
		const { server } = await сценарийСкрытия();

		server.candidates = {
			...JSON.parse(JSON.stringify(CANDIDATES)),
			generated: '2026-08-12T07:00:00.000Z',
			candidates: [...ROWS].reverse(),
		};

		const снова = await loadScreen(server);
		say(
			'скрытое пережило пересбор списка',
			снова.acts(ПЕРВЫЙ_КЛЮЧ).join(',') === 'unhide',
			`после пересбора кнопки строки: [${снова.acts(ПЕРВЫЙ_КЛЮЧ).join(', ')}] (ждали одну «unhide»)`,
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

/** Подмена куска текста в скрипте страницы. Не нашли — молчать нельзя. */
function подменить(source, что, чем, зачем) {
	if (!source.includes(что)) throw new Error(`в скрипте страницы нет «${что}» — подлог «${зачем}» не встал`);
	return source.replace(что, чем);
}

async function selftest() {
	console.log('=== САМОПРОВЕРКА: ПОДЛОЖЕН СЛОМАННЫЙ КОД ===\n');
	let плохо = 0;
	const спросить = (что, поймано, детали) => {
		if (!поймано) плохо += 1;
		console.log(`  ${поймано ? 'ок  ' : 'СБОЙ'}  ${что}\n        ${детали}\n`);
	};

	// ── Подлог 1: настоящий сломанный код 11 августа, слово в слово ──────────
	{
		const patch = (source) => {
			const from = source.indexOf('\t\t\tfunction saveDecisions()');
			if (from < 0) throw new Error('в скрипте страницы нет функции saveDecisions — подлог не встал');
			const to = source.indexOf('\t\t\tasync function writeDecisions(', from);
			if (to < 0) throw new Error('в скрипте страницы нет writeDecisions — подлог не встал');
			return source.slice(0, from) + СЛОМАННОЕ_ОЖИДАНИЕ + source.slice(to);
		};

		const { server, call } = await проверитьГонку(patch);
		const inFile = call ? JSON.parse(call.decisionsAtCall) : [];
		спросить(
			'«робот позван ПОСЛЕ записи» краснеет на сломанном ожидании',
			!(Boolean(call) && inFile.length === 2),
			`робота позвали ${server.dispatches.length} раз(а), решений в файле на тот миг: ${inFile.length} (при здоровом коде — 2)`,
		);
	}

	// ── Подлог 2: скрытое положено к решениям, в тот же файл ─────────────────
	//
	// Ровно та ошибка, ради которой файлов два: робот применения споткнулся бы
	// о запись, которую не умеет исполнять.
	{
		const patch = (source) =>
			подменить(
				source,
				"const HIDDEN_FILE = 'src/data/animeCandidateHidden.json';",
				'const HIDDEN_FILE = DECISIONS_FILE;',
				'скрытое лежит вместе с решениями',
			);

		const { server } = await сценарийСкрытия(patch);
		const вФайлеРешений = JSON.parse(server.decisions).length;
		спросить(
			'«скрытие не пишет в файл решений» краснеет, когда файл один',
			вФайлеРешений !== 0,
			`в файле решений после скрытия записей: ${вФайлеРешений} (при здоровом коде — 0)`,
		);
	}

	// ── Подлог 3: скрытое живёт во вкладке, на GitHub не уезжает ─────────────
	//
	// Выглядит безупречно ровно до перезагрузки страницы: строка уехала вниз,
	// счётчик посчитал, а назавтра всё вернулось.
	{
		const patch = (source) =>
			подменить(
				source,
				'saveHidden().catch(showHiddenError);',
				'/* подлог: запись выброшена */;',
				'скрытое никуда не пишется',
			);

		const { server } = await сценарийСкрытия(patch);
		server.candidates = {
			...JSON.parse(JSON.stringify(CANDIDATES)),
			generated: '2026-08-12T07:00:00.000Z',
			candidates: [...ROWS].reverse(),
		};
		const снова = await loadScreen(server, { patch });
		const кнопки = снова.acts(ПЕРВЫЙ_КЛЮЧ).join(',');
		спросить(
			'«скрытое пережило пересбор» краснеет, когда оно не записывается',
			кнопки !== 'unhide',
			`после пересбора кнопки строки: [${кнопки}] (при здоровом коде — одна «unhide»)`,
		);
	}

	console.log(
		плохо === 0
			? '  ВСЕ ТРИ ПОДЛОГА ПОЙМАНЫ — проверка умеет находить.'
			: `  НЕ ПОЙМАНО ПОДЛОГОВ: ${плохо}. Эти проверки бесполезны.`,
	);
	return плохо;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const bad = process.argv.includes('--selftest') ? await selftest() : await main();
	process.exit(bad === 0 ? 0 : 1);
}
