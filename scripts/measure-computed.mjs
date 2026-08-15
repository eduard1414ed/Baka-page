// ЧТО В ИТОГЕ ДОСТАЁТСЯ ЭЛЕМЕНТУ — по СОБРАННОМУ CSS, а не по исходникам.
//
// Зачем. Сводя две копии описания в одну, нельзя верить глазам: правило
// переезжает между файлами, у него меняется вес (Astro дописывает к правилам
// компонента метку `[data-astro-cid-…]`), меняется порядок — и победить может
// не тот. Приём уже сработал при сведении вкладок ленты и архива: считались
// свойства, которые В ИТОГЕ достаются элементу, до и после правки.
//
//   node scripts/measure-computed.mjs <страница> <селектор-образец> [ширина]
//
// Пример:
//   node scripts/measure-computed.mjs dist/about/index.html ".support-links a"
//
// ЧЕГО ЭТО НЕ УМЕЕТ — СПИСКОМ, А НЕ ОДНОЙ ОГОВОРКОЙ. Измеритель обязан
// говорить «не знаю», а не выдавать правдоподобное число:
//
//   • НАСЛЕДОВАНИЕ ОТ РОДИТЕЛЕЙ НЕ СЧИТАЕТСЯ. Спрашивается ровно то, что
//     назначено самому элементу.
//   • ДОЧЕРНИЙ И СОСЕДНИЙ КОМБИНАТОРЫ (`>`, `+`, `~`) НЕ РАЗБИРАЮТСЯ.
//     Правило `.btn-large > span` до элемента `span.ext-arrow` тут не доедет,
//     хотя в браузере доедет. Такие места проверяются глазами по собранному
//     CSS, а не этим замером.
//   • СОСТОЯНИЯ (`:hover`, `:focus-visible`) и псевдоэлементы В НАБОР НЕ ИДУТ:
//     это отдельные «места», и мешать их с базовым видом нельзя.
//
// Для вопроса «не разъехались ли две копии ОДНОГО описания» этого довольно —
// но только пока ответ читают, помня список выше.
import fs from 'node:fs';
import path from 'node:path';

/** Все куски CSS страницы: и файлы по ссылкам, и вставленное прямо в разметку. */
export function styleSourcesOf(pageFile) {
	const html = fs.readFileSync(pageFile, 'utf8');
	const dist = pageFile.slice(0, pageFile.indexOf(`${path.sep}dist${path.sep}`) + 6) || 'dist';
	const out = [];

	for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) {
		const href = m[1];
		if (/^https?:/.test(href)) continue;
		const file = path.join(dist, href.replace(/^\//, ''));
		if (!fs.existsSync(file)) throw new Error(`файл стилей не прочитался: ${file}`);
		out.push({ from: href, css: fs.readFileSync(file, 'utf8') });
	}
	for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
		out.push({ from: 'внутри страницы', css: m[1] });
	}
	return out;
}

