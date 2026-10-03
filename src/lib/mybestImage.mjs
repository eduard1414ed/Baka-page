// КАРТИНКА «МОИ ДЕВЯТЬ АНИМЕ» — 9:16 и 16:9 (задача 22, часть 2).
// ТЗ: тз/тз-22-moi-devyat-anime.md, «Картинка»; числа: тз/спецификация-22-вид.md.
//
// ЧИСЛА СПЕЦИФИКАЦИИ СТОЯТ ЗДЕСЬ КАК ЕСТЬ — для холста 900×1600 и 1600×900.
// Файл выходит в 1.2 раза крупнее (1080×1920 и 1920×1080: ширина 1080 —
// стандарт сторис, меньше соцсеть растянет сама и подписи поплывут). Множитель —
// ОДНО число `SCALE`, и применяется он ОДИН раз: преобразованием холста перед
// рисованием. Дальше всё рисуется в единицах спецификации. Умножай мы руками
// у каждого поля и кегля — при следующей смене размера половина отстала бы.
//
// ВТОРЫХ ПРАВИЛ ЗДЕСЬ НЕТ, И ЗАВОДИТЬ ИХ НЕЛЬЗЯ:
//   * подпись под маркой — та же, что на странице: её считает страница
//     (`shortTitle` или правка руками) и передаёт сюда готовой строкой;
//   * цвета и пропорция марки — токены сайта, страница читает их из стилей
//     и передаёт сюда (`look`); своих чисел цвета в этом файле нет;
//   * заглушка «изображения нет» — та же, что на сайте: рисунок, заливку,
//     долю ширины и прозрачность страница снимает с настоящего элемента
//     `imageMissingHtml({ compact: true })`;
//   * перфорация — числа марки каталога (`PERF` ниже), сверяет их с CSS
//     проверка `scripts/mybest.test.mjs`.
//
// ЧЕГО В КАРТИНКЕ НЕТ: кнопок, плюсов, крестиков, подсказок, рамок полей.
// Только заголовок, марки, подписи (или список) и брендинг.

/** Во сколько раз файл крупнее чисел спецификации. */
export const SCALE = 1.2;

/** Адрес на картинке — зеркало (тз-22: «Адрес на обеих картинках — зеркало»). */
export const PICTURE_ADDRESS = 'ru.bakapodcast.com/mybest';

// ПЕРФОРАЦИЯ — ЧИСЛА МАРКИ КАТАЛОГА (AnimeCard.astro, и ими же нарисована
// марка на странице `/mybest/`): полоса 12, кружок радиусом 5 цвета бумаги,
// шаг 18, первый кружок в 6 от угла, центр на 1 за краем. На сайте это
// радиальный градиент в стилях, на холсте градиента-узора нет — рисуем
// кружками вдоль четырёх краёв, но по тем же числам. Нижний и правый край
// на сайте — та же полоса, повёрнутая на 180°, поэтому их кружки отсчитываются
// от противоположного угла.
export const PERF = { radius: 5, step: 18, offset: 6, shift: 1 };

// ЛОГОТИП — НАСТОЯЩИЙ, ТОТ ЖЕ ФАЙЛ, ЧТО В ШАПКЕ (assets/images/logo-ink.png):
// японские знаки в нём нарисованы, а в обрезанных шрифтах сайта их нет вовсе.
// Спецификация задаёт «БАКА!» кеглем Literata 28 — значит, высота прописной
// в логотипе равна высоте прописной Literata 28. В файле 1068×237 буквы «БАКА»
// стоят на всю высоту: `LOGO_CAP_SHARE` — доля высоты файла, которую занимает
// прописная «Б» (замер 3 октября 2026 по пикселям файла).
const LOGO_CAP_SIZE = 28;
export const LOGO_CAP_SHARE = 0.99;

const TECH_SIZE = 12; // техслой в картинках — 12 (спецификация, «Шрифты»)
const TECH_TRACKING = 0.08; // em, как у техслоя сайта
const TECH_LINE = 1.35; // межстрочный техслоя сайта (§3.2)

