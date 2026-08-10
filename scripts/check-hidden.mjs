// Проверка: правда ли скрыто то, что помечено атрибутом `hidden`.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ ПРОВЕРКА. Атрибут `hidden` весит один селектор, а правило
// компонента в Astro всегда длиннее (`.foo[data-astro-cid-…]`), поэтому любой
// `display` из компонента его перебивает. Разметка при этом правильная, атрибут
// на месте, ошибок нигде нет — а элемент виден на странице. Эти грабли в проекте
// сработали трижды: сетки режимов фильтра на главной, плашка «не удалось
// загрузить аудио» поверх играющего плеера и строка «показаны все упоминания
// тайтла», висевшая всегда. Каждый раз это находил заказчик глазами.
//
// Лечится `:not([hidden])` в самом правиле раскладки — и вот это проверяется
// здесь, разбором собранного CSS, а не чтением исходников.
//
// РАВНЫЙ ВЕС ТОЖЕ ПЕРЕБИВАЕТ. Правило из одного класса весит ровно столько же,
// сколько `[hidden]`, и тогда решает порядок: побеждает то, что стоит ПОЗЖЕ.
// Такие правила пишет `global.css` (в сборке `:global(.x)` становится голым
// `.x`), а сам сброс `[hidden]{display:none}` стоит в его начале — то есть
// любое более позднее `.x{display:grid}` его перебьёт. До 10 августа 2026
// проверка сравнивала вес СТРОГО больше и этот случай пропускала молча.
// Порядок здесь считается по-настоящему: стили каждой страницы склеиваются
// так, как их применит браузер, — `<link>` и `<style>` по ходу разметки.
//
// Запуск: node scripts/check-hidden.mjs   (после `npm run build`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

/** Вес селектора: (id, класс/атрибут/псевдокласс, тег). Псевдоэлементы не считаем. */
function specificity(selector) {
	const ids = selector.match(/#[\w-]+/g) ?? [];
	const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)(?!not\b)[\w-]+/g) ?? [];
	const tags = selector.match(/(?:^|[\s>+~])([a-z][\w-]*)/g) ?? [];
	// Содержимое :not() тоже считается — там внутри обычный селектор.
	const inside = selector.match(/:not\(([^)]*)\)/g) ?? [];
	let extra = [0, 0, 0];
	for (const part of inside) {
		const s = specificity(part.slice(5, -1));
		extra = [extra[0] + s[0], extra[1] + s[1], extra[2] + s[2]];
	}
	return [ids.length + extra[0], classes.length + extra[1], tags.length + extra[2]];
}

const heavier = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/**
 * Все правила собранного CSS: [селектор, объявления]. Медиазапросы разворачиваем.
 *
 * ЧИТАЕМ И ФАЙЛЫ, И СТИЛИ ВНУТРИ СТРАНИЦ. Astro часть правил кладёт файлом
 * в `_astro/`, часть вставляет прямо в `<head>` страницы. Скрипт, читающий
 * только файлы, отвечает «такого правила нет» про правило, которое есть, —
 * то есть врёт в сторону «всё хорошо». Библиотеку поиска пропускаем: её
 * стилями сайт не пользуется вовсе.
 */
function cssRules(html) {
	const rules = [];
	const sources = [];
	// Порядок ровно тот, в каком браузер применит стили этой страницы.
	for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>|<style[^>]*>([\s\S]*?)<\/style>/g)) {
		if (m[1] !== undefined) {
			sources.push(m[1]);
			continue;
		}
		const href = m[0].match(/href="([^"]+)"/)?.[1];
		if (!href || href.includes('pagefind') || /^https?:/.test(href)) continue;
		try {
			sources.push(readFileSync(join(DIST, href.replace(/^\//, '')), 'utf8'));
		} catch { /* нет такого файла — пропускаем */ }
	}
	let order = 0;
	for (const source of sources) {
		const css = source.replace(/@media[^{]*\{/g, '');
		for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const selectors = match[1].trim();
			if (selectors.startsWith('@')) continue;
			for (const selector of selectors.split(',')) rules.push([selector.trim(), match[2], order]);
			order++;
		}
	}
	return rules;
}

// Насколько весит `[hidden]{display:none}` из global.css — с этим и сравниваем.
const HIDDEN_WEIGHT = [0, 1, 0];
const sameWeight = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const problems = [];

for (const page of walk(DIST).filter((f) => f.endsWith('.html') && !f.includes('pagefind'))) {
	const html = readFileSync(page, 'utf8');
	const rules = cssRules(html).filter(([, decls]) => /(?:^|;)\s*display\s*:/.test(decls));

	// Где на этой странице стоит сам сброс — с ним и сравниваем порядок.
	const reset = rules.find(
		([selector, decls]) => /^\[hidden\]$/.test(selector) && /display\s*:\s*none/.test(decls),
	);

	// Открывающие теги с атрибутом `hidden` (не `data-hidden`, не внутри значения).
	for (const tag of html.matchAll(/<(\w+)((?:\s+[^\s=>]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
		const attrs = tag[2];
		if (!/(?:^|\s)hidden(?:=|\s|$)/.test(attrs)) continue;

		const classAttr = attrs.match(/\sclass="([^"]*)"/)?.[1] ?? '';
		const classes = classAttr.split(/\s+/).filter(Boolean);
		if (classes.length === 0) continue;

		for (const [selector, decls, order] of rules) {
			// Правило про этот элемент, только если его последняя часть —
			// один из классов элемента и в ней нет ничего, кроме классов.
			const last = selector.split(/[\s>+~]+/).pop() ?? '';
			if (!/^(?:\.[\w-]+|\[[^\]]+\]|:not\([^)]*\))+$/.test(last)) continue;
			const used = last.match(/\.[\w-]+/g) ?? [];
			if (used.length === 0 || !used.every((c) => classes.includes(c.slice(1)))) continue;
			// Само правило уже учло `hidden` — значит и задумано так.
			if (/:not\(\[hidden\]\)/.test(last)) continue;
			// Правило само прячет — не беда.
			if (/(?:^|;)\s*display\s*:\s*none/.test(decls)) continue;

			const weight = specificity(selector);
			const byWeight = heavier(weight, HIDDEN_WEIGHT);
			// Равный вес решается порядком: позже — значит сильнее.
			const byOrder = Boolean(reset) && sameWeight(weight, HIDDEN_WEIGHT) && order > reset[2];
			if (byWeight || byOrder) {
				problems.push(
					`${page}: <${tag[1]} class="${classAttr}" hidden> перебивается правилом ${selector}` +
						` (${byWeight ? 'по весу' : 'равный вес, стоит позже сброса'})`,
				);
			}
		}
	}
}

const unique = [...new Set(problems)];
if (unique.length === 0) {
	console.log('Скрытое действительно скрыто: правил, перебивающих hidden, нет.');
} else {
	console.log(`Найдено ${unique.length} мест, где hidden не сработает:`);
	for (const line of unique) console.log('  ' + line);
	process.exitCode = 1;
}
