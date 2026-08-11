// СТРАНИЦА РОБОТОВ: ПРОГОН НАСТОЯЩЕГО КОДА СТРАНИЦЫ.
//
//   node scripts/tools-screen.test.mjs
//   node scripts/tools-screen.test.mjs --selftest
//
// ЗАЧЕМ ЭТО ЗАВЕДЕНО. На странице стало ДВЕ кнопки запуска, и главная беда
// у неё теперь не «кнопка не работает», а «нажал не ту»: подписи разные,
// а механизм один. Что нажатие «Забрать новые посты из телеграма» зовёт
// именно телеграм-воркфлоу, глазами не проверить вовсе — на экране обе кнопки
// ведут себя одинаково, а разница видна только в запросе к GitHub.
//
// Второе, ради чего это написано: у кнопок РАЗНЫЕ отсчёты (пять минут против
// двух), и считаются они по настоящему состоянию на GitHub, а не по памяти
// вкладки. Проверяется это подложенными походами разной свежести — то есть
// ровно тем, чего в браузере руками не получить, не подождав пять минут.
//
// Подделка браузера — общая с проверкой экрана кандидатов
// (`scripts/browser-stub.mjs`), второй копии у неё нет.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { loadPageScript, press, sleep } from './browser-stub.mjs';

const ROOT = new URL('../', import.meta.url);
const PAGE = new URL('public/admin/tools/index.html', ROOT);
const GITHUB_JS = new URL('public/admin/tools/github.js', ROOT);

const OWNER = 'eduard1414ed';
const REPO = 'Baka-page';

const EPISODES = 'sync-episodes.yml';
const TELEGRAM = 'telegram-fetch.yml';
const TG_BOT = 'baka-tg-fetch-bot';

const BUTTONS = ['login', 'run', 'tg-run', 'refresh', 'cases-dry', 'cases-write', 'to-candidates'];

/** Сколько минут назад. Даты подкладываем от настоящего «сейчас»: отсчёты
    у кнопок считаются от него же, и подмена часов проверяла бы не то. */
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

/** Поход робота таким, каким его отдаёт GitHub. */
function run({ id, startedMinAgo, lengthMin = 2, conclusion = 'success', running = false, event = 'schedule' }) {
	const started = new Date(Date.now() - startedMinAgo * 60000);
	const ended = new Date(started.getTime() + lengthMin * 60000);
	return {
		id,
		event,
		status: running ? 'in_progress' : 'completed',
		conclusion: running ? null : conclusion,
		created_at: started.toISOString(),
		run_started_at: started.toISOString(),
		updated_at: (running ? new Date() : ended).toISOString(),
		html_url: `https://github.com/${OWNER}/${REPO}/actions/runs/${id}`,
	};
}

// ── Подделка GitHub ─────────────────────────────────────────────────────────

function makeServer(options = {}) {
	const server = {
		runs: { [EPISODES]: [], [TELEGRAM]: [] },
		issues: [],
		commits: [], // { sha, author, date, files: [{ filename, status }] }
		dispatches: [],
		...options,
	};

	server.fetch = async (url, init = {}) => {
		const method = (init.method ?? 'GET').toUpperCase();
		const full = new URL(String(url), 'https://api.github.com');
		const path = full.pathname;

		if (path === `/repos/${OWNER}/${REPO}`) {
			return new Response(JSON.stringify({ owner: { login: 'заказчик' }, permissions: { push: true } }), {
				status: 200,
				headers: { 'x-oauth-scopes': 'repo' },
			});
		}

		const dispatchAt = path.match(/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/dispatches$/);
		if (dispatchAt && method === 'POST') {
			server.dispatches.push(dispatchAt[1]);
			return new Response(null, { status: 204 });
		}

		const runsAt = path.match(/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/([^/]+)\/runs$/);
		if (runsAt && method === 'GET') {
			const list = server.runs[runsAt[1]] ?? [];
			return new Response(JSON.stringify({ workflow_runs: list }), { status: 200 });
		}

		if (path === `/repos/${OWNER}/${REPO}/issues`) {
			return new Response(JSON.stringify(server.issues), { status: 200 });
		}

		if (path === `/repos/${OWNER}/${REPO}/commits`) {
			const since = new Date(full.searchParams.get('since')).getTime();
			const until = new Date(full.searchParams.get('until')).getTime();
			const inWindow = server.commits.filter((commit) => {
				const at = new Date(commit.date).getTime();
				return at >= since && at <= until;
			});
			return new Response(
				JSON.stringify(inWindow.map((commit) => ({ sha: commit.sha, commit: { author: { name: commit.author } } }))),
				{ status: 200 },
			);
		}

		const oneCommit = path.match(/^\/repos\/[^/]+\/[^/]+\/commits\/(.+)$/);
		if (oneCommit) {
			const found = server.commits.find((commit) => commit.sha === oneCommit[1]);
			return new Response(JSON.stringify({ files: found?.files ?? [] }), { status: 200 });
		}

		return new Response(`не знаю такой ручки: ${path}`, { status: 404 });
	};

	return server;
}

