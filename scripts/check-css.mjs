// Пять проверок раздела 8.4 ТЗ по СОБРАННОМУ CSS.
//
// ЗАЧЕМ ФАЙЛОМ, А НЕ КАЖДЫЙ РАЗ ЗАНОВО. Эти пять проверок гоняются в конце
// каждой сессии части 8, и до сих пор писались с нуля каждый раз. Дважды они
// соврали, и оба раза в сторону «всё хорошо» или «всё плохо»:
//
//   — считали нарушениями 27 `!important` и 44 «цвета мимо палитры»,
//     лежащие в `dist/pagefind/*` (готовая библиотека поиска) и в правилах
//     `::view-transition-*`, которые вставляет сам Astro. Ни одного нашего;
//   — объявляли нарушением `#d88f9f1a` — это `--accent-soft` из палитры,
//     сжатый сборщиком из записи `rgba()`. Цвета надо сравнивать по значению,
//     а не по написанию.
//
// Проверка с ложными срабатываниями перестаёт что-либо проверять через две
// сессии, поэтому оба лечения зашиты сюда, и переписывать их больше не надо.
//
// ЧИТАЕМ И ФАЙЛЫ, И СТИЛИ ВНУТРИ СТРАНИЦ. Astro часть правил кладёт файлом
// в `_astro/`, часть вставляет прямо в `<head>`. Скрипт, читающий только файлы,
// отвечает «такого правила нет» про правило, которое есть.
//
// Запуск: node scripts/check-css.mjs   (после `npm run build`)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

