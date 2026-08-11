// КАТАЛОГ: НАПРАВЛЕНИЕ СОРТИРОВКИ. ПРОГОН СОБРАННОГО СКРИПТА СТРАНИЦЫ.
//
//   node scripts/catalog-sort.test.mjs
//   node scripts/catalog-sort.test.mjs --selftest
//
// ЗАЧЕМ. Правило проекта «всё, что живёт в браузере, проверяет заказчик руками»
// осталось в силе для ВИДА. А порядок марок видом не является: перевёрнут он
// или нет, глазами на пяти карточках не отличить от «просто другая сортировка».
// Плюс два края, которых в живом каталоге не бывает по заказу: каталог, где
// ничего не нашлось, и каталог из одного тайтла.
//
// КАК УСТРОЕНО. Берётся СОБРАННЫЙ скрипт страницы из `dist/_astro/` и гоняется
// в Node поверх подделки документа. Переписывать его рядом своими словами
// нельзя: копия проверяла бы саму себя. Значит проверке нужна свежая сборка —
// без неё она честно ругается, что смотреть не на что.
//
// ЧЕГО ЭТА ПРОВЕРКА НЕ ЗНАЕТ. Ничего про вид: ни размера кнопки, ни того, что
// стрелка вообще нарисована. Только порядок, подписи и счётчики.

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Путь достаём через fileURLToPath, а не `.pathname`: в пути к проекту русские
// буквы, и `.pathname` отдаёт их закодированными — «файла нет» про файл, который есть.
const ASTRO_DIR = fileURLToPath(new URL('../dist/_astro/', import.meta.url));
const SCRIPT_PREFIX = 'index.astro_astro_type_script_index_0_lang.';

function собранныйСкрипт() {
	// Файл самопроверки лежит в той же папке и начинается так же — свой
	// подлог за настоящий скрипт принимать нельзя.
	const found = readdirSync(ASTRO_DIR).find(
		(name) => name.startsWith(SCRIPT_PREFIX) && !name.includes('selftest'),
	);
	if (!found) {
		throw new Error('в сборке нет скрипта каталога — соберите сайт (`npm run build`) и повторите');
	}
	return found;
}

// ── Подделка документа ──────────────────────────────────────────────────────
//
// Своя, а не общая с `browser-stub.mjs`: та вынимает скрипт из `index.html`
// служебной страницы и заводит элементы по первому спросу, а тут скрипт лежит
// отдельным файлом сборки и ему нужна настоящая сетка с марками.

function makeEl(tag, className = '') {
	const node = {
		tagName: tag,
		className,
		dataset: {},
		children: [],
		listeners: {},
		attrs: {},
		hidden: false,
		disabled: false,
		value: '',
		title: '',
		textContent: '',
		addEventListener: (type, fn) => ((node.listeners[type] ??= []).push(fn)),
		getAttribute: (name) => node.attrs[name] ?? null,
		setAttribute: (name, value) => (node.attrs[name] = value),
		querySelector: () => null,
		querySelectorAll: (sel) =>
			node.children.filter((kid) => String(kid.className).split(/\s+/).includes(sel.replace('.', ''))),
		// Перенос уже стоящего ребёнка в конец — ровно то, чем скрипт меняет
		// порядок марок в разметке.
		appendChild: (kid) => {
			const at = node.children.indexOf(kid);
			if (at >= 0) node.children.splice(at, 1);
			node.children.push(kid);
		},
	};
	return node;
}

function марка(id, data) {
	const el = makeEl('a', 'cat-stamp');
	el.dataset = { ...data };
	el.id = id;
	return el;
}

const ПЯТЬ = () => [
	марка('первый', { order: '1', title: 'Ааа', year: '2000', mentions: '10', search: 'ааа' }),
	марка('второй', { order: '2', title: 'Ббб', year: '2020', mentions: '30', search: 'ббб' }),
	марка('третий', { order: '3', title: 'Ввв', year: '2010', mentions: '20', search: 'ввв' }),
	марка('четвёртый', { order: '4', title: 'Ггг', year: '1990', mentions: '5', search: 'ггг' }),
	марка('пятый', { order: '5', title: 'Ддд', year: '2024', mentions: '1', search: 'ддд' }),
];