/** Вес селектора: [id, класс/атрибут/псевдокласс, элемент/псевдоэлемент]. */
function weight(sel) {
	const clean = sel.replace(/::[a-z-]+/g, ' ').replace(/:not\(([^)]*)\)/g, ' $1 ');
	const ids = (clean.match(/#[\w-]+/g) || []).length;
	const classes = (clean.match(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+(\([^)]*\))?/g) || []).length;
	const tags = (clean.replace(/\.[\w-]+|\[[^\]]+\]|#[\w-]+|:[a-z-]+(\([^)]*\))?/g, '').match(/\b[a-z]+\b/g) || []).length;
	return [ids, classes, tags];
}

const heavier = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Свойства, достающиеся элементу, у которого есть перечисленные классы и тег.
 *
 * Селектор образца пишется просто: «.support-links a», «.btn-large».
 * Совпадение считается ГРУБО — по последнему звену селектора: нам нужен
 * не браузер, а сравнение двух состояний одного и того же места.
 */
export function computedFor(sources, sample, { width = null } = {}) {
	const parts = sample.trim().split(/\s+/);
	const last = parts[parts.length - 1];
	const классы = (last.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
	const тег = last.replace(/\.[\w-]+|:[a-z-]+(\([^)]*\))?/g, '') || null;
	const предки = parts.slice(0, -1).flatMap((p) => (p.match(/\.[\w-]+/g) || []).map((c) => c.slice(1)));

	const winners = new Map(); // свойство → { value, weight, order, sel, from }
	let order = 0;

	for (const { from, css } of sources) {
		const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
		// Проходим правила вместе с их медиазапросом. Сборщик пишет
		// современный синтаксис (`width>=821px`), а не только `min-width`.
		const scan = (text, media) => {
			for (const m of text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
				const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
				const decls = m[2];
				for (const sel of selectors) {
					const tail = sel.split(/\s+/).pop();
					// псевдоэлементы и состояния считаем отдельными «местами»
					if (/::/.test(tail)) continue;
					const selКлассы = (tail.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
					const selТег = tail.replace(/\.[\w-]+|\[[^\]]+\]|:[a-z-]+(\([^)]*\))?/g, '') || null;
					// ПРАВИЛО ПОДХОДИТ, ЕСЛИ ЕГО КЛАССЫ — ПОДМНОЖЕСТВО КЛАССОВ ЭЛЕМЕНТА,
					// а не наоборот. Обратное условие стояло тут первой редакцией
					// и молча выбрасывало все правила без классов — `a { … }`,
					// `:root { … }`, сброс, — то есть измеритель отвечал тем меньше,
					// чем точнее его спрашивали. Заметно это только сравнением двух
					// замеров с разными образцами, а поодиночке число выглядит
					// правдоподобным (правило проекта: правдоподобное число хуже пропуска).
					if (selКлассы.some((c) => !классы.includes(c))) continue;
					if (selТег && тег && selТег !== тег) continue;
					if (selТег && !тег) continue;
					const selПредки = (sel.split(/\s+/).slice(0, -1).join(' ').match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
					if (!selПредки.every((c) => предки.includes(c) || классы.includes(c))) continue;
					// состояния (:hover) в базовый набор не идут
					if (/:(hover|focus|active|visited|focus-visible|disabled)/.test(tail)) continue;

					const w = weight(sel);
					for (const d of decls.split(';')) {
						const at = d.indexOf(':');
						if (at === -1) continue;
						const prop = d.slice(0, at).trim();
						const value = d.slice(at + 1).trim();
						if (!prop) continue;
						const prev = winners.get(prop);
						const now = { value, w, order, sel, from, media };
						if (!prev || heavier(w, prev.w) >= 0) winners.set(prop, now);
					}
					order++;
				}
			}
		};

		// Правила вне медиазапросов
		scan(clean.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''), null);
		// И правила внутри тех медиазапросов, что подходят по ширине
		if (width !== null) {
			for (const m of clean.matchAll(/@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
				const cond = m[1];
				if (!mediaMatches(cond, width)) continue;
				scan(m[2], cond.trim());
			}
		}
	}

	return winners;
}

function mediaMatches(cond, width) {
	let ok = true;
	for (const m of cond.matchAll(/\(\s*min-width\s*:\s*(\d+)px\s*\)|\(\s*width\s*>=\s*(\d+)px\s*\)/g))
		ok = ok && width >= Number(m[1] ?? m[2]);
	for (const m of cond.matchAll(/\(\s*max-width\s*:\s*(\d+)px\s*\)|\(\s*width\s*<=\s*(\d+)px\s*\)/g))
		ok = ok && width <= Number(m[1] ?? m[2]);
	return ok;
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('measure-computed.mjs')) {
	const [page, sample, widthArg] = process.argv.slice(2);
	if (!page || !sample) {
		console.error('Нужны страница и селектор: node scripts/measure-computed.mjs dist/about/index.html ".support-links a" [ширина]');
		process.exit(1);
	}
	const width = widthArg ? Number(widthArg) : null;
	const sources = styleSourcesOf(page);
	console.log(`страница: ${page}`);
	console.log(`кусков стилей прочитано: ${sources.length} (${sources.map((s) => s.from).join(', ')})`);
	console.log(`образец: ${sample}${width ? `, ширина ${width}` : ', без медиазапросов'}`);
	const winners = computedFor(sources, sample, { width });
	console.log(`свойств назначено: ${winners.size}\n`);
	for (const [prop, info] of [...winners].sort((a, b) => a[0].localeCompare(b[0]))) {
		console.log(`  ${prop}: ${info.value}`);
	}
}