// ── Загрузка страницы ───────────────────────────────────────────────────────

async function loadScreen(server, { patch } = {}) {
	const document_ = await loadPageScript({
		pageUrl: PAGE,
		githubJsUrl: GITHUB_JS,
		fetch: server.fetch,
		buttonIds: BUTTONS,
		patch,
	});

	const el = (id) => document_.getElementById(id);

	// Вход и первое обновление идут сами. Ждём, пока строчка телеграм-робота
	// скажет хоть что-нибудь: до этого мгновения читать состояние кнопок рано.
	for (let i = 0; i < 400; i++) {
		if (el('tg-last').textContent.trim() !== '') break;
		await sleep(50);
	}
	return { el, document: document_ };
}

// ── Проверки ────────────────────────────────────────────────────────────────

const cases = [];
const say = (name, ok, detail) => {
	cases.push({ name, ok, detail });
	console.log(`  ${ok ? 'ок  ' : 'СБОЙ'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

/** Обычная жизнь: оба робота ходили давно, всё открыто. */
const спокойно = () =>
	makeServer({
		runs: {
			[EPISODES]: [run({ id: 11, startedMinAgo: 300 })],
			[TELEGRAM]: [run({ id: 21, startedMinAgo: 120 })],
		},
	});

async function main() {
	const selftest = process.argv.includes('--selftest');
	console.log('=== СТРАНИЦА РОБОТОВ: ПРОГОН НАСТОЯЩЕГО КОДА СТРАНИЦЫ ===\n');

	// 1. НАЖАТИЕ ЗОВЁТ ИМЕННО СВОЕГО РОБОТА. Ради этой строчки всё и написано:
	//    кнопки рядом, механизм один, и перепутанный воркфлоу выглядел бы
	//    на экране совершенно нормально — «запуск принят», «прошёл без сбоев».
	{
		const server = спокойно();
		const { el } = await loadScreen(server);
		await press(el('tg-run'));
		await sleep(200);
		say(
			'кнопка телеграма зовёт телеграм-робота, а не робота выпусков',
			server.dispatches.length === 1 && server.dispatches[0] === TELEGRAM,
			`позвали: ${server.dispatches.join(', ') || 'никого'} (ждали ${TELEGRAM})`,
		);
	}

	{
		const server = спокойно();
		const { el } = await loadScreen(server);
		await press(el('run'));
		await sleep(200);
		say(
			'кнопка выпусков осталась звать своего робота',
			server.dispatches.length === 1 && server.dispatches[0] === EPISODES,
			`позвали: ${server.dispatches.join(', ') || 'никого'} (ждали ${EPISODES})`,
		);
	}

	// 2. ОТСЧЁТЫ РАЗНЫЕ, И СЧИТАЮТСЯ ОНИ ПО GITHUB. Нажатия тут нет вовсе:
	//    страница только что открыта, память вкладки пуста, а кнопка обязана
	//    быть серой — потому что так говорят данные.
	{
		const server = makeServer({
			runs: {
				[EPISODES]: [run({ id: 12, startedMinAgo: 3, lengthMin: 1 })],
				[TELEGRAM]: [run({ id: 22, startedMinAgo: 3, lengthMin: 1 })],
			},
		});
		const { el } = await loadScreen(server);
		say(
			'через две минуты после похода: телеграм открыт, выпуски ещё нет',
			el('tg-run').disabled === false && el('run').disabled === true,
			`телеграм серый: ${el('tg-run').disabled}; выпуски серые: ${el('run').disabled} («${el('run-note').textContent}»)`,
		);
	}

	{
		const server = makeServer({
			runs: {
				[EPISODES]: [run({ id: 13, startedMinAgo: 20 })],
				[TELEGRAM]: [run({ id: 23, startedMinAgo: 1, lengthMin: 0.5 })],
			},
		});
		const { el } = await loadScreen(server);
		say(
			'телеграм-робот ходил полминуты назад — кнопка серая и сказано, сколько ждать',
			el('tg-run').disabled === true && /снова можно через \d+:\d\d/.test(el('tg-note').textContent),
			`серая: ${el('tg-run').disabled}; строчка: «${el('tg-note').textContent}»`,
		);
	}

	// 3. РОБОТ В ПУТИ ГАСИТ СВОЮ КНОПКУ И НЕ ТРОГАЕТ ЧУЖУЮ.
	{
		const server = makeServer({
			runs: {
				[EPISODES]: [run({ id: 14, startedMinAgo: 300 })],
				[TELEGRAM]: [run({ id: 24, startedMinAgo: 0.2, running: true })],
			},
		});
		const { el } = await loadScreen(server);
		say(
			'пока телеграм-робот в пути, его кнопка серая, а кнопка выпусков живая',
			el('tg-run').disabled === true && el('run').disabled === false,
			`телеграм: ${el('tg-run').disabled} («${el('tg-note').textContent}»); выпуски: ${el('run').disabled}`,
		);
		say(
			'про идущий поход сказано вслух, а не молчанием',
			/в пути/.test(el('tg-status').innerHTML),
			`строчка: «${el('tg-status').innerHTML.slice(0, 90)}»`,
		);
	}

	// 4. СПИСОК ПОХОДОВ РАЗЛИЧАЕТ, ЧЕЙ ПОХОД, И ИДЁТ ПО ВРЕМЕНИ.
	{
		const server = makeServer({
			runs: {
				[EPISODES]: [run({ id: 15, startedMinAgo: 60 })],
				[TELEGRAM]: [run({ id: 25, startedMinAgo: 10 }), run({ id: 26, startedMinAgo: 400 })],
			},
		});
		const { el } = await loadScreen(server);
		const lines = el('runs').querySelectorAll('li').map((li) => li.textContent);
		const marks = lines.map((line) => (line.includes('[ телеграм ]') ? 'тг' : line.includes('[ выпуски ]') ? 'вып' : '?'));
		say(
			'в списке походов у каждой строки назван хозяин, и порядок по времени',
			lines.length === 3 && marks.join(' ') === 'тг вып тг',
			`строк ${lines.length}, пометки: ${marks.join(' ')} (ждали «тг вып тг»)`,
		);
	}

	// 5. ЧЕМ КОНЧИЛСЯ ПОХОД. «Прошёл без сбоев» не отвечает на вопрос
	//    «и что привёз», а письма при удачном заходе не бывает вовсе.
	{
		const server = makeServer({
			runs: { [EPISODES]: [], [TELEGRAM]: [run({ id: 27, startedMinAgo: 10, lengthMin: 2 })] },
			commits: [
				{
					sha: 'aaa',
					author: TG_BOT,
					date: ago(9),
					files: [
						{ filename: 'src/content/posts/tg-4501.md', status: 'added' },
						{ filename: 'src/content/posts/tg-4502.md', status: 'added' },
						{ filename: 'public/images/uploads/4501-1.jpg', status: 'added' },
						{ filename: 'src/data/telegramFeed.mjs', status: 'modified' },
					],
				},
				// Заказчик сохранил пост в админке ровно в эти же секунды —
				// это чужая работа, и в улов робота она попасть не должна.
				{
					sha: 'bbb',
					author: 'eduard1414ed',
					date: ago(9),
					files: [{ filename: 'src/content/posts/ep-147.md', status: 'added' }],
				},
			],
		});
		const { el } = await loadScreen(server);
		say(
			'сказано, сколько черновиков привёз, и чужой коммит в счёт не пошёл',
			/привёз 2 черновика/.test(el('tg-status').innerHTML),
			`строчка: «${el('tg-status').innerHTML}»`,
		);
	}

	{
		const server = makeServer({
			runs: { [EPISODES]: [], [TELEGRAM]: [run({ id: 28, startedMinAgo: 10 })] },
			commits: [],
		});
		const { el } = await loadScreen(server);
		say(
			'поход без улова говорит об этом словами, а не пустотой',
			/новых постов в канале не нашлось/.test(el('tg-status').innerHTML),
			`строчка: «${el('tg-status').innerHTML}»`,
		);
	}

	{
		// Разорванный альбом, доехавший вторым заходом: новых постов нет,
		// а работа была. Назвать это «ничем» — соврать.
		const server = makeServer({
			runs: { [EPISODES]: [], [TELEGRAM]: [run({ id: 29, startedMinAgo: 10 })] },
			commits: [
				{
					sha: 'ccc',
					author: TG_BOT,
					date: ago(9),
					files: [{ filename: 'src/content/posts/tg-4400.md', status: 'modified' }],
				},
			],
		});
		const { el } = await loadScreen(server);
		say(
			'дописанные снимки названы отдельно, а не выданы за пустой поход',
			/дописал снимки в 1 пост/.test(el('tg-status').innerHTML),
			`строчка: «${el('tg-status').innerHTML}»`,
		);
	}

	// 6. ДОБОР СО СТРАНИЦЫ КАНАЛА ВИДЕН НЕ ТОЛЬКО ПИСЬМОМ.
	{
		const server = makeServer({
			runs: { [EPISODES]: [], [TELEGRAM]: [run({ id: 30, startedMinAgo: 10, lengthMin: 2 })] },
			issues: [
				{
					title: 'Импорт из телеграма: 1 замечание',
					created_at: ago(9),
					html_url: 'https://github.com/x/y/issues/1',
				},
			],
		});
		const { el } = await loadScreen(server);
		say(
			'письмо, написанное в этом походе, названо прямо в строчке итога',
			/прислал письмо/.test(el('tg-status').innerHTML) &&
				el('tg-status').innerHTML.includes('Импорт из телеграма'),
			`строчка: «${el('tg-status').innerHTML}»`,
		);
	}

	// ── Подлоги: показать, что проверка умеет находить ──────────────────────
	//
	// «Пусто» у проверки ничего не значит, пока не показано, что она умеет
	// краснеть. Каждый подлог — настоящая поломка, которой можно сломать
	// страницу одной строчкой, и все они выглядели бы на экране безобидно.
	if (selftest) {
		console.log('\n--- ПОДЛОГИ: каждый ОБЯЗАН быть пойман ---\n');

		// 1. Перепутанный воркфлоу.
		{
			const server = спокойно();
			const { el } = await loadScreen(server, {
				patch: (src) => src.replace("const TG_WORKFLOW = 'telegram-fetch.yml';", "const TG_WORKFLOW = 'sync-episodes.yml';"),
			});
			await press(el('tg-run'));
			await sleep(200);
			say(
				'подлог: кнопка телеграма зовёт робота выпусков — пойман',
				server.dispatches[0] === EPISODES,
				`позвали: ${server.dispatches.join(', ') || 'никого'}`,
			);
		}

		// 2. Отсчёт снят вовсе.
		{
			const server = makeServer({
				runs: { [EPISODES]: [], [TELEGRAM]: [run({ id: 41, startedMinAgo: 1, lengthMin: 0.5 })] },
			});
			const { el } = await loadScreen(server, {
				patch: (src) => src.replace('const TG_COOLDOWN_MS = 2 * 60 * 1000;', 'const TG_COOLDOWN_MS = 0;'),
			});
			say(
				'подлог: отсчёт между нажатиями снят — пойман',
				el('tg-run').disabled === false,
				`кнопка серая: ${el('tg-run').disabled} (без подлога была бы серой)`,
			);
		}

		// 3. Пометки в списке разъехались — оба робота названы одинаково.
		{
			const server = makeServer({
				runs: {
					[EPISODES]: [run({ id: 42, startedMinAgo: 60 })],
					[TELEGRAM]: [run({ id: 43, startedMinAgo: 10 })],
				},
			});
			const { el } = await loadScreen(server, {
				patch: (src) => src.replace("whose: '[ телеграм ]'", "whose: '[ выпуски ]'"),
			});
			const lines = el('runs').querySelectorAll('li').map((li) => li.textContent);
			say(
				'подлог: список перестал различать роботов — пойман',
				!lines.some((line) => line.includes('[ телеграм ]')),
				`пометки: ${lines.map((l) => (l.includes('[ телеграм ]') ? 'тг' : 'вып')).join(' ')}`,
			);
		}

		// 4. Чужой коммит пошёл в улов робота.
		{
			const server = makeServer({
				runs: { [EPISODES]: [], [TELEGRAM]: [run({ id: 44, startedMinAgo: 10 })] },
				commits: [
					{
						sha: 'ddd',
						author: 'eduard1414ed',
						date: ago(9),
						files: [{ filename: 'src/content/posts/ep-147.md', status: 'added' }],
					},
				],
			});
			const { el } = await loadScreen(server, {
				patch: (src) => src.replace('if (commit.commit?.author?.name !== TG_BOT) continue;', 'if (false) continue;'),
			});
			say(
				'подлог: сохранение в админке засчитано роботу — пойман',
				/привёз 1 черновик/.test(el('tg-status').innerHTML),
				`строчка: «${el('tg-status').innerHTML}»`,
			);
		}
	}

	const bad = cases.filter((one) => !one.ok);
	console.log(
		bad.length ? `\nСБОЙ: не прошло ${bad.length} из ${cases.length}.` : `\nВсе ${cases.length} проверок прошли.`,
	);
	if (bad.length) process.exitCode = 1;
}

// Сравнение ПУТЯМИ, а не строками: `import.meta.url` кодирует русские буквы
// в пути к проекту, а `process.argv[1]` — нет, и строчное сравнение
// не совпадает никогда. Скрипт при этом молча ничего не делает и выходит
// с кодом 0, то есть врёт ровно в сторону «всё хорошо».
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
	await main();
}
