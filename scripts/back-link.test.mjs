#!/usr/bin/env node
// Проверки кнопки «Назад» в шапке материала (скрипт `Layout.astro`).
//
// НЕ ПЕРЕСКАЗ, А НАСТОЯЩИЙ КОД: обработчик вынимается из СОБРАННОГО файла
// `dist/_astro/Layout.astro_astro_type_script_*.js` и гоняется на подделке
// браузера в шестьдесят строк. Перепиши мы логику рядом — копия разошлась бы
// с первой правкой, и проверка стала бы проверять сама себя.
//
// Правило проекта «браузерное проверяет заказчик» остаётся в силе для ВИДА.
// Здесь проверяется РЕШЕНИЕ: возвращаться назад или уходить в раздел.
//
//   node scripts/back-link.test.mjs            (после npm run build)
//   node scripts/back-link.test.mjs --selftest (обработчику ломают условие)

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selftest = process.argv.includes('--selftest');

// ——— вынимаем настоящий код ———

const ASTRO_DIR = join(ROOT, 'dist/_astro');
const file = readdirSync(ASTRO_DIR).find((name) => name.startsWith('Layout.astro_astro_type_script') && name.endsWith('.js'));
if (!file) {
	console.log('ПРОВАЛ  Собранного скрипта макета нет — сначала npm run build');
	process.exit(1);
}

let code = readFileSync(join(ASTRO_DIR, file), 'utf8');
if (!code.includes('data-back')) {
	console.log('ПРОВАЛ  В собранном скрипте макета нет обработчика ссылки «Назад»');
	process.exit(1);
}

// Ввоз чужих кусков (заглушка «изображения нет») этой проверке не нужен,
// а `new Function` его не переварит: меняем на пустышки с теми же именами,
// чтобы код остался нашим, а не переписанным.
code = code.replace(/import\{([^}]*)\}from"[^"]*";/g, (_, names) => {
	const locals = names.split(',').map((pair) => pair.split(' as ').pop().trim());
	return locals.map((name) => `let ${name}=()=>"";`).join('');
});

// ПОДЛОГИ. Каждый портит код по-своему, и проверка обязана поймать оба.
// Второй — не выдуманный: ровно так кнопка и была сломана в первой редакции,
// и нашёл это заказчик на живом сайте, а не проверка.
const FAKES = {
	'счётчик истории отнят': (src) => src.replace(/typeof [a-zA-Z_$][\w$]*==`number`&&[a-zA-Z_$][\w$]*>0/, 'false'),
	'слушатель снят с фазы перехвата': (src) => src.replace('history.back())},!0)', 'history.back())})'),
};

const fakeName = selftest ? process.argv[process.argv.indexOf('--selftest') + 1] : null;