function собратьСтраницу(stamps) {
	const grid = makeEl('div', 'catalog-grid');
	grid.dataset = { pageSize: '24', forms: 'тайтл|тайтла|тайтлов' };
	for (const s of stamps) grid.children.push(s);

	const sort = makeEl('select');
	sort.value = 'order';
	sort.options = [
		{ value: 'order', text: 'по порядку добавления' },
		{ value: 'title', text: 'по алфавиту' },
		{ value: 'year', text: 'по году выхода' },
		{ value: 'mentions', text: 'по числу упоминаний' },
	];
	Object.defineProperty(sort, 'selectedIndex', {
		get: () => sort.options.findIndex((option) => option.value === sort.value),
	});

	const byId = new Map([
		['catalog-grid', grid],
		['catalog-search', makeEl('input')],
		['catalog-sort', sort],
		['catalog-sort-face', makeEl('span')],
		['catalog-dir', makeEl('button')],
		['catalog-dir-face', makeEl('span')],
		['catalog-count', makeEl('span')],
		['catalog-empty', makeEl('div')],
		['catalog-empty-text', makeEl('p')],
		['catalog-more', makeEl('button')],
	]);

	globalThis.document = {
		listeners: {},
		getElementById: (id) => byId.get(id) ?? null,
		addEventListener: (type, fn) => ((globalThis.document.listeners[type] ??= []).push(fn)),
	};
	return { byId, grid, sort };
}

const нажать = (node) => {
	for (const fn of node.listeners.click ?? []) fn({ target: node });
};
const сменить = (node, value) => {
	node.value = value;
	for (const fn of node.listeners.change ?? []) fn({ target: node });
};
const набрать = (node, value) => {
	node.value = value;
	for (const fn of node.listeners.input ?? []) fn({ target: node });
};
const видно = (grid) => grid.children.filter((el) => !el.hidden).map((el) => el.id).join(' ');

let прогонов = 0;

async function запустить(stamps, scriptName) {
	const page = собратьСтраницу(stamps);
	// Каждый прогон — свой модуль: у скрипта страницы есть состояние,
	// и второй сеанс поверх первого проверял бы не то.
	прогонов += 1;
	const url = `${pathToFileURL(resolve(ASTRO_DIR, scriptName)).href}?run=${прогонов}`;
	await import(url);
	for (const fn of globalThis.document.listeners['astro:page-load'] ?? []) fn();
	return page;
}

// ── Проверки ────────────────────────────────────────────────────────────────

