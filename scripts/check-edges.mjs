// Замер левого и правого края блоков по собранному CSS.
//
// ЗАЧЕМ. Одинаковость вертикалей глазом не проверяется: у хвоста страницы
// материала оказалось ТРИ разные оси (220, 232, 244), а правый край правой
// колонки на «Поддержать» задавался тремя способами сразу и давал разброс
// в 224 px. В коде это безобидные строчки в разных файлах — увидеть можно
// только замером или глазами на живой странице, и оба раза видел заказчик.
//
// ЧТО ЭТО НЕ. Это не движок браузера. Считается только горизонталь и только
// блочная модель плюс grid-колонки: где начинается и где кончается коробка.
// Высоты, переносы, флекс и авторазмещение в гриде не считаются вовсе —
// у элемента без явного `grid-column` берётся порядковая колонка.
// Ответ вида «этот блок начинается на 220, соседний на 232» верен;
// ответ «текст переносится вот так» этим скриптом не получить.
//
// Запуск: node scripts/check-edges.mjs --образцы 1440   ← ТАК И ГОНЯЮТ В КОНЦЕ СЕССИИ
//         node scripts/check-edges.mjs            — ВСЕ страницы, ключевые ширины
//         node scripts/check-edges.mjs 1440        — одна ширина
//         node scripts/check-edges.mjs --page dist/posts/ep-102/index.html
//         node scripts/check-edges.mjs --targets   — цели нажатия меньше 44
//
// ПОЧЕМУ ГОНЯЮТ ПО ОБРАЗЦАМ, А НЕ ЦЕЛИКОМ. Полный обход — это все 1400 страниц
// на шести ширинах, больше двадцати минут; прогон однажды остановили
// на пятнадцатой минуте. Инструмент, который занимает полчаса, гоняют один раз
// и больше не трогают, — а вертикаль, разъехавшаяся после правки вёрстки,
// находится потом глазами заказчика, как уже бывало трижды (ревизия задачи 15,
// находка 17). Ключ `--образцы` берёт по одной странице КАЖДОГО ВИДА
// и укладывается в полторы секунды: разъезжаются вертикали у вида целиком,
// а не у отдельной страницы, поэтому вторая такая же не добавляет ничего.
// Вид, которого не нашлось, называется вслух — молча пропущенный вид означал
// бы «нарушений нет» там, где просто не смотрели.
//
// САМОПРОВЕРКА ДЕЛАЕТСЯ РУКАМИ, флага для неё нет. Раньше в этой строке был
// обещан `--selftest`, которого в коде не существовало вовсе: скрипт молча
// игнорировал флаг и печатал обычный отчёт — то есть на вопрос «а ты вообще
// умеешь находить?» отвечал «всё хорошо». Убрано 10 августа 2026.
// Как проверить за минуту: дописать в конец `dist/_astro/Layout.*.css` строку
// `.footer.footer{margin-left:77px}`, прогнать — подвал обязан уехать в свою
// группу «левый край 137», — и вернуть файл из копии. Второй подлог,
// `padding-left:77px`, двигает только содержимое: коробка остаётся на 60,
// а рядом появляется пометка «[содержимое 137…]».

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const WIDTHS = [1440, 1280, 1100, 820, 620, 390];

// ── Разбор разметки ─────────────────────────────────────────────────────────

const VOID = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
	'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
// Внутрь этих не заглядываем: их содержимое не участвует в раскладке страницы.
const OPAQUE = new Set(['script', 'style', 'template', 'svg', 'noscript']);

function parseHtml(html) {
	const root = { tag: 'html', classes: [], attrs: {}, children: [], parent: null };
	let node = root;
	const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
	let skipUntil = null;
	let m;
	while ((m = re.exec(html))) {
		const [, closing, rawTag, rawAttrs, selfClose] = m;
		const tag = rawTag.toLowerCase();

		if (skipUntil) {
			if (closing && tag === skipUntil) skipUntil = null;
			continue;
		}
		if (closing) {
			// Закрываем ближайшего одноимённого предка; чужие закрывашки игнорируем.
			let up = node;
			while (up && up.tag !== tag) up = up.parent;
			if (up && up.parent) node = up.parent;
			continue;
		}
		if (OPAQUE.has(tag)) {
			if (!selfClose) skipUntil = tag;
			continue;
		}

		const attrs = {};
		for (const a of rawAttrs.matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
			attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
		}
		const el = {
			tag,
			classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
			attrs,
			children: [],
			parent: node,
		};
		node.children.push(el);
		if (!VOID.has(tag) && !selfClose) node = el;
	}
	return root;
}

// ── Разбор стилей ───────────────────────────────────────────────────────────

/** Условие медиазапроса → подходит ли ширина. Понимает и старый, и новый синтаксис. */
function mediaMatches(query, width) {
	if (!query) return true;
	const q = query.toLowerCase();
	// Печать, наведение, «предпочитает меньше движения» — к ширине не относятся.
	if (/\bprint\b/.test(q)) return false;
	if (/prefers-|hover|pointer|orientation|resolution|forced-colors/.test(q)) return false;
	let ok = true;
	for (const c of q.matchAll(/min-width\s*:\s*([\d.]+)px/g)) ok = ok && width >= parseFloat(c[1]);
	for (const c of q.matchAll(/max-width\s*:\s*([\d.]+)px/g)) ok = ok && width <= parseFloat(c[1]);
	for (const c of q.matchAll(/width\s*>=\s*([\d.]+)px/g)) ok = ok && width >= parseFloat(c[1]);
	for (const c of q.matchAll(/width\s*<=\s*([\d.]+)px/g)) ok = ok && width <= parseFloat(c[1]);
	for (const c of q.matchAll(/width\s*>\s*([\d.]+)px/g)) ok = ok && width > parseFloat(c[1]);
	for (const c of q.matchAll(/width\s*<\s*([\d.]+)px/g)) ok = ok && width < parseFloat(c[1]);
	return ok;
}

function specificity(selector) {
	const s = selector.replace(/::[\w-]+/g, '');
	const ids = s.match(/#[\w-]+/g) ?? [];
	const classes = s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)(?!not\b)[\w-]+/g) ?? [];
	const tags = s.match(/(?:^|[\s>+~])([a-z][\w-]*)/g) ?? [];
	const inside = s.match(/:not\(([^)]*)\)/g) ?? [];
	let extra = [0, 0, 0];
	for (const part of inside) {
		const p = specificity(part.slice(5, -1));
		extra = [extra[0] + p[0], extra[1] + p[1], extra[2] + p[2]];
	}
	return [ids.length + extra[0], classes.length + extra[1], tags.length + extra[2]];
}

