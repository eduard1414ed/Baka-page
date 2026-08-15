// ПЕРЕЖИВАЕТ ЛИ ЗВУК ПЕРЕХОД МЕЖДУ СТРАНИЦАМИ.
//
//   node scripts/persist-audio.test.mjs             — спросить
//   node scripts/persist-audio.test.mjs --selftest  — плюс подлоги
//
// ЗАЧЕМ. На этом держится главная особенность сайта: выпуск играет, читатель
// уходит на другую страницу, звук не прерывается. Работает это не «трюком
// на JS», а одной строкой разметки — `transition:persist` у панели плеера
// (`PlayerBar.astro`): при переходе Astro не пересоздаёт `<audio>`, а
// ПЕРЕНОСИТ живой элемент в новую страницу. Убери элемент из документа —
// и браузер обязан поставить его на паузу, так написано в стандарте HTML.
//
// ПОЧЕМУ ПРОВЕРКА ПОЯВИЛАСЬ. Обновление Astro 7.1.6 → 7.2.2 (сессия J,
// 15 августа 2026) принесло в переходы новый шаг `reifyMediaElements`: он
// обходит новую страницу и ЗАМЕНЯЕТ каждый `<video>` и `<audio>` свежей
// копией. Сделано это ради обратной беды, записанной у нас уроком, —
// «`<video>`, приехавший переходом без перезагрузки, сам за файлом не идёт».
// Но обход идёт по ВСЕЙ новой странице, а перенесённая панель плеера
// к этому моменту УЖЕ внутри неё. Вопрос «задевает ли новый шаг наш плеер»
// глазами по коду не решается: цена ошибки — молча умерший звук у всех.
//
// ЧЕМ ЭТО ПРОВЕРЯЕТСЯ. Настоящей функцией Astro `swapBodyElement` из
// `node_modules`, а не её пересказом: пересказ отвечал бы про правило,
// которого в сборке нет. Дерево — подделка ровно на те действия, которые
// функция совершает (найти, перенести, заменить, спросить атрибут).
// ПОДДЕЛКА ОБЯЗАНА ВОСПРОИЗВЕСТИ УЖЕ ИЗВЕСТНОЕ: сперва на ней проверяется,
// что перенос `transition:persist` вообще работает, — иначе «плеер умер»
// ничего не значило бы, он умер бы и без нового шага.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ЗДЕСЬ = dirname(fileURLToPath(import.meta.url));
const КОРЕНЬ = join(ЗДЕСЬ, '..');
const ФАЙЛ_ASTRO = join(КОРЕНЬ, 'node_modules', 'astro', 'dist', 'transitions', 'swap-functions.js');

let плохо = 0;
const скажи = (ок, что) => {
	if (!ок) плохо++;
	console.log(`${ок ? '  ок  ' : ' ПЛОХО'}  ${что}`);
};

// ── Подделка дерева ───────────────────────────────────────────────────────
// Только то, чего касается `swapBodyElement`. Всё, чего он не трогает
// (текст, стили, события), не изображается вовсе: изображённое наполовину
// хуже отсутствующего, потому что выглядит настоящим.

let счётчик = 0;

function элемент(localName, атрибуты = {}) {
	const узел = {
		localName,
		привет: ++счётчик, // чем отличить перенесённый элемент от свежей копии
		attributes: Object.entries(атрибуты).map(([name, value]) => ({ name, value: String(value) })),
		children: [],
		parentNode: null,
		innerHTML: '',
		shadowRoot: null,
		dataset: {},
		getAttribute(имя) {
			return this.attributes.find((a) => a.name === имя)?.value ?? null;
		},
		setAttribute(имя, значение) {
			const есть = this.attributes.find((a) => a.name === имя);
			if (есть) есть.value = String(значение);
			else this.attributes.push({ name: имя, value: String(значение) });
		},
		appendChild(дитя) {
			дитя.parentNode?.убрать(дитя);
			дитя.parentNode = this;
			this.children.push(дитя);
			return дитя;
		},
		убрать(дитя) {
			const i = this.children.indexOf(дитя);
			if (i >= 0) this.children.splice(i, 1);
		},
		remove() {
			this.parentNode?.убрать(this);
			this.parentNode = null;
		},
		replaceWith(другой) {
			const род = this.parentNode;
			if (!род) return;
			другой.parentNode?.убрать(другой);
			род.children[род.children.indexOf(this)] = другой;
			другой.parentNode = род;
			this.parentNode = null;
		},
		потомки() {
			return this.children.flatMap((к) => [к, ...к.потомки()]);
		},
		querySelectorAll(селектор) {
			return this.потомки().filter((к) => подходит(к, селектор));
		},
		querySelector(селектор) {
			return this.querySelectorAll(селектор)[0] ?? null;
		},
		get ownerDocument() {
			return документ;
		},
	};
	return узел;
}

