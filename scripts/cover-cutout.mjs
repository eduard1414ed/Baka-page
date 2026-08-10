// Персонаж вместо обложки: вырезать фигуру из обложки выпуска (тз/12).
//
//   node scripts/cover-cutout.mjs --fetch     скачать оригиналы во временную папку
//   node scripts/cover-cutout.mjs             РАЗВЕДКА: прогон без записи в репозиторий
//   node scripts/cover-cutout.mjs --write     ЗАПИСЬ: положить готовое в public/cutout/
//
//   node scripts/cover-cutout.mjs --new --write     ТОЛЬКО НОВОЕ — это зовёт робот
//   node scripts/cover-cutout.mjs --seed            завести журнал по уже сделанному
//   node scripts/cover-cutout.mjs --recheck         спросить у Mave, не подменили ли
//   node scripts/cover-cutout.mjs --only=X --write --force   записать вопреки отметке
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
import { createHash } from 'node:crypto';
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

/**
 * Какой доли самого крупного куска хватает, чтобы кусок тоже считался фигурой.
 *
 * Шаг 4 в ТЗ звучит «оставить самый крупный связный кусок», и написан он ради
 * того, чтобы отвалились надпись «БАКА!», кана и вертикальная подпись. С этим
 * он справляется, но заодно выбрасывает ВТОРУЮ ФИГУРУ, если в кадре двое:
 * у обложки 1e0dd09a девушка весит 70 % от парня и пропадала целиком.
 *
 * Порог из замера по архиву: у двух обложек с двумя фигурами второй кусок
 * это 70 % и 59 % от первого, у всех остальных 111 — 9 % и меньше (следующий
 * по величине разрыв 11-кратный). Четверть попадает ровно в эту пропасть.
 *
 * Вторым условием кусок обязан лежать ВНУТРИ рамки: настоящее отличие
 * персонажа от подписи не в размере, а в этом. Надпись и кана стоят выше
 * рамки целиком.
 */
const MIN_SECOND_PIECE = 0.25;

/** Допустимая доля площади фигуры от площади внутри рамки. */
const MIN_AREA = 0.05;
const MAX_AREA = 0.70;

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

/**
 * Насколько яркость светлого куска внутри рамки может отличаться от бумаги,
 * чтобы он считался фоном, а не нутром фигуры.
 *
 * Признак «сколько кусок касается кромки» не годится вовсе: замер по архиву
 * дал сплошную ленту от 5 до 25 % без единого разрыва, и карманы фона были
 * там вперемешку с одеждой. Годится другой: внутренний фон — это БУКВАЛЬНО
 * та же бумага, а всё нарисованное от неё отличается.
 *
 * Замер по 597 кускам: у кусков, содержащих угол рамки (то есть заведомо
 * фона), отличие от эталона 0 или 1 в 154 случаях из 160. У остальных либо
 * тоже 0–1 (это карманы фона, 60 кусков), либо сразу 10–12 — белая одежда,
 * нарисованная чистым 255 при бумаге 244.
 *
 * НО ОДНОЙ ЯРКОСТИ МАЛО: кусок обязан ещё и КАСАТЬСЯ КРОМКИ рамки. Кожа лица
 * нарисована ровно цветом бумаги, и правило по одной яркости выбрасывало её —
 * а вместе с ней осиротели глаза и рот: они становились отдельными кусочками,
 * оторванными от фигуры, и отваливались как мусор. У Наруто в очках от лица
 * не осталось ничего. Фон обязан быть связан с краем; что заперто внутри
 * фигуры, фоном быть не может.
 */
const PAPER_TOLERANCE = 2;

// ── служебное ───────────────────────────────────────────────────────────────

/** Ширины готовых файлов. Два размера, не больше — правило проекта. */
const OUT_WIDTHS = [640, 1200];

/**
 * Качество webp. Формат вместо PNG из ТЗ — решение заказчика 10 августа 2026.
 *
 * Замер: PNG на 1200 px весит 313 КБ, на весь архив в двух размерах 46 МБ;
 * webp — 58 и 29 КБ, на архив 12 МБ. Прозрачность webp держит, и сайт уже
 * отдаёт webp везде. Качество 82 от PNG на пятикратном увеличении контура
 * не отличается, 95 стоит ещё 40 % веса ни за что.
 */
const WEBP_QUALITY = 82;

// Обе папки — во временной, а не в проекте: в гит из этой работы попадает
// только сам скрипт. Путь простой и одинаковый на всех запусках, чтобы
// заказчику было куда заглянуть, — os.tmpdir() на маке прячется в /var/folders
// с нечитаемым именем.

