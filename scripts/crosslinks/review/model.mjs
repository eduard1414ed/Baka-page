// ПЕРЕЛИНКОВКА — ДАННЫЕ ДЛЯ СТРАНИЦЫ РЕВЬЮ (сессия 2).
//
// Превращает список кандидатов (find.mjs → candidates.json) в то, что видит
// Эд: ПОСТ целиком, а не пару. У поста — сжатый текст по блокам, основные
// кандидаты на своих местах и запасные цели списком. Номер пачки поста —
// по его самому сильному основному кандидату (kinds.mjs).
//
// Ничего не пишет. Читает: candidates.json, посты (lib.loadCorpus — то же
// чтение, что у поисковика, поэтому номера блоков совпадают с `place`),
// карточки разметчика (поле «о чём» у цели) и файлы постов — ради обложки
// цели и отпечатка файла.
//
// ОБЛОЖКИ — С ЖИВОГО САЙТА. Правило «какая картинка у материала» живёт
// в src/lib/postCardMedia.mjs, и оно же зовётся здесь: своей копии правила
// у страницы ревью нет. Локальный путь («/images/…», «/episodes/…») страница
// берёт с ru.bakapodcast.com — собранные копии лежат там, а не в репозитории.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, animeName } from '../lib.mjs';
import { RULES } from '../finder.mjs';
import { linkKind, KIND_LABEL, batchOfPost, BATCH_LABEL } from '../kinds.mjs';
import { readPostsRaw } from '../../archive-clean-lib.mjs';
import { normalizeFrontmatter } from '../../../src/lib/frontmatter.mjs';
import { getCardMedia } from '../../../src/lib/postCardMedia.mjs';
import { canPlayInline } from '../../../src/lib/postRef.mjs';
import { categories, sectionOf } from '../../../src/data/categories.js';
import { SITE_URL } from '../../../src/lib/site.mjs';
import { fingerprint, reanchor } from './fresh.mjs';
import { dupKind, DUP_KIND_LABEL, fragmentFor, sentenceView } from '../unlink.mjs';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CANDIDATES_FILE = join(homedir(), 'baka-audit/crosslinks/candidates/candidates.json');

// Подпись блока по умолчанию — та же, что ставит сборка сайта
// (src/plugins/remark-post-ref.mjs, ПОДПИСЬ_ПО_УМОЛЧАНИЮ). Там она не
// экспортируется, поэтому повторена здесь; разъедется — Эд увидит на ревью
// не ту подпись, что будет на сайте, но сама вставка от этого не изменится:
// подпись по умолчанию в файл не пишется.
export const DEFAULT_LABEL = { link: 'ещё по теме', podcast: 'послушать прямо здесь', videoessay: 'посмотреть прямо здесь' };

const CAT_LABEL = { podcast: 'выпуск', bonus: 'бонус', videoessay: 'эссе', note: 'заметка', article: 'статья' };

function flagNotes(c) {
	const f = c.flags ?? {};
	const out = [];
	if (f.capCount != null) out.push(`на цель уже ${f.capCount}`);
	if (f.noGeneralTarget) out.push('общей цели нет');
	if (f.sectionFit) out.push(`совпадение с разделом (${f.sectionFit})`);
	if (f.external) out.push('внешний материал');
	if (f.linkElsewhere?.length) out.push(`обычная ссылка на цель уже есть в абзаце ${f.linkElsewhere.join(', ')}`);
	return out;
}

/**
 * @param {object} opts
 * @param {string} [opts.file]  файл кандидатов
 * @param {string[]} [opts.only]  только эти источники (макет)
 */