/** Разбор ровно тех селекторов, которыми пользуется `swapBodyElement`. */
function подходит(узел, селектор) {
	for (const один of селектор.split(',').map((s) => s.trim())) {
		const атрибут = один.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/);
		if (атрибут) {
			const значение = узел.getAttribute(атрибут[1]);
			if (значение !== null && (атрибут[2] === undefined || значение === атрибут[2])) return true;
			continue;
		}
		const тегСАтрибутом = один.match(/^([a-z-]+)\[([a-z-]+)\]$/);
		if (тегСАтрибутом) {
			if (узел.localName === тегСАтрибутом[1] && узел.getAttribute(тегСАтрибутом[2]) !== null) return true;
			continue;
		}
		if (узел.localName === один) return true;
	}
	return false;
}

const документ = {
	documentElement: null,
	createElement: (тег) => элемент(тег),
};

/**
 * Страница, устроенная как настоящая: `<html>` → `<body>` → панель плеера
 * с `transition:persist` и `<audio>` внутри, плюс обычное содержимое.
 *
 * Имя атрибута НЕ ПРИДУМАНО, а взято из самой Astro: придуманное разошлось бы
 * с ней при первом же переименовании, и проверка отвечала бы «перенос
 * не работает» про работающий перенос.
 */
const ИМЯ_ПЕРЕЖИТЬ = readFileSync(ФАЙЛ_ASTRO, 'utf8').match(/const PERSIST_ATTR = "([^"]+)"/)[1];

function страница(подпись) {
	const body = элемент('body');
	const панель = элемент('div', { id: 'player-bar', [ИМЯ_ПЕРЕЖИТЬ]: 'player-bar' });
	const звук = элемент('audio', { id: 'player-audio', preload: 'none' });
	панель.appendChild(звук);
	body.appendChild(панель);
	body.appendChild(элемент('main', { 'data-страница': подпись }));
	return { body, панель, звук };
}

console.log('ПЕРЕЖИВАЕТ ЛИ ЗВУК ПЕРЕХОД: настоящая функция Astro на подделке дерева.');
console.log(`Astro: ${JSON.parse(readFileSync(join(КОРЕНЬ, 'node_modules', 'astro', 'package.json'), 'utf8')).version}`);
console.log(`атрибут «пережить переход»: ${ИМЯ_ПЕРЕЖИТЬ}`);
console.log();

// НАСТОЯЩИЙ КОД ASTRO, И В НЁМ МЕНЯЕТСЯ РОВНО ОДНО СЛОВО.
//
// Файл написан под сборщик: `import.meta.env.DEV` подставляет Vite, а в узле
// такого нет вовсе, и модуль падает на четвёртой строке. В боевой сборке сайта
// Vite подставляет туда `false` — то же самое подставляем и мы. Подмена одна,
// она названа, и проверка ниже требует, чтобы она правда что-то заменила:
// подлог, ничего не заменивший, обвиняет в своей ошибке проверку (CLAUDE.md).
const исходныйAstro = readFileSync(ФАЙЛ_ASTRO, 'utf8');
const кодAstro = исходныйAstro.replaceAll('import.meta.env.DEV', 'false');
if (кодAstro === исходныйAstro) {
	console.log(' ПЛОХО  в коде Astro нет `import.meta.env.DEV` — подмена ничего не заменила, файл изменился');
	process.exit(1);
}
// Времянка кладётся В ТУ ЖЕ ПАПКУ, что оригинал, а не рядом с проектом:
// внутри файла есть относительные импорты (`../runtime/…`), и из чужой папки
// они не находятся — узел падает на `ERR_MODULE_NOT_FOUND`, а выглядит это
// как «проверка сломалась», а не как «положил не туда».
const времянка = join(dirname(ФАЙЛ_ASTRO), '.swap-для-проверки.mjs');

