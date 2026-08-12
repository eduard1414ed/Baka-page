#!/usr/bin/env node
// Проверки вкладок ленты главной: помнит ли адрес выбранную вкладку и ставит
// ли её обратно возврат с материала (скрипт `PostFeed.astro`).
//
// НЕ ПЕРЕСКАЗ, А НАСТОЯЩИЙ КОД: обработчики вынимаются из СОБРАННОГО файла
// `dist/_astro/PostFeed.astro_astro_type_script_*.js` и гоняются на подделке
// браузера. Перепиши мы логику рядом — копия разошлась бы с первой правкой,
// и проверка стала бы проверять сама себя. Тот же приём, что у кнопки
// «Назад» (`back-link.test.mjs`), и та же причина.
//
// Правило проекта «браузерное проверяет заказчик» остаётся в силе для ВИДА.
// Здесь проверяется РЕШЕНИЕ: что уходит в адрес и какая вкладка встаёт,
// когда страница приезжает возвратом.
//
//   node scripts/feed-mode.test.mjs            (после npm run build)
//   node scripts/feed-mode.test.mjs --selftest (коду подкладывают поломки)

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selftest = process.argv.includes('--selftest');

// ——— вынимаем настоящий код ———

const ASTRO_DIR = join(ROOT, 'dist/_astro');
const file = readdirSync(ASTRO_DIR).find(
	(name) => name.startsWith('PostFeed.astro_astro_type_script') && name.endsWith('.js'),
);
if (!file) {
	console.log('ПРОВАЛ  Собранного скрипта ленты нет — сначала npm run build');
	process.exit(1);
}

let code = readFileSync(join(ASTRO_DIR, file), 'utf8');
if (!code.includes('astro:after-swap') || !code.includes('replaceState')) {
	console.log('ПРОВАЛ  В собранном скрипте ленты нет ни записи вкладки в адрес, ни её восстановления');
	process.exit(1);
}

// Ввоз общего `loadMore.mjs` этой проверке не нужен, а `new Function` его
// не переварит: меняем на пустышку с тем же именем, чтобы код остался нашим.
code = code.replace(/import\{([^}]*)\}from"[^"]*";/g, (_, names) => {
	const locals = names.split(',').map((pair) => pair.split(' as ').pop().trim());
	return locals.map((name) => `let ${name}=()=>"";`).join('');
});

// ПОДЛОГИ. Каждый ломает своё, и проверка обязана поймать все.
// Второй — не выдуманный: ровно так эта правка и могла бы тихо сломать
// ссылку «Назад» на материалах, потому что в `history.state` лежит счётчик
// ClientRouter, по которому она решает, есть ли куда возвращаться.
const FAKES = {
	'вкладка не пишется в адрес': (src) => src.replace(/,i\(a\.dataset\.filter\)/, ''),
	'состояние истории затёрто пустым': (src) => src.replace('history.replaceState(history.state,', 'history.replaceState({},'),
	'вкладка встаёт только после отрисовки': (src) => src.replace('document.addEventListener(`astro:after-swap`,o),', ''),
	'чужое слово из адреса принимается за режим': (src) =>
		src.replace('&&[...document.querySelectorAll(`.tab[data-filter]`)].some(t=>t.dataset.filter===e)', ''),
};

const fakeName = selftest ? process.argv[process.argv.indexOf('--selftest') + 1] : null;

if (selftest && !fakeName) {
	// Без имени подлога прогоняем ВСЕ, каждый своим заходом.
	const { execFileSync } = await import('node:child_process');
	let caught = 0;
	for (const name of Object.keys(FAKES)) {
		console.log(`\n— подлог «${name}»`);
		try {
			execFileSync(process.execPath, [process.argv[1], '--selftest', name], { stdio: 'inherit' });
			caught++;
		} catch {
			console.log('ПРОВАЛ  Подлог не пойман');
		}
	}
	const all = Object.keys(FAKES).length;
	console.log(caught === all ? `\nВсе ${all} подлога пойманы.` : `\nПРОВАЛ  Пойманы не все: ${caught} из ${all}.`);
	process.exit(caught === all ? 0 : 1);
}

