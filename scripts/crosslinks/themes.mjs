// ПЕРЕЛИНКОВКА — КАНАЛ «ТЕМЫ»: ПАРЫ ПО КАРТОЧКАМ РАЗМЕТЧИКА (сессия 1б).
//
// Ничего не пишет. На входе — корпус (lib.loadCorpus) и карточки разметчика
// (scripts/crosslinks/разметчик.md), на выходе — кандидаты в том же формате,
// что у канала «тайтлы» (finder.mjs), с `channel: 'themes'` в причинах.
// Слияние с каналом «тайтлы» — `mergeCandidates` из finder.mjs.
//
// Сигналы (у каждого свой `signal`):
//   'motive'   — источник прямо говорит «по мотивам нашего эссе / выпуска»,
//                цель — ближайший наш материал этого вида НЕ ПОЗЖЕ поста
//                и не раньше чем за MOTIVE_DAYS дней;
//   'label'    — общая метка словаря, главная у цели и главная (или главная
//                в разделе) у источника;
//   'person'   — человек главный хотя бы у одной стороны и назван у другой;
//   'studio'   — студия главная хотя бы у одной стороны и названа у другой;
//   'subject'  — тайтл, о котором пост «на самом деле» (subjectAnime), главный
//                у другой стороны: чинит промахи счётчика канала «тайтлы».
//
// Уверенность:
//   сильный — motive; метка редкая (df ≤ RARE_DF) и главная у обеих; человек
//             или студия главные у обеих; subject;
//   средний — метка главная у обеих, но частая; метка «в разделе» у источника;
//             человек/студия главные у одной стороны;
//   слабый  — метка из списка широких (⚠ в словаре).
// Вес — редкость метки (log N/df), как у тайтлов.

import { placeFor, RULES } from './finder.mjs';
import { classifyAnime } from './lib.mjs';

export const THEME_RULES = {
	motiveDays: 14,
	// Вид материала из поля ref → категории поста-цели.
	motiveKinds: { эссе: ['videoessay'], выпуск: ['podcast'], бонус: ['bonus'], Бунко: ['bonus'], пост: ['note', 'article'] },
	rareDf: 3,
	broad: ['уют', 'сёнен-тропы', 'анонс'],
	// Метки, которые связей не порождают вовсе: повод «по мотивам» работает
	// своим сигналом, а общая метка «по-мотивам» у двух постов ничего не значит.
	noPairs: ['по-мотивам'],
	// Рубрики: связь только с ПРЕДЫДУЩИМ выпуском рубрики, а не со всеми —
	// иначе три «Романтики сезона» дают шесть пар, из которых нужна одна-две.
	series: ['романтика-сезона', 'анонс-сезона', 'итоги-года'],
	// Метка, которая связывает, только если у сторон общая студия
	// (пробная разметка: «Заря MAPPA» ↔ эссе про Ghibli).
	needsStudio: ['история-студии'],
};

const LEVELS = ['слабый', 'средний', 'сильный'];
const daysBetween = (a, b) => (new Date(a) - new Date(b)) / 86400000;

/** Место вставки для метки: та же машинерия, что у тайтлов (finder.placeFor). */
function placeForBlocks(post, blocks, level) {
	const KEY = '__theme__';
	const marked = { ...post, blocks: post.blocks.map((b) => (blocks.includes(b.n) ? { ...b, anime: { ...(b.anime ?? {}), [KEY]: 1 } } : b)) };
	const sectionOf = level === 'раздел' ? [...new Set(blocks.map((n) => post.blocks[n]?.section).filter((s) => s != null))] : [];
	const info = { sectionOf, role: level === 'главная' ? 'main' : 'passing', blocks };
	return placeFor(marked, info, level === 'главная', KEY);
}

/**
 * @param {object} opts
 * @param {object[]} opts.posts   опубликованные посты (lib.loadCorpus)
 * @param {Map<string, object>} opts.cards  id поста → карточка разметчика
 * @param {object[]} opts.anime   справочник
 * @param {Set<string>} [opts.targetsOnly]  ограничить цели (пробный поиск по выборке)
 */
