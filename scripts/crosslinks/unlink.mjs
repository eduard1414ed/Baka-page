// ПЕРЕЛИНКОВКА — ДУБЛЬ ССЫЛКИ В АБЗАЦЕ ВСТАВКИ (сессия 3б).
//
// Решение Эда 25.09.2026: если в абзаце, после которого стоит одобренная
// вставка, есть обычная ссылка на ТУ ЖЕ цель — ссылка из текста снимается.
// Ссылки в других абзацах не трогаются. Исключение в CLAUDE.md, пункт 2.
//
// Здесь — единственный дом этого правила. Его зовут:
//   lib.mjs            — места ссылок в каждом блоке поста;
//   review/model.mjs   — какой у дубля вид (страница ревью);
//   review/server.mjs  — «было → станет» и проверка решения перед записью;
//   apply.mjs          — снятие в посте;
//   verify-diff.mjs    — какие ссылки вообще можно было снять.
//
// ВИДЫ ССЫЛОК (замер архива 25.09.2026): все ссылки на свои материалы —
// `[слова](адрес)`. Голых адресов, сносок и HTML-ссылок нет ни одной.
// Адреса: `/posts/…/`, `https://ru.bakapodcast.com/posts/…/`,
// `https://bakapodcast.com/posts/…/`, пост канала `https://t.me/podcastbaka/N`
// и ролик YouTube, встроенный в пост блоком `::video{youtube="…"}` (решение
// Эда 25.09.2026: «спешал из прошлого сезона» на youtu.be — это тот же №74).
// Ролик, встроенный в несколько постов, — ссылка сразу на все их.
// Правило знает и другие виды (голый адрес, `<адрес>`), но снять их, оставив
// слова, нельзя — у них нет слов; для них только свой вариант Эда.
//
// ВИД ДУБЛЯ — что будет с фразой без ссылки:
//   words    — слова ссылки сами что-то называют («в новом видеоэссе»):
//              снимаем разметку, слова остаются. По умолчанию — снять;
//   rephrase — слова ссылки указывают («тут», «по ссылке», «этот пост»):
//              без ссылки фраза ломается. Скрипт сам не трогает, нужен
//              вариант Эда. По умолчанию — оставить;
//   manual   — у ссылки нет слов (голый адрес): только вариант Эда.
// Сомнительное — в rephrase: лишний раз спросить дешевле, чем сломать фразу.

import { toPlainText } from '../../src/lib/plainText.mjs';