if (selftest && !fakeName) {
	// Без имени подлога прогоняем ОБА, каждый своим заходом.
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
	console.log(caught === Object.keys(FAKES).length ? '\nОба подлога пойманы.' : '\nПРОВАЛ  Пойманы не все.');
	process.exit(caught === Object.keys(FAKES).length ? 0 : 1);
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

function makeWorld({ historyIndex, referrer, origin = 'https://bakapodcast.com' }) {
	const world = { wentBack: 0, followedLink: 0, routerTook: 0 };

	const backLink = {
		tag: 'a',
		attrs: { 'data-back': '', href: '/category/note/' },
		closest(selector) {
			return selector === '[data-back]' ? this : null;
		},
	};
	const plainLink = {
		tag: 'a',
		attrs: { href: '/anime/' },
		closest() {
			return null;
		},
	};

	const listeners = [];
	const document = {
		referrer,
		addEventListener(type, fn, options) {
			const capture = options === true || options?.capture === true;
			listeners.push({ type, fn, capture });
		},
		querySelectorAll: () => [],
	};

	const history = {
		state: historyIndex === null ? null : { index: historyIndex },
		back() {
			world.wentBack++;
		},
	};

	// ЩЕЛЧОК ИДЁТ ДВУМЯ ФАЗАМИ, И ЭТО НЕ ПРИДИРКА К ТОЧНОСТИ ПОДДЕЛКИ.
	// ClientRouter слушает клики обычным обработчиком из <head> — то есть
	// раньше нашего — и ставит `preventDefault`, уводя на страницу раздела
	// переходом без перезагрузки. Кнопка «Назад» из-за этого месяц называлась
	// «Назад», а вела в раздел. Подделка обязана воспроизводить это, иначе
	// её «ок» ничего не значит: она уже один раз соврала именно так.
	world.click = (target) => {
		const event = {
			target,
			button: 0,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
		};

		// Сначала перехват — там, где обязаны быть мы.
		for (const { type, fn, capture } of listeners) if (type === 'click' && capture) fn(event);

		// Потом всплытие: сначала роутер Astro, следом наши обычные обработчики,
		// если бы они тут были.
		if (!event.defaultPrevented && target.attrs?.href) {
			event.preventDefault();
			world.routerTook++;
		}
		for (const { type, fn, capture } of listeners) if (type === 'click' && !capture) fn(event);

		// Куда в итоге ушёл человек: роутер повёл его по адресу ссылки.
		if (world.routerTook > 0) world.followedLink++;
	};

	world.backLink = backLink;
	world.plainLink = plainLink;
	world.env = { document, history, location: { origin }, HTMLMediaElement: { HAVE_NOTHING: 0, NETWORK_LOADING: 2 } };
	return world;
}

function run(world) {
	const { document, history, location, HTMLMediaElement } = world.env;
	const fn = new Function('document', 'history', 'location', 'HTMLMediaElement', 'URL', 'window', code);
	fn(document, history, location, HTMLMediaElement, URL, { addEventListener() {} });
	return world;
}

// ——— случаи ———

const CASES = [
	{
		name: 'ходил по сайту без перезагрузки — возвращаемся назад',
		world: { historyIndex: 3, referrer: '' },
		click: 'back',
		wantBack: 1,
		wantFollow: 0,
	},
	{
		name: 'пришёл из поиска Гугла прямо на статью — уходим в раздел',
		world: { historyIndex: 0, referrer: 'https://www.google.com/search?q=бака' },
		click: 'back',
		wantBack: 0,
		wantFollow: 1,
	},
	{
		name: 'первая страница вкладки, истории нет вовсе — уходим в раздел',
		world: { historyIndex: null, referrer: '' },
		click: 'back',
		wantBack: 0,
		wantFollow: 1,
	},
	{
		name: 'полная загрузка по внутренней ссылке — возвращаемся назад',
		world: { historyIndex: 0, referrer: 'https://bakapodcast.com/category/note/' },
		click: 'back',
		wantBack: 1,
		wantFollow: 0,
	},
	{
		name: 'обычная ссылка на странице кнопкой «назад» не становится',
		world: { historyIndex: 3, referrer: '' },
		click: 'plain',
		wantBack: 0,
		wantFollow: 1,
	},
];

let failed = 0;
for (const kase of CASES) {
	const world = run(makeWorld(kase.world));
	world.click(kase.click === 'back' ? world.backLink : world.plainLink);

	const ok = world.wentBack === kase.wantBack && world.followedLink === kase.wantFollow;
	if (ok) {
		console.log(`  ✓ ${kase.name}`);
	} else {
		failed++;
		console.log(`  ✗ ${kase.name}`);
		console.log(`      вернулись назад ${world.wentBack} (ждали ${kase.wantBack}), ушли по ссылке ${world.followedLink} (ждали ${kase.wantFollow})`);
	}
}

if (selftest) {
	// С подломанным условием случаи «возвращаемся назад» обязаны развалиться.
	console.log(failed > 0 ? `\nПодлог пойман: не сошлось ${failed} — так и надо.` : '\nПРОВАЛ  Подлог НЕ пойман: проверка молчит на сломанном коде.');
	process.exit(failed > 0 ? 0 : 1);
}

console.log(failed === 0 ? '\nВсё сошлось.' : `\nНе сошлось: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
