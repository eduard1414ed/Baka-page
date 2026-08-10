// Персонаж вместо обложки: вырезать фигуру из обложки выпуска (тз/12).
//
//   node scripts/cover-cutout.mjs --fetch     скачать оригиналы во временную папку
//   node scripts/cover-cutout.mjs             РАЗВЕДКА: прогон без записи в репозиторий
//
// Разведка ничего не записывает в репозиторий: готовые картинки ложатся
// во временную папку вне гита, на экран идёт отчёт с отметками «чисто» или
// «на проверку», рядом собирается страница со всеми парами «было — стало».
// Запись включается отдельным ключом и отдельным запуском — то же правило,
// что у разбора таймкодов (статус/этап-8.md).
//
// Оригиналы обложек в репозиторий не кладём (CLAUDE.md): они живут у Mave
// и качаются заново в любой момент. Временная папка — кэш, чтобы не дёргать
// чужой сервер при каждом прогоне.
//
// ПОРЯДОК ШАГОВ МЕНЯТЬ НЕЛЬЗЯ: сначала стереть шаблон, потом кадрировать.
// Обратный порядок срезает всё, что вылезает за рамку, а вылезает часто.

import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { fetchFeedItems } from '../src/lib/podcastFeed.mjs';
import { coverIdFromUrl } from '../src/lib/episodeCover.mjs';

// ────────────────────────────────────────────────────────────────────────────
// ЧИСЛА, КОТОРЫЕ КРУТИТ ЗАКАЗЧИК. Все здесь, одним блоком (тз/12, таблица).
// ────────────────────────────────────────────────────────────────────────────

/** Размер готовой картинки, px. Квадрат. */
const CANVAS = 1200;

/** Поля слева, справа и сверху — доля от холста. */
const MARGIN = 0.08;

/** Поле снизу. 0 — фигура стоит на нижнем краю. */
const MARGIN_BOTTOM = 0;

/** Ограничитель увеличения: во сколько раз максимум растягиваем мелкую фигуру. */
const MAX_SCALE = 1.8;

/** Порог «тёмного» (0–255) для поиска линий рамки. */
const DARK = 110;

/** Допуск фона: насколько пиксель может отличаться от цвета фона и остаться фоном. */
const BG_TOLERANCE = 30;

/** Полоса стирания вокруг найденной линии рамки, px в каждую сторону. */
const ERASE = 6;

/** Проба на пересечение: насколько далеко от линии смотреть, фон ли по бокам. */
const PROBE = 16;

/**
 * Оставлять ли цвет персонажа.
 *
 * ТЗ говорит «серый плюс прозрачность» — рисунки в архиве почти все серые.
 * Но у 20 обложек из 111 персонаж цветной, и на них разница видна. Ищется
 * и вырезается фигура в любом случае по серой копии: цвет на поиск рамки
 * и на разлив фона не влияет.
 */
const KEEP_COLOR = false;

// ── отметки «на проверку» ───────────────────────────────────────────────────

/** Во сколько раз первый кусок обязан быть крупнее второго. Норма по архиву — 37. */
const MIN_GAP = 10;

/** Допустимая доля площади фигуры от площади внутри рамки. */
const MIN_AREA = 0.05;
const MAX_AREA = 0.60;

// ── распознавание шаблона ───────────────────────────────────────────────────
//
// Линию рамки от персонажа отличает ПРОБА НАРУЖУ: снаружи от линии всегда фон,
// а что внутри — не наше дело. Считать «много тёмного в строке» нельзя (чёрный
// плащ, доходящий до нижней линии, читается линией — 46 % тёмного в строках
// 1780–1800 у Токийского гуля), и двусторонняя проба «светло и сверху и снизу»
// тоже не годится: у трёх обложек архива низ рисунка тёмный во всю ширину
// рамки, и тонкой линия не выглядит нигде.

/** Порог «светлого» для пробы наружу. */
const LIGHT = 150;

/** На каком расстоянии от линии смотреть наружу. */
const THIN_GAP = 9;

/**
 * Какую долю стороны обязана занимать линия рамки.
 *
 * Порог из замера по всему архиву, а не назначен на глаз: у шаблонных обложек
 * слабейшая линия 15–69 % (худшая — 15 % у обложки со знаком вопроса),
 * у нешаблонных не выше 12 %. Между ними и стоит.
 */
const MIN_LINE = 0.13;

