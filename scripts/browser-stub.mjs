// ПОДДЕЛКА БРАУЗЕРА ДЛЯ СЛУЖЕБНЫХ СТРАНИЦ — ОДНА НА ВСЕ ПРОВЕРКИ.
//
// Правило проекта «всё, что живёт в браузере, проверяет заказчик руками»
// осталось в силе для ВИДА. А порядок событий, состояние кнопок и разбор
// ответов GitHub проверяются здесь: скрипт страницы вынимается из её
// `index.html` КАК ЕСТЬ, у него подменяется единственный адрес
// (`/admin/tools/github.js` → файл с диска), и он исполняется в Node поверх
// шестидесяти строк подделки. Проверяется настоящий код, а не его пересказ.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. Проверок стало две — экран кандидатов
// (`candidates-screen.test.mjs`) и страница роботов (`tools-screen.test.mjs`).
// Вторая копия подделки разъехалась бы с первой правкой, и разошедшимся
// оказался бы не вид, а ответ на вопрос «а так ли ведёт себя браузер».
//
// ВРЕМЯ ИДЁТ В ДЕСЯТЬ РАЗ БЫСТРЕЕ (`SPEED`): пауза перед записью 1200 мс
// становится 120, ожидание похода 5000 — 500. Проверяется ПОРЯДОК событий,
// а он от одинакового ускорения всех задержек не меняется.

import { readFile } from 'node:fs/promises';

export const SPEED = 10;
export const realSetTimeout = globalThis.setTimeout;
export const sleep = (ms) => new Promise((done) => realSetTimeout(done, Math.max(0, Math.round(ms / SPEED))));

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

export function makeEl(tag) {
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

/**
 * Подделка документа. Элемент заводится по первому спросу — разметку страницы
 * мы не разбираем вовсе: нас интересует поведение скрипта, а не то,
 * что вокруг него написано. Кем родился элемент (кнопкой или блоком),
 * решает список имён: `disabled` у блока браузер бы проигнорировал.
 */
export function makeDocument(buttonIds = []) {
	const buttons = new Set(buttonIds);
	const byId = new Map();
	return {
		byId,
		getElementById(id) {
			if (!byId.has(id)) byId.set(id, makeEl(buttons.has(id) ? 'button' : 'div'));
			return byId.get(id);
		},
		createElement: (tag) => makeEl(tag),
	};
}

/** Нажать кнопку так, как это делает браузер: событием, а не вызовом функции. */
export function press(node) {
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

/**
 * Вынуть скрипт страницы из её `index.html` и исполнить его поверх подделок.
 *
 * Скрипт берётся КАК ЕСТЬ: перепиши мы его рядом своими словами — копия
 * разошлась бы с первой же правкой страницы, и проверка проверяла бы себя.
 * Отсюда же обе преграды ниже: не нашли скрипт или не нашли в нём импорта —
 * значит проверка смотрит не туда, и молчать об этом нельзя.
 */
export async function loadPageScript({ pageUrl, githubJsUrl, fetch, buttonIds = [], patch }) {
	const html = await readFile(pageUrl, 'utf8');
	const found = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
	if (!found) throw new Error('в index.html нет скрипта страницы — проверка смотрит не туда');

	let source = found[1];
	if (!source.includes("from '/admin/tools/github.js'")) {
		throw new Error('скрипт страницы больше не берёт github.js — проверка смотрит не туда');
	}
	source = source.replace("'/admin/tools/github.js'", JSON.stringify(githubJsUrl.href));
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
	globalThis.document = makeDocument(buttonIds);
	globalThis.fetch = fetch;
	globalThis.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, Math.max(0, Math.round((ms ?? 0) / SPEED)), ...rest);
	globalThis.clearTimeout = globalThis.clearTimeout ?? (() => {});

	// Каждый прогон — свой модуль: у страницы есть состояние, и второй сеанс
	// поверх первого проверял бы не то. Отсюда метка в адресе.
	const url = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
	await import(`${url}#${globalThis.__screenRun ?? 0}-${source.length}`);
	globalThis.__screenRun = (globalThis.__screenRun ?? 0) + 1;

	return globalThis.document;
}