// ЧУЖОЙ КОД. `pagefind/` — готовая библиотека поиска, её стилями сайт
// не пользуется вовсе. Правила переходов вставляет сам Astro.
const isOurs = (path) => !path.includes('pagefind');
const NOT_OURS_RULE = /::view-transition|\[data-astro-transition/;

/** Куски CSS из сборки: файлы `_astro/*.css` плюс `<style>` внутри страниц. */
function cssSources() {
	const sources = [];
	for (const file of walk(DIST).filter(isOurs)) {
		if (file.endsWith('.css')) {
			sources.push([file, readFileSync(file, 'utf8')]);
		} else if (file.endsWith('.html')) {
			const html = readFileSync(file, 'utf8');
			for (const style of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
				sources.push([file + ' (стиль внутри страницы)', style[1]]);
			}
		}
	}
	return sources;
}

/**
 * Правила собранного CSS: {где, селектор, объявления[]}.
 *
 * ПРАВИЛА НЕ СКЛЕИВАЮТСЯ. Медиазапрос как обёртка снимается, но каждое правило
 * внутри остаётся отдельным — иначе `.x{display:none}` в базе и `.x{display:grid}`
 * в медиазапросе сливаются в одно, и проверка объявляет нарушением обычное
 * «на узком экране прячем, на широком показываем». Ровно так она и соврала
 * при первом прогоне на `.tr-labels` в транскрипте.
 */
function rules() {
	const out = [];
	for (const [where, css] of cssSources()) {
		const flat = css.replace(/@media[^{]*\{/g, '').replace(/@supports[^{]*\{/g, '');
		for (const rule of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const selector = rule[1].trim();
			if (selector.startsWith('@') || NOT_OURS_RULE.test(selector)) continue;
			out.push({
				where,
				selector,
				decls: rule[2]
					.split(';')
					.map((d) => d.trim())
					.filter(Boolean),
			});
		}
	}
	return out;
}

const allRules = rules();
/** Плоский список объявлений — для проверок, которым правило целиком не нужно. */
const decls = allRules.flatMap((r) => r.decls.map((decl) => ({ where: r.where, selector: r.selector, decl })));
const report = [];

/** @param {string} title @param {{where:string,selector:string,decl:string}[]} hits */
function check(title, hits) {
	report.push([title, hits]);
}

// 1. Размеры шрифта меньше 11 px. Технический слой — ровно 11, ниже не бывает.
//    Считаем только явные px: токены проверять незачем, они в палитре.
check(
	'Размеры шрифта меньше 11 px',
	decls.filter((d) => {
		const m = d.decl.match(/^font-size\s*:\s*([\d.]+)px$/);
		return m && Number(m[1]) < 11;
	}),
);

// 2. Пометки принудительного приоритета. Запрещены §8.4: вес лечится
//    формой селектора, а не силой.
check(
	'Пометки принудительного приоритета',
	decls.filter((d) => /!\s*important/.test(d.decl)),
);

// 3. Видимость и раскладка в ОДНОМ правиле. Правило, которое и прячет,
//    и раскладывает, невозможно перебить атрибутом `hidden`: сняв видимость,
//    снимешь заодно и раскладку. Смотрим внутрь одного блока `{…}`, а не
//    по всем правилам с таким селектором — см. комментарий у `rules()`.
const LAYOUT = /^(grid-template|grid-column|grid-row|grid-auto|flex-direction|flex-wrap|gap|column-gap|row-gap|place-items|align-items|justify-content)\s*:/;
check(
	'Видимость и раскладка в одном правиле',
	allRules
		.filter(
			(r) =>
				r.decls.some((d) => /^display\s*:\s*none$/.test(d)) && r.decls.some((d) => LAYOUT.test(d)),
		)
		.map((r) => ({ where: r.where, selector: r.selector, decl: r.decls.join('; ') })),
);

// 4. Сетка схлопывающая вместо заполняющей. При недоборе элементов
//    схлопывающая растягивает оставшиеся во всю ширину.
check(
	'Сетка схлопывающая вместо заполняющей',
	decls.filter((d) => /auto-fit/.test(d.decl)),
);

// 5. Цвета мимо палитры. СРАВНИВАЕМ ПО ЗНАЧЕНИЮ, А НЕ ПО ЗАПИСИ: сборщик
//    сжимает `rgba(216,143,159,.1)` из палитры в `#d88f9f1a`, и посимвольное
//    сравнение объявило бы законный токен нарушением.
const tokensCss = readFileSync('src/styles/tokens.css', 'utf8');

/** Любая запись цвета → «r,g,b,a». Что не разобрали, возвращаем как есть. */
function colorValue(raw) {
	const text = raw.trim().toLowerCase();
	const hex = text.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		let h = hex[1];
		if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
		const n = (i) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
		const a = h.length === 8 ? n(3) / 255 : 1;
		return `${n(0)},${n(1)},${n(2)},${a.toFixed(3)}`;
	}
	const fn = text.match(/^rgba?\(([^)]*)\)$/);
	if (fn) {
		const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
		const a = parts[3] === undefined ? 1 : Number(parts[3]);
		return `${Number(parts[0])},${Number(parts[1])},${Number(parts[2])},${a.toFixed(3)}`;
	}
	return text;
}

const palette = new Set();
for (const m of tokensCss.matchAll(/:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)) {
	palette.add(colorValue(m[1]));
}

// ПРОЗРАЧНОСТЬ — НЕ ЦВЕТ, а его отсутствие, и палитре она не принадлежит.
// `border-color: transparent` сборщик сжимает в `#0000`, и проверка объявляла
// нарушением снятую рамку — то есть ровно то, чего в палитре и не должно быть.
// Ложное срабатывание найдено 10 августа 2026 на кнопках галереи; проверка,
// дающая ложные срабатывания, перестаёт что-либо проверять через две сессии.
palette.add(colorValue('#0000'));

// В комментариях писать шестнадцатеричные цвета нельзя — этот же поиск
// принял бы объяснение за нарушение. Поэтому комментарии вырезаются.
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
check(
	'Цвета мимо палитры',
	decls.flatMap((d) => {
		if (/^--/.test(d.decl)) return []; // объявление самого токена
		const clean = d.decl.replace(/\/\*[\s\S]*?\*\//g, '');
		return [...clean.matchAll(COLOR)]
			.filter((m) => !palette.has(colorValue(m[0])))
			.map((m) => ({ ...d, decl: `${d.decl}   ← ${m[0]}` }));
	}),
);

let bad = 0;
for (const [title, hits] of report) {
	if (hits.length === 0) {
		console.log(`пусто     — ${title}`);
		continue;
	}
	bad += hits.length;
	console.log(`${String(hits.length).padStart(2)} строк(и) — ${title}:`);
	for (const h of [...new Set(hits.map((x) => `      ${x.selector} { ${x.decl} }   [${x.where}]`))]) {
		console.log(h);
	}
}
if (bad > 0) process.exitCode = 1;
