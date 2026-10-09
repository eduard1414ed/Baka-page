import { readFileSync } from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { OG_DEFAULT_WIDTH as W, OG_DEFAULT_HEIGHT as H, OG_BACKGROUND } from '../lib/ogImage.mjs';

/**
 * Превью страницы результата теста, 1200×630 (ТЗ-тесты §5, сессия «Тесты-5б»).
 *
 * ЕДИНСТВЕННОЕ ПРЕВЬЮ САЙТА С ТЕКСТОМ. Остальные повторяют форму обложки
 * (og-images-integration.mjs); это рисуется заново, и форму ему задаём мы.
 *
 * Компоновка — макет тз/макеты-тесты.html, экран 7, вариант B, с решениями
 * заказчика 9 октября 2026 (Тесты-5б):
 * - шапка вдвое ниже макета: полоса 64, логотип 126, подпись `[ ТЕСТ ]` 18;
 * - широкая картинка (шире своей высоты — то же правило, что в блоке
 *   результата, TestResult.astro) во всю высоту, но не шире двух третей
 *   места; самому длинному слову уступает, но не уже трети;
 * - без картинки текст по центру по высоте, заголовок 128;
 * - заголовок уменьшается по 4 px до 64; не влез и так — многоточие
 *   и предупреждение в журнал сборки (сборка не падает).
 *
 * КАК РИСУЕТСЯ. satori раскладывает блоки и превращает текст в контуры,
 * resvg делает из этого картинку, sharp — jpeg. Переносы строк считаем
 * сами по ширинам слов, которые меряет тот же satori: так слово с дефисом
 * («VHS-полка») не рвётся, а слово шире колонки видно заранее.
 *
 * ШРИФТЫ — полные статичные TTF в src/assets/og-fonts/ (на сайт не идут),
 * а не урезанные woff2 сайта: в тех может не оказаться букв из заголовка,
 * и satori переменных шрифтов не читает. Literata 36pt — название теста
 * (44 px; ближайший готовый размер к 44), 72pt — заголовок (64–128 px, тот
 * же, что выбирает браузер). Версия 3.103, как у шрифта сайта.
 *
 * ОДНИ ДАННЫЕ — ОДИН ФАЙЛ БАЙТ В БАЙТ (проверено двумя прогонами): иначе
 * зеркало перезаливало бы превью при каждой выкладке (задача 22).
 * Системные шрифты resvg не загружает нарочно: текст уже контуры, а обход
 * шрифтов мака стоил 1,4 с на картинку.
 */

const FONT_DIR = new URL('../assets/og-fonts/', import.meta.url);
const font = (file) => readFileSync(new URL(file, FONT_DIR));
const FONTS = [
	{ name: 'Literata36', data: font('Literata36pt-Regular.ttf'), weight: 400, style: 'normal' },
	{ name: 'Literata72', data: font('Literata72pt-Regular.ttf'), weight: 400, style: 'normal' },
	{ name: 'Plex', data: font('IBMPlexMono-Regular.ttf'), weight: 400, style: 'normal' },
];
const LOGO = readFileSync(new URL('../assets/images/logo-ink.png', import.meta.url));
// Пропорция — из заголовка самого PNG (ширина и высота лежат в байтах 16–23),
// а не числом: заменят логотип — превью не растянет его.
const LOGO_RATIO = LOGO.readUInt32BE(20) / LOGO.readUInt32BE(16);

// Цвета — токены tokens.css числом: satori про CSS-переменные не знает.
// Меняете `--ink`, `--text`, `--line`, `--accent-text` — поправьте и здесь.
const INK = '#151515';
const TEXT = '#3f3b36';
const LINE = '#cbc6bc';
const ACCENT_TEXT = '#a64e65';

const PAD = 56; // поля слева, справа и снизу
const HEAD = 64; // полоса шапки (в макете 128 — решение заказчика: вдвое ниже)
const LOGO_W = 126;
const LABEL_SIZE = 18;
const TOP = 40; // от линии шапки до картинки и текста
const GAP = 48; // между картинкой и текстом
const CONTENT_W = W - 2 * PAD; // 1088
const AREA_H = H - HEAD - TOP - PAD; // 470
const NAME = { font: 'Literata36', size: 44, lh: 1.15, ls: -0.01, color: TEXT };
const TITLE = { font: 'Literata72', lh: 1, ls: -0.02, color: INK };
const NAME_GAP = 28;
const TITLE_MAX = 104;
const TITLE_MAX_NO_IMAGE = 128;
const TITLE_MIN = 64;
const TITLE_STEP = 4;
const ELLIPSIS = '…';