export const OWN_POST_RE = /^(?:https?:\/\/(?:www\.)?(?:ru\.)?bakapodcast\.com)?\/posts\/([^/?#]+)\/?(?:[?#].*)?$/u;
export const TG_POST_RE = /^https?:\/\/t\.me\/podcastbaka\/(\d+)\/?(?:\?.*)?$/u;

/**
 * СЛОВА-УКАЗАТЕЛИ. Ссылка, в словах которой есть хоть одно из этого списка,
 * — «нужна переформулировка». Список один, здесь; показан Эду в отчёте 10.
 * Сравнение — по целому слову, без различия регистра, ё = е.
 */
export const POINTER_WORDS = [
	'здесь', 'тут', 'там', 'вот', 'сюда', 'туда',
	'ссылка', 'ссылке', 'ссылку', 'ссылки', 'ссылкой',
	'этот', 'эта', 'это', 'эти', 'этом', 'этой', 'этого', 'этих', 'эту', 'этим', 'этими',
	'тот', 'та', 'то', 'том', 'той', 'того', 'ту',
	'такой', 'таком', 'такого',
	'него', 'нем', 'нём', 'ней', 'нее', 'неё', 'них', 'он', 'она', 'оно', 'они',
	'раз', 'здесь-то', 'тут-то',
];
/** Меньше стольких букв в словах ссылки — «нужна переформулировка» («я», «вот»). */
export const MIN_LETTERS = 4;

const POINTER_SET = new Set(POINTER_WORDS);
const LETTERS = /[a-zа-яё]/giu;
const WORD = /[a-zа-яё0-9-]+/giu;
const norm = (s) => s.toLowerCase().replaceAll('ё', 'е');

/** Номер ролика YouTube из адреса (youtu.be, watch?v=, embed, shorts) или null. */
export const youtubeId = (url) => String(url).match(/^https?:\/\/(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/u)?.[1] ?? null;

/** Ролики, встроенные в тело поста: номера. */
export const embeddedYoutube = (body) => [...String(body).matchAll(/::video\{[^}\n]*youtube="([^"]+)"/gu)].map((m) => youtubeId(m[1])).filter(Boolean);

/** Все цели адреса: [id…] (ролик бывает встроен в несколько постов). */
export function targetsOfUrl(url, tgToId, ytToIds = () => []) {
	const yt = youtubeId(url);
	if (yt) return ytToIds(yt) ?? [];
	const t = targetOfUrl(url, tgToId);
	return t?.target ? [t.target] : [];
}

/** Адрес → цель: { target, tg } или null (чужой адрес; YouTube — см. targetsOfUrl). */
export function targetOfUrl(url, tgToId) {
	const own = String(url).match(OWN_POST_RE);
	if (own) {
		let id = own[1];
		try {
			id = decodeURIComponent(id);
		} catch {
			// Кривая %-запись — берём как есть.
		}
		return { target: id, tg: null };
	}
	const tg = String(url).match(TG_POST_RE);
	if (tg) return { target: tgToId(tg[1]), tg: tg[1] };
	return null;
}

/**
 * Узлы-ссылки блока → ссылки на свои материалы с местом в тексте поста.
 * `start`/`end` — смещения в теле поста; `raw` — точный текст разметки.
 */
export function linksOfNodes(body, nodes, tgToId, ytToIds = () => []) {
	const out = [];
	for (const n of nodes) {
		const yt = youtubeId(n.url);
		const t = yt ? { targets: ytToIds(yt) ?? [], tg: null } : targetOfUrl(n.url, tgToId);
		if (!t || (yt && !t.targets.length)) continue;
		const targets = t.targets ?? [t.target];
		const start = n.position.start.offset;
		const end = n.position.end.offset;
		const raw = body.slice(start, end);
		let form = 'bare';
		let inner = null;
		if (raw.startsWith('[') && raw.endsWith(')') && raw.lastIndexOf('](') > 0) {
			form = 'inline';
			inner = raw.slice(1, raw.lastIndexOf(']('));
		} else if (raw.startsWith('<')) form = 'autolink';
		out.push({ start, end, raw, url: n.url, target: targets[0], targets, tg: t.tg, youtube: yt, form, inner, parts: 1 });
	}
	// СКЛЕЙКА. Одна фраза бывает нарезана на несколько ссылок подряд на одну
	// цель: «[я](…) [писал](…) [про него](…) [прошлым](…) [летом](…)» в
	// «Панельной ностальгии» (так её разметил перенос из телеграма). Для
	// читателя это ОДНА ссылка, и снимать её по кускам нельзя — половина
	// фразы осталась бы ссылкой. Соседние ссылки на одну цель, между которыми
	// только пробелы, считаются одной.
	const merged = [];
	for (const l of out) {
		const prev = merged.at(-1);
		const gap = prev ? body.slice(prev.end, l.start) : null;
		if (prev && prev.targets.join() === l.targets.join() && prev.form === 'inline' && l.form === 'inline' && /^[ \t]*$/u.test(gap)) {
			prev.inner += gap + l.inner;
			prev.end = l.end;
			prev.raw = body.slice(prev.start, prev.end);
			prev.parts++;
		} else merged.push(l);
	}
	for (const l of merged) l.words = l.inner == null ? '' : toPlainText(l.inner).trim();
	return merged;
}

/** Вид дубля: 'words' | 'rephrase' | 'manual' (см. шапку). */
export function dupKind(link) {
	if (link.form !== 'inline') return 'manual';
	const w = norm(link.words);
	if ((w.match(LETTERS) ?? []).length < MIN_LETTERS) return 'rephrase';
	for (const word of w.match(WORD) ?? []) if (POINTER_SET.has(word)) return 'rephrase';
	return 'words';
}
export const DUP_KIND_LABEL = { words: 'слова останутся связными', rephrase: 'нужна переформулировка', manual: 'голый адрес — только свой вариант' };

/** Ссылки блока на цель. */
export const dupLinks = (block, target) => (block?.links ?? []).filter((l) => l.targets.includes(target));

/** Сколько раз `part` встречается в `text` (без перекрытий). */
export function occurrences(text, part) {
	if (!part) return 0;
	let n = 0;
	for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + part.length)) n++;
	return n;
}

/**
 * Предложение блока, в котором стоит место `pos` (смещение в `raw` блока).
 * Граница — конец строки или знак конца предложения с пробелом после,
 * но не внутри ссылки: у «[в нашем бонусном выпуске.](…)» точка своя.
 */
export function sentenceOf(raw, pos, spans = []) {
	const inSpan = (i) => spans.some(([a, b]) => i >= a && i < b);
	let start = 0;
	let end = raw.length;
	for (let i = pos - 1; i >= 0; i--) {
		if (raw[i] === '\n') {
			start = i + 1;
			break;
		}
		if (/\s/u.test(raw[i]) && /[.!?…]["»”)]*$/u.test(raw.slice(Math.max(0, i - 3), i)) && !inSpan(i - 1)) {
			start = i + 1;
			break;
		}
	}
	for (let i = pos; i < raw.length; i++) {
		if (raw[i] === '\n') {
			end = i;
			break;
		}
		if (/[.!?…]/u.test(raw[i]) && !inSpan(i) && (i + 1 >= raw.length || /[\s"»”)]/u.test(raw[i + 1]))) {
			let j = i + 1;
			while (j < raw.length && /["»”)]/u.test(raw[j])) j++;
			if (j >= raw.length || /\s/u.test(raw[j])) {
				end = j;
				break;
			}
		}
	}
	return { start, end };
}

/**
 * Предложение со ссылкой — «как видит читатель» (ссылка заменена своими
 * словами): этим текстом заполняется поле «свой вариант».
 */
export function sentenceView(block, link) {
	const ls = link.start - block.start;
	const le = link.end - block.start;
	const s = sentenceOf(block.raw, ls, block.links.map((l) => [l.start - block.start, l.end - block.start]));
	const raw = block.raw.slice(s.start, s.end);
	const inner = link.inner ?? link.raw;
	return { start: s.start, end: s.end, raw, view: raw.slice(0, ls - s.start) + inner + raw.slice(le - s.start), linkAt: ls - s.start, linkLen: inner.length, rawLinkLen: le - ls };
}

/**
 * Замена для решения. mode 'words' — разметка ссылки → её слова; mode 'custom'
 * — фрагмент со ссылкой (в пределах предложения) → текст Эда. Заменяемый
 * фрагмент — наименьший кусок, который отличается от вписанного Эдом
 * предложения и накрывает ссылку целиком.
 *
 * @returns {{ from: string, to: string, pre: string, post: string } | { error: string }}
 */
export function fragmentFor(block, link, mode, typed = null) {
	if (!block?.raw || link.start < block.start || link.end > block.end) return { error: 'ссылка не в этом абзаце' };
	const sv = sentenceView(block, link);
	let from;
	let to;
	let rs;
	let re;
	if (mode === 'words') {
		if (link.form !== 'inline') return { error: 'у ссылки нет слов — только свой вариант' };
		from = link.raw;
		to = link.inner;
		rs = sv.linkAt;
		re = sv.linkAt + sv.rawLinkLen;
	} else if (mode === 'custom') {
		const T = String(typed ?? '');
		if (!T.trim()) return { error: 'свой вариант пуст' };
		if (/[\n\r]/u.test(T)) return { error: 'в своём варианте не должно быть переносов строки' };
		const V = sv.view;
		let p = 0;
		while (p < V.length && p < T.length && V[p] === T[p]) p++;
		let s = 0;
		while (s < V.length - p && s < T.length - p && V[V.length - 1 - s] === T[T.length - 1 - s]) s++;
		const vs = Math.min(p, sv.linkAt);
		const ve = Math.max(V.length - s, sv.linkAt + sv.linkLen);
		const ts = vs;
		const te = T.length - (V.length - ve);
		rs = vs;
		re = ve - sv.linkLen + sv.rawLinkLen;
		from = sv.raw.slice(rs, re);
		to = T.slice(ts, te);
	} else return { error: `неизвестный режим ${mode}` };
	if (occurrences(block.raw, from) !== 1) return { error: 'заменяемый кусок встречается в абзаце не один раз — впишите вариант чуть шире' };
	return { from, to, pre: sv.raw.slice(0, rs), post: sv.raw.slice(re) };
}

/** Ссылки (адреса) в куске разметки `[слова](адрес)` — для проверки журнала. */
export function urlsIn(fragment) {
	return [...String(fragment).matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/gu)].map((m) => m[1]);
}