/**
 * Обложки, которые НЕ применяем, даже если скрипт их обработал.
 *
 * `3a8d5148` — контур персонажа нарисован цветом (зелёным и жёлтым по белому),
 * в серой копии он от бумаги неотличим, и заливка проходит сквозь него как
 * сквозь пустоту. Вырезать эту обложку описанным способом нельзя в принципе;
 * выпуск остаётся с обычной обложкой. Решение заказчика 10 августа 2026.
 */
const EXCLUDE = ['3a8d5148'];

/** Куда кладём скачанные оригиналы. Вне репозитория. */
const CACHE_DIR = '/tmp/baka-covers';

/** Куда кладёт результаты разведка. Тоже вне репозитория. */
const SCOUT_DIR = '/tmp/baka-cutout';

const ROOT = new URL('../', import.meta.url);
const POSTS_DIR = new URL('src/content/posts/', ROOT);
const UPLOADS_DIR = new URL('public/images/uploads/', ROOT);
const CUTOUT_DIR = new URL('public/cutout/', ROOT);
const CUTOUT_MANIFEST = new URL('src/data/coverCutouts.mjs', ROOT);
const CUTOUT_LOG = new URL('src/data/coverCutoutLog.mjs', ROOT);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} КБ`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

// ────────────────────────────────────────────────────────────────────────────
// ЖУРНАЛ ОБРАБОТКИ (src/data/coverCutoutLog.mjs)
// ────────────────────────────────────────────────────────────────────────────
//
// Зачем он нужен. Робот ходит каждое утро, и ему надо отвечать на два вопроса:
// «эту обложку я уже видел?» и «архив трогать нельзя». Ответ по НАЛИЧИЮ ФАЙЛА
// в public/cutout/ на оба вопроса врёт:
//
//   1. У обложки, которую вырезать не удалось, файла нет — и робот брался бы
//      за неё каждое утро заново, каждое утро с тем же результатом и с новой
//      строчкой в письме.
//   2. Вы чините плохо вырезанного персонажа УДАЛЕНИЕМ ФАЙЛА (так задумано,
//      см. src/lib/coverCutout.mjs). Робот, считающий по файлам, вернул бы его
//      на место следующим же утром.
//
// Поэтому в журнале лежит ОТПЕЧАТОК ИСХОДНОЙ картинки: короткая сумма от её
// байтов. Совпал — трогать нечего, что бы ни лежало в папке. Не совпал —
// картинку подменили, и вот тогда надо вырезать заново.
//
// Статусы по-русски нарочно: этот файл читают глазами, когда спрашивают
// «а почему у этого выпуска обычная обложка».

/** Отпечаток исходной картинки. Шестнадцати знаков хватает: их 18 миллиардов миллиардов. */
function fingerprint(buffer) {
	return createHash('sha256').update(buffer).digest('hex').slice(0, 16);
}

/** Журнал с диска. Нет файла — пустой журнал, это законное состояние. */
async function readLog() {
	if (!existsSync(fileURLToPath(CUTOUT_LOG))) return {};
	const module = await import(`${CUTOUT_LOG.href}?v=${Date.now()}`);
	return { ...module.default };
}

async function writeLog(log) {
	const ids = Object.keys(log).sort();
	const line = (id) => {
		const entry = log[id];
		const parts = [`status: ${JSON.stringify(entry.status)}`, `hash: ${JSON.stringify(entry.hash)}`];
		if (entry.why) parts.push(`why: ${JSON.stringify(entry.why)}`);
		return `\t${JSON.stringify(id)}: { ${parts.join(', ')} },`;
	};

	await writeFile(fileURLToPath(CUTOUT_LOG), [
		'// Журнал обработки обложек — что робот уже видел и чем это кончилось.',
		'// Ключ тот же, что у обложки: у выпусков — id картинки с хостинга подкаста,',
		'// у загруженных руками — имя файла без расширения.',
		'//',
		'// hash — отпечаток ИСХОДНОЙ картинки. Совпал с тем, что лежит у хостинга, —',
		'// значит обложка та же самая и делать нечего. Не совпал — картинку подменили,',
		'// и её надо вырезать заново.',
		'//',
		'// Файл пишет scripts/cover-cutout.mjs, руками не править. Зачем он вообще',
		'// нужен — объяснение в самом скрипте, раздел «ЖУРНАЛ ОБРАБОТКИ».',
		'export default {',
		...ids.map(line),
		'};',
		'',
	].join('\n'), 'utf8');

	return ids.length;
}

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

	// RSS может не ответить — сеть, чужой сервер, что угодно. Тогда прогон
	// молча делал бы три обложки из ста сорока одной и печатал бодрый отчёт:
	// ложь ровно в сторону «всё хорошо». Берём список из кэша скачанного
	// и говорим об этом громко.
	if (fromFeed === 0) {
		// Сказать надо ВСЕГДА, а не только когда есть чем подменить: у робота
		// временной папки нет вовсе, и без этой строчки прогон, не увидевший
		// ни одного выпуска, выглядел бы точно так же, как прогон, которому
		// нечего было делать.
		console.log('ВНИМАНИЕ: RSS не ответил — обложек выпусков в этом прогоне не будет.');
	}

	if (fromFeed === 0 && existsSync(CACHE_DIR)) {
		const cached = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.jpg'));
		for (const file of cached) {
			const id = file.slice(0, -4);
			if (found.has(id)) continue;
			found.set(id, { id, kind: 'episode', src: path.join(CACHE_DIR, file), title: id });
		}
		console.log(`Беру ${cached.length} обложек из кэша ${CACHE_DIR}.`);
		console.log('Новых выпусков, появившихся после последнего --fetch, в этом прогоне нет.');
	}

	const all = [...found.values()];
	const episodes = all.filter((c) => c.kind === 'episode').length;
	console.log(`Обложек выпусков: ${episodes}. Загруженных руками (бонусы и прочее): ${all.length - episodes}.`);
	if (all.length === 0) throw new Error('Обложек не нашлось ни в RSS, ни в кэше — делать нечего.');
	return all;
}

/** Путь к оригиналу: у выпусков — в кэше, у загруженных руками — прямо в проекте. */
function sourcePath(cover) {
	return cover.kind === 'episode' ? path.join(CACHE_DIR, `${cover.id}.jpg`) : cover.src;
}

/**
 * Байты исходной обложки — из кэша, а если её там нет, скачать с хостинга.
 *
 * Оригинал в репозиторий не кладём никогда (CLAUDE.md): временная папка живёт
 * вне проекта, а у робота она и вовсе умирает вместе с прогоном.
 *
 * @param {boolean} refetch Спросить хостинг заново, даже если в кэше лежит.
 *        Нужно одному режиму — `--recheck`: он и существует ради того, чтобы
 *        узнать, не подменили ли картинку по прежнему адресу.
 */
async function loadSource(cover, { refetch = false } = {}) {
	const cached = sourcePath(cover);

	if (cover.kind === 'upload') return readFile(cached);
	if (!refetch && existsSync(cached)) return readFile(cached);

	// Когда RSS не ответил, collectCovers подставляет путь в кэш вместо адреса —
	// качать в этом случае нечего и незачем.
	if (!cover.src.startsWith('http')) return readFile(cover.src);

	const response = await fetch(cover.src);
	if (!response.ok) throw new Error(`хостинг ответил ${response.status}`);
	const buffer = Buffer.from(await response.arrayBuffer());

	await mkdir(CACHE_DIR, { recursive: true });
	await writeFile(cached, buffer);
	return buffer;
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
 * Убрать рамку из маски полосой ±ERASE, но только там, где по обе стороны
 * от неё фон.
 *
 * Полосой, а не линией: у линии есть серый ореол сглаживания, он не чёрный
 * и не фон. Уберёшь только линию — ореол останется тонким кольцом и попадёт
 * в фигуру ободком.
 *
 * Где персонаж пересекает рамку — не трогаем: разрыв отрезал бы всё, что
 * вылезло наружу (замер по архиву: заметно вылезает 98 фигур из 112).
 *
 * ЭТОТ ШАГ ИДЁТ ПОСЛЕ ЗАЛИВКИ, а не до неё, как написано в ТЗ. Порядок из ТЗ
 * съедал белую одежду: фигура обрезана рамкой снизу, то есть контур у неё
 * внизу разомкнут, и по стёртой рамке заливка входила внутрь фигуры. Белая
 * рубашка от фона по яркости не отличается вовсе (фон 248, рубашка 250–255),
 * поэтому разливалась по ней целиком — на красной подложке сквозь одежду
 * было видно подложку. При целой рамке входить некуда.
 *
 * @returns {{erased:number, kept:number}} сколько позиций стёрли и сколько
 *          оставили. «Оставили» = там персонаж пересекает рамку — и это число
 *          считается ТОЛЬКО вне углов: в углу проба всегда упирается
 *          в перпендикулярную линию, и без этой оговорки счётчик отвечал бы
 *          «фигура вылезала за рамку» про все 112 обложек подряд.
 */
function eraseFrame(grey, bgMask, W, H, frame, bg) {
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
			for (let y = Math.max(0, c - ERASE); y <= Math.min(H - 1, c + ERASE); y += 1) bgMask[y * W + x] = 1;
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
			for (let x = Math.max(0, c - ERASE); x <= Math.min(W - 1, c + ERASE); x += 1) bgMask[row + x] = 1;
			erased += 1;
		}
	}

	return { erased, kept };
}

// ────────────────────────────────────────────────────────────────────────────
// ШАГ 3. ЗАЛИТЬ ФОН ОТ КРАЁВ
// ────────────────────────────────────────────────────────────────────────────

/**
 * Разлив фона от краёв картинки и от фона ВНУТРИ рамки.
 *
 * Именно разливом, а не «все светлые пиксели прозрачные»: иначе пропали бы
 * белая рубашка, светлые чулки и блики — всё, что светлое, но заперто внутри
 * контура.
 *
 * Рамка на этом шаге ЦЕЛАЯ, поэтому от краёв картинки внутрь заливка не
 * попадает — её пускают отдельным засевом по кольцу сразу внутри рамки.
 * Кольцом, а не одной точкой: фигура делит внутренний фон на несколько кусков
 * (обычно над плечами и под руками), и каждый надо засеять своим семенем.
 *
 * @returns {Uint8Array} 1 — фон, 0 — не фон.
 */
function floodBackground(grey, W, H, bg, frame) {
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

	// Фон ВНУТРИ рамки. Просто засеять его по кромке нельзя: персонаж обрезан
	// рамкой, его светлая одежда выходит на ту же кромку не отделённая ничем,
	// и семя оказывается ВНУТРИ фигуры. Ровно это и съедало белые блузки.
	//
	// Отличаем ЯРКОСТЬЮ: внутренний фон — та же бумага, что снаружи, а всё
	// нарисованное от неё отличается. Эталон бумаги берём не снаружи рамки
	// (у части обложек внутри она светлее), а из куска, который содержит УГОЛ
	// рамки: угол — заведомо фон, персонаж туда не достаёт.
	//
	// Отступ РОВНО в полосу стирания, ни пикселем больше. Зазор между полосой
	// и этой областью остался бы кольцом чистого фона, не помеченным ни одним
	// из двух шагов: оно прилипает к фигуре там, где та выходит за рамку,
	// и вокруг персонажа появляется тонкий прямоугольник. Домыть его заливкой
	// нельзя — она тут же утечёт в фигуру через ту же стёртую полосу.
	// Ореол сглаживания линии шириной ровно в пиксель (замер: 159 при фоне 245,
	// следующий пиксель уже 236), полоса ±6 перекрывает его с запасом.
	const inset = ERASE;
	const x0 = Math.round(frame.left) + inset;
	const x1 = Math.round(frame.right) - inset;
	const y0 = Math.round(frame.top) + inset;
	const y1 = Math.round(frame.bottom) - inset;

	const labels = new Int32Array(W * H).fill(-1);
	const pieces = [];
	const bins = new Int32Array(256);

	for (let sy = y0; sy <= y1; sy += 1) {
		for (let sx = x0; sx <= x1; sx += 1) {
			const seed = sy * W + sx;
			if (labels[seed] !== -1 || !isBg(grey[seed])) continue;

			labels[seed] = seed;
			stack[top++] = seed;
			let size = 0;
			let corner = false;
			let touch = 0;
			bins.fill(0);

			while (top > 0) {
				const index = stack[--top];
				const x = index % W;
				const y = (index - x) / W;
				size += 1;
				bins[grey[index]] += 1;
				if (y === y0 || y === y1 || x === x0 || x === x1) touch += 1;
				if ((y === y0 || y === y1) && (x === x0 || x === x1)) corner = true;

				const step = (nx, ny) => {
					if (nx < x0 || nx > x1 || ny < y0 || ny > y1) return;
					const next = ny * W + nx;
					if (labels[next] !== -1 || !isBg(grey[next])) return;
					labels[next] = seed;
					stack[top++] = next;
				};
				step(x - 1, y); step(x + 1, y); step(x, y - 1); step(x, y + 1);
			}

			let seen = 0;
			let median = 0;
			for (let v = 0; v < 256; v += 1) { seen += bins[v]; if (seen >= size / 2) { median = v; break; } }
			pieces.push({ label: seed, size, corner, touch, median });
		}
	}

	// Эталон бумаги — самый крупный кусок с углом. Такой есть у всех обложек
	// архива (замер: обложек без единого светлого угла — ноль), но если
	// когда-нибудь не окажется, берём самый крупный кусок вообще: он и будет
	// фоном с наибольшей вероятностью.
	const anchor = pieces.filter((p) => p.corner).sort((a, b) => b.size - a.size)[0]
		?? pieces.slice().sort((a, b) => b.size - a.size)[0];
	if (!anchor) return mask;

	const isPaper = new Set(pieces.filter((p) => p.corner).map((p) => p.label));
	for (let index = 0; index < W * H; index += 1) {
		if (labels[index] !== -1 && isPaper.has(labels[index])) mask[index] = 1;
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
 * Оставляем не один кусок, а самый крупный ПЛЮС всё, что не мельче четверти
 * от него и лежит внутри рамки: иначе из кадра с двумя людьми уезжает один.
 * Почему именно так — в комментарии к MIN_SECOND_PIECE.
 *
 * @returns {{best:Uint8Array, box:{x0,y0,x1,y1}, first:number, second:number,
 *            kept:number}}
 */
function largestPiece(bgMask, W, H, frame) {
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

	/** Какая доля прямоугольника куска попала внутрь рамки. */
	const insideShare = (box) => {
		const w = Math.max(0, Math.min(box.x1, frame.right) - Math.max(box.x0, frame.left));
		const h = Math.max(0, Math.min(box.y1, frame.bottom) - Math.max(box.y0, frame.top));
		const area = (box.x1 - box.x0) * (box.y1 - box.y0);
		return area > 0 ? (w * h) / area : 0;
	};

	const winners = new Set([winner]);
	for (const [index, size] of order.slice(1)) {
		if (size < first * MIN_SECOND_PIECE) break; // список отсортирован, дальше только мельче
		if (insideShare(boxes[index]) > 0.5) winners.add(index);
	}

	const figures = winners.size;

	const best = new Uint8Array(W * H);
	const box = { x0: W, y0: H, x1: 0, y1: 0 };
	for (let i = 0; i < W * H; i += 1) {
		if (!winners.has(labels[i])) continue;
		best[i] = 1;
	}
	for (const index of winners) {
		box.x0 = Math.min(box.x0, boxes[index].x0);
		box.y0 = Math.min(box.y0, boxes[index].y0);
		box.x1 = Math.max(box.x1, boxes[index].x1);
		box.y1 = Math.max(box.y1, boxes[index].y1);
	}

	return { best, box, first, second, figures };
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
async function processCover(cover, source) {
	// Работаем по БАЙТАМ, а не по пути к файлу: у робота оригинала на диске нет
	// вовсе, он скачивает его в память и тут же забывает.
	const file = source ?? (existsSync(sourcePath(cover)) ? await readFile(sourcePath(cover)) : null);
	if (!file) return { status: 'skip', reasons: ['оригинал не скачан'] };

	const { data: grey, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
	const W = info.width;
	const H = info.height;

	if (W !== H) return { status: 'skip', reasons: [`не квадрат (${W}×${H})`] };

	const frame = findFrame(grey, W, H);
	if (!frame) return { status: 'skip', reasons: ['рамка не найдена — обложка не по шаблону'], W, H };

	const bg = backgroundLevel(grey, W, H);
	// Порядок: СНАЧАЛА заливка при целой рамке, ПОТОМ уборка рамки из маски.
	// Почему не наоборот, как в ТЗ, — в комментарии к eraseFrame.
	const bgMask = floodBackground(grey, W, H, bg, frame);
	const { erased, kept } = eraseFrame(grey, bgMask, W, H, frame, bg);
	const piece = largestPiece(bgMask, W, H, frame);
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
	if (gap < MIN_GAP) {
		reasons.push(piece.figures > 1
			? `в кадре ${piece.figures} фигуры, оставлены обе — посмотрите`
			: `разрыв кусков ${gap.toFixed(1)}× (норма от ${MIN_GAP})`);
	}
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
			${r.canvas ? `<img src="стало/${r.id}.webp" alt="">` : '<p class="none">не трогаем</p>'}
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

async function scout(covers, { refetch = false } = {}) {
	await rm(SCOUT_DIR, { recursive: true, force: true });
	await mkdir(path.join(SCOUT_DIR, 'было'), { recursive: true });
	await mkdir(path.join(SCOUT_DIR, 'стало'), { recursive: true });

	const rows = [];
	for (const [index, cover] of covers.entries()) {
		// Оригинал берём в память — и разведка по обложке, которой ещё нет
		// в кэше, работает так же, как по архивной. Это нужно ровно для того,
		// чтобы можно было посмотреть НОВЫЙ выпуск, ничего не записывая.
		let source = null;
		let trouble = null;
		try {
			source = await loadSource(cover, { refetch });
		} catch (error) {
			trouble = `не смог получить оригинал: ${error.message}`;
		}

		const result = source
			? await processCover(cover, source)
			: { status: 'skip', reasons: [trouble] };
		rows.push({ ...cover, ...result });

		if (result.canvas) {
			// Пишем ровно тем форматом, каким поедет на сайт: смотреть надо
			// на то, что будет, а не на его PNG-двойника.
			await sharp(result.canvas).webp({ quality: WEBP_QUALITY })
				.toFile(path.join(SCOUT_DIR, 'стало', `${cover.id}.webp`));
		}
		if (source) {
			await sharp(source).resize(400, 400, { fit: 'contain', background: '#F8F6F0' })
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
// ЗАПИСЬ
// ────────────────────────────────────────────────────────────────────────────

const isExcluded = (id) => EXCLUDE.includes(id) || EXCLUDE.some((prefix) => id.startsWith(prefix));

/**
 * Положить готовые картинки в public/cutout/, переписать список и журнал.
 *
 * Список — отдельным js-файлом по тому же приёму, что у обложек выпусков:
 * этот модуль читает и сборщик Astro, и обычный node, а проверка файла
 * на диске из сборки молча отвечает «нет» (см. src/lib/episodeCover.mjs).
 *
 * Идёт ОТДЕЛЬНЫМ ключом и отдельным запуском — то же правило, что у разбора
 * таймкодов: сначала посмотреть глазами, потом записывать.
 *
 * @param {object} options
 * @param {boolean} options.strict  Записывать ТОЛЬКО «чисто». Так ходит робот:
 *        глаз у него нет, а отметка «на проверку» — это просьба посмотреть,
 *        и посмотреть некому. Сомнительный результат хуже обычной обложки
 *        (тз/12): персонаж с куском подписи или дырой в контуре останется
 *        на сайте навсегда, потому что заметить его будет некому.
 * @param {boolean} options.force   Записать вопреки отметке «на проверку».
 *        Это ручная починка: посмотрели глазами, решили, что годится.
 * @param {boolean} options.refetch Спросить хостинг заново, минуя кэш.
 * @param {boolean} options.respectLog Пропускать то, чей отпечаток уже
 *        в журнале. Включено у робота, выключено у ручного прогона: сказали
 *        «обработай эту» — значит обработай, а не рассуждай.
 */
async function write(covers, { strict = false, force = false, refetch = false, respectLog = false } = {}) {
	await mkdir(fileURLToPath(CUTOUT_DIR), { recursive: true });

	const log = await readLog();
	const done = [];
	/** Не применённое — из этого собирается письмо. */
	const left = [];
	let skipped = 0;
	let unchanged = 0;
	let bytes = 0;

	for (const [index, cover] of covers.entries()) {
		const head = `[${index + 1}/${covers.length}] ${cover.id.slice(0, 8)}`;

		if (isExcluded(cover.id)) {
			console.log(`${head} — в списке исключений, пропускаю`);
			// Отпечаток исключённой обложки не нужен и её саму качать незачем:
			// решение «эту не трогаем» принято вами и от картинки не зависит.
			log[cover.id] = { status: 'исключён вручную', hash: '' };
			skipped += 1;
			continue;
		}

		let source;
		try {
			source = await loadSource(cover, { refetch });
		} catch (error) {
			// Сеть отвалилась — В ЖУРНАЛ НЕ ПИШЕМ. Иначе одна неудачная минута
			// навсегда убедила бы робота, что эту обложку он уже разбирал:
			// назавтра он бы её не тронул, и выпуск молча остался бы с рамкой.
			// Не смогла — пропустила, не сломала.
			console.error(`${head} — не смог получить оригинал: ${error.message}`);
			left.push({ cover, kind: 'error', why: `не смог получить оригинал: ${error.message}` });
			skipped += 1;
			continue;
		}

		const hash = fingerprint(source);
		const before = log[cover.id];
		if (respectLog && before && before.hash === hash) {
			unchanged += 1;
			continue;
		}

		const result = await processCover(cover, source);

		// Что попадает на сайт. Отметка «на проверку» проходит только там, где
		// есть кому проверить: у ручного прогона (по умолчанию) или по прямому
		// требованию --force.
		const applied = Boolean(result.canvas) && (result.status === 'ok' || force || !strict);

		if (!applied) {
			const why = result.reasons.join('; ') || 'вырезать не удалось';
			log[cover.id] = {
				status: result.status === 'check' ? 'на проверку' : 'не по шаблону',
				hash,
				why,
			};
			left.push({ cover, kind: result.status === 'check' ? 'check' : 'skip', why });
			console.log(`${head} — НЕ ПРИМЕНЕНО: ${why}`);
			skipped += 1;
			continue;
		}

		for (const width of OUT_WIDTHS) {
			const info = await sharp(result.canvas)
				.resize({ width, withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toFile(fileURLToPath(new URL(`${encodeURIComponent(cover.id)}-${width}w.webp`, CUTOUT_DIR)));
			bytes += info.size;
		}

		log[cover.id] = { status: 'готов', hash };
		if (result.status === 'check') log[cover.id].why = `записан вопреки отметке: ${result.reasons.join('; ')}`;
		done.push(cover.id);
		console.log(`${head} — записан${result.status === 'check' ? ' (вопреки отметке «на проверку»)' : ''}`);
	}

	// Список пишем по НАСТОЯЩЕМУ содержимому папки, а не по итогу прогона:
	// иначе он отстанет от диска, если файлы приехали из чужого коммита.
	const files = await readdir(fileURLToPath(CUTOUT_DIR));
	const seen = new Map();
	for (const file of files) {
		const match = file.match(/^(.+)-(\d+)w\.webp$/);
		if (!match) continue;
		const id = decodeURIComponent(match[1]);
		if (!seen.has(id)) seen.set(id, new Set());
		seen.get(id).add(Number(match[2]));
	}
	const complete = [...seen.entries()]
		.filter(([, widths]) => OUT_WIDTHS.every((w) => widths.has(w)))
		.map(([id]) => id)
		.sort();

	await writeFile(fileURLToPath(CUTOUT_MANIFEST), [
		'// Список вырезанных персонажей в public/cutout/ — по тому же ключу,',
		'// что и обложка: у выпусков это id картинки с хостинга подкаста,',
		'// у загруженных руками — имя файла без расширения.',
		'// Файл создаётся скриптом scripts/cover-cutout.mjs --write, руками не править.',
		'// Зачем он нужен и почему это js, а не json — src/lib/coverCutout.mjs.',
		'export default [',
		...complete.map((id) => `\t${JSON.stringify(id)},`),
		'];',
		'',
	].join('\n'), 'utf8');

	const inLog = await writeLog(log);

	console.log(`\nЗаписано: ${done.length}. Пропущено: ${skipped}. Уже было, отпечаток тот же: ${unchanged}.`);
	console.log(`В списке для сайта: ${complete.length}. В журнале обработки: ${inLog}.`);
	console.log(`Файлов в public/cutout/: ${complete.length * OUT_WIDTHS.length}, вес нового ${mb(bytes)}.`);

	return { done, left, unchanged };
}

// ────────────────────────────────────────────────────────────────────────────
// ПИСЬМО ЗАКАЗЧИКУ И ЗАВЕДЕНИЕ ЖУРНАЛА
// ────────────────────────────────────────────────────────────────────────────

/**
 * Текст для задачи на GitHub — она же письмо на почту.
 *
 * Пишется ТОЛЬКО когда что-то не применено. Робот работает, когда заказчика
 * нет, и всё, что он делает молча, замечается через недели: тихо подставить
 * исходную обложку и промолчать нельзя (тз/12). Удачная вырезка, наоборот,
 * молчит — её видно на сайте, и письмо о ней было бы шумом.
 *
 * Формат тот же, что у расшифровки (scripts/transcribe/auto.py): первая
 * строка — заголовок задачи, дальше через пустую строку тело.
 *
 * @returns {Promise<boolean>} было ли о чём писать
 */
async function writeNotice(file, left) {
	if (left.length === 0) return false;

	const title = left.length === 1
		? `Обложка не обработана: ${left[0].cover.title}`
		: `Обложек не обработано: ${left.length}`;

	const lines = [];
	for (const { cover, kind, why } of left) {
		lines.push(`### 🖼 ${cover.title}`);
		lines.push('');
		lines.push(`- **На сайте осталась обычная обложка** — с рамкой и надписью. Это не поломка, а запасной путь: лучше обложка как есть, чем персонаж с куском подписи или дырой в контуре.`);
		lines.push(`- Причина: ${why}`);
		lines.push(`- Ключ обложки: \`${cover.id}\``);

		if (kind === 'check') {
			lines.push('- Вырезать **получилось**, но результат сомнительный, и посмотреть было некому.');
			lines.push('  Посмотреть и, если годится, применить:');
			lines.push('');
			lines.push('  ```');
			lines.push(`  node scripts/cover-cutout.mjs --only=${cover.id}`);
			lines.push(`  node scripts/cover-cutout.mjs --only=${cover.id} --write --force`);
			lines.push('  ```');
			lines.push('');
			lines.push('  Первая команда только покажет («было — стало»), вторая применит.');
		} else if (kind === 'skip') {
			lines.push('- Эта обложка нарисована **не по шаблону «БАКА!»** — вырезать из неё нечего, и так и задумано. Делать ничего не нужно.');
		} else {
			lines.push('- Это сбой связи, а не обложки. Робот попробует ещё раз сам, завтра утром.');
		}
		lines.push('');
	}

	await writeFile(file, `${title}\n\n${lines.join('\n')}`, 'utf8');
	console.log(`\nТекст письма записан: ${file} (${left.length} шт.).`);
	return true;
}