export function findThemeCandidates({ posts, cards, anime, targetsOnly = null, rejected = new Set() }) {
	const byId = new Map(posts.map((p) => [p.id, p]));
	const nameOf = new Map(anime.map((a) => [a.id, a.data.titleRu || a.data.titleOriginal || a.id]));
	const franchiseOf = new Map(anime.map((a) => [a.id, a.data.franchise || null]));
	const fam = (id) => franchiseOf.get(id) || id;

	// Редкость меток — по всем карточкам.
	const df = new Map();
	for (const c of cards.values()) for (const code of new Set((c.labels ?? []).filter((l) => l.level !== 'мимоходом').map((l) => l.code))) df.set(code, (df.get(code) ?? 0) + 1);
	const N = Math.max(cards.size, 1);
	const idf = (code) => Math.log((N + 1) / (df.get(code) ?? 1));

	const mains = (c) => new Map((c.labels ?? []).filter((l) => l.level === 'главная' && !THEME_RULES.noPairs.includes(l.code)).map((l) => [l.code, l]));
	const out = [];

	for (const [sid, sc] of cards) {
		const src = byId.get(sid);
		if (!src || !src.ownPage || !RULES.sourceCategories.includes(src.category)) continue;
		const existing = new Set(src.blocks.filter((b) => b.kind === 'material').map((b) => b.target));
		const pairs = new Map();
		const add = (tid, reason) => {
			if (tid === sid) return;
			if (targetsOnly && !targetsOnly.has(tid)) return;
			if (!pairs.has(tid)) pairs.set(tid, []);
			pairs.get(tid).push(reason);
		};

		// motive — цель ищется по всему архиву, а не только среди размеченных.
		for (const l of (sc.labels ?? []).filter((x) => x.code === 'по-мотивам')) {
			const kinds = THEME_RULES.motiveKinds[l.ref] ?? [];
			const cand = posts
				.filter((p) => kinds.includes(p.category) && p.ownPage && p.date && src.date)
				.map((p) => ({ p, d: daysBetween(src.date, p.date) }))
				.filter((x) => x.d >= 0 && x.d <= THEME_RULES.motiveDays)
				.sort((a, b) => a.d - b.d);
			if (cand.length) {
				const t = cand[0].p;
				add(t.id, {
					signal: 'motive',
					level: 'сильный',
					weight: 3,
					blocks: l.blocks,
					labelLevel: 'главная',
					text: `пост написан по мотивам нашего материала («${l.quote}»); ближайший ${l.ref} до даты поста — «${t.title}», за ${Math.round(cand[0].d)} дн.`,
				});
			}
		}

		const sMain = mains(sc);
		const sSection = new Map((sc.labels ?? []).filter((l) => l.level === 'раздел').map((l) => [l.code, l]));
		for (const [tid, tc] of cards) {
			if (tid === sid) continue;
			const tgt = byId.get(tid);
			if (!tgt) continue;
			const tMain = mains(tc);
			const studiosOf = (c) => new Set((c.studios ?? []).map((x) => x.name));
			const shareStudio = [...studiosOf(sc)].some((x) => studiosOf(tc).has(x));
			// Рубрика: ближайший ПРЕДЫДУЩИЙ пост рубрики.
			const prevInSeries = (code) => {
				const earlier = [...cards].filter(([id, c]) => id !== sid && (c.labels ?? []).some((l) => l.code === code && l.level === 'главная') && byId.get(id)?.date && src.date && byId.get(id).date < src.date);
				earlier.sort((a, b) => (byId.get(b[0]).date > byId.get(a[0]).date ? 1 : -1));
				return earlier[0]?.[0] ?? null;
			};
			for (const [code, tl] of tMain) {
				const sl = sMain.get(code) ?? sSection.get(code);
				if (!sl) continue;
				if (THEME_RULES.needsStudio.includes(code) && !shareStudio) continue;
				if (THEME_RULES.series.includes(code) && prevInSeries(code) !== tid) continue;
				const broad = THEME_RULES.broad.includes(code);
				const inSection = sl.level === 'раздел';
				const rare = (df.get(code) ?? 0) <= THEME_RULES.rareDf;
				const level = broad ? 'слабый' : inSection || !rare ? 'средний' : 'сильный';
				const place = code === 'реальные-места' ? (sl.place && tl.place && sl.place === tl.place ? sl.place : null) : '';
				if (place === null) continue; // разные места — не связь
				add(tid, {
					signal: 'label',
					code,
					level,
					weight: idf(code) * (inSection ? 0.6 : 1),
					blocks: sl.blocks,
					labelLevel: sl.level,
					text: `общая тема «${code}»${place ? ` (${place})` : ''}: у источника ${inSection ? 'главная в разделе' : 'главная'}, у цели главная; тема встречается в ${df.get(code)} размеченных постах`,
				});
			}
			for (const sp of sc.people ?? []) {
				const tp = (tc.people ?? []).find((x) => x.name === sp.name);
				if (!tp || (sp.level !== 'главный' && tp.level !== 'главный')) continue;
				const both = sp.level === 'главный' && tp.level === 'главный';
				// Источник упоминает человека, цель — о нём: читатель узнает больше (средний).
				// Источник о человеке, цель лишь упоминает: ведём из большего в меньшее (слабый).
				add(tid, {
					signal: 'person',
					level: both ? 'сильный' : tp.level === 'главный' ? 'средний' : 'слабый',
					weight: both ? 2 : 1,
					blocks: sp.blocks,
					labelLevel: sp.level === 'главный' ? 'главная' : 'мимоходом',
					text: `общий человек: ${sp.name} (${sp.role}) — у источника ${sp.level}, у цели ${tp.level}`,
				});
			}
			for (const ss of sc.studios ?? []) {
				const ts = (tc.studios ?? []).find((x) => x.name === ss.name);
				if (!ts || (ss.level !== 'главная' && ts.level !== 'главная')) continue;
				const both = ss.level === 'главная' && ts.level === 'главная';
				add(tid, {
					signal: 'studio',
					// Студия, лишь упомянутая у источника («MAPPA обещает 24 серии»), —
					// слабая связь даже к посту о студии (пробная разметка: 6 таких пар
					// из анонсов сезона, все сомнительные). У людей такая связь — средняя.
					level: both ? 'сильный' : 'слабый',
					weight: both ? 2 : 1,
					blocks: ss.blocks,
					labelLevel: ss.level === 'главная' ? 'главная' : 'мимоходом',
					text: `общая студия: ${ss.name} — у источника ${ss.level}, у цели ${ts.level}`,
				});
			}
			// subject: тайтл-предмет с одной стороны, главный (или тоже предмет) с другой.
			const tCls = classifyAnime(tgt);
			const tSubject = new Set([...Object.entries(tCls).filter(([, x]) => x.role === 'main').map(([id]) => fam(id)), ...(tc.subjectAnime ?? []).map((a) => fam(a.anime))]);
			const sCls = classifyAnime(src);
			const sSubject = new Set([...Object.entries(sCls).filter(([, x]) => x.role === 'main').map(([id]) => fam(id)), ...(sc.subjectAnime ?? []).map((a) => fam(a.anime))]);
			const viaSubject = [...(sc.subjectAnime ?? []).map((a) => a.anime).filter((a) => tSubject.has(fam(a))), ...(tc.subjectAnime ?? []).map((a) => a.anime).filter((a) => sSubject.has(fam(a)))];
			for (const a of new Set(viaSubject)) {
				const blocks = src.blocks.filter((b) => b.anime?.[a]).map((b) => b.n);
				add(tid, {
					signal: 'subject',
					anime: a,
					level: 'сильный',
					weight: 2,
					blocks,
					labelLevel: 'главная',
					text: `тайтл «${nameOf.get(a)}» — предмет поста по прочтению (счётчик считал его мимоходным)`,
				});
			}
		}

		for (const [tid, reasons] of pairs) {
			const key = `${sid}→${tid}`;
			if (rejected.has(key)) continue;
			const tgt = byId.get(tid);
			reasons.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.weight - a.weight);
			const best = reasons[0];
			const p = best.blocks?.length ? placeForBlocks(src, best.blocks, best.labelLevel === 'раздел' ? 'раздел' : best.labelLevel) : null;
			let at = p;
			if (!at) {
				// Нет места по блокам — конец поста, как у тайтлов «назван только в заголовке».
				const tail = src.blocks.filter((b) => b.kind === 'text').pop();
				at = tail ? { b: tail.n, mode: 'конец' } : null;
			}
			const anchor = at ? [...src.blocks.slice(0, at.b + 1)].reverse().find((b) => b.kind === 'text') : null;
			out.push({
				key,
				source: sid,
				sourceTitle: src.title,
				sourceCategory: src.category,
				target: tid,
				targetTitle: tgt.title,
				targetCategory: tgt.category,
				channels: ['themes'],
				signal: best.signal,
				confidence: best.level,
				weight: Math.round(reasons.reduce((s, r) => s + r.weight, 0) * 100) / 100,
				reason: best.text,
				reasons: reasons.map(({ blocks, ...r }) => ({ channel: 'themes', ...r, weight: Math.round(r.weight * 100) / 100 })),
				place: at ? { afterBlock: at.b, mode: at.mode, anchorBlock: anchor?.n ?? null, anchorWords: anchor ? anchor.plain.split(/\s+/).slice(0, 10).join(' ') : '' } : null,
				flags: { existing: existing.has(tid) },
				status: existing.has(tid) ? 'уже стоит' : null,
			});
		}
	}
	return { candidates: out, df };
}