const cases = [];
const say = (name, ok, detail) => {
	cases.push({ name, ok });
	console.log(`  ${ok ? 'ок  ' : 'СБОЙ'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

async function main(scriptName = собранныйСкрипт()) {
	console.log('=== КАТАЛОГ: НАПРАВЛЕНИЕ СОРТИРОВКИ, ПРОГОН СОБРАННОГО СКРИПТА ===\n');

	{
		const { grid, byId, sort } = await запустить(ПЯТЬ(), scriptName);
		const dir = byId.get('catalog-dir');
		const face = byId.get('catalog-dir-face');

		say(
			'по умолчанию порядок прежний, и кнопка называет его словами',
			видно(grid) === 'первый второй третий четвёртый пятый' &&
				dir.textContent.includes('по возрастанию') &&
				face.textContent === '↑',
			`порядок: ${видно(grid)}; подпись: «${dir.textContent}»; стрелка: ${face.textContent}`,
		);

		нажать(dir);
		say(
			'нажатие переворачивает ТЕКУЩУЮ сортировку',
			видно(grid) === 'пятый четвёртый третий второй первый' && dir.textContent.includes('по убыванию'),
			`порядок: ${видно(grid)}; подпись: «${dir.textContent}»`,
		);

		// Перевёрнутость переживает смену сортировки, а подпись пересчитывается:
		// у года прямой порядок — свежие сверху, то есть по убыванию, поэтому
		// перевёрнутый год это возрастание.
		сменить(sort, 'year');
		say(
			'при смене сортировки направление сохраняется',
			видно(grid) === 'четвёртый первый третий второй пятый' && dir.textContent.includes('по возрастанию'),
			`порядок по году, перевёрнуто: ${видно(grid)}; подпись: «${dir.textContent}»`,
		);

		нажать(dir);
		say(
			'ПРЯМОЙ порядок каждой сортировки остался прежним — у года свежие сверху',
			видно(grid) === 'пятый второй третий первый четвёртый' && dir.textContent.includes('по убыванию'),
			`порядок по году: ${видно(grid)}; подпись: «${dir.textContent}»`,
		);
	}

	{
		// КРАЙ ПЕРВЫЙ: каталог из одного тайтла.
		const { grid, byId } = await запустить([ПЯТЬ()[0]], scriptName);
		нажать(byId.get('catalog-dir'));
		say(
			'каталог из одного тайтла: нажатие ничего не ломает',
			видно(grid) === 'первый' && byId.get('catalog-count').textContent === 'Всего: 1 тайтл',
			`видно: «${видно(grid)}»; счётчик: «${byId.get('catalog-count').textContent}»`,
		);
	}

	{
		// КРАЙ ВТОРОЙ: по запросу не нашлось ничего.
		const { grid, byId } = await запустить(ПЯТЬ(), scriptName);
		набрать(byId.get('catalog-search'), 'такогонетвовсе');
		нажать(byId.get('catalog-dir'));
		say(
			'ничего не нашлось: нажатие ничего не ломает, пустое состояние на месте',
			видно(grid) === '' &&
				byId.get('catalog-empty').hidden === false &&
				byId.get('catalog-count').textContent === 'Найдено: 0 тайтлов',
			`видно строк: ${grid.children.filter((el) => !el.hidden).length}; ` +
				`пустое состояние скрыто: ${byId.get('catalog-empty').hidden}; ` +
				`счётчик: «${byId.get('catalog-count').textContent}»`,
		);
	}

	const плохо = cases.filter((item) => !item.ok).length;
	console.log(плохо === 0 ? `\nВсе ${cases.length} проверок прошли.` : `\nНЕ ПРОШЛО: ${плохо} из ${cases.length}.`);
	return плохо;
}

// ── Самопроверка: а умеет ли она находить? ──────────────────────────────────
//
// Подлог — «кнопка нажимается, а порядок не меняется»: у знака сравнения
// отнимается зависимость от состояния. Ищется он выражением, а не точным
// текстом: сборщик переименовывает переменные при каждой сборке, и подлог,
// написанный буквой, молча перестал бы вставать.
//
// Копия кладётся РЯДОМ с оригиналом, в `dist/_astro/`: скрипт импортирует
// оттуда соседние файлы, и в другой папке он не завёлся бы вовсе. Убирается
// в `finally` — оставшийся файл уехал бы на сайт следующей выкладкой.

async function selftest() {
	console.log('=== САМОПРОВЕРКА: ПОДЛОЖЕН СКРИПТ, В КОТОРОМ НАПРАВЛЕНИЕ НЕ ДЕЙСТВУЕТ ===\n');

	const оригинал = собранныйСкрипт();
	const текст = readFileSync(resolve(ASTRO_DIR, оригинал), 'utf8');
	const сломанный = текст.replace(/(\b[\w$]+)=(\b[\w$]+)\?-1:1/, '$1=1');
	if (сломанный === текст) {
		throw new Error('в собранном скрипте нет знака направления — подлог не встал, проверка смотрит не туда');
	}

	const имя = `${SCRIPT_PREFIX}selftest.js`;
	writeFileSync(resolve(ASTRO_DIR, имя), сломанный);
	try {
		const плохо = await main(имя);
		const покраснели = cases.filter((item) => !item.ok).map((item) => item.name);
		console.log(
			плохо > 0
				? `\n  ок    ПРОВЕРКА КРАСНЕЕТ НА СЛОМАННОМ КОДЕ: ${покраснели.join('; ')}`
				: '\n  СБОЙ  проверка НЕ ЗАМЕТИЛА, что направление не работает. Она бесполезна.',
		);
		return плохо > 0 ? 0 : 1;
	} finally {
		unlinkSync(resolve(ASTRO_DIR, имя));
	}
}

// Сравнение путями, а не строками: `import.meta.url` кодирует русские буквы
// в пути к проекту, а `process.argv[1]` — нет, и строчное сравнение
// не совпало бы никогда.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const плохо = process.argv.includes('--selftest') ? await selftest() : await main();
	process.exit(плохо === 0 ? 0 : 1);
}
