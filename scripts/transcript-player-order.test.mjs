// ПОРЯДОК ЗНАКОМСТВА РАСШИФРОВКИ С ПЛЕЕРОМ — ПРОВЕРКА НА СОБРАННЫХ СКРИПТАХ.
//
// ЧТО СПРАШИВАЕМ. Расшифровка становится «живой» (кнопка «Следить за плеером»,
// нажатие на реплику перематывает звук) только если в миг её запуска на окне
// уже объявлен `window.__bakaPlayer`. Объявляет его панель плеера — ВНУТРИ
// своего обработчика `astro:page-load`. Значит всё решает порядок: чей
// обработчик зарегистрирован раньше.
//
// Обработчики вызываются в порядке РЕГИСТРАЦИИ, а регистрируются они при
// исполнении модулей, то есть в порядке тегов `<script>` на странице.
// В собранной странице выпуска порядок такой: сначала расшифровка, потом
// панель. Выходит, на ПЕРВОЙ загрузке страницы расшифровка спрашивает плеер
// раньше, чем тот объявился, и получает «плеера нет».
//
// ПОЧЕМУ ЭТОГО НЕ ВИДНО ПРИ ХОЖДЕНИИ ПО САЙТУ. Переходы идут без перезагрузки,
// а `window.__bakaPlayer` живёт на окне и переживает их. Стоит открыть любую
// страницу выпуска не первой — и всё работает. Ломается ровно первая
// открытая: ссылка из мессенджера, из поиска, из письма.
//
// КАК ПРОВЕРЯЕМ. Берём ДВА НАСТОЯЩИХ собранных скрипта из `dist/_astro/`
// (не пересказ, а те самые файлы, которые грузит браузер) и исполняем их
// в Node поверх маленькой подделки окна — ровно в том порядке, в каком их
// перечисляет собранная страница выпуска. Дальше смотрим одно: объявлен ли
// плеер к тому мигу, когда придёт очередь обработчика расшифровки.
//
//   node scripts/transcript-player-order.test.mjs
//   node scripts/transcript-player-order.test.mjs --selftest
//
// `--selftest` ВОЗВРАЩАЕТ ПРЕЖНЕЕ ПРАВИЛО и обязан ПОКРАСНЕТЬ: он вырезает
// из собранного скрипта панели тот самый вызов, которым она объявляет себя
// сразу, — и панель снова объявляется только внутри обработчика загрузки.
// Без такого подлога «зелено» ничего не значит: проверка, которая не умеет
// провалиться, врёт в сторону «всё хорошо».
//
// Прежняя редакция подлога меняла скрипты МЕСТАМИ, и это перестало годиться
// ровно тогда, когда поломку починили: после починки порядок не решает ничего,
// оба порядка отвечают «видит плеер», и подлог перестал ловиться. Подлог
// обязан отменять ПРАВИЛО, а не переставлять то, от чего правило избавило.

import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = new URL('../dist/', import.meta.url);

/** Файл подлога — убираем за собой в любом исходе. */
let fakeFile = null;

/** Страница выпуска из сборки — любая, лишь бы с расшифровкой. */
async function findEpisodePage() {
	const dir = new URL('posts/', DIST);
	for (const name of (await readdir(dir)).sort()) {
		try {
			const html = await readFile(new URL(`${name}/index.html`, dir), 'utf8');
			if (html.includes('class="transcript') && html.includes('class="episode-player')) return { name, html };
		} catch {
			// не папка поста — пропускаем
		}
	}
	return null;
}

/** Имена собранных скриптов страницы, В ТОМ ЖЕ ПОРЯДКЕ, что в разметке. */
function scriptsOf(html) {
	return [...html.matchAll(/src="\/(_astro\/[^"]+\.js)"/g)].map((m) => m[1]);
}

/**
 * Маленькая подделка окна.
 *
 * Ей не нужно уметь всю страницу: вопрос у проверки один — КОГДА появляется
 * `window.__bakaPlayer`. Поэтому поиск по разметке отвечает «ничего не нашёл»,
 * и модули просто регистрируют свои обработчики, ничего не рисуя.
 */
