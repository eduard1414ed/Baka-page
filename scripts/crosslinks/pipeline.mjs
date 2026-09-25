// ПЕРЕЛИНКОВКА — СЛИЯНИЕ КАНАЛОВ «ТАЙТЛЫ» И «ТЕМЫ» (сессия 1в, шаг 6).
//
// Ничего не пишет. Один вход на весь конвейер: его зовут find.mjs (итоговый
// список) и check71.mjs (проверка на вставках Эда) — чтобы проверялось ровно то,
// что потом уходит на ревью.
//
// Порядок (план из отчёта 1б, раздел 4; решения Эда 1в):
//   1. Канал «тайтлы» (finder.findTitleCandidates) и канал «темы»
//      (themes.findThemeCandidates) — каждый со своими причинами и местами.
//   2. Смысловой фильтр снимает СРЕДНИХ и СЛАБЫХ тайтловых, если разметчик
//      ответил «пример» про этот тайтл в этом месте. Снятые остаются в списке
//      со статусом «отсеян» — видно, что сняло.
//   3. Слияние: пара, найденная обоими каналами, — одна запись, уверенность
//      на ступень выше (finder.mergeCandidates).
//   4. Правило охвата (coverage.applyCoverage) — поверх тайтловых, после фильтра:
//      узкая цель уступает общей или идёт ступенью ниже.
//   5. Места — по всем кандидатам поста сразу: плотность и «не ближе абзаца»
//      (правила finder.RULES). Порядок: главный тайтл или главная тема источника
//      («по мотивам», тайтл-предмет, главный человек — наравне) → уверенность → вес.
//   6. Потолок на цель — общий для обоих каналов, считая уже стоящие вставки;
//      мягкий, как в сессии 1: превысившие помечаются `capCount`, а не снимаются.
//
// planned (сессия 3): одобренные Эдом, но ещё не вписанные пары — Map
// источник → [{ key, target, afterBlock }]. Считаются УЖЕ СТОЯЩИМИ вставками:
// занимают место для плотности и «не ближе абзаца», входят в потолок на цель
// (решение Эда 3 к сессии 3). Сама одобренная пара остаётся основной, но места
// заново не ищет и второй раз не считается. Вписанные вставки (::material
// в файле) учитываются как раньше — они уже блоки поста.
//
// stripExisting: посты без вставок (проверка на 71). Карточки разметчика хранят
// ИСХОДНЫЕ номера блоков, поэтому при снятии вставок номера в карточках
// пересчитываются той же картой, что и сами посты.

import { findTitleCandidates, mergeCandidates, densityLimit, describePlace, tailStart, RULES } from './finder.mjs';
import { findThemeCandidates, THEME_RULES } from './themes.mjs';
import { applyCoverage } from './coverage.mjs';
import { classifyAnime } from './lib.mjs';

const LEVELS = ['слабый', 'средний', 'сильный'];

function stripPost(p) {
	const remap = new Map();
	let j = 0;
	for (const b of p.blocks) if (b.kind !== 'material') remap.set(b.n, j++);
	const blocks = p.blocks.filter((b) => b.kind !== 'material').map((b) => ({ ...b, n: remap.get(b.n), section: b.section != null ? (remap.get(b.section) ?? null) : b.section }));
	return { post: { ...p, blocks }, remap };
}

function remapCard(card, remap) {
	const m = (xs) => (xs ?? []).map((n) => remap.get(n)).filter((n) => n != null);
	const fix = (list) => (list ?? []).map((x) => ({ ...x, blocks: m(x.blocks) }));
	return { ...card, labels: fix(card.labels), people: fix(card.people), studios: fix(card.studios), filter: (card.filter ?? []).map((f) => ({ ...f, block: f.block != null ? (remap.get(f.block) ?? null) : null })) };
}

