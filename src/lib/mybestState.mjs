// ЧТО ВЫБРАНО НА СТРАНИЦЕ «МОИ ДЕВЯТЬ АНИМЕ» И КАК ЭТО ЖИВЁТ В АДРЕСЕ
// (задача 22, тз-22 «Страница»).
//
// Чистые функции: ни окна, ни хранилища, ни сети — их зовёт скрипт страницы,
// а проверяет scripts/mybest.test.mjs обычным запуском в Node. Ссылка на
// девятку — это ровно то, что глазами не проверить: «у друга открылась та же
// девятка» отличается от «почти та же» одной потерянной подписью.
//
// МАРКА — ОДНА ИЗ ЧЕТЫРЁХ ВИДОВ:
//   cat      — тайтл нашего каталога, хранится одним адресом (`id`): название,
//              год и постер берутся из справочника при каждом заходе, поэтому
//              переименованный в админке тайтл переименуется и в старых ссылках;
//   shiki    — Шикимори, `id` — его номер;
//   anilist  — AniList, `id` — его номер;
//   manual   — вписано руками, постера нет.
// У внешних в адрес едут ещё год и название: без них ссылка, открытая
// без связи с чужим сервисом, показала бы пустые марки. Постер в адрес
// не едет — он длинный; его по номерам дозапрашивает страница.
//
// ПОДПИСЬ ПОД МАРКОЙ (`label`) — только если человек правил её руками.
// Пусто — подпись считается из названия (`shortTitle`), и в адрес не едет.

export const SLOTS = 9;
export const DEFAULT_CAPTION = '9 аниме, которые меня сформировали';
/** Предел длины подписей: и под маркой, и над картинкой. */
export const MAX_TEXT = 80;

/** «Шестое аниме», «выбрать шестое аниме». */
export const ORDINALS = ['первое', 'второе', 'третье', 'четвёртое', 'пятое', 'шестое', 'седьмое', 'восьмое', 'девятое'];

const PREFIX = { shiki: 's', anilist: 'a', manual: 'm' };
const BY_PREFIX = { s: 'shiki', a: 'anilist', m: 'manual' };

export function emptyState() {
	return { caption: DEFAULT_CAPTION, slots: Array(SLOTS).fill(null) };
}

function clean(text) {
	return String(text ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_TEXT);
}

/** Одна марка → строка для адреса. */
function encodeItem(item) {
	if (!item) return '';
	if (item.src === 'cat') return item.id;
	if (item.src === 'manual') return `m.${item.title}`;
	return `${PREFIX[item.src]}.${item.id}.${item.year ?? ''}.${item.title}`;
}

/** Строка из адреса → марка. Непонятное — пустая клетка, а не поломка страницы. */
function decodeItem(raw) {
	const text = String(raw ?? '');
	if (!text) return null;
	const dot = text.indexOf('.');
	const src = dot === 1 ? BY_PREFIX[text[0]] : undefined;
	if (!src) return /^[a-z0-9-]+$/.test(text) ? { src: 'cat', id: text } : null;
	if (src === 'manual') {
		const title = clean(text.slice(2));
		return title ? { src, title } : null;
	}
	const [id, year, ...rest] = text.slice(2).split('.');
	const title = clean(rest.join('.'));
	if (!/^\d+$/.test(id) || !title) return null;
	return { src, id, title, ...(/^\d{4}$/.test(year) ? { year: Number(year) } : {}) };
}

/**
 * Состояние → хвост адреса (без «?»). Пустая девятка с подписью
 * по умолчанию даёт пустую строку — адрес остаётся голым `/mybest/`.
 *
 * Параметры: `c` — подпись над картинкой (только если её меняли);
 * `t` — клетки по порядку, пустая клетка — пустое значение, хвост пустых
 * обрезается; `l` — правленые подписи марок, `<номер клетки>.<подпись>`.
 */
export function encodeState(state) {
	const params = new URLSearchParams();
	const caption = clean(state.caption);
	if (caption && caption !== DEFAULT_CAPTION) params.set('c', caption);
	let last = -1;
	state.slots.forEach((item, i) => item && (last = i));
	for (let i = 0; i <= last; i++) params.append('t', encodeItem(state.slots[i]));
	state.slots.forEach((item, i) => {
		const label = clean(item?.label);
		if (label) params.append('l', `${i + 1}.${label}`);
	});
	return params.toString();
}

/** Хвост адреса → состояние; `null`, если девятки в адресе нет вовсе. */
export function decodeState(search) {
	const params = new URLSearchParams(search);
	if (!params.has('t') && !params.has('c')) return null;
	const state = emptyState();
	const caption = clean(params.get('c'));
	if (caption) state.caption = caption;
	params
		.getAll('t')
		.slice(0, SLOTS)
		.forEach((raw, i) => (state.slots[i] = decodeItem(raw)));
	for (const raw of params.getAll('l')) {
		const dot = raw.indexOf('.');
		const at = Number(raw.slice(0, dot)) - 1;
		const label = clean(raw.slice(dot + 1));
		if (dot > 0 && state.slots[at] && label) state.slots[at].label = label;
	}
	return state;
}

/**
 * Состояние из хранилища браузера. Чужое, старое или битое — пустая девятка:
 * ломать страницу из-за того, что лежит в чьём-то браузере, нельзя.
 */
export function readStored(json) {
	try {
		const data = JSON.parse(json);
		if (!data || !Array.isArray(data.slots)) return null;
		const state = emptyState();
		state.caption = clean(data.caption) || DEFAULT_CAPTION;
		data.slots.slice(0, SLOTS).forEach((item, i) => {
			if (item && ['cat', 'shiki', 'anilist', 'manual'].includes(item.src) && (item.id || item.title)) state.slots[i] = item;
		});
		return state;
	} catch {
		return null;
	}
}

/** Тот же тайтл уже стоит в девятке? Ручные сравниваются по названию. */
export function sameItem(a, b) {
	if (!a || !b || a.src !== b.src) return false;
	return a.src === 'manual' ? a.title.toLowerCase() === b.title.toLowerCase() : String(a.id) === String(b.id);
}