function makeWindow() {
	const handlers = [];
	const empty = () => [];

	// ЭЛЕМЕНТ ОТВЕЧАЕТ НА ВСЁ, И ЭТО НАРОЧНО. Панель плеера при запуске ищет
	// полтора десятка кнопок по id и сразу вешает на них слушатели; верни
	// подделка «ничего не нашла» — запуск падал бы на первой же кнопке
	// и до объявления `window.__bakaPlayer` не доходил никогда. Тогда проверка
	// отвечала бы «плеер не объявлен» ВСЕГДА, в любом порядке скриптов, —
	// то есть меряла бы собственную бедность, а не порядок. Именно это
	// и поймал `--selftest` в первой редакции.
	const makeElement = () => {
		const el = {
			addEventListener() {},
			removeEventListener() {},
			querySelectorAll: empty,
			classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
			dataset: {},
			style: { setProperty() {}, removeProperty() {} },
			setAttribute() {},
			removeAttribute() {},
			getAttribute: () => null,
			appendChild() {},
			append() {},
			insertBefore() {},
			remove() {},
			contains: () => false,
			closest: () => null,
			focus() {},
			blur() {},
			click() {},
			scrollIntoView() {},
			getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
			children: [],
			childNodes: [],
			textContent: '',
			innerHTML: '',
			value: '',
			hidden: false,
			disabled: false,
			checked: false,
			// свойства звука — панель читает их при запуске
			currentTime: 0,
			duration: 0,
			paused: true,
			playbackRate: 1,
			readyState: 0,
			networkState: 0,
			src: '',
			play: () => Promise.resolve(),
			pause() {},
			load() {},
		};
		el.querySelector = () => makeElement();
		return el;
	};

	const documentStub = {
		addEventListener(name, fn) {
			handlers.push({ name, fn });
		},
		removeEventListener() {},
		querySelector: () => makeElement(),
		querySelectorAll: empty,
		getElementById: () => makeElement(),
		createElement: () => makeElement(),
		body: makeElement(),
		documentElement: makeElement(),
		head: makeElement(),
	};

	const win = {
		document: documentStub,
		addEventListener() {},
		removeEventListener() {},
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
		requestAnimationFrame: (fn) => fn(),
		getSelection: () => ({ toString: () => '' }),
		location: { hash: '', pathname: '/', href: 'https://ru.bakapodcast.com/' },
		history: { state: null, replaceState() {}, pushState() {} },
		localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
		sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
		IntersectionObserver: class {
			observe() {}
			disconnect() {}
		},
		HTMLMediaElement: { HAVE_CURRENT_DATA: 2, HAVE_NOTHING: 0, NETWORK_NO_SOURCE: 3 },
	};

	return { win, documentStub, handlers };
}

/** Исполнить собранные скрипты в заданном порядке поверх подделки. */
async function run(order) {
	const { win, documentStub, handlers } = makeWindow();

	const saved = {
		window: globalThis.window,
		document: globalThis.document,
		matchMedia: globalThis.matchMedia,
		IntersectionObserver: globalThis.IntersectionObserver,
		HTMLMediaElement: globalThis.HTMLMediaElement,
		requestAnimationFrame: globalThis.requestAnimationFrame,
		getSelection: globalThis.getSelection,
		location: globalThis.location,
	};

	globalThis.window = win;
	globalThis.document = documentStub;
	globalThis.matchMedia = win.matchMedia;
	globalThis.IntersectionObserver = win.IntersectionObserver;
	globalThis.HTMLMediaElement = win.HTMLMediaElement;
	globalThis.requestAnimationFrame = win.requestAnimationFrame;
	globalThis.getSelection = win.getSelection;

	const failures = [];
	// ЧЕЙ ОБРАБОТЧИК — ЗАПОМИНАЕМ СРАЗУ. Спрашивать «видел ли плеер ПЕРВЫЙ
	// обработчик» нельзя: при обратном порядке первым становится сам плеер,
	// и он, конечно, себя ещё не объявил — ответ «нет» вышел бы одинаковым
	// в обоих случаях, и подлог не поймался бы. Вопрос у проверки другой:
	// видит ли плеер обработчик РАСШИФРОВКИ.
	for (const file of order) {
		const url = new URL(file, DIST);
		const before = handlers.length;
		try {
			// Каждый прогон читает модуль заново: иначе второй порядок достался бы
			// из кэша модулей, и подлог не смог бы ничего изменить.
			await import(`${url.href}?v=${Math.abs(hash(order.join('|') + file))}`);
		} catch (error) {
			failures.push(`${file}: ${error.message}`);
		}
		for (let i = before; i < handlers.length; i++) handlers[i].from = file;
	}

	// Кто объявился ДО того, как побежали обработчики загрузки страницы.
	const beforeLoad = win.__bakaPlayer !== undefined;

	const pageLoad = handlers.filter((h) => h.name === 'astro:page-load');
	const seen = [];
	for (const h of pageLoad) {
		const sawPlayer = win.__bakaPlayer !== undefined;
		seen.push({ from: h.from ?? '?', sawPlayer });
		try {
			h.fn({});
		} catch {
			// обработчику нечего рисовать на подделке — нам важен только порядок
		}
	}

	Object.assign(globalThis, saved);
	return { beforeLoad, pageLoad: pageLoad.length, seen, failures, playerAtEnd: win.__bakaPlayer !== undefined };
}

/** Убрать файл подлога, чем бы дело ни кончилось. */
async function cleanup() {
	if (!fakeFile) return;
	try {
		await unlink(fakeFile);
	} catch {
		// уже убран — не беда
	}
	fakeFile = null;
}

function hash(text) {
	let h = 0;
	for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
	return h;
}