/** Ответ фильтра для тайтлового кандидата: тот же тайтл, ближайший вопрос не позже места. */
function filterVerdict(card, cand) {
	const r = cand.reasons.find((x) => x.channel === 'titles');
	if (!r) return null;
	const answers = (card?.filter ?? []).filter((f) => f.anime === r.sourceAnime && f.verdict);
	if (!answers.length) return null;
	const at = cand.place?.anchorBlock ?? Infinity;
	const before = answers.filter((f) => f.block == null || f.block <= at).sort((a, b) => (b.block ?? -1) - (a.block ?? -1));
	return before[0] ?? answers[0];
}

/**
 * @returns {{ candidates: object[], forStep5: object[], stats: object }}
 */
export function buildCandidates({ posts: rawPosts, anime, cards: rawCards, broad = new Set(), occasions = new Set(), rejected = new Set(), stripExisting = false, planned = new Map() }) {
	let posts = rawPosts;
	let cards = rawCards;
	if (stripExisting) {
		const stripped = rawPosts.map(stripPost);
		posts = stripped.map((s) => s.post);
		cards = new Map();
		stripped.forEach((s, i) => rawCards.has(rawPosts[i].id) && cards.set(rawPosts[i].id, remapCard(rawCards.get(rawPosts[i].id), s.remap)));
	}
	const byId = new Map(posts.map((p) => [p.id, p]));
	const stats = { filtered: 0, themesExisting: 0, merged: 0 };

	// 1. Каналы.
	const { candidates: titles, forStep5 } = findTitleCandidates({ posts, anime, rejected });
	const { candidates: themes, dropped } = findThemeCandidates({ posts, cards, anime, rejected, broad, occasions });
	stats.themesDropped = dropped;

	// 2. Фильтр и отбор живых. Статусы места канала «тайтлы» сбрасываются:
	// места расставляются заново, по обоим каналам сразу (шаг 5 ниже).
	const aside = [];
	const liveTitles = [];
	for (const c of titles) {
		if (c.status === 'отсеян' || c.status === 'шаг 5') {
			aside.push(c);
			continue;
		}
		c.status = null;
		c.statusWhy = null;
		c.flags = { ...c.flags, capCount: null };
		if (['средний', 'слабый'].includes(c.confidence)) {
			const v = filterVerdict(cards.get(c.source), c);
			if (v?.verdict === 'пример') {
				c.status = 'отсеян';
				c.statusWhy = `смысловой фильтр: пример — ${v.why}`;
				stats.filtered++;
				aside.push(c);
				continue;
			}
		}
		liveTitles.push(c);
	}
	const asideByKey = new Map(aside.map((c) => [c.key, c]));
	const liveThemes = [];
	for (const c of themes) {
		if (c.flags?.existing) {
			stats.themesExisting++;
			continue;
		}
		// Пара, которую канал «тайтлы» отправил в шаг 5 (в абзаце уже обычная
		// ссылка на цель), — туда же и тематическая.
		if (asideByKey.get(c.key)?.status === 'шаг 5') continue;
		c.status = null;
		liveThemes.push(c);
	}

	// 3. Слияние.
	const merged = mergeCandidates(liveTitles, liveThemes);
	stats.merged = merged.filter((c) => c.channels.length > 1).length;
	// «По мотивам» на выпуск или эссе встаёт за упоминанием и тогда, когда пару
	// нашёл и канал «тайтлы» (слияние берёт место первого канала).
	for (const t of liveThemes) {
		if (t.signal !== 'motive' || !t.place || !THEME_RULES.motiveInline.includes(t.targetCategory)) continue;
		const m = merged.find((c) => c.key === t.key);
		if (m) m.place = t.place;
	}
	// «По мотивам», сдвинутое за 2-й абзац, — в конец текста (перед карточками
	// тайтлов). Ревью первой пачки (сессия 3): такое место Эд не оставил ни разу,
	// 0 из 4 — переносил либо к самой фразе о выпуске, либо в конец; конец он
	// принимал 10 из 10, и он не рвёт мысль (вопрос в 1-м абзаце, ответ во 2-м).
	// Решение Эда 25.09.2026: «Ок, я если что руками подвину».
	for (const c of merged) {
		if (c.place?.mode !== 'сдвинуто за 2-й абзац' || !c.reasons.some((r) => r.signal === 'motive')) continue;
		const src = byId.get(c.source);
		const end = tailStart(src) - 1;
		if (end >= 0) c.place = describePlace(src, end, 'конец');
	}

	// Совпадение цели с разделом источника: сколько ГЛАВНЫХ тайтлов цели названо
	// в разделе (или абзаце), где встанет вставка. Пример Эда 1в: в «Романтике
	// сезона — весна 2026» раздел «Ледяная стена» называет и «Ледяную стену»,
	// и «Ты и я» — пост о них обоих точнее бонуса об одной «Стене».
	const franchiseOf = new Map(anime.map((a) => [a.id, a.data.franchise || null]));
	const famOf = (id) => franchiseOf.get(id) || id;
	const mainsOf = new Map();
	const targetMains = (id) => {
		if (!mainsOf.has(id)) {
			const p = byId.get(id);
			const subj = (cards.get(id)?.subjectAnime ?? []).map((s) => famOf(s.anime));
			mainsOf.set(id, new Set([...(p ? Object.entries(classifyAnime(p)).filter(([, x]) => x.role === 'main').map(([a]) => famOf(a)) : []), ...subj]));
		}
		return mainsOf.get(id);
	};
	for (const c of merged) {
		const src = byId.get(c.source);
		const b = c.place?.afterBlock;
		if (!src || b == null) continue;
		// Только в постах с разделами (подборки): в сплошном тексте «раздела» нет,
		// и сравнение по одному абзацу решало споры, которых правило не касается.
		const sec = src.blocks[b]?.section;
		if (sec == null) continue;
		const zone = src.blocks.filter((x) => x.section === sec || x.n === sec);
		const named = new Set(zone.flatMap((x) => Object.keys(x.anime ?? {})).map(famOf));
		c.flags = { ...c.flags, sectionFit: [...targetMains(c.target)].filter((a) => named.has(a)).length };
	}

	// 4. Охват — поверх тайтловых. applyCoverage понижает только «основных».
	for (const c of merged) c.status = 'основной';
	const coverageLog = applyCoverage({ candidates: merged, cards, anime, posts });
	for (const c of merged) if (c.status === 'основной') c.status = null;

	// 5. Места по всем кандидатам поста.
	const srcRank = (x) =>
		x.reasons.some(
			(r) =>
				(r.channel === 'titles' && r.sourceLevel !== 'weighty') ||
				(r.channel === 'themes' && (r.signal === 'motive' || r.signal === 'subject' || r.labelLevel === 'главная')),
		)
			? 1
			: 0;
	const bySource = new Map();
	for (const c of merged) {
		if (!bySource.has(c.source)) bySource.set(c.source, []);
		bySource.get(c.source).push(c);
	}
	const approvedKeys = new Set([...planned.values()].flat().map((a) => a.key));
	for (const [sid, list] of bySource) {
		const src = byId.get(sid);
		for (const x of list.filter((x) => !x.status && approvedKeys.has(x.key))) (x.status = 'основной'), (x.statusWhy = 'одобрено Эдом');
		const live = list.filter((x) => !x.status && x.place);
		for (const x of list.filter((x) => !x.status && !x.place)) (x.status = 'отсеян'), (x.statusWhy = 'не нашлось места по правилам');
		// Цель по тому же тайтлу (канал «тайтлы», тайтл-предмет, «по мотивам»)
		// важнее цели через студию, человека или общую тему (калибровка 1в:
		// интервью с создателями «Магической битвы» — «лучше дать ссылку
		// непосредственно на выпуск по „Магической битве“», а не на «Детей на холме»).
		// Круг 3 калибровки: цель по тайтлу важнее и тогда, когда тема у источника
		// главная, а тайтл лишь весомый — поэтому «ярус» стоит ПЕРЕД рангом источника:
		// тайтл, тайтл-предмет, «по мотивам» → человек, студия → тема.
		const tier = (x) => (x.reasons.some((r) => r.channel === 'titles' || r.signal === 'subject' || r.signal === 'motive') ? 2 : x.reasons.some((r) => r.signal === 'person' || r.signal === 'studio') ? 1 : 0);
		const fit = (x) => Math.min(x.flags?.sectionFit ?? 0, 2);
		// Точный тайтл выше родственного по франшизе (обзор «Твоего имени»:
		// «Трилогия трагедий Синкая» против «Дитя погоды», одной франшизы Shikimori).
		const exact = (x) => (x.reasons.some((r) => (r.channel === 'titles' && r.signal === 'same-title') || r.signal === 'subject' || r.signal === 'motive') ? 1 : 0);
		live.sort((a, b) => tier(b) - tier(a) || srcRank(b) - srcRank(a) || exact(b) - exact(a) || fit(b) - fit(a) || LEVELS.indexOf(b.confidence) - LEVELS.indexOf(a.confidence) || b.weight - a.weight);
		// Один человек — одна вставка на пост: связь «только через человека»
		// уходит в запас, если уже стоит вставка на материал, где он главный
		// («Твоё имя»: «лучше на „Трилогию Макото Синкая“», а не ещё и «Судзумэ»).
		const mainPeople = (id) => new Set((cards.get(id)?.people ?? []).filter((p) => p.level === 'главный').map((p) => p.name));
		const personOnly = (x) => x.reasons.every((r) => r.signal === 'person' || (r.signal === 'label' && r.broad));
		const people = (x) => x.reasons.filter((r) => r.signal === 'person').map((r) => r.text.match(/общий человек: (.+?) \(/u)?.[1]).filter(Boolean);
		const coveredPeople = new Set();
		const sections = new Set(live.map((x) => src.blocks[x.place.afterBlock]?.section).filter((s) => s != null));
		const cap = densityLimit(src, sections.size);
		const taken = [...src.blocks.filter((b) => b.kind === 'material').map((b) => b.n), ...(planned.get(sid) ?? []).map((a) => a.afterBlock)];
		const existingCount = taken.length;
		let placed = 0;
		for (const x of live) {
			const b = x.place.afterBlock;
			const tooClose = taken.some((t) => {
				const [lo, hi] = t < b ? [t, b] : [b, t];
				let n = 0;
				for (let i = lo + 1; i <= hi; i++) if (src.blocks[i].kind === 'text') n++;
				return n < RULES.minTextBetween;
			});
			if (personOnly(x) && people(x).some((n) => coveredPeople.has(n))) (x.status = 'запасной'), (x.statusWhy = `человек уже есть в другой вставке поста`);
			else if (existingCount + placed >= cap) (x.status = 'запасной'), (x.statusWhy = `плотность: в посте ${src.textChars} знаков, мест ${cap}`);
			else if (tooClose) (x.status = 'запасной'), (x.statusWhy = 'место занято другой вставкой рядом');
			else (x.status = 'основной'), taken.push(b), placed++, mainPeople(x.target).forEach((n) => coveredPeople.add(n));
		}
	}

	// 6. Потолок на цель: уже стоящие вставки + основные обоих каналов по весу.
	const onTarget = new Map();
	for (const p of posts) for (const b of p.blocks) if (b.kind === 'material') onTarget.set(b.target, (onTarget.get(b.target) ?? 0) + 1);
	for (const a of [...planned.values()].flat()) onTarget.set(a.target, (onTarget.get(a.target) ?? 0) + 1);
	for (const x of merged.filter((x) => x.status === 'основной' && !approvedKeys.has(x.key)).sort((a, b) => LEVELS.indexOf(b.confidence) - LEVELS.indexOf(a.confidence) || b.weight - a.weight)) {
		const n = (onTarget.get(x.target) ?? 0) + 1;
		onTarget.set(x.target, n);
		x.flags = { ...x.flags, capCount: n > RULES.targetCap ? n - 1 : null };
	}

	// Пара, живая в одном канале, не повторяется «отсеянной» из другого: фильтр
	// снял тайтловую причину, а тематическая держит пару — в списке она одна.
	const liveKeys = new Set(merged.map((c) => c.key));
	return { candidates: [...merged, ...aside.filter((c) => !liveKeys.has(c.key))], forStep5, stats, coverageLog };
}