/**
 * Завести журнал по тому, что уже сделано, — разово.
 *
 * Без этого шага робот в первое же утро счёл бы новым ВЕСЬ АРХИВ и полез бы
 * перегонять 141 обложку, чего делать нельзя. Ничего не записывает в
 * public/cutout/ и алгоритм ради статуса гоняет вхолостую: у того, что уже
 * применено на сайте, статус берётся с сайта, а причина считается только
 * для непринятого — чтобы в журнале стояло, ПОЧЕМУ у выпуска обычная обложка.
 */
async function seedLog(covers) {
	const applied = new Set((await import(CUTOUT_MANIFEST.href)).default);
	const log = {};
	let missing = 0;

	console.log(`\nЗавожу журнал по ${covers.length} обложкам. В репозиторий из картинок не записывается ничего.\n`);

	for (const [index, cover] of covers.entries()) {
		const head = `[${index + 1}/${covers.length}] ${cover.id.slice(0, 8)}`;

		if (isExcluded(cover.id)) {
			log[cover.id] = { status: 'исключён вручную', hash: '' };
			console.log(`${head} — исключён вручную`);
			continue;
		}

		let source;
		try {
			source = await loadSource(cover);
		} catch (error) {
			console.error(`${head} — оригинала нет: ${error.message}`);
			missing += 1;
			continue;
		}

		const hash = fingerprint(source);

		if (applied.has(cover.id)) {
			log[cover.id] = { status: 'готов', hash };
			console.log(`${head} — готов`);
			continue;
		}

		const result = await processCover(cover, source);
		const why = result.reasons.join('; ') || 'вырезать не удалось';
		log[cover.id] = { status: result.status === 'check' ? 'на проверку' : 'не по шаблону', hash, why };
		console.log(`${head} — не применён: ${why}`);
	}

	const total = await writeLog(log);
	console.log(`\nВ журнале ${total} обложек. Оригинал не нашёлся у ${missing}.`);
	console.log('Всё, что в журнале, робот трогать не будет.');
}