/** Правила одного источника, с развёрнутыми медиазапросами (условие остаётся при правиле). */
function parseCss(css, startOrder) {
	const rules = [];
	let order = startOrder;
	// Разворачиваем @media, запоминая условие; прочие @-блоки пропускаем целиком.
	const stack = [];
	let i = 0;
	let media = null;
	while (i < css.length) {
		const open = css.indexOf('{', i);
		if (open === -1) break;
		const head = css.slice(i, open).trim();
		if (head.startsWith('@')) {
			if (/^@media/i.test(head)) {
				stack.push(media);
				media = media ? media + ' and ' + head.slice(6).trim() : head.slice(6).trim();
				i = open + 1;
				continue;
			}
			// @font-face, @supports, @keyframes — пропускаем вместе с телом.
			let depth = 1;
			let j = open + 1;
			while (j < css.length && depth > 0) {
				if (css[j] === '{') depth++;
				else if (css[j] === '}') depth--;
				j++;
			}
			i = j;
			continue;
		}
		// Обычное правило.
		const close = css.indexOf('}', open);
		if (close === -1) break;
		const decls = css.slice(open + 1, close);
		for (const sel of head.split(',')) {
			const selector = sel.trim();
			if (selector) rules.push({ selector, decls, media, order: order++ });
		}
		i = close + 1;
		// Закрылся ли на этом месте медиазапрос — смотрим по лишним `}`.
		while (css[i] === '}' || /\s/.test(css[i] ?? '')) {
			if (css[i] === '}' && stack.length) media = stack.pop();
			i++;
		}
	}
	return rules;
}

/**
 * СЧЁТЧИК ОХВАТА. «Нарушений нет» выглядит одинаково и когда их правда нет,
 * и когда замер не увидел ни одного правила. Имена файлов стилей в проекте
 * уже меняли — поменяются ещё раз, и без этих чисел мы узнаем об этом никогда
 * (ревизия задачи 15, находка 6).
 */
const охват = { страниц: 0, файловСтилей: 0, стилейВСтранице: 0, правил: 0 };
const прочитанныеФайлы = new Set();

/**
 * Файлы стилей, которые не прочитались.
 *
 * ГРОМКО, А НЕ `catch {}`. Прежде непрочитанный файл пропускался молча,
 * и замер спокойно считал края, не видя половины правил страницы, — то есть
 * врал числами, а не молчанием. Пропуск законен ровно в двух случаях, и оба
 * отсеиваются ДО чтения: библиотека поиска и внешний адрес.
 */
const непрочитанные = new Map();

/** Все стили страницы в порядке применения браузером. */
function pageRules(html) {
	const parts = [];
	const re = /<link[^>]+rel="stylesheet"[^>]*>|<style[^>]*>([\s\S]*?)<\/style>/g;
	for (const m of html.matchAll(re)) {
		if (m[1] !== undefined) {
			parts.push(m[1]);
			охват.стилейВСтранице++;
		} else {
			const href = m[0].match(/href="([^"]+)"/)?.[1];
			if (!href || href.includes('pagefind') || /^https?:/.test(href)) continue;
			try {
				parts.push(readFileSync(join(DIST, href.replace(/^\//, '')), 'utf8'));
				прочитанныеФайлы.add(href);
			} catch (ошибка) {
				непрочитанные.set(href, String(ошибка.message).split('\n')[0]);
			}
		}
	}
	let rules = [];
	let order = 0;
	for (const part of parts) {
		const r = parseCss(part, order);
		order += r.length + 1;
		rules = rules.concat(r);
	}
	охват.правил += rules.length;
	return rules;
}

// ── Сопоставление селектора с элементом ─────────────────────────────────────

/** Одно простое звено селектора (без комбинаторов) против элемента. */
function matchesSimple(el, part) {
	if (part === '*' || part === '') return true;
	if (/^:root$/i.test(part)) return el.tag === 'html';
	let rest = part;
	// :not(...) — внутри может быть любой простой селектор.
	for (const n of part.matchAll(/:not\(([^)]*)\)/g)) {
		for (const inner of n[1].split(',')) {
			if (matchesSimple(el, inner.trim())) return false;
		}
	}
	rest = rest.replace(/:not\([^)]*\)/g, '');
	// Псевдоэлементы и состояния к статическому замеру не относятся: считаем,
	// что состояние не наступило, а псевдоэлемент коробку родителя не двигает.
	if (/::/.test(rest)) return false;
	rest = rest.replace(/:(?:hover|focus|focus-visible|focus-within|active|visited|target|disabled|checked|placeholder|placeholder-shown|lang\([^)]*\))/g, '');
	// :first-child / :last-child / :nth-child(...) — учитываем по-настоящему.
	const idx = el.parent ? el.parent.children.indexOf(el) : 0;
	const total = el.parent ? el.parent.children.length : 1;
	let structural = true;
	for (const p of rest.matchAll(/:(first-child|last-child|only-child|nth-child\(([^)]*)\))/g)) {
		if (p[1] === 'first-child') structural = structural && idx === 0;
		else if (p[1] === 'last-child') structural = structural && idx === total - 1;
		else if (p[1] === 'only-child') structural = structural && total === 1;
		else {
			const arg = (p[2] ?? '').trim();
			if (/^\d+$/.test(arg)) structural = structural && idx + 1 === parseInt(arg, 10);
			else if (arg === 'odd') structural = structural && idx % 2 === 0;
			else if (arg === 'even') structural = structural && idx % 2 === 1;
			else {
				const nm = arg.match(/^(\d*)n(?:\s*\+\s*(\d+))?$/);
				if (nm) {
					const a = nm[1] === '' ? 1 : parseInt(nm[1], 10);
					const b = nm[2] ? parseInt(nm[2], 10) : 0;
					structural = structural && a > 0 && (idx + 1 - b) % a === 0 && idx + 1 >= b;
				}
			}
		}
	}
	if (!structural) return false;
	rest = rest.replace(/:(first-child|last-child|only-child|nth-child\([^)]*\))/g, '');

	// Тег.
	const tagM = rest.match(/^([a-zA-Z][\w-]*)/);
	if (tagM && tagM[1].toLowerCase() !== el.tag) return false;
	// Классы.
	for (const c of rest.matchAll(/\.([\w-]+)/g)) {
		if (!el.classes.includes(c[1])) return false;
	}
	// Идентификатор.
	for (const id of rest.matchAll(/#([\w-]+)/g)) {
		if (el.attrs.id !== id[1]) return false;
	}
	// Атрибуты.
	for (const a of rest.matchAll(/\[([\w:-]+)(?:([~^$*|]?=)"?([^\]"]*)"?)?\]/g)) {
		const name = a[1].toLowerCase();
		if (!(name in el.attrs)) return false;
		if (a[2]) {
			const val = el.attrs[name];
			const want = a[3];
			if (a[2] === '=' && val !== want) return false;
			if (a[2] === '~=' && !val.split(/\s+/).includes(want)) return false;
			if (a[2] === '^=' && !val.startsWith(want)) return false;
			if (a[2] === '$=' && !val.endsWith(want)) return false;
			if (a[2] === '*=' && !val.includes(want)) return false;
		}
	}
	return true;
}

function matches(el, selector) {
	if (/[,]/.test(selector)) return selector.split(',').some((s) => matches(el, s.trim()));
	// Селекторы с `+` и `~` считаем не совпавшими: соседство статически
	// разбирать здесь незачем, а ошибиться в сторону «правило есть» опаснее.
	if (/[+~]/.test(selector)) return false;
	const parts = selector.trim().split(/\s*(>)\s*|\s+/).filter(Boolean);
	let node = el;
	let i = parts.length - 1;
	if (!matchesSimple(node, parts[i])) return false;
	i--;
	while (i >= 0) {
		const combinator = parts[i] === '>' ? '>' : ' ';
		if (combinator === '>') i--;
		const part = parts[i];
		if (part === undefined) break;
		if (combinator === '>') {
			node = node.parent;
			if (!node || !matchesSimple(node, part)) return false;
		} else {
			let up = node.parent;
			let found = false;
			while (up) {
				if (matchesSimple(up, part)) { found = true; break; }
				up = up.parent;
			}
			if (!found) return false;
			node = up;
		}
		i--;
	}
	return true;
}

// ── Каскад ──────────────────────────────────────────────────────────────────

const heavier = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);