const box = (style, children) => ({ type: 'div', props: { style: { display: 'flex', boxSizing: 'border-box', ...style }, children } });
const dataUri = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
const lineHeight = (st, size) => Math.round(size * st.lh);

/** Ширины строк одним вызовом satori: блок без ограничения ширины = ширина текста. */
async function measure(texts, st, size) {
	const uniq = [...new Set(texts)];
	const widths = new Map();
	const height = 8 + uniq.length * 2;
	await satori(
		box(
			{ width: 8000, height, flexDirection: 'column', alignItems: 'flex-start' },
			uniq.map((t) => box({ fontFamily: st.font, fontSize: size, letterSpacing: `${st.ls}em`, whiteSpace: 'pre', flexShrink: 0, height: 2 }, t)),
		),
		{ width: 8000, height, fonts: FONTS, onNodeDetected: (n) => n.textContent != null && widths.set(n.textContent, n.width) },
	);
	return widths;
}

const words = (text) => text.split(/\s+/).filter(Boolean);
const pieces = (word) => word.split(/(?<=-)/); // «VHS-полка» → «VHS-», «полка»

/**
 * Жадный перенос по словам. Слово с дефисом — одно слово; рвётся по дефису,
 * только если целиком шире колонки. Слово шире колонки и по кускам — null:
 * при этом кегле не влезает.
 */
async function wrap(text, st, size, width) {
	const ws = words(text);
	const wd = await measure([...ws, ...ws.flatMap(pieces), 'а а', 'а'], st, size);
	const space = wd.get('а а') - 2 * wd.get('а');
	const units = []; // { t, w, glue } — glue: следующий кусок встаёт без пробела
	for (const w of ws) {
		if (wd.get(w) <= width) units.push({ t: w, w: wd.get(w), glue: false });
		else if (pieces(w).length > 1 && pieces(w).every((p) => wd.get(p) <= width))
			pieces(w).forEach((p, i, all) => units.push({ t: p, w: wd.get(p), glue: i < all.length - 1 }));
		else return null;
	}
	const lines = [];
	let line = null;
	units.forEach((u, i) => {
		const join = i > 0 && !units[i - 1].glue ? space : 0;
		if (line && line.w + join + u.w <= width) {
			line.t += (join ? ' ' : '') + u.t;
			line.w += join + u.w;
		} else {
			if (line) lines.push(line.t);
			line = { t: u.t, w: u.w };
		}
	});
	if (line) lines.push(line.t);
	return lines;
}

/** Самая длинная из строк `candidates`, что влезает в ширину. */
async function longestFitting(candidates, st, size, width) {
	const wd = await measure(candidates, st, size);
	return [...candidates].reverse().find((c) => wd.get(c) <= width) ?? candidates[0];
}

/**
 * Не влезло и при 64 px: оставляем столько строк, сколько помещается,
 * и последнюю кончаем многоточием. Слово шире колонки режется по буквам.
 */
async function ellipsize(title, size, width, rooms) {
	const ws = words(title);
	const kept = [];
	for (const w of ws) {
		const wide = (await measure([w], TITLE, size)).get(w) > width;
		if (!wide) {
			kept.push(w);
			continue;
		}
		const prefixes = [...w].map((_, i) => w.slice(0, i + 1) + ELLIPSIS);
		kept.push(await longestFitting(prefixes, TITLE, size, width));
		break;
	}
	let lines = (await wrap(kept.join(' '), TITLE, size, width)) ?? [kept.join(' ')];
	if (lines.length <= rooms && kept.length === ws.length) return lines;
	lines = lines.slice(0, rooms);
	let last = lines[rooms - 1];
	if (!last.endsWith(ELLIPSIS)) {
		// Последняя строка: убираем слова с конца, пока «…» не влезет.
		// Висячее слово в одну-две буквы («а…», «по…») перед ним не оставляем.
		const lw = words(last);
		const tries = lw
			.map((_, i) => lw.slice(0, i + 1))
			.filter((ws, i) => i === 0 || ws.at(-1).replace(/[^\p{L}\p{N}]/gu, '').length > 2)
			.map((ws) => ws.join(' ').replace(/[\s,.;:!?—–-]+$/, '') + ELLIPSIS);
		last = await longestFitting(tries, TITLE, size, width);
	}
	lines[rooms - 1] = last;
	return lines;
}

