// ПЕРЕЛИНКОВКА — ПРАВИЛО ОХВАТА (сессия 1б).
//
// Ничего не пишет. Поверх кандидатов канала «тайтлы» и карточек разметчика.
//
// Правило (случай «Наруто. Бикочу»):
//   1. Источник про тайтл В ЦЕЛОМ (охват «общий» или охвата нет) → узкая цель
//      по этому тайтлу уступает общей: если у источника есть кандидат на цель
//      с общим охватом по тому же тайтлу, узкий становится запасным.
//   2. Источник УЗКИЙ (о конкретном аспекте) → узкая цель остаётся, если
//      у неё с источником общая главная метка словаря (тот же аспект:
//      «какие филлеры смотреть» → бонус о филлерной арке). Иначе — как в п. 1.
//   3. Общей цели по тайтлу нет вовсе → узкая остаётся, но на ступень ниже
//      по уверенности и с пометкой: на ревью видно, что лучше цели нет.
// Охват берётся из карточки: у источника — по тайтлу-причине, у цели — по нему же
// (сначала точное совпадение тайтла, потом франшиза: у «Человека-бензопилы»
// и фильма «Резе» одна франшиза, а охват разный). Нет карточки или охвата —
// правило молчит.
// «Общая» цель — только та, где тайтл главный (по счётчику или по прочтению):
// обзор сезона на двадцать тайтлов ставит каждому охват «общий», но материалом
// «про тайтл в целом» не является (проверка на 71, сессия 1в: «Ещё рыбалка»
// уступала «Обзору всех аниме зимы 2022»).

const LEVELS = ['слабый', 'средний', 'сильный'];

import { classifyAnime } from './lib.mjs';