if (selftest) {
	const fake = FAKES[fakeName];
	if (!fake) {
		console.log(`ПРОВАЛ  Подлога «${fakeName}» нет`);
		process.exit(1);
	}
	const before = code;
	code = fake(code);
	if (code === before) {
		console.log('ПРОВАЛ  Подлог не подставился — проверка ничего не проверяет');
		process.exit(1);
	}
}

// ——— подделка браузера ———

// Состав вкладок берём тот же, что у сайта: «Все» плюс четыре типа.
const MODES = ['all', 'podcast', 'videoessay', 'note', 'article'];

class Element {}

function makeTab(mode) {
	const node = new Element();
	Object.assign(node, {
		className: mode === 'all' ? 'tab active' : 'tab',
		dataset: {
			filter: mode,
			archiveHref: mode === 'all' ? '/archive/' : `/category/${mode}/`,
			archiveLabel: mode === 'all' ? 'Весь архив' : `Все ${mode} в архиве`,
		},
		attrs: {},
		classList: {
			toggle(name, on) {
				const has = node.className.split(' ').includes(name);
				if (on && !has) node.className = `${node.className} ${name}`.trim();
				if (!on && has) node.className = node.className.split(' ').filter((c) => c !== name).join(' ');
			},
		},
		setAttribute(name, value) {
			node.attrs[name] = value;
		},
		closest(sel) {
			return sel === '.tab[data-filter]' ? node : null;
		},
	});
	return node;
}

function makeBlock(fields) {
	const node = new Element();
	Object.assign(node, { hidden: false, dataset: {}, attrs: {}, ...fields });
	node.closest ??= () => null;
	return node;
}

function makeWorld({ href, withTabs = true }) {
	const tabs = withTabs ? MODES.map(makeTab) : [];

	// Блоки, которые переключает режим. Ряды главной помечают себя сами
	// (`data-only-mode`), у сеток режим стоит в `data-mode`.
	const showcase = makeBlock({ dataset: { onlyMode: 'all' } });
	const grids = MODES.filter((m) => m !== 'all').map((m) => makeBlock({ dataset: { mode: m }, hidden: true }));
	const lists = MODES.map((m) => makeBlock({ dataset: { mode: m }, hidden: m !== 'all' }));

	const byId = {
		'load-more': makeBlock({ disabled: false, closest: (sel) => (sel === '#load-more' ? byId['load-more'] : null) }),
		'older-materials': makeBlock({ hidden: true, querySelector: () => null }),
		'archive-link': makeBlock({}),
		'archive-link-label': makeBlock({ textContent: '' }),
	};
	byId['archive-link'].setAttribute = (name, value) => {
		byId['archive-link'].attrs[name] = value;
	};

	const world = { tabs, showcase, grids, lists, byId, replaced: 0, pushed: 0, stateSeen: [] };

	const pick = (sel) => {
		if (sel === '.tab[data-filter]') return tabs;
		if (sel === '[data-only-mode]') return [showcase];
		if (sel === '.archive-grid[data-mode]') return grids;
		if (sel === '.list-grid[data-mode]') return lists;
		return [];
	};

	const listeners = [];
	const document = {
		addEventListener(type, fn) {
			listeners.push({ type, fn });
		},
		querySelectorAll: pick,
		querySelector: (sel) => pick(sel)[0] ?? null,
		getElementById: (id) => byId[id] ?? null,
	};

	// Адрес живой: то, что записали, читается следующим вызовом.
	const location = { href };
	const history = {
		state: { index: 3, scrollX: 0, scrollY: 0 },
		replaceState(state, _title, url) {
			world.replaced++;
			world.stateSeen.push(state);
			history.state = state;
			location.href = String(url);
		},
		pushState() {
			world.pushed++;
		},
	};

	world.fire = (type) => {
		for (const l of listeners) if (l.type === type) l.fn();
	};
	world.click = (target) => {
		const event = { target };
		for (const l of listeners) if (l.type === 'click') l.fn(event);
	};
	world.url = () => location.href;
	world.activeTab = () => tabs.find((t) => t.className.split(' ').includes('active'))?.dataset.filter ?? null;
	world.env = { document, history, location, window: { location } };
	return world;
}