const textBlock = (lines, st, size, extra = {}) =>
	box(
		{ flexDirection: 'column', flexShrink: 0, ...extra },
		lines.map((l) =>
			box({ fontFamily: st.font, fontSize: size, lineHeight: st.lh, letterSpacing: `${st.ls}em`, color: st.color, whiteSpace: 'pre', height: lineHeight(st, size) }, l),
		),
	);

/**
 * @param {{ test: string, title: string, image: Buffer | null }} data
 *   test — название теста, title — заголовок результата, image — файл картинки.
 * @returns {Promise<{ jpg: Buffer, size: number, cut: boolean }>}
 *   size — кегль заголовка; cut — заголовок не влез и обрезан многоточием.
 */
export async function renderTestResultCard({ test, title, image }) {
	let pic = null;
	let colW = CONTENT_W;
	if (image) {
		const { width, height } = await sharp(image).metadata();
		const ratio = width / height;
		let picH = AREA_H;
		let picW = Math.round(ratio * picH);
		if (ratio > 1) {
			const place = CONTENT_W - GAP;
			const longest = async (text, st, size) => Math.max(...(await measure(words(text), st, size)).values());
			const need = Math.ceil(Math.max(await longest(title, TITLE, TITLE_MIN), await longest(test, NAME, NAME.size)));
			const maxW = Math.max(Math.floor(place / 3), Math.min(Math.floor((place * 2) / 3), place - need));
			if (picW > maxW) {
				picW = maxW;
				picH = Math.round(picW / ratio);
			}
		}
		const png = await sharp(image)
			.resize({ width: picW * 2, height: picH * 2, fit: 'fill' })
			.flatten({ background: OG_BACKGROUND })
			.png()
			.toBuffer();
		pic = { type: 'img', props: { src: dataUri(png), width: picW, height: picH, style: { flexShrink: 0 } } };
		colW = CONTENT_W - picW - GAP;
	}

	const nameLines = (await wrap(test, NAME, NAME.size, colW)) ?? [test];
	const nameH = nameLines.length * lineHeight(NAME, NAME.size);
	const fits = (lines, size) => lines && nameH + NAME_GAP + lines.length * lineHeight(TITLE, size) <= AREA_H;

	let size = image ? TITLE_MAX : TITLE_MAX_NO_IMAGE;
	let lines = await wrap(title, TITLE, size, colW);
	while (!fits(lines, size) && size > TITLE_MIN) {
		size -= TITLE_STEP;
		lines = await wrap(title, TITLE, size, colW);
	}
	const cut = !fits(lines, size);
	if (cut) {
		const rooms = Math.max(1, Math.floor((AREA_H - nameH - NAME_GAP) / lineHeight(TITLE, size)));
		lines = await ellipsize(title, size, colW, rooms);
	}

	const col = box({ flexDirection: 'column', width: colW, height: AREA_H, justifyContent: image ? 'flex-start' : 'center' }, [
		textBlock(nameLines, NAME, NAME.size),
		textBlock(lines, TITLE, size, { marginTop: NAME_GAP }),
	]);
	const tree = box({ width: W, height: H, flexDirection: 'column', background: OG_BACKGROUND, paddingLeft: PAD, paddingRight: PAD, paddingBottom: PAD }, [
		box({ height: HEAD, flexShrink: 0, alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${LINE}` }, [
			{ type: 'img', props: { src: dataUri(LOGO), width: LOGO_W, height: Math.round(LOGO_RATIO * LOGO_W) } },
			box({ fontFamily: 'Plex', fontSize: LABEL_SIZE, letterSpacing: '0.08em', color: ACCENT_TEXT }, '[ ТЕСТ ]'),
		]),
		box({ gap: GAP, paddingTop: TOP, alignItems: 'flex-start' }, pic ? [pic, col] : [col]),
	]);

	const svg = await satori(tree, { width: W, height: H, fonts: FONTS });
	const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
	return { jpg: await sharp(png).jpeg({ quality: 86 }).toBuffer(), size, cut };
}