export function applyCoverage({ candidates, cards, anime, posts = null }) {
	const franchiseOf = new Map(anime.map((a) => [a.id, a.data.franchise || null]));
	const fam = (id) => franchiseOf.get(id) || id;
	const covOf = (postId, animeId) => {
		const list = cards.get(postId)?.coverage ?? [];
		return list.find((c) => c.anime === animeId) ?? list.find((c) => fam(c.anime) === fam(animeId)) ?? null;
	};
	const byId = posts ? new Map(posts.map((p) => [p.id, p])) : null;
	const mainAt = (postId, animeId) => {
		if (!byId?.get(postId)) return true; // без постов — как раньше
		const cls = classifyAnime(byId.get(postId));
		const subj = (cards.get(postId)?.subjectAnime ?? []).map((s) => fam(s.anime));
		return Object.entries(cls).some(([a, x]) => x.role === 'main' && fam(a) === fam(animeId)) || subj.includes(fam(animeId));
	};
	const mainLabels = (postId) => new Set((cards.get(postId)?.labels ?? []).filter((l) => l.level === 'главная').map((l) => l.code));
	const log = [];

	const bySource = new Map();
	for (const c of candidates) {
		if (!bySource.has(c.source)) bySource.set(c.source, []);
		bySource.get(c.source).push(c);
	}
	// Тайтловые причины и тайтл-предмет канала «темы» — у обоих есть тайтл.
	const animeReasons = (c) => (c.reasons ?? []).filter((x) => x.channel === 'titles' || x.signal === 'subject').map((x) => ({ anime: x.anime, sourceAnime: x.sourceAnime ?? x.anime }));
	// Тот же аспект у двух узких материалов: общая главная метка ИЛИ общее
	// содержательное слово в описании аспекта («новелла о Какаши» и «арка
	// „Какаши Гайден“» — калибровка 1в: вместо выпуска про Какаши правило
	// выбирало арку «Спасение Казекаге»).
	const STOP = new Set(['арка', 'арки', 'сезон', 'сезона', 'серия', 'серии', 'фильм', 'фильма', 'персонаж', 'персонажа', 'аниме', 'манга', 'манги', 'тема', 'сериала', 'сериал', 'первый', 'второй', 'третий', 'одного', 'один', 'одна', 'пример', 'примера', 'эпизод', 'эпизода', 'история', 'истории', 'новый', 'новая', 'роль', 'приём', 'детали', 'деталь']);
	const words = (s) => new Set((s ?? '').toLowerCase().replace(/[«»„“"()]/gu, ' ').split(/[^\p{L}]+/u).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));
	const sameAspectOf = (src, sCov, tgt, tCov) => {
		if (sCov?.scope !== 'узкий') return false;
		if ([...mainLabels(src)].some((x) => mainLabels(tgt).has(x))) return 'общая главная метка';
		const a = words(sCov.aspect), b = words(tCov?.aspect);
		const w = [...a].find((x) => b.has(x));
		return w ? `общее в аспекте («${w}…»)` : false;
	};

	for (const [src, list] of bySource) {
		for (const c of list) {
			// Цель узкая, только если узкая по ВСЕМ общим тайтлам пары: у пары
			// «фильм „Резе“ → бонус „История Резе“» общие и сериал (по нему бонус
			// узкий), и сам фильм (по нему общий) — это точное попадание.
			const rs = animeReasons(c);
			if (!rs.length) continue;
			if (rs.some((x) => covOf(c.target, x.anime)?.scope !== 'узкий')) continue;
			const r = rs[0];
			const tCov = covOf(c.target, r.anime);
			const sCov = covOf(src, r.sourceAnime);
			// Цель, совпадающая с разделом источника по двум главным тайтлам и больше
			// (pipeline: flags.sectionFit), — точное попадание, а не «узкая».
			if ((c.flags?.sectionFit ?? 0) >= 2) {
				log.push({ key: c.key, anime: r.anime, verdict: 'остаётся: совпадает с разделом по двум тайтлам' });
				continue;
			}
			const sameAspect = sameAspectOf(src, sCov, c.target, tCov);
			const entry = { key: c.key, anime: r.anime, source: sCov ? `${sCov.scope}${sCov.aspect ? ` (${sCov.aspect})` : ''}` : 'нет разметки', target: `узкий (${tCov.aspect})` };
			if (sameAspect) {
				entry.verdict = `остаётся: тот же аспект (${sameAspect})`;
				log.push(entry);
				continue;
			}
			// Узкая цель с тем же аспектом по тому же тайтлу — лучше общей.
			const aspectTwin = list.find((o) => o !== c && animeReasons(o).some((x) => fam(x.anime) === fam(r.anime)) && covOf(o.target, r.anime)?.scope === 'узкий' && sameAspectOf(src, sCov, o.target, covOf(o.target, r.anime)));
			const general = list.find((o) => o !== c && animeReasons(o).some((x) => fam(x.anime) === fam(r.anime)) && covOf(o.target, r.anime)?.scope === 'общий' && mainAt(o.target, r.anime));
			// Источник узкий → узкая цель остаётся, даже если есть общая (решение
			// Эда 1в, шаг 7: «Цугаи» — Эд сам связывал узкие разборы между собой);
			// уступает она только цели о том же аспекте.
			const better = aspectTwin ?? (sCov?.scope === 'узкий' ? null : general);
			if (!better && sCov?.scope === 'узкий') {
				entry.verdict = 'остаётся: источник тоже узкий';
				log.push(entry);
				continue;
			}
			if (better) {
				if (c.status === 'основной') c.status = 'запасной';
				c.statusWhy = aspectTwin ? `узкая цель уступает цели о том же «${aspectTwin.targetTitle}»` : `узкая цель уступает общей «${general.targetTitle}»`;
				entry.verdict = `${aspectTwin ? 'уступает той же по аспекту' : 'уступает общей'}: ${better.target}`;
			} else {
				c.confidence = LEVELS[Math.max(0, LEVELS.indexOf(c.confidence) - 1)];
				c.flags = { ...(c.flags ?? {}), noGeneralTarget: true };
				entry.verdict = 'общей цели нет — остаётся ступенью ниже';
			}
			log.push(entry);
		}
	}
	return log;
}
