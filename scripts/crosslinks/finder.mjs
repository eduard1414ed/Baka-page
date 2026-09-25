// ПЕРЕЛИНКОВКА — ПОИСКОВИК КАНДИДАТОВ (сессия 1, шаг 3). Канал «тайтлы».
//
// Ничего не пишет. На входе — корпус из lib.mjs, на выходе — список кандидатов.
// Формат кандидата сразу рассчитан на два канала («тайтлы» и «темы», сессия 1б):
// у кандидата список причин `reasons`, у каждой своё поле `channel`, а пара
// источник→цель встречается в итоговом списке один раз (`mergeCandidates`).
//
// КАЖДОЕ ЧИСЛО НИЖЕ — ПОРОГ, КОТОРЫЙ ПОДКРУЧИВАЕТСЯ ПО ИТОГАМ РЕВЬЮ. Поэтому они
// вынесены в `RULES`, а у кандидата тип сигнала и уровень уверенности лежат
// отдельными полями: после пачки считается «сколько одобрено по типам».

import { classifyAnime } from './lib.mjs';

export const RULES = {
	// Кто источник. Выпуски и эссе в основном проходе не участвуют (решение Эда).
	sourceCategories: ['note', 'article'],
	// Не раньше конца этого текстового абзаца.
	minTextBefore: 2,
	// Между двумя вставками — не меньше стольких текстовых абзацев.
	minTextBetween: 1,
	// Плотность: до 1500 знаков одна вставка, до 4000 — две, дальше — по разделам.
	density: [
		[1500, 1],
		[4000, 2],
	],
	// Мягкий потолок вставок на одну цель за весь проект.
	targetCap: 5,
	// Тайтл «частый», если встречается в стольких опубликованных постах и больше.
	frequentDf: 15,
	// Множители веса.
	sourceFactor: { main: 1, section: 1, weighty: 0.6 },
	// Цель «главный в разделе»; у главной множитель — её очевидность (lib.classifyAnime).
	targetFactor: { section: 0.35 },
	signalFactor: { 'same-title': 1, franchise: 0.55 },
	// «Маленькое → большое»: заметка → бонус, выпуск, эссе (большой разговор),
	// слабее — заметка → статья.
	directionBonus: {
		note: { bonus: 1.3, podcast: 1.3, videoessay: 1.3, article: 1.15 },
		article: { bonus: 1.3, podcast: 1.3, videoessay: 1.3 },
	},
};

const LEVELS = ['слабый', 'средний', 'сильный'];

/** Сколько текстовых абзацев в блоках 0..b включительно. */
function textUpTo(post, b) {
	let n = 0;
	for (let i = 0; i <= b && i < post.blocks.length; i++) if (post.blocks[i].kind === 'text') n++;
	return n;
}

/** Хвост поста, куда вставку не ставят: карточки тайтлов и служебные блоки. */
export function tailStart(post) {
	let i = post.blocks.length;
	while (i > 0) {
		const k = post.blocks[i - 1].kind;
		if (k === 'anime-ref' || k === 'material' || k.startsWith('directive:') || k.startsWith('other:')) i--;
		else break;
	}
	return i;
}

/** Абзац b плюс идущие за ним картинки, видео и служебные строки ##### раздела. */
function extendOverMedia(post, b, limit) {
	let i = b;
	while (i + 1 < limit) {
		const nx = post.blocks[i + 1];
		if (nx.kind === 'image' || nx.kind === 'video' || (nx.kind === 'heading' && nx.depth >= 5)) i++;
		else break;
	}
	return i;
}

/** Конец раздела, открытого заголовком h: перед следующим заголовком ≤4 или хвостом. */
function sectionEnd(post, h, limit) {
	let i = h + 1;
	while (i < limit && !(post.blocks[i].kind === 'heading' && post.blocks[i].depth <= 4)) i++;
	return i - 1;
}

/** Документ «вставка после блока b» → что показать человеку. */
export function describePlace(post, b, mode) {
	let anchor = null;
	for (let i = b; i >= 0; i--) if (post.blocks[i].kind === 'text') { anchor = post.blocks[i]; break; }
	const at = post.blocks[b];
	return {
		afterBlock: b,
		afterTextN: textUpTo(post, b),
		textTotal: post.blocks.filter((x) => x.kind === 'text').length,
		mode,
		after: at.kind,
		anchorBlock: anchor?.n ?? null,
		anchorWords: anchor ? anchor.plain.split(/\s+/).slice(0, 10).join(' ') : '',
	};
}