/**
 * Насколько рамка может отличаться от квадрата, доля.
 *
 * Тоже замер: у шаблонных отклонение не больше 0,4 %, у остальных от 1,2 %
 * и выше. Широкая рамка «BAKA ANIME AWARD» (отклонение 35 %) — другой шаблон,
 * сюда не проходит намеренно.
 */
const SQUARE_TOLERANCE = 0.05;

// ── служебное ───────────────────────────────────────────────────────────────

/** Ширины готовых файлов. Два размера, не больше — правило проекта. */
const OUT_WIDTHS = [640, 1200];

// Обе папки — во временной, а не в проекте: в гит из этой работы попадает
// только сам скрипт. Путь простой и одинаковый на всех запусках, чтобы
// заказчику было куда заглянуть, — os.tmpdir() на маке прячется в /var/folders
// с нечитаемым именем.

/** Куда кладём скачанные оригиналы. Вне репозитория. */
const CACHE_DIR = '/tmp/baka-covers';

/** Куда кладёт результаты разведка. Тоже вне репозитория. */
const SCOUT_DIR = '/tmp/baka-cutout';

const ROOT = new URL('../', import.meta.url);
const POSTS_DIR = new URL('src/content/posts/', ROOT);
const UPLOADS_DIR = new URL('public/images/uploads/', ROOT);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} КБ`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

// ────────────────────────────────────────────────────────────────────────────
// ОТКУДА БЕРЁМ ОБЛОЖКИ
// ────────────────────────────────────────────────────────────────────────────

/**
 * Все обложки, которые надо обработать, из двух источников.
 *
 * 1. Выпуски подкаста — адрес картинки из RSS, оригинал 2000×2000 у Mave.
 *    Ключ (`id`) — идентификатор самой картинки, а не выпуска: у шести
 *    выпусков архива обложка общая, и обрабатывать её надо один раз.
 * 2. Бонусы и всё, чему обложку загрузили руками, — поле «Обложка» поста,
 *    файл лежит в public/images/uploads/. Ключ — имя файла без расширения.
 *
 * Не по шаблону нарисованные обложки (кадр с ютуба у видеоэссе) отсеются сами:
 * скрипт трогает только квадратные картинки, в которых нашлась рамка.
 *
 * @returns {Promise<{id:string, kind:'episode'|'upload', src:string, title:string}[]>}
 */
async function collectCovers() {
	const found = new Map();

	const items = await fetchFeedItems();
	for (const item of items) {
		const id = coverIdFromUrl(item.imageUrl);
		if (!id || found.has(id)) continue;
		found.set(id, { id, kind: 'episode', src: item.imageUrl, title: item.title ?? id });
	}
	const fromFeed = found.size;

	const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
	for (const file of files.sort()) {
		const text = await readFile(new URL(encodeURIComponent(file), POSTS_DIR), 'utf8');
		const match = text.match(/^cover:\s*['"]?(\/images\/uploads\/[^'"\n]+?)['"]?\s*$/m);
		if (!match) continue;

		const name = decodeURIComponent(match[1].slice('/images/uploads/'.length));
		const dot = name.lastIndexOf('.');
		const id = dot === -1 ? name : name.slice(0, dot);
		if (found.has(id)) continue;

		const titleMatch = text.match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
		found.set(id, {
			id,
			kind: 'upload',
			src: fileURLToPath(new URL(encodeURIComponent(name), UPLOADS_DIR)),
			title: titleMatch ? titleMatch[1] : file.replace(/\.md$/, ''),
		});
	}

	console.log(`Обложек выпусков из RSS: ${fromFeed}. Загруженных руками (бонусы и прочее): ${found.size - fromFeed}.`);
	return [...found.values()];
}

/** Путь к оригиналу: у выпусков — в кэше, у загруженных руками — прямо в проекте. */
function sourcePath(cover) {
	return cover.kind === 'episode' ? path.join(CACHE_DIR, `${cover.id}.jpg`) : cover.src;
}

/**
 * Скачать оригиналы во временную папку. Идемпотентно: уже лежащие пропускает.
 * Локальные файлы (загруженные в админку) не качает — они и так на диске.
 */
async function fetchOriginals(covers) {
	await mkdir(CACHE_DIR, { recursive: true });

	const episodes = covers.filter((c) => c.kind === 'episode');
	const todo = episodes.filter((c) => !existsSync(sourcePath(c)));
	console.log(`\nВременная папка: ${CACHE_DIR}`);
	console.log(`Всего обложек выпусков: ${episodes.length}. Уже скачано: ${episodes.length - todo.length}. К скачиванию: ${todo.length}.`);

	if (todo.length === 0) {
		console.log('Качать нечего.');
		return;
	}

	console.log(`Примерный вес: ${mb(todo.length * 1_400_000)}. В репозиторий не попадёт ничего.\n`);

	let bytes = 0;
	let failed = 0;

	for (const [index, cover] of todo.entries()) {
		try {
			const response = await fetch(cover.src);
			if (!response.ok) throw new Error(`код ответа ${response.status}`);
			const buffer = Buffer.from(await response.arrayBuffer());
			await writeFile(sourcePath(cover), buffer);
			bytes += buffer.length;
			console.log(`[${index + 1}/${todo.length}] ${cover.id}: ${kb(buffer.length)}`);
		} catch (error) {
			// Одна недоступная обложка не должна валить прогон: её просто
			// не будет в разведке, и это видно в итоге.
			failed += 1;
			console.error(`[${index + 1}/${todo.length}] ${cover.id}: ОШИБКА — ${error.message}`);
		}
	}

	console.log(`\nСкачано: ${todo.length - failed}, ошибок: ${failed}, всего ${mb(bytes)}.`);
}

// ────────────────────────────────────────────────────────────────────────────
// ШАГ 1. НАЙТИ РАМКУ
// ────────────────────────────────────────────────────────────────────────────

/** Подряд идущие номера — в отрезки. */
function toGroups(indexes) {
	const out = [];
	for (const i of indexes) {
		const last = out[out.length - 1];
		if (last && i === last.end + 1) last.end = i;
		else out.push({ start: i, end: i });
	}
	return out;
}

/**
 * Рамка шаблона: единственные сплошные тёмные линии через всю картинку.
 *
 * Измеряется, а не вписывается числами: координаты от обложки к обложке гуляют
 * (замер по архиву: верх 419 у большинства, но встречаются 139 и 521).
 *
 * Линию узнаём ПРОБОЙ НАРУЖУ: считаем пиксели, которые тёмные сами и светлые
 * на расстоянии THIN_GAP с ВНЕШНЕЙ стороны. У верхней линии смотрим вверх,
 * у нижней вниз, у боковых в стороны. Тёмная одежда персонажа этой пробы
 * не проходит, линия рамки проходит вся — что бы ни было нарисовано внутри.
 *
 * @returns {{top:number, bottom:number, left:number, right:number,
 *            scores:number[]} | null} null — рамки нет, обложка не по шаблону.
 */
function findFrame(grey, W, H) {
	const rowUp = new Float64Array(H);
	const rowDown = new Float64Array(H);
	const colLeft = new Float64Array(W);
	const colRight = new Float64Array(W);

	for (let y = THIN_GAP; y < H - THIN_GAP; y += 1) {
		const row = y * W;
		const up = (y - THIN_GAP) * W;
		const down = (y + THIN_GAP) * W;
		let a = 0;
		let b = 0;
		for (let x = 0; x < W; x += 1) {
			if (grey[row + x] >= DARK) continue;
			if (grey[up + x] > LIGHT) a += 1;
			if (grey[down + x] > LIGHT) b += 1;
		}
		rowUp[y] = a / W;
		rowDown[y] = b / W;
	}

	for (let x = THIN_GAP; x < W - THIN_GAP; x += 1) {
		let a = 0;
		let b = 0;
		for (let y = 0; y < H; y += 1) {
			const row = y * W;
			if (grey[row + x] >= DARK) continue;
			if (grey[row + x - THIN_GAP] > LIGHT) a += 1;
			if (grey[row + x + THIN_GAP] > LIGHT) b += 1;
		}
		colLeft[x] = a / H;
		colRight[x] = b / H;
	}

	// Верхняя линия — самая сильная в верхней половине, нижняя — в нижней,
	// и так же по бокам. Половина отсекает надпись «БАКА!» и кану: они выше
	// рамки, но слабее её (замер: 15 % против 69 %).
	const best = (arr, from, to) => {
		let at = -1;
		let value = 0;
		for (let i = from; i < to; i += 1) if (arr[i] > value) { value = arr[i]; at = i; }
		return { at, value };
	};

	const t = best(rowUp, 0, Math.floor(H / 2));
	const b = best(rowDown, Math.floor(H / 2), H);
	const l = best(colLeft, 0, Math.floor(W / 2));
	const r = best(colRight, Math.floor(W / 2), W);
	const scores = [t.value, b.value, l.value, r.value];

	if (scores.some((v) => v < MIN_LINE)) return null;
	if ([t, b, l, r].some((line) => line.at < 0)) return null;

	// Середина линии, а не её самый сильный пиксель: линия толщиной 4 px,
	// стирать надо от середины.
	const centre = (arr, at) => {
		const peak = arr[at];
		const group = toGroups(
			[...arr.keys()].filter((i) => arr[i] > peak * 0.5 && Math.abs(i - at) < 30),
		).find((g) => g.start <= at && at <= g.end) ?? { start: at, end: at };
		return (group.start + group.end) / 2;
	};

	const frame = {
		top: centre(rowUp, t.at),
		bottom: centre(rowDown, b.at),
		left: centre(colLeft, l.at),
		right: centre(colRight, r.at),
		scores,
	};

	// Найдено не прямоугольником — считаем, что шаблона нет. Рамка шаблона
	// квадратная (замер: 1385×1385 при 2000×2000).
	const width = frame.right - frame.left;
	const height = frame.bottom - frame.top;
	if (width < W * 0.3 || height < H * 0.3) return null;
	if (Math.abs(width - height) / Math.max(width, height) > SQUARE_TOLERANCE) return null;

	return frame;
}

// ────────────────────────────────────────────────────────────────────────────
// ШАГ 2. СТЕРЕТЬ РАМКУ ПОЛОСОЙ
// ────────────────────────────────────────────────────────────────────────────

/**
 * Цвет фона: середина яркости по краю картинки. Именно по краю — там фон есть
 * всегда, что бы ни было нарисовано внутри.
 */
function backgroundLevel(grey, W, H) {
	const samples = [];
	for (let x = 0; x < W; x += 7) {
		for (const y of [2, 5, H - 3, H - 6]) samples.push(grey[y * W + x]);
	}
	for (let y = 0; y < H; y += 7) {
		for (const x of [2, 5, W - 3, W - 6]) samples.push(grey[y * W + x]);
	}
	samples.sort((a, b) => a - b);
	return samples[Math.floor(samples.length / 2)];
}

/**
 * Стереть рамку полосой ±ERASE, но только там, где по обе стороны от неё фон.
 *
 * Полосой, а не линией: у линии есть серый ореол сглаживания, он не чёрный
 * и не фон. Сотрёшь только линию — ореол останется тонким кольцом и запечатает
 * внутреннюю область: заливка снаружи внутрь не пройдёт, и в «персонажа»
 * попадёт весь фон вместе с подписью.
 *
 * Где персонаж пересекает рамку — не трогаем: дыра в контуре пустила бы
 * заливку внутрь фигуры.
 *
 * @returns {{erased:number, kept:number}} сколько позиций стёрли и сколько
 *          оставили. «Оставили» = там персонаж пересекает рамку — и это число
 *          считается ТОЛЬКО вне углов: в углу проба всегда упирается
 *          в перпендикулярную линию, и без этой оговорки счётчик отвечал бы
 *          «фигура вылезала за рамку» про все 112 обложек подряд.
 */
function eraseFrame(grey, W, H, frame, bg) {
	const isBg = (value) => Math.abs(value - bg) <= BG_TOLERANCE;
	let erased = 0;
	let kept = 0;

	// Зона угла: там, где проба одной линии дотягивается до другой.
	const CORNER = PROBE + ERASE;
	const inCornerX = (x) => Math.abs(x - frame.left) < CORNER || Math.abs(x - frame.right) < CORNER;
	const inCornerY = (y) => Math.abs(y - frame.top) < CORNER || Math.abs(y - frame.bottom) < CORNER;

	const from = Math.max(0, Math.round(frame.left) - ERASE);
	const to = Math.min(W - 1, Math.round(frame.right) + ERASE);
	const fromY = Math.max(0, Math.round(frame.top) - ERASE);
	const toY = Math.min(H - 1, Math.round(frame.bottom) + ERASE);

	// Горизонтальные линии: идём по столбцам, пробуем выше и ниже.
	for (const line of [frame.top, frame.bottom]) {
		const c = Math.round(line);
		for (let x = from; x <= to; x += 1) {
			const above = grey[Math.max(0, c - PROBE) * W + x];
			const below = grey[Math.min(H - 1, c + PROBE) * W + x];
			if (!isBg(above) || !isBg(below)) { if (!inCornerX(x)) kept += 1; continue; }
			for (let y = Math.max(0, c - ERASE); y <= Math.min(H - 1, c + ERASE); y += 1) grey[y * W + x] = bg;
			erased += 1;
		}
	}

	// Вертикальные линии: идём по строкам, пробуем слева и справа.
	for (const line of [frame.left, frame.right]) {
		const c = Math.round(line);
		for (let y = fromY; y <= toY; y += 1) {
			const row = y * W;
			const leftPx = grey[row + Math.max(0, c - PROBE)];
			const rightPx = grey[row + Math.min(W - 1, c + PROBE)];
			if (!isBg(leftPx) || !isBg(rightPx)) { if (!inCornerY(y)) kept += 1; continue; }
			for (let x = Math.max(0, c - ERASE); x <= Math.min(W - 1, c + ERASE); x += 1) grey[row + x] = bg;
			erased += 1;
		}
	}

	return { erased, kept };
}

// ────────────────────────────────────────────────────────────────────────────
// ШАГ 3. ЗАЛИТЬ ФОН ОТ КРАЁВ
// ────────────────────────────────────────────────────────────────────────────

/**
 * Разлив фона от краёв картинки внутрь.
 *
 * Именно разливом, а не «все светлые пиксели прозрачные»: иначе пропали бы
 * белая рубашка, светлые чулки и блики — всё, что светлое, но заперто внутри
 * контура.
 *
 * @returns {Uint8Array} 1 — фон, 0 — не фон.
 */
function floodBackground(grey, W, H, bg) {
	const isBg = (value) => Math.abs(value - bg) <= BG_TOLERANCE;
	const mask = new Uint8Array(W * H);
	const stack = new Int32Array(W * H);
	let top = 0;

	const push = (index) => {
		if (mask[index] || !isBg(grey[index])) return;
		mask[index] = 1;
		stack[top++] = index;
	};

	for (let x = 0; x < W; x += 1) { push(x); push((H - 1) * W + x); }
	for (let y = 0; y < H; y += 1) { push(y * W); push(y * W + W - 1); }

	while (top > 0) {
		const index = stack[--top];
		const x = index % W;
		const y = (index - x) / W;
		if (x > 0) push(index - 1);
		if (x < W - 1) push(index + 1);
		if (y > 0) push(index - W);
		if (y < H - 1) push(index + W);
	}

	return mask;
}

// ────────────────────────────────────────────────────────────────────────────
// ШАГ 4. ОСТАВИТЬ САМЫЙ КРУПНЫЙ СВЯЗНЫЙ КУСОК
// ────────────────────────────────────────────────────────────────────────────

/**
 * Связные куски того, что не фон. Персонаж крупнее подписей в десятки раз,
 * поэтому надпись «БАКА!», кана и вертикальная подпись отваливаются сами.
 *
 * @returns {{best:Uint8Array, box:{x0,y0,x1,y1}, first:number, second:number}}
 */
function largestPiece(bgMask, W, H) {
	const labels = new Int32Array(W * H).fill(-1);
	const stack = new Int32Array(W * H);
	const sizes = [];
	const boxes = [];

	for (let start = 0; start < W * H; start += 1) {
		if (bgMask[start] || labels[start] !== -1) continue;

		const label = sizes.length;
		let top = 0;
		labels[start] = label;
		stack[top++] = start;
		let size = 0;
		const box = { x0: W, y0: H, x1: 0, y1: 0 };

		while (top > 0) {
			const index = stack[--top];
			const x = index % W;
			const y = (index - x) / W;
			size += 1;
			if (x < box.x0) box.x0 = x;
			if (x > box.x1) box.x1 = x;
			if (y < box.y0) box.y0 = y;
			if (y > box.y1) box.y1 = y;

			const step = (next) => {
				if (bgMask[next] || labels[next] !== -1) return;
				labels[next] = label;
				stack[top++] = next;
			};
			if (x > 0) step(index - 1);
			if (x < W - 1) step(index + 1);
			if (y > 0) step(index - W);
			if (y < H - 1) step(index + W);
		}

		sizes.push(size);
		boxes.push(box);
	}

	if (sizes.length === 0) return null;

	const order = sizes.map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]);
	const [winner, first] = order[0];
	const second = order[1] ? order[1][1] : 0;

	const best = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i += 1) if (labels[i] === winner) best[i] = 1;

	return { best, box: boxes[winner], first, second };
}

// ────────────────────────────────────────────────────────────────────────────
// ШАГ 5. ОБРЕЗАТЬ, ОТЦЕНТРИРОВАТЬ, ОТМАСШТАБИРОВАТЬ
// ────────────────────────────────────────────────────────────────────────────

/**
 * Фигура → квадратный холст CANVAS×CANVAS, серый плюс прозрачность.
 *
 * Центрирование геометрическое, по краям фигуры, а не по центру рамки:
 * персонаж стоит в рамке криво, смещение бывает под 200 px.
 *
 * Масштаб считается от оригинала 2000 px, а не от уменьшенной копии.
 */
async function composeCanvas(grey, colour, mask, W, H, box) {
	const figW = box.x1 - box.x0 + 1;
	const figH = box.y1 - box.y0 + 1;

	// Вырезаем прямоугольник фигуры: серый плюс прозрачность (или цвет плюс
	// прозрачность, если KEEP_COLOR).
	//
	// У прозрачных пикселей кладём светлое, а не чёрное: при уменьшении
	// соседние пиксели смешиваются, и чёрный дал бы фигуре тёмный ореол
	// по контуру.
	const channels = colour ? 4 : 2;
	const cut = Buffer.allocUnsafe(figW * figH * channels);
	for (let y = 0; y < figH; y += 1) {
		for (let x = 0; x < figW; x += 1) {
			const from = (y + box.y0) * W + (x + box.x0);
			const to = (y * figW + x) * channels;
			const inside = mask[from] === 1;
			if (colour) {
				cut[to] = inside ? colour[from * 3] : 255;
				cut[to + 1] = inside ? colour[from * 3 + 1] : 255;
				cut[to + 2] = inside ? colour[from * 3 + 2] : 255;
			} else {
				cut[to] = inside ? grey[from] : 255;
			}
			cut[to + channels - 1] = inside ? 255 : 0;
		}
	}

	const availableW = CANVAS * (1 - MARGIN * 2);
	const availableH = CANVAS * (1 - MARGIN - MARGIN_BOTTOM);
	const scale = Math.min(availableW / figW, availableH / figH, MAX_SCALE);
	const destW = Math.max(1, Math.round(figW * scale));
	const destH = Math.max(1, Math.round(figH * scale));

	const figure = await sharp(cut, { raw: { width: figW, height: figH, channels } })
		.resize(destW, destH)
		.png()
		.toBuffer();

	const canvas = await sharp({
		create: {
			width: CANVAS, height: CANVAS, channels: 4,
			background: { r: 255, g: 255, b: 255, alpha: 0 },
		},
	})
		.composite([{
			input: figure,
			left: Math.round((CANVAS - destW) / 2),
			top: Math.round(CANVAS - MARGIN_BOTTOM * CANVAS - destH),
		}])
		.png()
		.toBuffer();

	return { canvas, scale, figW, figH };
}

// ────────────────────────────────────────────────────────────────────────────
// ОДНА ОБЛОЖКА ЦЕЛИКОМ
// ────────────────────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{status:'ok'|'check'|'skip', reasons:string[], …}>}
 *   'skip'  — обложка не по шаблону, не трогаем вовсе;
 *   'check' — сделана, но просит посмотреть глазами;
 *   'ok'    — чисто.
 */
async function processCover(cover) {
	const file = sourcePath(cover);
	if (!existsSync(file)) return { status: 'skip', reasons: ['оригинал не скачан'] };

	const { data: grey, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;

	if (W !== H) return { status: 'skip', reasons: [`не квадрат (${W}×${H})`] };

	const frame = findFrame(grey, W, H);
	if (!frame) return { status: 'skip', reasons: ['рамка не найдена — обложка не по шаблону'], W, H };

	const bg = backgroundLevel(grey, W, H);
	const { erased, kept } = eraseFrame(grey, W, H, frame, bg);
	const bgMask = floodBackground(grey, W, H, bg);
	const piece = largestPiece(bgMask, W, H);
	if (!piece) return { status: 'skip', reasons: ['внутри рамки ничего не осталось'], W, H };

	// Цвет читаем ОТДЕЛЬНО и только если он нужен: искали и вырезали по серой
	// копии, и это правильно — цвет на поиск рамки и разлив фона не влияет.
	const colour = KEEP_COLOR
		? await sharp(file).removeAlpha().toColourspace('srgb').raw().toBuffer()
		: null;

	const { canvas, scale, figW, figH } = await composeCanvas(grey, colour, piece.best, W, H, piece.box);

	const insideArea = (frame.right - frame.left) * (frame.bottom - frame.top);
	const areaShare = piece.first / insideArea;
	const gap = piece.second > 0 ? piece.first / piece.second : Infinity;
	const touchesEdge = piece.box.x0 === 0 || piece.box.y0 === 0 || piece.box.x1 === W - 1 || piece.box.y1 === H - 1;

	const reasons = [];
	if (gap < MIN_GAP) reasons.push(`разрыв кусков ${gap.toFixed(1)}× (норма от ${MIN_GAP})`);
	if (touchesEdge) reasons.push('фигура касается края исходника');
	if (areaShare < MIN_AREA) reasons.push(`фигура мелкая, ${(areaShare * 100).toFixed(1)} % рамки`);
	if (areaShare > MAX_AREA) reasons.push(`фигура крупная, ${(areaShare * 100).toFixed(1)} % рамки`);
	if (scale >= MAX_SCALE - 1e-9) reasons.push(`масштаб упёрся в ограничитель ${MAX_SCALE}×`);

	return {
		status: reasons.length ? 'check' : 'ok',
		reasons, canvas, scale, figW, figH, gap, areaShare, erased, kept, frame, W, H,
		crossings: kept,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// РАЗВЕДКА
// ────────────────────────────────────────────────────────────────────────────

/** Страница «было — стало», чтобы смотреть глазами в браузере. */
function reportPage(rows) {
	const card = (r) => `
	<figure class="${r.status}">
		<div class="pair">
			<img src="было/${r.id}.jpg" alt="">
			${r.canvas ? `<img src="стало/${r.id}.png" alt="">` : '<p class="none">не трогаем</p>'}
		</div>
		<figcaption>
			<b>${r.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b><br>
			<code>${r.id}</code><br>
			${r.status === 'check' ? `<span class="why">${r.reasons.join('; ')}</span><br>` : ''}
			масштаб ${r.scale?.toFixed(2) ?? '—'}×, разрыв ${r.gap === Infinity ? '∞' : r.gap?.toFixed(0) ?? '—'}×,
			фигура ${r.figW}×${r.figH}, пересечений рамки ${r.crossings ?? '—'}
		</figcaption>
	</figure>`;

	const section = (title, list) => list.length === 0 ? '' : `
	<h2>${title} — ${list.length}</h2>
	<div class="grid">${list.map(card).join('')}</div>`;

	return `<!doctype html><meta charset="utf-8"><title>Персонаж вместо обложки — разведка</title>
<style>
 body{font:14px/1.4 -apple-system,system-ui,sans-serif;margin:24px;background:#F8F6F0;color:#1a1a1a}
 h1{font-size:22px} h2{margin-top:32px;border-top:1px solid #ccc;padding-top:12px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:20px}
 figure{margin:0;background:#fff;border:1px solid #ddd;padding:8px}
 figure.check{border-color:#c0392b;border-width:2px}
 .pair{display:grid;grid-template-columns:1fr 1fr;gap:6px}
 .pair img{width:100%;display:block;background:#F8F6F0}
 figcaption{margin-top:6px;font-size:12px;color:#444}
 .why{color:#c0392b;font-weight:600}
 code{font-size:11px;color:#888}
</style>
<h1>Персонаж вместо обложки — разведка</h1>
<p>Слева исходная обложка, справа результат на бумажном фоне (сам файл прозрачный).
Красной рамкой отмечено «на проверку» — это не ошибка, а просьба посмотреть.</p>
${section('НА ПРОВЕРКУ', rows.filter((r) => r.status === 'check'))}
${section('Чисто', rows.filter((r) => r.status === 'ok'))}
${section('Не по шаблону — не трогаем', rows.filter((r) => r.status === 'skip'))}
`;
}

async function scout(covers) {
	await rm(SCOUT_DIR, { recursive: true, force: true });
	await mkdir(path.join(SCOUT_DIR, 'было'), { recursive: true });
	await mkdir(path.join(SCOUT_DIR, 'стало'), { recursive: true });

	const rows = [];
	for (const [index, cover] of covers.entries()) {
		const result = await processCover(cover);
		rows.push({ ...cover, ...result });

		if (result.canvas) {
			await writeFile(path.join(SCOUT_DIR, 'стало', `${cover.id}.png`), result.canvas);
		}
		const src = sourcePath(cover);
		if (existsSync(src)) {
			await sharp(src).resize(400, 400, { fit: 'contain', background: '#F8F6F0' })
				.jpeg({ quality: 80 }).toFile(path.join(SCOUT_DIR, 'было', `${cover.id}.jpg`));
		}

		const mark = { ok: 'чисто', check: 'НА ПРОВЕРКУ', skip: 'не шаблон' }[result.status];
		console.log(`[${index + 1}/${covers.length}] ${cover.id.slice(0, 8)} — ${mark}${result.reasons.length ? ': ' + result.reasons.join('; ') : ''}`);
	}

	await writeFile(path.join(SCOUT_DIR, 'отчёт.html'), reportPage(rows), 'utf8');
	return rows;
}

/** Отчёт таблицей: сколько всего, сколько чисто, сколько на проверку и почему. */
function printReport(rows) {
	const ok = rows.filter((r) => r.status === 'ok');
	const check = rows.filter((r) => r.status === 'check');
	const skip = rows.filter((r) => r.status === 'skip');

	console.log('\n' + '─'.repeat(70));
	console.log('| Итог                                   | Обложек |');
	console.log('|----------------------------------------|---------|');
	console.log(`| Всего в работе                         | ${String(rows.length).padStart(7)} |`);
	console.log(`| Чисто                                  | ${String(ok.length).padStart(7)} |`);
	console.log(`| На проверку                            | ${String(check.length).padStart(7)} |`);
	console.log(`| Не по шаблону, не трогаем              | ${String(skip.length).padStart(7)} |`);

	const byReason = new Map();
	for (const r of [...check, ...skip]) {
		for (const reason of r.reasons) {
			const key = reason.replace(/\d+([.,]\d+)?/g, 'N');
			byReason.set(key, (byReason.get(key) ?? 0) + 1);
		}
	}
	console.log('\n| Причина отметки                                    | Обложек |');
	console.log('|----------------------------------------------------|---------|');
	for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
		console.log(`| ${reason.padEnd(50).slice(0, 50)} | ${String(count).padStart(7)} |`);
	}

	const done = rows.filter((r) => r.scale);
	const scales = done.map((r) => r.scale).sort((a, b) => a - b);
	const crossed = done.filter((r) => r.crossings > 0);
	const capped = done.filter((r) => r.scale >= MAX_SCALE - 1e-9);
	const gaps = done.map((r) => r.gap).filter((g) => Number.isFinite(g)).sort((a, b) => a - b);

	console.log('\n| Замер                                              | Значение |');
	console.log('|----------------------------------------------------|----------|');
	console.log(`| Фигура вылезала за рамку                           | ${String(crossed.length).padStart(8)} |`);
	console.log(`| Масштаб упёрся в ограничитель ${MAX_SCALE}×               | ${String(capped.length).padStart(8)} |`);
	if (scales.length) {
		console.log(`| Коэффициент масштаба: самый мелкий                  | ${scales[0].toFixed(2).padStart(8)} |`);
		console.log(`| Коэффициент масштаба: середина                     | ${scales[Math.floor(scales.length / 2)].toFixed(2).padStart(8)} |`);
		console.log(`| Коэффициент масштаба: самый крупный                | ${scales[scales.length - 1].toFixed(2).padStart(8)} |`);
	}
	if (gaps.length) {
		console.log(`| Разрыв первого и второго куска: худший              | ${gaps[0].toFixed(0).padStart(8)} |`);
		console.log(`| Разрыв первого и второго куска: середина            | ${gaps[Math.floor(gaps.length / 2)].toFixed(0).padStart(8)} |`);
		console.log(`| Разрыв первого и второго куска: лучший              | ${gaps[gaps.length - 1].toFixed(0).padStart(8)} |`);
	}

	console.log(`\nСмотреть здесь: ${path.join(SCOUT_DIR, 'отчёт.html')}`);
	console.log('В репозиторий не записано ничего.');
	void OUT_WIDTHS;
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
	const covers = await collectCovers();

	if (process.argv.includes('--fetch')) {
		await fetchOriginals(covers);
		return;
	}

	const only = process.argv.find((a) => a.startsWith('--only='));
	const list = only ? covers.filter((c) => c.id.startsWith(only.slice('--only='.length))) : covers;

	console.log(`\nРазведка: ${list.length} обложек. Пишу во временную папку ${SCOUT_DIR}.\n`);
	printReport(await scout(list));
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