export async function buildReview({ file = CANDIDATES_FILE, only = null } = {}) {
	const found = JSON.parse(await readFile(file, 'utf8'));
	const { posts: all, anime } = await loadCorpus();
	const posts = all.filter((p) => p.published);
	const byId = new Map(posts.map((p) => [p.id, p]));
	const cards = new Map(JSON.parse(await readFile(join(REPO, 'статус/перелинковка/карточки.json'), 'utf8')).cards.map((c) => [c.id, c]));
	const raw = new Map((await readPostsRaw()).map((r) => [r.id, { id: r.id, data: normalizeFrontmatter(r.front), body: r.body }]));

	// Закрытые посты (find.mjs, решение Эда 2 к сессии 3) показываются и тогда,
	// когда основных у них не осталось: после вписывания пара — уже стоящая
	// вставка, и поиск её больше не предлагает. Пачку такого поста берём
	// из решений, а не из кандидатов.
	const closed = new Set(found.closed ?? []);
	const approved = JSON.parse(await readFile(join(REPO, 'статус/перелинковка/решения.json'), 'utf8').catch(() => '{}')).approved ?? [];
	const bySource = new Map();
	for (const id of closed) if (!only || only.includes(id)) bySource.set(id, []);
	for (const c of found.candidates) {
		if (c.status !== 'основной' && c.status !== 'запасной') continue;
		if (only && !only.includes(c.source)) continue;
		if (!bySource.has(c.source)) bySource.set(c.source, []);
		bySource.get(c.source).push(c);
	}

	// Цели: один раз на каждую, а не на каждого кандидата.
	const targets = new Map();
	const targetInfo = async (id) => {
		if (targets.has(id)) return targets.get(id);
		const p = byId.get(id);
		const r = raw.get(id);
		let thumb = null;
		try {
			const m = r ? await getCardMedia(r) : null;
			if (m?.src) thumb = m.src.startsWith('/') ? SITE_URL + m.src : m.src;
		} catch {
			// Нет сети до RSS — плашка без картинки, как на сайте у материала без обложки.
		}
		const external = Boolean(p?.external);
		const info = {
			id,
			title: p?.title ?? id,
			category: p?.category ?? null,
			kindLabel: external ? `${CAT_LABEL[p?.category] ?? p?.category} · внешний` : (CAT_LABEL[p?.category] ?? p?.category),
			meta: categories.find((x) => x.id === sectionOf(p?.category))?.labelOne?.toLowerCase() + (p?.category === 'bonus' ? ' · бонус' : ''),
			date: p?.date ?? null,
			about: cards.get(id)?.about ?? '',
			url: r?.data.externalUrl ?? `${SITE_URL}/posts/${id}/`,
			external,
			canPlay: r ? canPlayInline(r) : false,
			thumb,
		};
		targets.set(id, info);
		return info;
	};

	const shape = (c) => {
		const kind = linkKind(c);
		return {
			key: c.key,
			target: c.target,
			status: c.status,
			confidence: c.confidence,
			channels: c.channels,
			kind,
			kindLabel: KIND_LABEL[kind],
			reason: c.reason,
			reasons: (c.reasons ?? []).map((r) => r.text),
			place: c.place,
			notes: flagNotes(c),
			// «Играет здесь» по умолчанию — только «по мотивам» на выпуск или эссе
			// (решение Эда 1в: «плеером сразу»). Бонусу и внешнему играть нечем.
			playDefault: kind === 'motive',
			weight: c.weight,
		};
	};

	const out = [];
	for (const [sid, list] of bySource) {
		const mains = list.filter((c) => c.status === 'основной');
		if (!mains.length && !closed.has(sid)) continue;
		const src = byId.get(sid);
		if (!src) continue;
		const decidedBatches = approved.filter((a) => a.source === sid && a.batch != null).map((a) => a.batch);
		const reserves = list
			.filter((c) => c.status === 'запасной')
			.sort((a, b) => ['слабый', 'средний', 'сильный'].indexOf(b.confidence) - ['слабый', 'средний', 'сильный'].indexOf(a.confidence) || b.weight - a.weight);
		for (const c of list) await targetInfo(c.target);
		const blocks = src.blocks.map((b) => ({
			n: b.n,
			kind: b.kind,
			text: b.plain ?? null,
			depth: b.depth ?? null,
			textN: b.textN ?? null,
			anime: b.kind === 'anime-ref' ? animeName(anime, b.animeId) : null,
			material: b.kind === 'material' ? { target: b.target, title: byId.get(b.target)?.title ?? b.target } : null,
			// Ссылки на свои материалы в блоке — для «в этом абзаце уже есть
			// ссылка на эту цель» (сессия 3б). Вид и «было → станет» считает
			// unlink.mjs, у страницы своей копии правила нет.
			dups: (b.links ?? []).map((l) => {
				const kind = dupKind(l);
				const w = kind === 'manual' ? null : fragmentFor(b, l, 'words');
				return { raw: l.raw, target: l.target, targets: l.targets, youtube: Boolean(l.youtube), kind, kindLabel: DUP_KIND_LABEL[kind], words: l.words, parts: l.parts, view: sentenceView(b, l).view, wordsFrag: w && !w.error ? w : null, wordsError: w?.error ?? null };
			}),
		}));
		// Абзац-якорь вписанной вставки — текстовый блок прямо перед ней
		// (через картинки): тот, в котором apply.mjs будет снимать дубль.
		const insertedAnchor = {};
		for (const b of src.blocks) {
			if (b.kind !== 'material') continue;
			let j = b.n - 1;
			while (j >= 0 && src.blocks[j].kind === 'image') j--;
			if (src.blocks[j]?.kind === 'text') insertedAnchor[b.target] = j;
		}
		// Пост изменился после поиска — места заново по первым словам абзаца.
		// Нет отпечатка в файле кандидатов (старый прогон) — сверять не с чем,
		// и это говорится вслух, а не считается «не изменился».
		const now = await fingerprint(sid);
		const then = found.fingerprints?.[sid];
		const changed = then === undefined ? null : then !== now;
		const shaped = [...mains.map(shape), ...reserves.map(shape)];
		if (changed) {
			for (const c of shaped) {
				const re = reanchor(blocks, c.place);
				if (re) c.place = { ...c.place, ...re };
				else c.placeLost = true;
			}
		}
		out.push({
			id: sid,
			title: src.title,
			category: src.category,
			categoryLabel: CAT_LABEL[src.category] ?? src.category,
			date: src.date,
			url: `${SITE_URL}/posts/${sid}/`,
			batch: mains.length ? batchOfPost(mains) : Math.min(...decidedBatches, 5),
			best: mains.length ? Math.max(...mains.map((c) => c.weight)) : 0,
			closed: closed.has(sid),
			// Цели, уже вписанные в файл поста блоком ::material.
			inserted: src.blocks.filter((b) => b.kind === 'material').map((b) => b.target),
			insertedAnchor,
			fingerprint: now,
			changed,
			blocks,
			candidates: shaped,
		});
	}
	for (const p of posts) await targetInfo(p.id);
	// Внутри пачки — сначала посты с самым весомым кандидатом.
	out.sort((a, b) => a.batch - b.batch || b.best - a.best || a.id.localeCompare(b.id));

	const result = {
		made: found.made,
		hasFingerprints: Boolean(found.fingerprints),
		rules: { minTextBefore: RULES.minTextBefore, minTextBetween: RULES.minTextBetween },
		batches: BATCH_LABEL,
		kinds: KIND_LABEL,
		defaultLabel: DEFAULT_LABEL,
		posts: out,
		// Все опубликованные — не только цели кандидатов: «своя цель» Эда
		// выбирается из любого материала, и плашка у неё та же.
		targets: Object.fromEntries(targets),
	};
	// Блоки постов как их разобрал lib.mjs (с разметкой и местами ссылок) —
	// серверу, для «своего варианта» и проверки решения. Страница их не получает:
	// свойство не перечисляемое и в JSON не попадает.
	Object.defineProperty(result, 'corpus', { value: byId, enumerable: false });
	return result;
}