const LONGHAND = {
	'margin': ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
	'padding': ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
	'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width'],
};

/**
 * Режет значение по пробелам ВЕРХНЕГО УРОВНЯ. `calc(var(--x) * -1)` — это одна
 * часть, а не три: обычный `split(/\s+/)` рвал её внутри скобок.
 *
 * НАСТУПИЛИ 10 августа 2026. `margin-inline: calc(var(--gutter) * -1)`
 * (вынос картинки до краёв экрана) распадался на «calc(var(--gutter)», разбор
 * получал огрызок без закрывающей скобки и уходил в бесконечную рекурсию:
 * скрипт ПАДАЛ целиком на ширинах 620 и 390, то есть треть замера не делалась
 * вовсе. Заметно это только по коду возврата — до падения он успевал напечатать
 * почти весь отчёт, и на глаз прогон выглядел удачным.
 */
function splitParts(value) {
	const out = [];
	let depth = 0;
	let buf = '';
	for (const ch of value.trim()) {
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		if (depth === 0 && /\s/.test(ch)) {
			if (buf) out.push(buf);
			buf = '';
			continue;
		}
		buf += ch;
	}
	if (buf) out.push(buf);
	return out;
}

function expandShorthand(prop, value, out) {
	if (prop === 'margin-inline' || prop === 'padding-inline') {
		const base = prop.split('-')[0];
		const v = splitParts(value);
		out[base + '-left'] = v[0];
		out[base + '-right'] = v[1] ?? v[0];
		return true;
	}
	if (prop === 'inset-inline-start') { out['left-offset'] = value; return true; }
	if (LONGHAND[prop]) {
		const v = splitParts(value);
		const [t, r, b, l] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
		const names = LONGHAND[prop];
		out[names[0]] = t; out[names[1]] = r; out[names[2]] = b; out[names[3]] = l;
		return true;
	}
	if (prop === 'border' || prop === 'border-left' || prop === 'border-right') {
		const w = splitParts(value)[0];
		const px = /^[\d.]+px$/.test(w) ? w : (/none/.test(value) ? '0' : '1px');
		if (prop === 'border') { out['border-left-width'] = px; out['border-right-width'] = px; }
		if (prop === 'border-left') out['border-left-width'] = px;
		if (prop === 'border-right') out['border-right-width'] = px;
		return true;
	}
	if (prop === 'gap' || prop === 'grid-gap') {
		const v = splitParts(value);
		out['column-gap'] = v[1] ?? v[0];
		return true;
	}
	if (prop === 'grid-area') {
		// row-start / column-start / row-end / column-end — колонка это 2-е и 4-е.
		// Запись из двух частей (`grid-area:1/2`) задаёт только начало колонки,
		// и пропустить её нельзя: она молча оставит в силе прежнее правило.
		const v = value.split('/').map((s) => s.trim());
		if (v.length >= 4) out['grid-column'] = v[1] + ' / ' + v[3];
		else if (v.length >= 2) out['grid-column'] = v[1];
		return true;
	}
	return false;
}

const WANTED = new Set([
	'display', 'width', 'max-width', 'min-width', 'box-sizing',
	'margin-left', 'margin-right', 'padding-left', 'padding-right',
	'border-left-width', 'border-right-width',
	'grid-template-columns', 'column-gap', 'grid-column', 'position', 'float',
	// Для оценки цели нажатия (режим --targets).
	'height', 'min-height', 'padding-top', 'padding-bottom',
	'font-size', 'line-height', 'inset', 'top', 'bottom', 'left', 'right',
]);

function declarations(text) {
	const out = {};
	// Значения могут содержать `;` внутри скобок — режем по верхнему уровню.
	let depth = 0, start = 0;
	const chunks = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '(') depth++;
		else if (ch === ')') depth--;
		else if (ch === ';' && depth === 0) { chunks.push(text.slice(start, i)); start = i + 1; }
	}
	chunks.push(text.slice(start));
	for (const chunk of chunks) {
		const c = chunk.indexOf(':');
		if (c === -1) continue;
		const prop = chunk.slice(0, c).trim().toLowerCase();
		const value = chunk.slice(c + 1).replace(/!important/i, '').trim();
		if (!prop) continue;
		if (prop.startsWith('--')) { out[prop] = value; continue; }
		if (expandShorthand(prop, value, out)) continue;
		if (WANTED.has(prop)) out[prop] = value;
	}
	return out;
}

/** Итоговые значения нужных свойств у элемента. */
function computed(el, rules, width) {
	const winners = {};
	for (const rule of rules) {
		if (!mediaMatches(rule.media, width)) continue;
		if (!matches(el, rule.selector)) continue;
		const decls = declarations(rule.decls);
		const spec = specificity(rule.selector);
		const important = /!important/i.test(rule.decls);
		for (const [prop, value] of Object.entries(decls)) {
			const prev = winners[prop];
			if (
				!prev ||
				(important && !prev.important) ||
				(important === prev.important && (heavier(spec, prev.spec) ||
					(!heavier(prev.spec, spec) && rule.order >= prev.order)))
			) {
				winners[prop] = { value, spec, order: rule.order, important };
			}
		}
	}
	const out = {};
	for (const [k, v] of Object.entries(winners)) out[k] = v.value;
	// Стиль в атрибуте перебивает всё, кроме !important.
	if (el.attrs.style) {
		for (const [k, v] of Object.entries(declarations(el.attrs.style))) out[k] = v;
	}
	return out;
}