async function main() {
	const selftest = process.argv.includes('--selftest');

	const page = await findEpisodePage();
	if (!page) {
		console.error('В сборке не нашлось ни одной страницы выпуска с расшифровкой — сначала `npm run build`.');
		process.exit(1);
	}

	const all = scriptsOf(page.html);
	const transcript = all.find((s) => s.includes('Transcript.astro'));
	const player = all.find((s) => s.includes('PlayerBar.astro'));
	if (!transcript || !player) {
		console.error('На странице выпуска нет скрипта расшифровки или панели плеера — проверять нечем.');
		process.exit(1);
	}

	console.log(`Страница-образец: /posts/${page.name}/`);
	console.log('Порядок скриптов в разметке:');
	all.forEach((s, i) => console.log(`   ${i + 1}. ${s.replace('_astro/', '')}`));

	// ПОДЛОГ: у собранной панели вырезается вызов, которым она объявляет себя
	// сразу, — то есть возвращается поведение до починки.
	let order = all;
	if (selftest) {
		const file = new URL(player, DIST);
		const text = await readFile(file, 'utf8');
		// Вызов стоит последним в файле, сразу за регистрацией обработчика:
		// `…addEventListener("astro:page-load",()=>{…}),o();`
		const stripped = text.replace(/,\s*([A-Za-z_$][\w$]*)\(\);?\s*$/, ';');
		if (stripped === text) {
			console.error('\n✗ ПОДЛОГ НЕ СРАБОТАЛ: в собранной панели не нашлось вызова, который надо снять.');
			console.error('  Проверка ничего не доказывает, пока подлог не подменил кода, — чинить подлог.');
			process.exit(1);
		}
		const fake = new URL('podmena-panel.mjs', import.meta.url);
		await writeFile(fake, stripped, 'utf8');
		fakeFile = fake;
		order = all.map((s) => (s === player ? fake.href : s));
		console.log('\nПОДЛОГ: у панели снят вызов «объявиться сразу» — как было до починки.');
	}

	const result = await run(order);

	console.log(`\nОбработчиков astro:page-load зарегистрировано: ${result.pageLoad}`);
	console.log('Кто когда просыпается и видит ли плеер:');
	for (const s of result.seen) {
		console.log(`   ${s.sawPlayer ? 'видит плеер   ' : 'плеера НЕ ВИДИТ'}  ← ${s.from.replace('_astro/', '').split('.astro')[0]}`);
	}
	console.log(`Плеер объявлен после всех обработчиков: ${result.playerAtEnd ? 'да' : 'нет'}`);
	if (result.failures.length) {
		console.log('\nмодули, не исполнившиеся на подделке (для порядка это не помеха):');
		for (const f of result.failures) console.log('   ' + f);
	}

	if (!result.playerAtEnd) {
		console.log('\n✗ ПОДДЕЛКА СЛИШКОМ БЕДНА: плеер не объявился даже в конце.');
		console.log('  Значит проверка меряет не порядок, а собственную бедность, — чинить её.');
		process.exit(1);
	}

	// ГЛАВНЫЙ ВОПРОС: видит ли плеер обработчик РАСШИФРОВКИ.
	const trHandler = result.seen.find((s) => s.from.includes('Transcript.astro'));
	if (!trHandler) {
		console.log('\n✗ Обработчик расшифровки не нашёлся вовсе — проверять нечего.');
		process.exit(1);
	}
	const firstSawPlayer = trHandler.sawPlayer;

	console.log();
	if (selftest) {
		if (!firstSawPlayer) {
			console.log('✓ ПОДЛОГ ПОЙМАН: сняли у панели «объявиться сразу» — и расшифровка');
			console.log('  снова просыпается раньше плеера. Значит проверка меряет именно это.');
			await cleanup();
			process.exit(0);
		}
		console.log('✗ ПОДЛОГ НЕ ПОЙМАН: правило отменили, а проверка осталась зелёной —');
		console.log('  значит она смотрит не туда, и её «ок» ничего не значит.');
		await cleanup();
		process.exit(1);
	}

	if (firstSawPlayer) {
		console.log('ок      Расшифровка просыпается, когда плеер уже объявлен, — она живая');
		console.log('        и на первой открытой странице, а не только после перехода по сайту.');
		await cleanup();
		process.exit(0);
	}
	console.log('✗✗ ПЕРВЫЙ ОБРАБОТЧИК СТРАНИЦЫ ПЛЕЕРА НЕ ВИДИТ.');
	console.log('   Это и есть поломка: на ПЕРВОЙ загрузке страницы выпуска расшифровка');
	console.log('   спрашивает плеер раньше, чем тот объявился, и остаётся мёртвой —');
	console.log('   кнопка «Следить за плеером» не показывается, нажатие на реплику');
	console.log('   не перематывает. При переходе внутри сайта плеер уже объявлен');
	console.log('   с прошлой страницы, поэтому там всё работает.');
	process.exit(1);
}

const calledDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
if (calledDirectly) await main();