// ────────────────────────────────────────────────────────────────────────────

async function main() {
	const covers = await collectCovers();

	if (process.argv.includes('--fetch')) {
		await fetchOriginals(covers);
		return;
	}

	if (process.argv.includes('--seed')) {
		await seedLog(covers);
		return;
	}

	const only = process.argv.find((a) => a.startsWith('--only='));
	const notify = process.argv.find((a) => a.startsWith('--notify='));
	const onlyNew = process.argv.includes('--new');
	const recheck = process.argv.includes('--recheck');
	const force = process.argv.includes('--force');

	let list = only ? covers.filter((c) => c.id.startsWith(only.slice('--only='.length))) : covers;

	if (onlyNew) {
		const log = await readLog();
		// ЧТО СЧИТАЕТСЯ НОВЫМ.
		//
		// Обложки выпусков — только незнакомые. Перекачивать весь архив каждое
		// утро ради отпечатков и есть «гонять архив заново»: 208 МБ и минуты
		// чужого трафика в день за ответ «ничего не изменилось».
		//
		// Загруженные руками — все до одной. Их исходник лежит у нас на диске,
		// отпечаток стоит миллисекунду, а перезалить картинку под тем же именем
		// в админке можно в любой день — и только по отпечатку это видно.
		list = list.filter((cover) => cover.kind === 'upload' || !log[cover.id]);

		if (list.length === 0) {
			console.log('\nНовых обложек нет — журнал знает про все. Ничего не делаю.');
			return;
		}
		console.log(`\nНовых обложек к разбору: ${list.length}.`);
	}

	if (process.argv.includes('--write')) {
		console.log(`\nЗАПИСЬ: ${list.length} обложек в public/cutout/.\n`);
		const result = await write(list, {
			// Робот записывает только «чисто»: смотреть на отметку «на проверку»
			// у него некому. Ручной прогон по-прежнему пишет и её.
			strict: onlyNew,
			force,
			refetch: recheck,
			respectLog: onlyNew || recheck,
		});
		if (notify) await writeNotice(notify.slice('--notify='.length), result.left);
		return;
	}

	console.log(`\nРазведка: ${list.length} обложек. Пишу во временную папку ${SCOUT_DIR}.\n`);
	printReport(await scout(list, { refetch: recheck }));
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