// ── Переменные и длины ──────────────────────────────────────────────────────

function collectVars(rules, width) {
	const vars = {};
	const scored = {};
	for (const rule of rules) {
		if (!mediaMatches(rule.media, width)) continue;
		if (!/^(:root|html|body|\*)$/i.test(rule.selector.trim())) continue;
		for (const [k, v] of Object.entries(declarations(rule.decls))) {
			if (!k.startsWith('--')) continue;
			if (!(k in scored) || rule.order >= scored[k]) { vars[k] = v; scored[k] = rule.order; }
		}
	}
	return vars;
}

function resolveVars(value, vars, depth = 0) {
	if (depth > 10 || !value.includes('var(')) return value;
	const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (_, name, fallback) =>
		vars[name] ?? fallback ?? '',
	);
	return resolveVars(out, vars, depth + 1);
}

/**
 * Длина в пикселях. `basis` — ширина, от которой считаются проценты.
 * Понимает px, %, rem, em (приблизительно 16), vw, calc, min, max, clamp.
 */
function length(value, basis, vars, fontSize = 16) {
	if (value == null) return null;
	let v = resolveVars(String(value).trim(), vars);
	if (v === '' || v === 'auto' || v === 'none' || v === 'inherit') return v === 'auto' ? 'auto' : null;
	if (v === '0') return 0;

	// Страховка от огрызка выражения. Незакрытая скобка («calc(18px») заставляет
	// разбор пересобирать сама себя и уводит в бесконечную рекурсию — скрипт
	// падает целиком, а не пропускает одно место. Уж лучше честное «не знаю».
	let depth = 0;
	const evalExpr = (expr) => {
		if (++depth > 40) return null;
		// min()/max()/clamp() — считаем каждый аргумент и берём нужный.
		expr = expr.trim();
		const fn = expr.match(/^(min|max|clamp)\((.*)\)$/is);
		if (fn) {
			const args = splitTop(fn[2]).map((a) => evalExpr(a));
			if (args.some((a) => a === null)) return null;
			if (fn[1].toLowerCase() === 'min') return Math.min(...args);
			if (fn[1].toLowerCase() === 'max') return Math.max(...args);
			return Math.min(Math.max(args[0], args[1]), args[2]);
		}
		const calc = expr.match(/^calc\((.*)\)$/is);
		if (calc) return evalExpr(calc[1]);
		// Простая арифметика слева направо с учётом скобок.
		return arithmetic(expr);
	};

	const splitTop = (s) => {
		const out = []; let depth = 0, start = 0;
		for (let i = 0; i < s.length; i++) {
			if (s[i] === '(') depth++;
			else if (s[i] === ')') depth--;
			else if (s[i] === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
		}
		out.push(s.slice(start));
		return out;
	};

	const unit = (token) => {
		const t = token.trim();
		if (/^[-\d.]+px$/.test(t)) return parseFloat(t);
		if (/^[-\d.]+%$/.test(t)) return basis === null ? null : (parseFloat(t) / 100) * basis;
		if (/^[-\d.]+r?em$/.test(t)) return parseFloat(t) * (t.includes('rem') ? 16 : fontSize);
		if (/^[-\d.]+vw$/.test(t)) return (parseFloat(t) / 100) * CURRENT_VIEWPORT;
		if (/^[-\d.]+vh$/.test(t)) return (parseFloat(t) / 100) * 900;
		if (/^[-\d.]+$/.test(t)) return parseFloat(t);
		if (/^[-\d.]+fr$/.test(t)) return null;
		return null;
	};

	const arithmetic = (expr) => {
		const tokens = expr.match(/\(|\)|[+\-*/]|[^\s()+*/]+(?:%|px|r?em|vw|vh|fr)?|\S/g);
		if (!tokens) return null;
		let pos = 0;
		const parseExpr = () => {
			let left = parseTerm();
			while (left !== null && pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
				const op = tokens[pos++];
				const right = parseTerm();
				if (right === null) return null;
				left = op === '+' ? left + right : left - right;
			}
			return left;
		};
		const parseTerm = () => {
			let left = parseFactor();
			while (left !== null && pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
				const op = tokens[pos++];
				const right = parseFactor();
				if (right === null) return null;
				left = op === '*' ? left * right : left / right;
			}
			return left;
		};
		const parseFactor = () => {
			if (tokens[pos] === '(') { pos++; const v = parseExpr(); if (tokens[pos] === ')') pos++; return v; }
			if (tokens[pos] === '-') { pos++; const v = parseFactor(); return v === null ? null : -v; }
			const t = tokens[pos];
			if (t === undefined) return null;
			// Вложенные min/max/clamp/calc внутри арифметики.
			if (/^(min|max|clamp|calc)$/i.test(t) && tokens[pos + 1] === '(') {
				let depth = 0, j = pos + 1, buf = '';
				for (; j < tokens.length; j++) {
					if (tokens[j] === '(') depth++;
					if (tokens[j] === ')') { depth--; if (depth === 0) { buf += ')'; break; } }
					buf += tokens[j];
				}
				const inner = t + buf.slice(t.length === 0 ? 0 : 0);
				pos = j + 1;
				return evalExpr(t + buf);
			}
			pos++;
			return unit(t);
		};
		const value = parseExpr();
		return pos >= tokens.length ? value : value;
	};

	const result = evalExpr(v);
	return result === null || Number.isNaN(result) ? null : result;
}

let CURRENT_VIEWPORT = 1440;

// ── Раскладка по горизонтали ────────────────────────────────────────────────

/** Колонки грида в пикселях. Понимает repeat(), fr, px, %, minmax(). */
function gridColumns(value, contentWidth, gap, vars) {
	let v = resolveVars(value, vars).trim();
	if (!v || v === 'none') return null;
	// Разворачиваем repeat(N, …). Заполняющие сетки считаем по фактической ширине.
	v = v.replace(/repeat\(\s*(\d+)\s*,\s*([^()]*(?:\([^()]*\)[^()]*)*)\)/gi, (_, n, tpl) =>
		Array(parseInt(n, 10)).fill(tpl.trim()).join(' '),
	);
	if (/repeat\(\s*auto-(fill|fit)/i.test(v)) {
		const min = v.match(/minmax\(\s*([^,]+),/);
		const minPx = min ? length(min[1], contentWidth, vars) : null;
		if (!minPx) return null;
		const n = Math.max(1, Math.floor((contentWidth + gap) / (minPx + gap)));
		v = Array(n).fill('1fr').join(' ');
	}
	// Режем на дорожки по верхнему уровню скобок.
	const tracks = [];
	let depth = 0, start = 0;
	for (let i = 0; i < v.length; i++) {
		if (v[i] === '(') depth++;
		else if (v[i] === ')') depth--;
		else if (/\s/.test(v[i]) && depth === 0) {
			const t = v.slice(start, i).trim();
			if (t) tracks.push(t);
			start = i + 1;
		}
	}
	const last = v.slice(start).trim();
	if (last) tracks.push(last);
	if (tracks.length === 0) return null;

	const free = contentWidth - gap * (tracks.length - 1);
	let frTotal = 0;
	// Дорожка по содержимому (`auto`, `min-content`, `fit-content`) без движка
	// не считается вовсе: её ширину задаёт текст. Такие сетки помечаем
	// неточными — врать числом хуже, чем сказать «здесь не знаю».
	let exact = true;
	const fixed = tracks.map((t) => {
		let track = t;
		const mm = t.match(/^minmax\(([^,]+),(.+)\)$/i);
		if (mm) track = mm[2].trim();
		if (/fr$/.test(track)) { frTotal += parseFloat(track) || 1; return null; }
		if (/^(auto|min-content|max-content|fit-content.*)$/i.test(track)) { exact = false; return null; }
		const px = length(track, contentWidth, vars);
		if (px === 'auto' || px === null) { exact = false; return null; }
		return px;
	});
	const usedFixed = fixed.reduce((a, b) => a + (b ?? 0), 0);
	const perFr = frTotal > 0 ? Math.max(0, free - usedFixed) / frTotal : 0;
	const sizes = tracks.map((t, i) => {
		if (fixed[i] !== null) return fixed[i];
		let track = t;
		const mm = t.match(/^minmax\(([^,]+),(.+)\)$/i);
		if (mm) track = mm[2].trim();
		const fr = /fr$/.test(track) ? (parseFloat(track) || 1) : 1;
		return perFr * fr;
	});
	sizes.exact = exact;
	return sizes;
}

/**
 * Считает край каждого элемента дерева. Возвращает список записей.
 * `left`/`right` — края коробки, `contentLeft`/`contentRight` — края содержимого.
 */
function layout(root, rules, vars, viewport) {
	const out = [];

	function walkNode(el, box, gridInfo) {
		const style = computed(el, rules, viewport);
		const resolve = (prop, basis = box.contentWidth) => length(style[prop], basis, vars);

		const display = (resolve('display') === null ? style.display : style.display) ?? '';
		const isNone = /(^|\s)none(\s|$)/.test(resolveVars(display, vars));
		if (isNone) return; // спрятанное не меряем

		const ml = resolve('margin-left');
		const mr = resolve('margin-right');
		const pl = resolve('padding-left') ?? 0;
		const pr = resolve('padding-right') ?? 0;
		const bl = resolve('border-left-width') ?? 0;
		const br = resolve('border-right-width') ?? 0;

		let left = box.contentLeft;
		let width;

		let exact = box.exact !== false;
		// Почему число неточное — говорит сам замер, а не читатель отчёта:
		// причин уже несколько, и они разные.
		let why = null;

		// ВЫНУТОЕ ИЗ ПОТОКА БЛОЧНОЙ МОДЕЛЬЮ НЕ СЧИТАЕТСЯ ВОВСЕ. У закреплённого
		// или абсолютного блока ширину задаёт содержимое вместе с `left`/`right`,
		// а не колонка родителя, — и скрипт молча выдавал ему ширину родителя.
		// Так были посчитаны кнопка «наверх» (90 px по тексту против «во всю
		// оболочку» в отчёте) и ссылка «Перейти к содержимому». Число тут
		// остаётся для порядка, но помечено: верить ему нельзя.
		const positioned = /^(fixed|absolute)$/i.test(resolveVars(style.position ?? '', vars).trim());
		if (positioned) {
			exact = false;
			why = 'вынут из потока — ширину задают содержимое и left/right';
		}
		if (gridInfo) {
			// Ребёнок грида: колонка по `grid-column` либо по порядку.
			const { tracks, gap, startLeft } = gridInfo;
			if (tracks.exact === false) { exact = false; why = 'дорожка грида по содержимому'; }
			let colStart = gridInfo.auto;
			let span = 1;
			const gc = style['grid-column'];
			if (gc) {
				const g = resolveVars(gc, vars).trim();
				const parts = g.split('/').map((s) => s.trim());
				const startRaw = parts[0];
				const endRaw = parts[1];
				if (/^\d+$/.test(startRaw)) colStart = parseInt(startRaw, 10) - 1;
				if (endRaw) {
					const spanM = endRaw.match(/^span\s+(\d+)$/i);
					if (spanM) span = parseInt(spanM[1], 10);
					else if (/^\d+$/.test(endRaw)) span = parseInt(endRaw, 10) - 1 - colStart;
					else if (/^-1$/.test(endRaw)) span = tracks.length - colStart;
				} else {
					const spanM = startRaw.match(/^span\s+(\d+)$/i);
					if (spanM) { span = parseInt(spanM[1], 10); colStart = gridInfo.auto; }
				}
			}
			// Явно названа колонка — считаем точно; авторазмещение считать
			// нечем: браузер раскладывает по заполненности рядов, а рядов
			// мы не знаем. Такие места помечаем неточными.
			if (!gc || /auto/.test(resolveVars(gc, vars))) { exact = false; why = why ?? 'авторазмещение в гриде'; }
			colStart = Math.max(0, Math.min(colStart, tracks.length - 1));
			span = Math.max(1, Math.min(span, tracks.length - colStart));
			gridInfo.auto = colStart + span;
			let x = startLeft;
			for (let i = 0; i < colStart; i++) x += tracks[i] + gap;
			let w = 0;
			for (let i = colStart; i < colStart + span; i++) w += tracks[i] + (i > colStart ? gap : 0);
			left = x + (ml === 'auto' || ml === null ? 0 : ml);
			width = w - (ml === 'auto' || ml === null ? 0 : ml) - (mr === 'auto' || mr === null ? 0 : mr);
		} else {
			// ПЛАВАЮЩИЙ БЛОК СТОИТ НЕ ТАМ, ГДЕ СЧИТАЕТ ОБЫЧНАЯ БЛОЧНАЯ МОДЕЛЬ.
			// Он вынут из потока, боковые `auto` у него обращаются в ноль,
			// и прижимается он к своему краю контейнера. Без этой ветки маркировка
			// рекламы (единственный float на сайте, `.ad-mark`) выдавалась
			// посередине колонки — 597…843 при настоящих 1094…1340: число
			// правдоподобное и потому опасное. Правдоподобное число хуже пропуска.
			//
			// ТОЧНЫМ ЕГО ВСЁ РАВНО НЕ СЧИТАЕМ: два плавающих блока подряд встают
			// друг рядом с другом или переносятся по высоте, а высот этот скрипт
			// не знает вовсе. Для одного блока ответ верный, для двух — уже нет,
			// и говорить об этом обязан он сам, а не следующий читатель отчёта.
			const floatSide = resolveVars(style.float ?? '', vars).trim();
			const floating = floatSide === 'left' || floatSide === 'right';
			const available = box.contentWidth;
			const declaredWidth = resolve('width');
			let w = declaredWidth === 'auto' || declaredWidth === null
				? available - (ml === 'auto' ? 0 : ml ?? 0) - (mr === 'auto' ? 0 : mr ?? 0)
				: declaredWidth;
			const maxW = resolve('max-width');
			if (typeof maxW === 'number') w = Math.min(w, maxW);
			const minW = resolve('min-width');
			if (typeof minW === 'number') w = Math.max(w, minW);
			// ШИРЕ РОДИТЕЛЯ — ЗАКОННОЕ СОСТОЯНИЕ, И ОБРЕЗАТЬ ЕГО НЕЛЬЗЯ.
			// Здесь стояло `Math.min(w, available)`, и оно молча приводило
			// к ширине колонки ВСЁ, что нарочно выходит за её края: медиа
			// до краёв экрана на телефоне (отрицательные поля), картинку
			// «во всю ширину», галерею. То есть настоящий вынос и сломанный —
			// когда коробка осталась шириной с колонку и просто уехала влево —
			// выглядели у замера ОДИНАКОВО. Ровно эта поломка и жила у видео
			// в тексте: замер её показать не мог, увидел заказчик глазами.
			w = Math.max(0, w);
			if (floating) {
				exact = false;
				why = 'плавающий блок — считается один, два встали бы иначе';
				left = floatSide === 'right'
					? box.contentLeft + available - w - (mr === 'auto' ? 0 : mr ?? 0)
					: box.contentLeft + (ml === 'auto' ? 0 : ml ?? 0);
			} else if (ml === 'auto' && mr === 'auto') left = box.contentLeft + (available - w) / 2;
			else if (ml === 'auto') left = box.contentLeft + available - w;
			else left = box.contentLeft + (ml ?? 0);
			width = w;
		}

		// box-sizing на сайте border-box (проверено в собранном CSS).
		const contentLeft = left + bl + pl;
		const contentWidth = Math.max(0, width - bl - pl - pr - br);

		const record = {
			el,
			left: round(left),
			right: round(left + width),
			contentLeft: round(contentLeft),
			contentRight: round(contentLeft + contentWidth),
			width: round(width),
			style,
			exact,
			why,
		};
		out.push(record);

		const displayResolved = resolveVars(display, vars);
		// Дети flex-контейнера встают по содержимому и по `justify-content` —
		// блочной моделью это не считается, и числа для них были бы выдумкой.
		const childBox = {
			contentLeft,
			contentWidth,
			exact: exact && !/flex|inline-flex/.test(displayResolved),
			why: /flex|inline-flex/.test(displayResolved) ? 'ребёнок flex — ширину задаёт содержимое' : why,
		};
		if (/grid/.test(displayResolved)) {
			const gap = resolve('column-gap') ?? 0;
			const tracks = gridColumns(style['grid-template-columns'] ?? '', contentWidth, gap, vars);
			if (tracks) {
				const info = { tracks, gap, startLeft: contentLeft, auto: 0 };
				for (const child of el.children) walkNode(child, childBox, info);
				return;
			}
		}
		for (const child of el.children) walkNode(child, childBox, null);
	}

	const body = findBody(root);
	if (!body) return out;
	walkNode(body, { contentLeft: 0, contentWidth: viewport, exact: true }, null);
	return out;
}

const round = (n) => Math.round(n * 10) / 10;

function findBody(root) {
	const stack = [root];
	while (stack.length) {
		const n = stack.shift();
		if (n.tag === 'body') return n;
		stack.push(...n.children);
	}
	return null;
}

// ── Отчёт ───────────────────────────────────────────────────────────────────

const name = (el) => (el.classes.length ? el.tag + '.' + el.classes.join('.') : el.tag);

/** Блоки, чей край стоит показать: у них есть собственная геометрия. */
function interesting(rec) {
	const s = rec.style;
	if (rec.el.tag === 'body' || rec.el.tag === 'html') return false;
	// Заголовки, абзацы и мелочь внутри — не структура.
	if (['p', 'span', 'a', 'li', 'em', 'strong', 'b', 'i', 'time', 'br', 'img', 'button', 'input', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(rec.el.tag)) return false;
	return Boolean(
		s['max-width'] || s['grid-column'] || s['padding-left'] || s['margin-left'] ||
		s['width'] || s['grid-template-columns'],
	);
}

function report(page, width, { onlyMismatch = true } = {}) {
	CURRENT_VIEWPORT = width;
	const html = readFileSync(page, 'utf8');
	const rules = pageRules(html);
	const vars = collectVars(rules, width);
	const root = parseHtml(html);
	const recs = layout(root, rules, vars, width);
	return { recs, vars };
}

// ── Цели нажатия (режим --targets) ──────────────────────────────────────────

const INTERACTIVE = new Set(['a', 'button', 'select', 'input', 'summary', 'textarea']);

/**
 * СПИСОК ПОДОЗРЕНИЙ, А НЕ ПРИГОВОР. Высота считается по явным `height`
 * и `min-height`, а где их нет — по отступам и строке текста; ширина у строчных
 * элементов зависит от самого текста и здесь не считается вовсе. Главное:
 * цель бывает больше видимой коробки — её добирает прозрачный псевдоэлемент
 * (`::after{position:absolute;inset:…}`), и такие места помечаются отдельно.
 */
function targets(page, width) {
	CURRENT_VIEWPORT = width;
	const html = readFileSync(page, 'utf8');
	const rules = pageRules(html);
	const vars = collectVars(rules, width);
	const root = parseHtml(html);
	const body = findBody(root);
	const found = [];
	if (!body) return found;

	// Правила псевдоэлементов, растягивающих зону нажатия.
	// Сборщик пишет псевдоэлемент ОДНИМ двоеточием (`:after`), а не двумя:
	// поиск по `::after` не находит ничего и отвечает «накладок нет».
	const overlays = rules.filter(
		(r) =>
			mediaMatches(r.media, width) &&
			/::?(after|before)\b/.test(r.selector) &&
			/position\s*:\s*absolute/.test(r.decls) &&
			/(?:^|;)\s*(inset|top|bottom|left|right)\s*:/.test(r.decls),
	);

	/**
	 * Накладка у элемента или его предка. Возвращает, на сколько она расширяет
	 * зону: `inset:-4px` даёт по 4 px с каждой стороны, `inset:0` — растяжение
	 * на всю коробку предка (сколько это в пикселях, здесь не считается).
	 */
	function overlayOf(el) {
		for (const r of overlays) {
			const base = r.selector.replace(/::?(after|before)\b.*$/, '').trim();
			if (!base) continue;
			let node = el;
			let own = true;
			while (node) {
				if (matches(node, base)) {
					// `inset:0` сборщик пишет без единицы — требовать «px» нельзя.
					const inset = r.decls.match(/(?:^|;)\s*inset\s*:\s*(-?[\d.]+)(?:px)?\s*(?:;|$)/);
					const grow = inset ? -parseFloat(inset[1]) : 0;
					return { own, grow: grow > 0 ? grow : 0, stretched: Boolean(inset) && parseFloat(inset[1]) >= 0 };
				}
				node = node.parent;
				own = false;
			}
		}
		return null;
	}

	/** Обёртка вокруг контрола, которая сама держит 44 px. */
	function wrapperHeight(el) {
		let node = el.parent;
		let depth = 0;
		while (node && depth < 3) {
			const s = computed(node, rules, width);
			const mh = length(s['min-height'], 0, vars) ?? length(s.height, 0, vars);
			if (typeof mh === 'number' && mh >= 44) return mh;
			node = node.parent;
			depth++;
		}
		return null;
	}

	function walkNode(el, inherited) {
		const style = computed(el, rules, width);
		const fs = length(style['font-size'], inherited.fontSize, vars, inherited.fontSize);
		const fontSize = typeof fs === 'number' ? fs : inherited.fontSize;
		let lineHeight = inherited.lineHeight;
		if (style['line-height']) {
			const raw = resolveVars(style['line-height'], vars).trim();
			lineHeight = /^[\d.]+$/.test(raw)
				? parseFloat(raw) * fontSize
				: (length(raw, fontSize, vars, fontSize) ?? inherited.lineHeight);
		}
		const next = { fontSize, lineHeight: lineHeight || fontSize * 1.4 };

		const display = resolveVars(style.display ?? '', vars);
		if (!/none/.test(display) && (INTERACTIVE.has(el.tag) || el.attrs.role === 'button')) {
			const pt = length(style['padding-top'], 0, vars, fontSize) ?? 0;
			const pb = length(style['padding-bottom'], 0, vars, fontSize) ?? 0;
			const explicit =
				length(style['min-height'], 0, vars, fontSize) ??
				length(style.height, 0, vars, fontSize);
			const byText = (pt || 0) + (pb || 0) + next.lineHeight;
			const box = typeof explicit === 'number' ? Math.max(explicit, byText) : byText;
			const ov = overlayOf(el);
			const wrap = wrapperHeight(el);
			// Итоговая зона: коробка плюс вынос накладки; растянутая накладка
			// или обёртка на 44 закрывают вопрос целиком.
			const target = box + (ov?.grow ?? 0) * 2;
			const covered = target >= 44 || (wrap !== null) || Boolean(ov?.stretched && wrap !== null);
			if (!covered) {
				found.push({
					el,
					height: round(box),
					target: round(target),
					how: typeof explicit === 'number' ? 'задана' : 'по тексту и отступам',
					note: ov?.stretched
						? 'растянута накладкой на родителя — размер решает родитель'
						: ov?.grow
							? `накладка добирает по ${ov.grow} px`
							: '',
				});
			}
		}
		for (const child of el.children) walkNode(child, next);
	}

	walkNode(body, { fontSize: 16, lineHeight: 16 * 1.5 });
	return found;
}

// ── Запуск ──────────────────────────────────────────────────────────────────

function walk(dir) {
	return readdirSync(dir).flatMap((n) => {
		const p = join(dir, n);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
}

/**
 * ПО ОДНОЙ СТРАНИЦЕ КАЖДОГО ВИДА — ключ `--образцы`.
 *
 * ЗАЧЕМ. Полный обход — это ВСЕ собранные страницы на шести ширинах:
 * 1400 × 6 ≈ 8400 разборов, больше двадцати минут. Инструмент, который
 * занимает полчаса, гоняют один раз и больше не трогают, — а `CLAUDE.md`
 * предписывает гонять его в конце каждой сессии наравне с двумя другими
 * (ревизия задачи 15, находка 17). Выборка, сделанная руками в той сессии,
 * заняла двадцать секунд и ответила на тот же вопрос.
 *
 * ВИДЫ, А НЕ СЛУЧАЙНЫЕ СТРАНИЦЫ. Разъезжаются вертикали не у отдельной
 * страницы, а у ВИДА: у всех статей разом, у всех выпусков разом. Значит
 * одна страница каждого вида отвечает за весь вид, а вторая такая же
 * не добавляет ничего.
 *
 * ОБРАЗЕЦ ВЫБИРАЕТСЯ ИЗ СОБРАННОЙ ПАПКИ, А НЕ ВПИСАН ИМЕНЕМ. Вписанное
 * именем протухает от первой же работы заказчика: пост переименуют или
 * снесут, и замер начнёт молча пропускать целый вид. Поэтому каждому виду
 * задан ПРИЗНАК, а страница берётся первая подходящая — и если вид не нашёлся,
 * об этом говорится вслух, а не пропускается молча.
 */
const ВИДЫ = [
	['главная', (p) => p === join(DIST, 'index.html')],
	['архив', (p) => p === join(DIST, 'archive', 'index.html')],
	['каталог тайтлов', (p) => p === join(DIST, 'anime', 'index.html')],
	['поиск', (p) => p === join(DIST, 'search', 'index.html')],
	['404', (p) => p === join(DIST, '404.html')],
	['поддержать', (p) => p === join(DIST, 'support', 'index.html')],
	['о проекте', (p) => p === join(DIST, 'about', 'index.html')],
	['раздел ленты', (p) => /dist\/category\/[^/]+\/index\.html$/.test(p.replaceAll('\\', '/'))],
	['соглашение', (p) => p === join(DIST, 'legal', 'index.html')],
	['страница тайтла', (p) => p.replaceAll('\\', '/').includes('/anime/') && p.endsWith('index.html') && !p.endsWith(join('anime', 'index.html'))],
	['выпуск', (p) => /dist\/posts\/ep-\d+\/index\.html$/.test(p.replaceAll('\\', '/'))],
	['статья', (p) => p.replaceAll('\\', '/').includes('/posts/') && !/\/posts\/ep-\d+\//.test(p.replaceAll('\\', '/')) && p.endsWith('index.html')],
];

const argv = process.argv.slice(2);
const pageArg = argv.includes('--page') ? argv[argv.indexOf('--page') + 1] : null;
const widthArg = argv.find((a) => /^\d+$/.test(a));
const widths = widthArg ? [parseInt(widthArg, 10)] : WIDTHS;
const verbose = argv.includes('--all');

const все = () => walk(DIST).filter((f) => f.endsWith('.html') && !f.includes('pagefind') && !f.includes('admin')).sort();

function образцы() {
	const весь = все();
	const взято = [];
	const ненайдено = [];
	for (const [вид, признак] of ВИДЫ) {
		const первая = весь.find(признак);
		if (первая) взято.push({ вид, page: первая });
		else ненайдено.push(вид);
	}
	console.log(`ОБРАЗЦЫ: по одной странице каждого вида — ${взято.length} из ${ВИДЫ.length} (всего страниц в сборке ${весь.length}).`);
	for (const { вид, page } of взято) console.log(`   ${вид.padEnd(18)} ${page.replace(DIST + '/', '')}`);
	// МОЛЧА ПРОПУСТИТЬ ВИД НЕЛЬЗЯ: «нарушений нет» тогда значило бы «этот вид
	// не смотрели», и отличить одно от другого было бы нечем.
	if (ненайдено.length) console.log(`   ВИДОВ НЕ НАШЛОСЬ: ${ненайдено.join(', ')} — их этот прогон НЕ проверял.`);
	console.log();
	return взято.map((х) => х.page);
}

const pages = pageArg ? [pageArg] : argv.includes('--образцы') ? образцы() : все();

if (argv.includes('--targets')) {
	const byKind = new Map();
	for (const page of pages) {
		охват.страниц++;
		for (const width of widths) {
			for (const t of targets(page, width)) {
				const key = `${name(t.el)}\t${t.target}\t${t.note}\t${t.how}\t${width}`;
				if (!byKind.has(key)) byKind.set(key, []);
				byKind.get(key).push(page);
			}
		}
	}
	console.log('ЦЕЛИ НАЖАТИЯ НИЖЕ 44 px — СПИСОК ПОДОЗРЕНИЙ');
	console.log('Высота по CSS; «накладка» значит, что зону добирает псевдоэлемент.\n');
	const rows = [...byKind.entries()].sort((a, b) => parseFloat(a[0].split('\t')[1]) - parseFloat(b[0].split('\t')[1]));
	for (const [key, list] of rows) {
		const [nm, h, note, how, w] = key.split('\t');
		const uniq = [...new Set(list)];
		const where = uniq.slice(0, 3).map((p) => p.replace('dist/', '').replace('/index.html', ''));
		console.log(
			`  ${h} px  ${nm}   (${how}, ширина окна ${w})${note ? '   ← ' + note : ''}` +
				`\n        ${where.join(', ')}${uniq.length > 3 ? ` и ещё ${uniq.length - 3}` : ''}`,
		);
	}
	process.exit(сказатьОхват() ? 1 : 0);
}

for (const page of pages) {
	охват.страниц++;
	for (const width of widths) {
		const { recs } = report(page, width);
		const rows = recs.filter(verbose ? () => true : interesting);
		if (rows.length === 0) continue;
		console.log(`\n=== ${page}   ширина ${width} ===`);
		// Группируем по левому краю КОРОБКИ — так разъезд вертикалей виден сразу.
		// Именно коробки, а не содержимого: рамка в 1 px и внутренний отступ
		// строки сдвигают содержимое, но вертикаль блока держат, и группировка
		// по содержимому выдавала бы их за расхождение.
		const byLeft = new Map();
		for (const r of rows) {
			const key = r.left;
			if (!byLeft.has(key)) byLeft.set(key, []);
			byLeft.get(key).push(r);
		}
		for (const [left, list] of [...byLeft.entries()].sort((a, b) => a[0] - b[0])) {
			console.log(`  левый край ${left}:`);
			const seen = new Set();
			for (const r of list) {
				const key = name(r.el) + r.left + r.right;
				if (seen.has(key)) continue; // одинаковые строки списка не повторяем
				seen.add(key);
				const inner = r.contentLeft !== r.left || r.contentRight !== r.right
					? `  [содержимое ${r.contentLeft}…${r.contentRight}]` : '';
				const mark = r.exact ? '' : `   ≈ (${r.why ?? 'блочной моделью не считается'} — точно не считается)`;
				console.log(`      ${name(r.el)}   ${r.left}…${r.right}  (ширина ${round(r.right - r.left)})${inner}${mark}`);
			}
		}
	}
}

// ── ЧТО ИМЕННО РАЗОБРАНО ───────────────────────────────────────────────────
// Число, которое вдруг стало нулём, видно сразу. Без этой строчки «расхождений
// не видно» у сломанного замера и у здорового выглядит одинаково.
//
// ЗОВЁТСЯ ИЗ ОБОИХ РЕЖИМОВ. Режим `--targets` выходит из скрипта раньше конца
// файла, и отчёт, стоявший просто в хвосте, до него не доезжал: половина
// работы скрипта осталась бы без счётчика охвата — ровно та беда, ради которой
// счётчик и заводили.
function сказатьОхват() {
	охват.файловСтилей = прочитанныеФайлы.size;
	console.log(
		`\nРазобрано: страниц ${охват.страниц}, файлов стилей ${охват.файловСтилей}, ` +
			`стилей внутри страниц ${охват.стилейВСтранице}, правил ${охват.правил}.`,
	);

	let ослепла = false;

	// НЕПРОЧИТАННЫЙ ФАЙЛ — ГРОМКАЯ ОШИБКА. Замер, не увидевший половины правил,
	// не молчит, а СЧИТАЕТ КРАЯ НЕПРАВИЛЬНО, и числа выглядят как измерение.
	if (непрочитанные.size > 0) {
		console.log(`НЕ ПРОЧИТАЛОСЬ ФАЙЛОВ СТИЛЕЙ: ${непрочитанные.size}. Края посчитаны не по всем правилам:`);
		for (const [href, почему] of непрочитанные) console.log(`  ${href} — ${почему}`);
		ослепла = true;
	}

	// ПОЛ ОХВАТА. Ноль — это не «чисто», это «не смотрели».
	for (const [что, сколько] of [['страниц', охват.страниц], ['файлов стилей', охват.файловСтилей], ['правил', охват.правил]]) {
		if (сколько === 0) {
			console.log(`ЗАМЕР ОСЛЕП: ${что} разобрано 0 — это не «расхождений нет», это «не смотрели».`);
			ослепла = true;
		}
	}

	return ослепла;
}

if (сказатьОхват()) process.exitCode = 1;
