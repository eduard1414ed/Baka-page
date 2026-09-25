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
//   'person'   — человек ВЕСОМЫЙ у источника и ГЛАВНЫЙ у цели (решение Эда 1в);
//   'studio'   — студия так же: весомая у источника, главная у цели.
//                Весомость — признаки тайтла из сессии 1 (weightyMention ниже).
//                Прежние «упомянут → главный» и «главный → упомянут» отменены:
//                Эд отклонил «Самые продаваемые комиксы» → «Восемь сторон
//                Фудзимото», где Фудзимото назван один раз посреди текста;
//   'subject'  — тайтл, о котором пост «на самом деле» (subjectAnime), главный
//                у другой стороны: чинит промахи счётчика канала «тайтлы».
//
// Уверенность:
//   сильный — motive; метка редкая (df ≤ RARE_DF) и главная у обеих; человек
//             или студия главные у обеих; subject;
//   средний — метка главная у обеих, но частая; метка «в разделе» у источника;
//             человек весомый (не главный) у источника;
//   слабый  — широкая метка (поле «Широкая: да» в словаре); студия весомая,
//             но не главная у источника.
//
// ШИРОКАЯ МЕТКА ОДНА ПАРЫ НЕ ДАЁТ (решение Эда 1в): нужен второй сигнал —
// общий тайтл (весомый у источника, главный или предмет у цели), человек,
// студия, «по мотивам», тайтл-предмет или вторая общая метка. Какие метки
// широкие, говорит словарь; нет пометки — метка узкая.
// Вес — редкость метки (log N/df), как у тайтлов.

import { placeFor, describePlace, RULES } from './finder.mjs';
import { classifyAnime } from './lib.mjs';
import { fold } from '../../src/lib/animeMentions.mjs';

export const THEME_RULES = {
	motiveDays: 14,
	// Вид материала из поля ref → категории поста-цели.
	motiveKinds: { эссе: ['videoessay'], выпуск: ['podcast'], бонус: ['bonus'], Бунко: ['bonus'], пост: ['note', 'article'] },
	rareDf: 3,
	// Метки, которые связей не порождают вовсе: повод «по мотивам» работает
	// своим сигналом, а общая метка «по-мотивам» у двух постов ничего не значит.
	noPairs: ['по-мотивам'],
	// Рубрики: связь только с БЛИЖАЙШИМ ПРЕДЫДУЩИМ выпуском рубрики (решение
	// Эда 1в), а не со всеми — иначе три «Романтики сезона» дают шесть пар.
	series: ['романтика-сезона', 'анонс-сезона', 'итоги-года'],
	// Метка, которая связывает, только если у сторон общая студия
	// (пробная разметка: «Заря MAPPA» ↔ эссе про Ghibli).
	needsStudio: ['история-студии'],
	// Новость как цель: пост, где главная метка из этого списка, — о событии
	// своего времени. Из материала, написанного РАНЬШЕ новости, ссылка на неё
	// не ставится (калибровка 1в: «Какое аниме смотреть весной 2023» →
	// «Что происходит в MAPPA?» (ноябрь 2023) — «таймсенситив пост»).
	newsLabels: ['анонс', 'индустрия'],
	// «По мотивам» на эти виды встаёт за упоминанием (решение Эда 1в).
	motiveInline: ['podcast', 'bonus', 'videoessay'], // бонус — тоже выпуск с плеером (пара 1-15 калибровки)
	// Категории целей, у которых тема «в разделе» тоже связывает (ступенью ниже).
	sectionTargets: ['videoessay'],
};

const LEVELS = ['слабый', 'средний', 'сильный'];
// Время года по заголовку поста: для метки «сезон-настроение» (калибровка 1в:
// летняя подборка не ведёт на осеннюю, как разные места не связывают).
const SEASONS = [['лето', /лет(о|ом|а|н)/iu], ['осень', /осен/iu], ['зима', /зим/iu], ['весна', /весн/iu]];
const seasonOf = (post) => SEASONS.find(([, re]) => re.test(post?.title ?? ''))?.[0] ?? null;
// Вид материала рубрики «итоги года» по заголовку: манга (и ранобэ) или аниме.
const mediumOf = (post) => (/манг|ранобэ/iu.test(post?.title ?? '') ? 'манга' : 'аниме');
const daysBetween = (a, b) => (new Date(a) - new Date(b)) / 86400000;