// ГОД ВЫХОДА — В КАРТИНКЕ ЕСТЬ, НА СТРАНИЦЕ НЕТ (решение заказчика 3 октября
// 2026: со страницы год сняли ради кнопок у марки, а в картинке он нужен).
// Техслой 12, `--muted`. ГОД ПРИЛИПАЕТ К НАЗВАНИЮ (правка заказчика того же
// дня): в 9:16 — строкой сразу под последней строкой подписи, а не на общей
// линии ряда (у однострочной подписи между ними зиял разрыв); в 16:9 — в той
// же строке, сразу после названия, а не колонкой по правому краю. Место под
// двухстрочную подпись с годом в 9:16 по-прежнему держится всегда: ряд марок
// от длины подписи не прыгает.
const YEAR_BEFORE = 4; // space-1
const YEAR_GAP = 12; // space-3: от конца названия до года в 16:9

// НАЗВАНИЯ КРУПНЕЕ СПЕЦИФИКАЦИИ (решение заказчика 3 октября 2026,
// «мелковаты в обоих форматах»): 9:16 — 18 вместо 15, 16:9 — 26 вместо 21.
// 18 — ПОТОЛОК 9:16, И ЭТО АРИФМЕТИКА: худший случай — подпись над картинкой
// в три строки; тогда сетке остаётся 1258 единиц, три ряда марок по 332.9
// и два зазора по 26 оставляют подписи с годом 75.4 на ряд, то есть 9 + 2×1.2×к
// + 4 + 16.2 ≤ 75.4 → к ≤ 19.2. Вырастет кегль — девятая марка упрётся
// в брендинг. Порог `shortTitle` (50 знаков) мерился под 15: при 18 в две
// строки колонки 238 влезает меньше, и длинное режет многоточие.

export const FORMATS = {
	// 9:16 — заголовок сверху, сетка 3×3 с подписями, брендинг строкой внизу.
	'9x16': {
		width: 900,
		height: 1600,
		pad: { top: 52, side: 70, bottom: 44 },
		title: { size: 44, lineHeight: 1.12, after: 34, lines: 3 },
		grid: { gapX: 22, gapY: 26 },
		cap: { size: 18, lineHeight: 1.2, before: 9, lines: 2 },
		brand: { pad: 20 },
	},
	// 16:9 — сетка слева, справа заголовок и список 01–09, брендинг внизу правой.
	'16x9': {
		width: 1600,
		height: 900,
		pad: 52,
		gridWidth: 530,
		columnGap: 64,
		grid: { gapX: 16, gapY: 18 },
		title: { size: 40, lineHeight: 1.12, after: 30, lines: 2 },
		// `room` — наименьший зазор между списком и линией брендинга (space-6):
		// не влезает список с двухстрочными названиями — в одну строку
		// с многоточием уходят САМЫЕ ДЛИННЫЕ, по одному, пока не влезет.
		// Все разом — нельзя: замер на девяти самых длинных названиях каталога
		// дал обрезанный список и 326 px пустоты под ним.
		list: { size: 26, lineHeight: 1.3, gap: 13, lines: 2, numberColumn: 26, room: 24 },
		brand: { pad: 20 },
	},
};

/** Размер готового файла в пикселях. */
export function pixelSize(format) {
	const f = FORMATS[format];
	return { width: Math.round(f.width * SCALE), height: Math.round(f.height * SCALE) };
}

// ——— Текст ———

/**
 * Строки не шире `width`, не больше `max`; лишнее — многоточием в конце
 * последней. Переносится, как у подписи на странице: по пробелу и после
 * дефиса («очень-очень-…» иначе рвалось посреди слова), а слово длиннее
 * строки — по буквам, как `overflow-wrap: anywhere`.
 */
export function wrapLines(ctx, text, width, max) {
	const fits = (s) => ctx.measureText(s).width <= width;
	// Кусок слова после дефиса приклеивается к строке без пробела. Делим без
	// просмотра назад в регулярке: его не знают Safari старше 16.4, и модуль
	// не загрузился бы у них вовсе.
	const pieces = [];
	for (const word of String(text).split(' ').filter(Boolean)) {
		const parts = word.split('-');
		parts.forEach((part, i) => {
			const piece = i < parts.length - 1 ? `${part}-` : part;
			if (piece) pieces.push({ piece, glue: i ? '' : ' ' });
		});
	}
	const lines = [];
	let line = '';
	for (const { piece, glue } of pieces) {
		const next = line ? `${line}${glue}${piece}` : piece;
		if (fits(next)) {
			line = next;
			continue;
		}
		if (line) lines.push(line);
		line = piece;
		while (!fits(line) && line.length > 1) {
			let cut = line.length - 1;
			while (cut > 1 && !fits(line.slice(0, cut))) cut--;
			lines.push(line.slice(0, cut));
			line = line.slice(cut);
		}
	}
	if (line) lines.push(line);
	if (lines.length <= max) return lines;
	const kept = lines.slice(0, max);
	let last = kept[max - 1];
	while (last && !fits(`${last}…`)) last = last.slice(0, -1).trimEnd();
	kept[max - 1] = `${last}…`;
	return kept;
}