/** Загрузить `swapBodyElement` из данного текста кода Astro. */
async function загрузитьSwap(код, метка) {
	writeFileSync(времянка, код, 'utf8');
	try {
		// Метка в адресе — чтобы узел не отдал закэшированный модуль: без неё
		// подложенная версия молча оказалась бы прежней, и подлог «не поймался»
		// говорил бы о кэше, а не о проверке.
		return (await import(`${pathToFileURL(времянка).href}?${метка}`)).swapBodyElement;
	} finally {
		unlinkSync(времянка);
	}
}

let swapBodyElement = await загрузитьSwap(кодAstro, 'настоящий');

/** Один переход. Возвращает, что стало с живым `<audio>` старой страницы. */
function переход() {
	счётчик = 0;
	const html = элемент('html');
	документ.documentElement = html;
	const старая = страница('была');
	const новая = страница('стала');
	html.appendChild(старая.body);

	globalThis.document = документ;
	try {
		swapBodyElement(новая.body, старая.body);
	} finally {
		delete globalThis.document;
	}

	const вДокументе = (узел) => {
		let у = узел;
		while (у.parentNode) у = у.parentNode;
		return у === html;
	};
	const звукиПосле = новая.body.querySelectorAll('audio');
	return {
		живойЗвукОстался: вДокументе(старая.звук),
		панельПеренесена: вДокументе(старая.панель),
		звуковНаСтранице: звукиПосле.length,
		этоТотЖеЭлемент: звукиПосле[0] === старая.звук,
	};
}

// ── 1. Подделка обязана воспроизвести УЖЕ ИЗВЕСТНОЕ ───────────────────────
// Панель с `transition:persist` обязана переехать в новую страницу. Не переедь
// она — «звук умер» ничего не значило бы: он умер бы и без нового шага, просто
// от бедности подделки. Ровно на этом уже спотыкалась проверка порядка
// расшифровки и плеера, и поймал её тогда собственный `--selftest`.
console.log('── подделка воспроизводит перенос ──');
const исход = переход();
скажи(исход.панельПеренесена, 'панель плеера перенесена в новую страницу (перенос работает)');
скажи(исход.звуковНаСтранице === 1, `на новой странице ровно один <audio> (${исход.звуковНаСтранице})`);

// ── 2. Главный вопрос ─────────────────────────────────────────────────────
console.log();
console.log('── тот ли это <audio>, что играл ──');
скажи(исход.живойЗвукОстался, 'игравший <audio> ОСТАЛСЯ в документе (иначе браузер ставит на паузу)');
скажи(исход.этоТотЖеЭлемент, 'на странице стоит ТОТ ЖЕ элемент, а не свежая копия');