/**
 * Где встать вставке про тайтл `animeId` в источнике.
 * @returns {{ b: number, mode: string } | null}
 */
export function placeFor(post, info, oneTitle, animeId) {
	const limit = tailStart(post);
	if (limit === 0) return null;
	let b;
	let mode;
	if (info.sectionOf.length) {
		// Подборка: хвост раздела этого тайтла.
		b = sectionEnd(post, info.sectionOf[info.sectionOf.length - 1], limit);
		mode = 'раздел';
	} else if (oneTitle && info.role === 'main') {
		b = limit - 1;
		mode = 'конец';
	} else {
		// Абзац, где о тайтле речь: больше всего упоминаний, при равенстве — первый
		// («сразу после того, как тайтл назван», как у Эда).
		const texts = post.blocks.filter((x) => x.kind === 'text' && x.anime?.[animeId] && x.n < limit);
		if (!texts.length) {
			// Назван только в заголовке/поле — ставим в конец.
			b = limit - 1;
			mode = 'конец';
		} else {
			const best = texts.reduce((a, x) => (x.anime[animeId] > a.anime[animeId] ? x : a));
			b = extendOverMedia(post, best.n, limit);
			mode = b >= limit - 1 ? 'конец' : 'абзац';
		}
	}
	// Абзац, кончающийся двоеточием, зовёт то, что идёт следом. Если следом
	// текст («Смотрите:» и список) — вставка разорвала бы его, сдвигаемся.
	// Если следом картинки или конец поста — место верное: у Эда двоеточие
	// и зовёт саму вставку («рассказываю в нашем новом видеоэссе:»).
	for (let guard = 0; guard < 5; guard++) {
		const at = post.blocks[b];
		const after = post.blocks[b + 1];
		if (at.kind !== 'text' || !/:\s*$/u.test(at.plain) || b + 1 >= limit || after.kind !== 'text') break;
		const next = post.blocks.find((x) => x.kind === 'text' && x.n > b && x.n < limit);
		if (!next) return null;
		b = extendOverMedia(post, next.n, limit);
		if (mode === 'конец' && b < limit - 1) mode = 'абзац';
	}
	// Не раньше конца 2-го текстового абзаца.
	if (textUpTo(post, b) < RULES.minTextBefore) {
		const second = post.blocks.filter((x) => x.kind === 'text')[RULES.minTextBefore - 1];
		if (!second || second.n >= limit) return null;
		b = extendOverMedia(post, second.n, limit);
		mode = b >= limit - 1 ? 'конец' : 'сдвинуто за 2-й абзац';
	}
	// Сразу за заголовком раздела вставку не ставим.
	if (post.blocks[b].kind === 'heading' && post.blocks[b].depth <= 4) return null;
	return { b, mode };
}

/** Сколько вставок пускает плотность. */
export function densityLimit(post, sectionsWithCandidates) {
	let byChars = RULES.density[RULES.density.length - 1][1];
	for (const [chars, n] of [...RULES.density].reverse()) if (post.textChars <= chars) byChars = n;
	// Подборка (есть разделы с тайтлами): по одной на раздел, сколько бы ни было
	// знаков. Эд так и делал: «Осенние аниме» — 1342 знака и 4 вставки.
	if (post.textChars > RULES.density[RULES.density.length - 1][0] || sectionsWithCandidates >= 2) {
		return Math.max(byChars, sectionsWithCandidates);
	}
	return byChars;
}

/** Уровень уверенности одной причины. */
function levelOf(signal, srcLevel, tgtLevel, frequent) {
	if (tgtLevel === 'section') return 'слабый';
	if (signal === 'franchise') return srcLevel === 'weighty' ? 'слабый' : 'средний';
	if (srcLevel === 'weighty') return frequent ? 'слабый' : 'средний';
	return 'сильный';
}

/**
 * Все кандидаты канала «тайтлы».
 *
 * @param {object} opts
 * @param {object[]} opts.posts           опубликованные посты (из lib.loadCorpus)
 * @param {object[]} opts.anime           справочник
 * @param {boolean}  opts.stripExisting   убрать существующие вставки в памяти (проверка на 71)
 * @param {Set<string>} opts.rejected     ключи «источник→цель», отклонённые Эдом
 */