/** Базовая линия строки высотой `size × lineHeight`, начинающейся в `top`, — как в CSS. */
function baseline(ctx, top, size, lineHeight) {
	const m = ctx.measureText('Ag');
	const ascent = m.fontBoundingBoxAscent ?? size * 0.9;
	const descent = m.fontBoundingBoxDescent ?? size * 0.25;
	return top + (size * lineHeight - (ascent + descent)) / 2 + ascent;
}

/** Блок текста; возвращает его высоту. */
function drawText(ctx, lines, x, top, size, lineHeight) {
	lines.forEach((line, i) => ctx.fillText(line, x, baseline(ctx, top + i * size * lineHeight, size, lineHeight)));
	return lines.length * size * lineHeight;
}

/**
 * Техслой с разрядкой. `ctx.letterSpacing` есть не во всех браузерах
 * (Safari до 18 его не знает), поэтому буквы ставятся по одной.
 * `align: 'right'` — `x` это правый край.
 */
function drawTracked(ctx, text, x, y, align = 'left') {
	const spacing = TECH_SIZE * TECH_TRACKING;
	const chars = [...text];
	const widths = chars.map((c) => ctx.measureText(c).width);
	const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
	let at = align === 'right' ? x - total : x;
	chars.forEach((c, i) => {
		ctx.fillText(c, at, y);
		at += widths[i] + spacing;
	});
}

const font = (size, family) => `400 ${size}px ${family}`;

// ——— Марка ———

/** Постер заполняет рамку целиком (`cover`), обрезка поровну с двух сторон. */
function drawCover(ctx, image, x, y, w, h) {
	const iw = image.naturalWidth || image.width;
	const ih = image.naturalHeight || image.height;
	let sx = 0;
	let sy = 0;
	let sw = iw;
	let sh = ih;
	if (iw / ih > w / h) {
		sw = ih * (w / h);
		sx = (iw - sw) / 2;
	} else {
		sh = iw / (w / h);
		sy = (ih - sh) / 2;
	}
	ctx.drawImage(image, sx, sy, sw, sh, x, y, w, h);
}

/** Заглушка «изображения нет» — вид снят страницей с настоящего элемента сайта. */
function drawMissing(ctx, missing, x, y, w, h) {
	ctx.fillStyle = missing.fill;
	ctx.fillRect(x, y, w, h);
	if (!missing.image) return;
	const size = w * missing.share;
	const ratio = (missing.image.naturalHeight || 1) / (missing.image.naturalWidth || 1);
	ctx.save();
	ctx.globalAlpha = missing.alpha;
	ctx.globalCompositeOperation = missing.blend;
	ctx.drawImage(missing.image, x + (w - size) / 2, y + (h - size * ratio) / 2, size, size * ratio);
	ctx.restore();
}

function drawPerforation(ctx, paper, x, y, w, h) {
	const { radius: r, step, offset, shift } = PERF;
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y, w, h);
	ctx.clip();
	ctx.fillStyle = paper;
	ctx.beginPath();
	const dot = (cx, cy) => {
		ctx.moveTo(cx + r, cy);
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
	};
	for (let d = offset; d - r < w; d += step) {
		dot(x + d, y - shift); // верх, от левого угла
		dot(x + w - d, y + h + shift); // низ, от правого
	}
	for (let d = offset; d - r < h; d += step) {
		dot(x - shift, y + d); // левый край, от верхнего угла
		dot(x + w + shift, y + h - d); // правый, от нижнего
	}
	ctx.fill();
	ctx.restore();
}

/** Марка: постер или заглушка, поверх — перфорация. */
export function drawStamp(ctx, look, cell, x, y, w, h) {
	ctx.fillStyle = look.colors.lineSoft;
	ctx.fillRect(x, y, w, h);
	if (cell.image) drawCover(ctx, cell.image, x, y, w, h);
	else drawMissing(ctx, look.missing, x, y, w, h);
	drawPerforation(ctx, look.colors.paper, x, y, w, h);
}