if (!исход.живойЗвукОстался || !исход.этоТотЖеЭлемент) {
	console.log();
	console.log('  ЧТО ЭТО ЗНАЧИТ ДЛЯ ЧИТАТЕЛЯ: выпуск играет, читатель нажимает ссылку —');
	console.log('  звук обрывается, а кнопки закреплённой панели перестают что-либо делать');
	console.log('  (window.__bakaPlayer держит ссылку на элемент, которого в документе нет).');
	console.log('  Причина — шаг reifyMediaElements в node_modules/astro/dist/transitions/');
	console.log('  swap-functions.js: он обходит ВСЮ новую страницу, включая перенесённое.');
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
if (process.argv.includes('--selftest')) {
	console.log();
	console.log('── ПОДЛОГИ ──');

	// Подлог 1: подделка обязана УМЕТЬ показать смерть звука. Выносим живой
	// элемент из документа руками и спрашиваем тем же способом.
	счётчик = 0;
	const html = элемент('html');
	документ.documentElement = html;
	const п = страница('подлог');
	html.appendChild(п.body);
	const былВДокументе = (() => { let у = п.звук; while (у.parentNode) у = у.parentNode; return у === html; })();
	п.звук.remove();
	const сталВДокументе = (() => { let у = п.звук; while (у.parentNode) у = у.parentNode; return у === html; })();
	скажи(былВДокументе && !сталВДокументе, 'подделка отличает «элемент в документе» от «вынут» — вопрос задаётся не впустую');

	// Подлог 2: селектор `video, audio` обязан находить наш элемент. Не находи
	// он — проверка отвечала бы «всё хорошо» просто потому, что ничего не ищет.
	const п2 = страница('подлог2');
	скажи(п2.body.querySelectorAll('video, audio').length === 1, 'селектор «video, audio» находит наш <audio>');
	скажи(п2.body.querySelectorAll(`[${ИМЯ_ПЕРЕЖИТЬ}]`).length === 1, `селектор «[${ИМЯ_ПЕРЕЖИТЬ}]» находит панель`);

	// Подлог 3: настоящая разметка обязана содержать то, о чём идёт речь.
	// Убери кто-нибудь `transition:persist` у панели — проверка выше осталась бы
	// зелёной (она про Astro), а звук умер бы по совсем другой причине.
	const панель = readFileSync(join(КОРЕНЬ, 'src', 'components', 'PlayerBar.astro'), 'utf8');
	скажи(/id="player-bar"[^>]*transition:persist/.test(панель), 'у панели плеера в разметке правда стоит transition:persist');
	скажи(/<audio id="player-audio"/.test(панель), 'внутри панели правда лежит <audio id="player-audio">');

	// ГЛАВНЫЙ ПОДЛОГ: ВЕРНУТЬ ТУ САМУЮ ПОЛОМКУ.
	//
	// Пока проект стоит на 7.1.6, проверка зелёная — и зелёной она будет
	// годами. Зелёная проверка, которую нечем уронить, это ложь в сторону
	// «всё хорошо»: однажды её сочтут пустой и снимут. Поэтому подкладываем
	// в код 7.1.6 ровно тот шаг, который добавила 7.2.2, — дословно, включая
	// место вызова, — и требуем красного.
	const ШАГ_7_2_2 = `
function ПОДЛОГ_reifyMediaElements(root) {
  for (const media of root.querySelectorAll("video, audio")) {
    const fresh = document.createElement(media.localName);
    for (const attr of media.attributes) fresh.setAttribute(attr.name, attr.value);
    fresh.innerHTML = media.innerHTML;
    media.replaceWith(fresh);
  }
}
`;
	const естьУже = кодAstro.includes('reifyMediaElements');
	if (естьУже) {
		// Мы уже на версии с этим шагом — значит главная проверка выше и есть
		// красный, подкладывать нечего. Молчать тут нельзя: «подлог пропущен»
		// и «подлог не сработал» обязаны различаться.
		скажи(true, 'шаг 7.2.2 уже есть в самой Astro — подлог не нужен, красное выше и есть он');
	} else {
		const сПоломкой = кодAstro.replace(
			'  attachShadowRoots(newElement);\n}',
			'  attachShadowRoots(newElement);\n  ПОДЛОГ_reifyMediaElements(newElement);\n}' + ШАГ_7_2_2,
		);
		скажи(сПоломкой !== кодAstro, 'подлог «шаг из 7.2.2» и правда вставился в код Astro');
		const целый = swapBodyElement;
		try {
			swapBodyElement = await загрузитьSwap(сПоломкой, 'подлог');
			const сломанный = переход();
			скажи(!сломанный.живойЗвукОстался, 'с подложенным шагом 7.2.2 проверка КРАСНЕЕТ: живой <audio> вынут из документа');
			скажи(сломанный.панельПеренесена, 'при этом сама панель всё равно перенесена — сломался именно звук, а не перенос');
		} finally {
			swapBodyElement = целый;
		}
		скажи(переход().живойЗвукОстался, 'после уборки подлога проверка снова зелёная');
	}
}

console.log();
if (плохо) {
	console.log(`ПРОВАЛОВ: ${плохо}`);
	process.exit(1);
}
console.log('Звук переживает переход: элемент переносится, а не пересоздаётся.');