export function findTitleCandidates({ posts, anime, stripExisting = false, rejected = new Set() }) {
	const franchiseOf = new Map(anime.map((a) => [a.id, a.data.franchise || null]));
	const famKey = (id) => franchiseOf.get(id) || id;
	const nameOf = new Map(anime.map((a) => [a.id, a.data.titleRu || a.data.titleOriginal || a.id]));

	// В памяти — без существующих вставок, если просят. Файлы не трогаются.
	const corpus = posts.map((p) => {
		if (!stripExisting) return p;
		const blocks = p.blocks.filter((b) => b.kind !== 'material').map((b, i) => ({ ...b, n: i }));
		// Номера блоков сдвинулись — пересчитать ссылки на заголовки разделов.
		const remap = new Map();
		let j = 0;
		for (const b of p.blocks) if (b.kind !== 'material') remap.set(b.n, j++);
		for (const b of blocks) if (b.section != null) b.section = remap.get(b.section) ?? null;
		return { ...p, blocks };
	});

	const cls = new Map(corpus.map((p) => [p.id, classifyAnime(p)]));

	// Редкость: в скольких опубликованных постах тайтл встречается вообще.
	const df = new Map();
	for (const p of corpus) for (const id of Object.keys(cls.get(p.id))) df.set(id, (df.get(id) ?? 0) + 1);
	const N = corpus.length;
	const idf = (id) => Math.log(N / (df.get(id) ?? 1));

	// Цели по тайтлу: где тайтл главный или главный в разделе.
	// Узость цели: материал про один тайтл ближе к нему, чем материал про два
	// («Магическая битва | …» против интервью про «Битву» и «Винланд»).
	// Главные тайтлы одной франшизы считаются одним.
	const targetsByAnime = new Map();
	for (const p of corpus) {
		const c = cls.get(p.id);
		const mains = new Set(Object.entries(c).filter(([, x]) => x.role === 'main').map(([id]) => famKey(id)));
		const narrow = 1 / Math.sqrt(Math.max(1, mains.size));
		for (const [id, x] of Object.entries(c)) {
			if (x.role === 'passing') continue;
			if (!targetsByAnime.has(id)) targetsByAnime.set(id, []);
			targetsByAnime.get(id).push({ post: p, level: x.role, centrality: x.centrality * narrow });
		}
	}
	const byFranchise = new Map();
	for (const [id] of targetsByAnime) {
		const f = franchiseOf.get(id);
		if (!f) continue;
		if (!byFranchise.has(f)) byFranchise.set(f, []);
		byFranchise.get(f).push(id);
	}

	// Сколько вставок уже стоит на каждую цель (для потолка).
	const existingOnTarget = new Map();
	if (!stripExisting) for (const p of corpus) for (const b of p.blocks) if (b.kind === 'material' && b.target) existingOnTarget.set(b.target, (existingOnTarget.get(b.target) ?? 0) + 1);

	const all = [];
	const forStep5 = [];

	for (const src of corpus) {
		if (!src.ownPage || !RULES.sourceCategories.includes(src.category)) continue;
		const c = cls.get(src.id);
		const existingTargets = new Set(src.blocks.filter((b) => b.kind === 'material').map((b) => b.target));

		// Пост про один тайтл: главные тайтлы, склеенные по франшизе, дают одну группу.
		const mainGroups = new Set(Object.entries(c).filter(([, x]) => x.role === 'main').map(([id]) => franchiseOf.get(id) || id));
		const oneTitle = mainGroups.size === 1;

		const pairs = new Map(); // target id → кандидат
		for (const [aid, info] of Object.entries(c)) {
			if (!info.weighty) continue;
			const srcLevel = info.role === 'main' ? 'main' : info.sectionOf.length ? 'section' : 'weighty';
			// Весомый ТОЛЬКО из-за последнего абзаца — самый слабый признак: там
			// тайтлы часто называют для сравнения («как в „Наруто“ и „Бличе“»).
			// Выборка шага 5: 4 мусорных кандидата из 13 средних были такими.
			const lastOnly = srcLevel === 'weighty' && info.weightWhy.every((w) => w === 'в последнем абзаце');
			const related = [{ id: aid, signal: 'same-title' }];
			const fr = franchiseOf.get(aid);
			if (fr) for (const other of byFranchise.get(fr) ?? []) if (other !== aid) related.push({ id: other, signal: 'franchise' });

			for (const rel of related) {
				// Родственный тайтл, который и сам назван в источнике, пойдёт своим ходом.
				if (rel.signal === 'franchise' && c[rel.id]?.weighty) continue;
				for (const t of targetsByAnime.get(rel.id) ?? []) {
					const tgt = t.post;
					if (tgt.id === src.id) continue;
					const key = `${src.id}→${tgt.id}`;
					const frequent = (df.get(rel.id) ?? 0) >= RULES.frequentDf;
					const level = levelOf(rel.signal, srcLevel === 'section' ? 'main' : srcLevel, t.level, frequent || lastOnly);
					const weight =
						idf(rel.id) *
						RULES.sourceFactor[srcLevel] *
						(t.level === 'main' ? t.centrality : RULES.targetFactor.section) *
						RULES.signalFactor[rel.signal];
					const where = info.blocks.length
						? `назван в ${[...new Set(info.blocks.map((n) => textUpTo(src, n)))].filter(Boolean).map((n) => n + '-м').join(', ')} абзаце`
						: 'назван только в заголовке/поле';
					const reason = {
						channel: 'titles',
						signal: rel.signal,
						anime: rel.id,
						animeName: nameOf.get(rel.id),
						sourceAnime: aid,
						sourceLevel: srcLevel,
						targetLevel: t.level,
						level,
						weight,
						df: df.get(rel.id) ?? 0,
						text:
							(rel.signal === 'franchise'
								? `родственный тайтл: в источнике «${nameOf.get(aid)}», в цели «${nameOf.get(rel.id)}» (одна франшиза)`
								: `общий тайтл «${nameOf.get(rel.id)}»`) +
							`, у источника ${srcLevel === 'main' ? 'главный' : srcLevel === 'section' ? 'заголовок раздела' : 'весомый (' + info.weightWhy.join(', ') + ')'}` +
							`, у цели ${t.level === 'main' ? 'главный' : 'один из нескольких'}; ${where}`,
						place: placeFor(src, info, oneTitle, aid),
					};
					if (!pairs.has(tgt.id)) pairs.set(tgt.id, { key, src, tgt, reasons: [] });
					pairs.get(tgt.id).reasons.push(reason);
				}
			}
		}

		// Внешняя цель — только если по тому же тайтлу нет своей. Тайтл сравнивается
		// с точностью до франшизы: своя цель про «Магическую битву» закрывает
		// внешнюю про «Магическую битву 2».
		const ownByAnime = new Set();
		for (const p of pairs.values()) if (!p.tgt.external) for (const r of p.reasons) ownByAnime.add(famKey(r.anime));

		const cands = [];
		for (const p of pairs.values()) {
			const reasons = p.reasons.sort((a, b) => b.weight - a.weight);
			const best = reasons.find((r) => r.place) ?? reasons[0];
			// Тайтлы одной франшизы — одна связь: «Магическая битва» и «Магическая
			// битва 0» у одной цели не складываются, берётся сильнейшая.
			const perFamily = new Map();
			for (const r of reasons) perFamily.set(famKey(r.anime), Math.max(perFamily.get(famKey(r.anime)) ?? 0, r.weight));
			let weight = [...perFamily.values()].reduce((s, w) => s + w, 0);
			weight *= RULES.directionBonus[src.category]?.[p.tgt.category] ?? 1;
			const level = LEVELS[Math.max(...reasons.map((r) => LEVELS.indexOf(r.level)))];
			const cand = {
				key: p.key,
				source: src.id,
				sourceTitle: src.title,
				sourceCategory: src.category,
				sourceDate: src.date,
				target: p.tgt.id,
				targetTitle: p.tgt.title,
				targetCategory: p.tgt.category,
				targetDate: p.tgt.date,
				channels: ['titles'],
				signal: best.signal,
				confidence: level,
				weight: Math.round(weight * 100) / 100,
				reason: best.text,
				reasons: reasons.map(({ place, ...r }) => ({ ...r, weight: Math.round(r.weight * 100) / 100 })),
				place: best.place ? describePlace(src, best.place.b, best.place.mode) : null,
				flags: {
					bonus: p.tgt.category === 'bonus',
					external: p.tgt.external,
					playPossible: p.tgt.canPlay,
					capCount: null,
				},
				status: null,
				statusWhy: null,
				_anchor: best.place?.b ?? null,
				_section: src.blocks[best.place?.b ?? 0]?.section ?? null,
			};

			if (rejected.has(p.key)) continue;
			if (existingTargets.has(p.tgt.id)) continue; // уже стоит вставкой
			if (p.tgt.external && reasons.some((r) => ownByAnime.has(famKey(r.anime)))) {
				cand.status = 'отсеян';
				cand.statusWhy = 'внешняя цель, а свой материал по тайтлу есть';
			} else if (!best.place) {
				cand.status = 'отсеян';
				cand.statusWhy = 'не нашлось места по правилам';
			} else {
				// Обычная ссылка на ту же цель в абзаце места → список шага 5.
				const anchor = src.blocks[cand.place.anchorBlock];
				if (anchor?.ownLinks?.some((l) => l.target === p.tgt.id)) {
					cand.status = 'шаг 5';
					cand.statusWhy = `в абзаце уже есть обычная ссылка на цель`;
					forStep5.push(cand);
				}
				const elsewhere = src.blocks.filter((b) => b.ownLinks?.some((l) => l.target === p.tgt.id)).map((b) => textUpTo(src, b.n));
				if (elsewhere.length) cand.flags.linkElsewhere = elsewhere;
			}
			cands.push(cand);
		}

		// Раскладка по местам: лучшие по весу, с плотностью и расстоянием.
		// Порядок: сначала кандидаты по ГЛАВНОМУ тайтлу источника, потом уверенность,
		// потом вес. Второстепенный тайтл не отнимает место у главного.
		const srcRank = (x) => (x.reasons.some((r) => r.sourceLevel !== 'weighty') ? 1 : 0);
		const live = cands
			.filter((x) => !x.status)
			.sort((a, b) => srcRank(b) - srcRank(a) || LEVELS.indexOf(b.confidence) - LEVELS.indexOf(a.confidence) || b.weight - a.weight);
		const sections = new Set(live.map((x) => x._section).filter((s) => s != null));
		const cap = densityLimit(src, sections.size);
		const taken = src.blocks.filter((b) => b.kind === 'material').map((b) => b.n); // существующие вставки
		const existingCount = taken.length;
		let placed = 0;
		for (const x of live) {
			const b = x._anchor;
			const tooClose = taken.some((t) => {
				const [lo, hi] = t < b ? [t, b] : [b, t];
				let n = 0;
				for (let i = lo + 1; i <= hi; i++) if (src.blocks[i].kind === 'text') n++;
				return n < RULES.minTextBetween;
			});
			if (existingCount + placed >= cap) {
				x.status = 'запасной';
				x.statusWhy = `плотность: в посте ${src.textChars} знаков, мест ${cap}`;
			} else if (tooClose) {
				x.status = 'запасной';
				x.statusWhy = 'место занято другой вставкой рядом';
			} else {
				x.status = 'основной';
				taken.push(b);
				placed++;
			}
		}
		all.push(...cands);
	}

	// Потолок на цель: считаем существующие вставки и основных кандидатов по убыванию веса.
	const onTarget = new Map(existingOnTarget);
	for (const x of all.filter((x) => x.status === 'основной').sort((a, b) => b.weight - a.weight)) {
		const n = (onTarget.get(x.target) ?? 0) + 1;
		onTarget.set(x.target, n);
		if (n > RULES.targetCap) x.flags.capCount = n - 1;
	}

	for (const x of all) {
		delete x._anchor;
		delete x._section;
	}
	return { candidates: all, forStep5, df };
}

/**
 * Слить кандидатов двух каналов: пара источник→цель — один кандидат.
 * Если пару нашли оба канала, он сильнее каждого: уверенность на ступень выше.
 */
export function mergeCandidates(...lists) {
	const map = new Map();
	for (const list of lists) {
		for (const c of list) {
			const had = map.get(c.key);
			if (!had) {
				map.set(c.key, { ...c, channels: [...c.channels], reasons: [...c.reasons] });
				continue;
			}
			had.reasons.push(...c.reasons);
			had.channels = [...new Set([...had.channels, ...c.channels])];
			had.weight = Math.round((had.weight + c.weight) * 100) / 100;
			const lv = Math.max(LEVELS.indexOf(had.confidence), LEVELS.indexOf(c.confidence));
			had.confidence = LEVELS[Math.min(2, had.channels.length > 1 ? lv + 1 : lv)];
		}
	}
	return [...map.values()];
}