// ——— Брендинг ———

/**
 * Строка внизу: линия сверху, отступ, логотип слева, адрес справа — по одной
 * базовой линии (низ логотипа — базовая линия «БАКА!»). `bottom` — нижний
 * край строки. Возвращает верх строки (где линия).
 */
function logoHeightOf(ctx, look) {
	ctx.font = font(LOGO_CAP_SIZE, look.fonts.display);
	return ctx.measureText('Б').actualBoundingBoxAscent / LOGO_CAP_SHARE;
}

function drawBrand(ctx, look, logo, x, width, bottom, pad) {
	const logoHeight = logoHeightOf(ctx, look);
	const logoWidth = logoHeight * (logo.naturalWidth / logo.naturalHeight);
	const top = bottom - logoHeight - pad;
	hairline(ctx, look.colors.line, x, top, width);
	ctx.drawImage(logo, x, bottom - logoHeight, logoWidth, logoHeight);
	ctx.font = font(TECH_SIZE, look.fonts.tech);
	ctx.fillStyle = look.colors.muted;
	drawTracked(ctx, PICTURE_ADDRESS, x + width, bottom, 'right');
	return top;
}

/** Линия ровно в один пиксель файла, по сетке пикселей, а не 1.2 размытых. */
function hairline(ctx, color, x, y, width) {
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = color;
	ctx.fillRect(Math.round(x * SCALE), Math.round(y * SCALE), Math.round(width * SCALE), 1);
	ctx.restore();
}

// ——— Картинка целиком ———

/**
 * Рисует картинку на `canvas` (размер ставит сама).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{
 *   format: '9x16' | '16x9',
 *   caption: string,
 *   cells: { caption: string, year?: number, image: CanvasImageSource | null }[],
 *   logo: HTMLImageElement,
 *   look: {
 *     colors: { paper, ink, muted, line, lineSoft },
 *     fonts: { display, tech },
 *     ratio: number,
 *     missing: { image, fill, share, alpha, blend },
 *   },
 * }} data
 * @returns {{ gridBottom: number, textBottom: number, brandTop: number, bottom: number }}
 *   в единицах спецификации: где кончилась сетка (с подписями), где кончился
 *   текст над брендингом, где начинается брендинг и где кончается кадр
 *   за вычетом поля, — для проверки запаса по высоте на настоящей картинке.
 */
export function drawPicture(canvas, data) {
	const f = FORMATS[data.format];
	const size = pixelSize(data.format);
	canvas.width = size.width;
	canvas.height = size.height;
	const ctx = canvas.getContext('2d');
	ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = data.look.colors.paper;
	ctx.fillRect(0, 0, f.width, f.height);
	return data.format === '9x16' ? drawStory(ctx, f, data) : drawWide(ctx, f, data);
}

function drawStory(ctx, f, { caption, cells, logo, look }) {
	const { colors, fonts } = look;
	const left = f.pad.side;
	const width = f.width - f.pad.side * 2;

	ctx.fillStyle = colors.ink;
	ctx.font = font(f.title.size, fonts.display);
	let y = f.pad.top;
	y += drawText(ctx, wrapLines(ctx, caption, width, f.title.lines), left, y, f.title.size, f.title.lineHeight);
	y += f.title.after;

	const column = (width - f.grid.gapX * 2) / 3;
	const stamp = column / look.ratio;
	const capLines = f.cap.size * f.cap.lineHeight * f.cap.lines;
	const yearLine = TECH_SIZE * TECH_LINE;
	const capBlock = f.cap.before + capLines + YEAR_BEFORE + yearLine;
	cells.forEach((cell, i) => {
		const x = left + (i % 3) * (column + f.grid.gapX);
		const top = y + Math.floor(i / 3) * (stamp + capBlock + f.grid.gapY);
		drawStamp(ctx, look, cell, x, top, column, stamp);
		ctx.fillStyle = colors.ink;
		ctx.font = font(f.cap.size, fonts.display);
		const height = drawText(ctx, wrapLines(ctx, cell.caption, column, f.cap.lines), x, top + stamp + f.cap.before, f.cap.size, f.cap.lineHeight);
		if (cell.year) {
			ctx.font = font(TECH_SIZE, fonts.tech);
			ctx.fillStyle = colors.muted;
			const yearTop = top + stamp + f.cap.before + height + YEAR_BEFORE;
			drawTracked(ctx, String(cell.year), x, baseline(ctx, yearTop, TECH_SIZE, TECH_LINE));
		}
	});
	const rows = Math.ceil(cells.length / 3);
	const gridBottom = y + rows * (stamp + capBlock) + (rows - 1) * f.grid.gapY;

	const bottom = f.height - f.pad.bottom;
	const brandTop = drawBrand(ctx, look, logo, left, width, bottom, f.brand.pad);
	return { gridBottom, textBottom: gridBottom, brandTop, bottom };
}