// Основа имени для поиска в тексте: фамилия (последнее слово) у человека,
// всё название у студии; у русского слова длиннее четырёх букв отрезается
// последняя гласная, чтобы находились падежи («Хонда» → «Хонды»).
function nameStem(name, isPerson) {
	const w = fold(isPerson ? name.trim().split(/\s+/u).pop() : name.trim());
	return /[\p{Script=Cyrillic}]/u.test(w) && w.length > 4 ? w.replace(/[аяыиоуеьй]$/u, '') : w;
}
const hasStem = (text, stem) => new RegExp(`(?<![\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(fold(text ?? ''));

/**
 * Весомый ли человек (студия) у источника — признаки тайтла из сессии 1,
 * хватает одного: главный у поста; в заголовке; назван в двух блоках и
 * больше; в последнем абзаце; в заголовке раздела. Блоки — из карточки
 * разметчика и из поиска имени по тексту (разметчик пишет не все).
 */
export function weightyMention(post, entry, isPerson) {
	const why = [];
	if (entry.level === (isPerson ? 'главный' : 'главная')) why.push(isPerson ? 'главный герой поста' : 'пост о студии');
	const stem = nameStem(entry.name, isPerson);
	const blocks = new Set((entry.blocks ?? []).filter((n) => post.blocks[n]));
	for (const b of post.blocks) if (b.plain && stem.length >= 3 && hasStem(b.plain, stem)) blocks.add(b.n);
	if (stem.length >= 3 && hasStem(post.title, stem)) why.push('в заголовке');
	const named = [...blocks].filter((n) => ['text', 'heading'].includes(post.blocks[n]?.kind));
	if (named.length >= 2) why.push(`назван в ${named.length} блоках`);
	const lastText = post.blocks.filter((b) => b.kind === 'text').pop();
	if (lastText && blocks.has(lastText.n)) why.push('в последнем абзаце');
	if (named.some((n) => post.blocks[n].kind === 'heading')) why.push('в заголовке раздела');
	return { weighty: why.length > 0, why, blocks: [...blocks].sort((a, b) => a - b) };
}

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
 * @param {Set<string>} [opts.broad]  широкие метки (dictionary.readDictionary().broad);
 *        не передано — все метки узкие
 */
export function findThemeCandidates({ posts, cards, anime, targetsOnly = null, rejected = new Set(), broad = new Set(), occasions = new Set() }) {
	const byId = new Map(posts.map((p) => [p.id, p]));
	const nameOf = new Map(anime.map((a) => [a.id, a.data.titleRu || a.data.titleOriginal || a.id]));
	const franchiseOf = new Map(anime.map((a) => [a.id, a.data.franchise || null]));
	const fam = (id) => franchiseOf.get(id) || id;
	// Название по ключу семьи (франшиза или id): для подписи «общий тайтл» —
	// самое короткое в семье («Фрирен», а не «Фрирен 2»).
	const famName = new Map();
	for (const a of anime) {
		const k = fam(a.id), n = nameOf.get(a.id);
		if (!famName.has(k) || n.length < famName.get(k).length) famName.set(k, n);
	}

	// Редкость меток — по всем карточкам.
	const df = new Map();
	for (const c of cards.values()) for (const code of new Set((c.labels ?? []).filter((l) => l.level !== 'мимоходом').map((l) => l.code))) df.set(code, (df.get(code) ?? 0) + 1);
	const N = Math.max(cards.size, 1);
	const idf = (code) => Math.log((N + 1) / (df.get(code) ?? 1));

	// Общий тайтл как второй сигнал для широкой метки: у источника весомый
	// или предмет, у цели главный или предмет (с точностью до франшизы).
	const srcTitles = new Map();
	const tgtTitles = new Map();
	for (const [id, c] of cards) {
		const p = byId.get(id);
		if (!p) continue;
		const cls = classifyAnime(p);
		const subj = (c.subjectAnime ?? []).map((a) => fam(a.anime));
		srcTitles.set(id, new Set([...Object.entries(cls).filter(([, x]) => x.weighty).map(([a]) => fam(a)), ...subj]));
		tgtTitles.set(id, new Set([...Object.entries(cls).filter(([, x]) => x.role === 'main').map(([a]) => fam(a)), ...subj]));
	}
	// Рубрики: посты с главной меткой рубрики, по дате — ближайший предыдущий.
	// Выпуск рубрики — только ОБЗОР (ни одного главного тайтла по счётчику):
	// заметка о премьере одного сериала с меткой «анонс сезона» выпуском
	// рубрики не является (калибровка 1в: «Лучшая премьера весны —
	// Троецарствие» → «10 ожидаемых аниме зимы 2026» — «пост про конкретное аниме»).
	const isOverview = (id) => !Object.values(classifyAnime(byId.get(id))).some((x) => x.role === 'main');
	const seriesPosts = new Map(THEME_RULES.series.map((code) => [code, [...cards].filter(([id, c]) => byId.get(id)?.date && (c.labels ?? []).some((l) => l.code === code && l.level === 'главная') && isOverview(id)).map(([id]) => id).sort((a, b) => (byId.get(a).date < byId.get(b).date ? -1 : 1))]));
	const prevInSeries = (code, sid) => {
		const d = byId.get(sid)?.date;
		const earlier = (seriesPosts.get(code) ?? []).filter((id) => id !== sid && byId.get(id).date < d);
		return earlier.at(-1) ?? null;
	};
	const dropped = { broadAlone: 0, personNotWeighty: 0, personNotMainAtTarget: 0, newsLater: 0 };

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
			// У видеоэссе цель — и тема «в разделе»: эссе длиной в час, его раздел —
			// несколько минут разговора о теме, почти отдельный материал. Выжимки
			// эссе (сессия 1в) дают разметчику именно разделы: «рыбалка» в ep-126,
			// «вечное лето» в ep-153 стоят разделами, а Эд эти пары одобрил.
			const tMain = new Map([...mains(tc), ...(THEME_RULES.sectionTargets.includes(tgt.category) ? [...(tc.labels ?? [])].filter((l) => l.level === 'раздел' && !THEME_RULES.noPairs.includes(l.code) && !mains(tc).has(l.code)).map((l) => [l.code, l]) : [])]);
			const studiosOf = (c) => new Set((c.studios ?? []).map((x) => x.name));
			const shareStudio = [...studiosOf(sc)].some((x) => studiosOf(tc).has(x));
			for (const [code, tl] of tMain) {
				// Рубрика связывает, только если у источника она главная: «Романтика
				// сезона» с разделом «анонс сезона» на анонсы не ведёт (калибровка 1в).
				const sl = sMain.get(code) ?? (THEME_RULES.series.includes(code) ? null : sSection.get(code));
				if (!sl) continue;
				if (THEME_RULES.needsStudio.includes(code) && !shareStudio) continue;
				if (THEME_RULES.series.includes(code) && (!isOverview(sid) || prevInSeries(code, sid) !== tid)) continue;
				// «Итоги года» — только тот же вид: манга с мангой, аниме с аниме
				// (калибровка 1в: «Самая продаваемая манга» → «Лучшие аниме-сериалы» — нет).
				if (code === 'итоги-года' && mediumOf(src) !== mediumOf(tgt)) continue;
				const isBroad = broad.has(code);
				const inSection = sl.level === 'раздел';
				const rare = (df.get(code) ?? 0) <= THEME_RULES.rareDf;
				const tSection = tl.level === 'раздел';
				const level = isBroad ? 'слабый' : inSection || tSection || !rare ? 'средний' : 'сильный';
				const place = code === 'реальные-места' ? (sl.place && tl.place && sl.place === tl.place ? sl.place : null) : '';
				if (place === null) continue; // разные места — не связь
				// «Настроение времени года» — только одно и то же время года.
				if (code === 'сезон-настроение' && (!seasonOf(src) || seasonOf(src) !== seasonOf(tgt))) continue;
				add(tid, {
					signal: 'label',
					code,
					broad: isBroad,
					level,
					// Цель о теме в целом (обзор, подборка — без главного тайтла) лучше
					// цели об одном тайтле (калибровка 1в: «лучше дать ссылку на статью
					// про исекаи вообще», а не на «Слизь»).
					weight: idf(code) * (inSection ? 0.6 : 1) * (isOverview(tid) ? 1.5 : 0.7),
					blocks: sl.blocks,
					labelLevel: sl.level,
					text: `общая тема «${code}»${place ? ` (${place})` : ''}: у источника ${inSection ? 'главная в разделе' : 'главная'}, у цели ${tSection ? 'раздел эссе' : 'главная'}; тема встречается в ${df.get(code)} размеченных постах`,
				});
			}
			// Человек и студия: весомые у источника, главные у цели.
			for (const [kind, isPerson, main] of [['people', true, 'главный'], ['studios', false, 'главная']]) {
				for (const se of sc[kind] ?? []) {
					const te = (tc[kind] ?? []).find((x) => x.name === se.name);
					if (!te) continue;
					if (te.level !== main) {
						dropped.personNotMainAtTarget++;
						continue;
					}
					const w = weightyMention(src, se, isPerson);
					if (!w.weighty) {
						dropped.personNotWeighty++;
						continue;
					}
					const both = se.level === main;
					const who = isPerson ? `общий человек: ${se.name} (${se.role})` : `общая студия: ${se.name}`;
					add(tid, {
						signal: isPerson ? 'person' : 'studio',
						// Студия, весомая, но не главная у источника, — слабая: в 1б все
						// шесть таких пар из анонсов сезона («MAPPA делает три сериала
						// сезона») были сомнительными. У человека такая связь средняя.
						level: both ? 'сильный' : isPerson ? 'средний' : 'слабый',
						weight: both ? 2 : 1,
						blocks: se.blocks?.length ? se.blocks : w.blocks,
						labelLevel: both ? 'главная' : 'мимоходом',
						text: `${who} — у источника ${both ? main : 'весомый: ' + w.why.join(', ')}, у цели ${main}`,
					});
				}
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
			// Новость, вышедшая позже источника, — не цель (THEME_RULES.newsLabels).
			const tgtNews = (cards.get(tid)?.labels ?? []).some((l) => l.level === 'главная' && THEME_RULES.newsLabels.includes(l.code));
			if (tgtNews && byId.get(tid)?.date && src.date && byId.get(tid).date > src.date) {
				dropped.newsLater++;
				continue;
			}
			// Широкая метка одна пары не даёт: нужен второй сигнал.
			const labels = reasons.filter((r) => r.signal === 'label');
			const others = reasons.filter((r) => r.signal !== 'label');
			// Одна узкая ТЕМА без второго сигнала — слабая связь (калибровка 1в,
			// круг 3: 7 отказов из 10; взамен Эд называл цель по тайтлу или
			// человеку). Поводы (праздник, время года, рубрика) и «реальные места»
			// с тем же местом — исключение: по ним Эд соглашался (Рождество, Коулун).
			if (!others.length && labels.length === 1 && !labels[0].broad && !occasions.has(labels[0].code) && labels[0].code !== 'реальные-места') {
				labels[0].level = 'слабый';
				labels[0].text += '; одна общая тема без общего тайтла или человека — слабая связь';
			}
			if (!others.length && labels.length === 1 && labels[0].broad) {
				const common = [...(srcTitles.get(sid) ?? [])].filter((a) => tgtTitles.get(tid)?.has(a));
				if (!common.length) {
					dropped.broadAlone++;
					continue;
				}
				labels[0].text += `; второй сигнал — общий тайтл «${famName.get(common[0]) ?? common[0]}»`;
			} else if (labels.some((r) => r.broad)) {
				for (const r of labels.filter((x) => x.broad)) r.text += '; тема широкая, пару держит второй сигнал';
			}
			const tgt = byId.get(tid);
			reasons.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.weight - a.weight);
			const best = reasons[0];
			// «По мотивам» на выпуск подкаста или эссе — сразу за словами о нём
			// («плеером сразу»); на остальное — как у темы поста, в конце.
			// Решение Эда 25.09.2026 (сессия 1в, после отчёта 07).
			const placeLevel = best.signal === 'motive' && THEME_RULES.motiveInline.includes(tgt.category) ? 'мимоходом' : best.labelLevel;
			const p = best.blocks?.length ? placeForBlocks(src, best.blocks, placeLevel) : null;
			let at = p;
			if (!at) {
				// Нет места по блокам — конец поста, как у тайтлов «назван только в заголовке».
				const tail = src.blocks.filter((b) => b.kind === 'text').pop();
				at = tail ? { b: tail.n, mode: 'конец' } : null;
			}
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
				// Место — в том же виде, что у канала «тайтлы» (finder.describePlace):
				// совместная расстановка (pipeline.mjs) сравнивает их между собой.
				place: at ? describePlace(src, at.b, at.mode) : null,
				flags: { existing: existing.has(tid) },
				status: existing.has(tid) ? 'уже стоит' : null,
			});
		}
	}
	return { candidates: out, df, dropped };
}
