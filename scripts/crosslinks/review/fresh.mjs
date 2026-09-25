// ПЕРЕЛИНКОВКА — СВЕЖЕСТЬ МЕСТА ВСТАВКИ (сессия 2).
//
// Посты меняются после поиска кандидатов: роботы на сервере коммитят их,
// Эд правит в админке. Номер блока из candidates.json при этом может
// уехать — абзац вставили выше, и «после блока 7» стало чужим местом.
//
// Поэтому у каждого поста хранится ОТПЕЧАТОК ФАЙЛА на момент поиска
// (find.mjs пишет `fingerprints` в candidates.json), а у решения Эда —
// на момент решения. Разошёлся отпечаток — место ищется заново по первым
// словам абзаца (`anchorWords`), а не по номеру. Не нашлось — место
// объявляется потерянным вслух, а не остаётся на чужом абзаце молча.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POSTS_DIR = fileURLToPath(new URL('../../../src/content/posts/', import.meta.url));

/** Отпечаток файла поста: 12 знаков sha1. Нет файла — null. */
export async function fingerprint(id, dir = POSTS_DIR) {
	try {
		return createHash('sha1').update(await readFile(join(dir, `${id}.md`))).digest('hex').slice(0, 12);
	} catch (e) {
		if (e.code === 'ENOENT') return null;
		throw e;
	}
}

const words = (t) => (t ?? '').split(/\s+/u).filter(Boolean);

/**
 * Место заново по первым словам абзаца.
 *
 * @param {{kind:string,n:number,text?:string,plain?:string}[]} blocks блоки поста СЕЙЧАС
 * @param {{afterBlock:number, anchorBlock?:number, anchorWords:string}} place место из прошлого
 * @returns {{afterBlock:number, anchorBlock:number, anchorWords:string}|null} null — абзаца больше нет
 */
export function reanchor(blocks, place) {
	if (!place?.anchorWords) return null;
	const want = words(place.anchorWords);
	const hits = blocks.filter((b) => b.kind === 'text' && words(b.text ?? b.plain).slice(0, want.length).join(' ') === want.join(' '));
	if (!hits.length) return null;
	// Одинаково начинающихся абзацев бывает несколько — берём ближайший
	// к прежнему номеру: сдвиг обычно на абзац-другой, а не через весь пост.
	const was = place.anchorBlock ?? place.afterBlock;
	const a = hits.reduce((x, y) => (Math.abs(y.n - was) < Math.abs(x.n - was) ? y : x));
	// Вставка стояла после абзаца и идущих за ним картинок: сдвиг сохраняем,
	// но не дальше следующего текстового блока.
	let after = a.n + Math.max(0, place.afterBlock - (place.anchorBlock ?? place.afterBlock));
	const nextText = blocks.find((b) => b.n > a.n && b.kind === 'text');
	if (nextText && after >= nextText.n) after = nextText.n - 1;
	if (after >= blocks.length) after = blocks.length - 1;
	return { afterBlock: after, anchorBlock: a.n, anchorWords: place.anchorWords };
}