function drawWide(ctx, f, { caption, cells, logo, look }) {
	const { colors, fonts } = look;
	const column = (f.gridWidth - f.grid.gapX * 2) / 3;
	const stamp = column / look.ratio;
	cells.forEach((cell, i) => {
		const x = f.pad + (i % 3) * (column + f.grid.gapX);
		const top = f.pad + Math.floor(i / 3) * (stamp + f.grid.gapY);
		drawStamp(ctx, look, cell, x, top, column, stamp);
	});
	const rows = Math.ceil(cells.length / 3);
	const gridBottom = f.pad + rows * stamp + (rows - 1) * f.grid.gapY;

	const left = f.pad + f.gridWidth + f.columnGap;
	const width = f.width - f.pad - left;
	ctx.fillStyle = colors.ink;
	ctx.font = font(f.title.size, fonts.display);
	let y = f.pad;
	y += drawText(ctx, wrapLines(ctx, caption, width, f.title.lines), left, y, f.title.size, f.title.lineHeight);
	y += f.title.after;

	// Номер стоит на базовой линии первой строки названия, год — на базовой
	// линии последней, сразу за ней.
	const { list } = f;
	const bottom = f.height - f.pad;
	const brandTop = bottom - logoHeightOf(ctx, look) - f.brand.pad;
	const nameWidth = width - list.numberColumn;
	const yearWidth = (year) => {
		if (!year) return 0;
		ctx.font = font(TECH_SIZE, fonts.tech);
		const text = String(year);
		return ctx.measureText(text).width + TECH_SIZE * TECH_TRACKING * (text.length - 1) + YEAR_GAP;
	};
	// Год обязан уместиться за последней строкой. Не умещается — название
	// переносится уже, освобождая ему место, а не уводит год на новую строку.
	const wrapName = (cell, max) => {
		const room = yearWidth(cell.year);
		ctx.font = font(list.size, fonts.display);
		const lines = wrapLines(ctx, cell.caption, nameWidth, max);
		if (ctx.measureText(lines.at(-1)).width + room <= nameWidth) return lines;
		return wrapLines(ctx, cell.caption, nameWidth - room, max);
	};
	const heightOf = (wrapped) => wrapped.reduce((sum, lines) => sum + lines.length * list.size * list.lineHeight, 0) + list.gap * (cells.length - 1);
	const wrapped = cells.map((cell) => wrapName(cell, list.lines));
	const byLength = cells.map((cell, i) => i).sort((a, b) => cells[b].caption.length - cells[a].caption.length);
	for (const i of byLength) {
		if (y + heightOf(wrapped) <= brandTop - list.room) break;
		if (wrapped[i].length > 1) wrapped[i] = wrapName(cells[i], 1);
	}
	cells.forEach((cell, i) => {
		if (i) y += list.gap;
		ctx.font = font(list.size, fonts.display);
		ctx.fillStyle = colors.ink;
		const first = baseline(ctx, y, list.size, list.lineHeight);
		const height = drawText(ctx, wrapped[i], left + list.numberColumn, y, list.size, list.lineHeight);
		const lastEnd = left + list.numberColumn + ctx.measureText(wrapped[i].at(-1)).width;
		const last = first + (wrapped[i].length - 1) * list.size * list.lineHeight;
		ctx.font = font(TECH_SIZE, fonts.tech);
		ctx.fillStyle = colors.muted;
		drawTracked(ctx, String(i + 1).padStart(2, '0'), left, first);
		if (cell.year) drawTracked(ctx, String(cell.year), lastEnd + YEAR_GAP, last);
		y += height;
	});

	drawBrand(ctx, look, logo, left, width, bottom, f.brand.pad);
	return { gridBottom, textBottom: y, brandTop, bottom };
}