function run(world) {
	const { document, history, location, window } = world.env;
	const fn = new Function('document', 'history', 'location', 'window', 'URL', 'Element', code);
	fn(document, history, location, window, URL, Element);
	return world;
}

// ——— случаи ———

const SITE = 'https://bakapodcast.com/';

const CASES = [
	{
		name: 'нажали «Заметки» — адрес запомнил вкладку',
		world: { href: SITE },
		act: (w) => w.click(w.tabs[3]),
		check: (w) => (w.url() === `${SITE}?mode=note` ? null : `адрес ${w.url()}`),
	},
	{
		name: 'запись в историю ЗАМЕНЯЕТСЯ, а не добавляется',
		world: { href: SITE },
		act: (w) => w.click(w.tabs[3]),
		check: (w) => (w.replaced === 1 && w.pushed === 0 ? null : `замен ${w.replaced}, добавлений ${w.pushed}`),
	},
	{
		name: 'счётчик истории ClientRouter уцелел — «Назад» на материале жив',
		world: { href: SITE },
		act: (w) => w.click(w.tabs[3]),
		check: (w) => (w.stateSeen[0]?.index === 3 ? null : `в историю ушло ${JSON.stringify(w.stateSeen[0])}`),
	},
	{
		name: 'вернулись на «Все» — хвостик из адреса ушёл',
		world: { href: SITE },
		act: (w) => {
			w.click(w.tabs[3]);
			w.click(w.tabs[0]);
		},
		check: (w) => (w.url() === SITE ? null : `адрес ${w.url()}`),
	},
	{
		name: 'ВОЗВРАТ С МАТЕРИАЛА: вкладка встаёт ДО отрисовки',
		world: { href: `${SITE}?mode=note` },
		act: (w) => w.fire('astro:after-swap'),
		check: (w) =>
			w.activeTab() === 'note' && w.showcase.hidden && !w.lists.find((l) => l.dataset.mode === 'note').hidden
				? null
				: `вкладка ${w.activeTab()}, ряды главной спрятаны: ${w.showcase.hidden}`,
	},
	{
		name: 'обычное открытие /?mode=podcast — вкладка та же',
		world: { href: `${SITE}?mode=podcast` },
		act: (w) => w.fire('astro:page-load'),
		check: (w) => (w.activeTab() === 'podcast' ? null : `вкладка ${w.activeTab()}`),
	},
	{
		name: 'чужое слово в адресе режимом не считается',
		world: { href: `${SITE}?mode=выдумка` },
		act: (w) => w.fire('astro:page-load'),
		check: (w) => (w.activeTab() === 'all' && !w.showcase.hidden ? null : `вкладка ${w.activeTab()}`),
	},
	{
		name: 'страница без ленты (материал, архив) — ничего не трогаем',
		world: { href: `${SITE}posts/kaguya/`, withTabs: false },
		act: (w) => {
			w.fire('astro:after-swap');
			w.fire('astro:page-load');
		},
		check: (w) => (w.showcase.hidden === false ? null : 'ряды главной кто-то спрятал'),
	},
];

let failed = 0;
for (const kase of CASES) {
	const world = run(makeWorld(kase.world));
	kase.act(world);
	const problem = kase.check(world);
	if (problem === null) {
		console.log(`  ✓ ${kase.name}`);
	} else {
		failed++;
		console.log(`  ✗ ${kase.name} — ${problem}`);
	}
}

if (selftest) {
	// С подломанным кодом хоть один случай ОБЯЗАН развалиться. Ноль здесь
	// значил бы, что проверка молчит на сломанном коде, — то есть не значит
	// ничего и на исправном.
	console.log(failed > 0 ? `\nПодлог пойман: не сошлось ${failed} — так и надо.` : '\nПРОВАЛ  Подлог НЕ пойман.');
	process.exit(failed > 0 ? 0 : 1);
}

if (failed) {
	console.log(`\nПРОВАЛ  ${failed} из ${CASES.length}`);
	process.exit(1);
}
console.log(`\nВсе ${CASES.length} случая сошлись.`);
