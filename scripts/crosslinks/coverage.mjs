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
// (с точностью до франшизы). Нет карточки или охвата — правило молчит.

const LEVELS = ['слабый', 'средний', 'сильный'];

export function applyCoverage({ candidates, cards, anime }) {
	const franchiseOf = new Map(anime.map((a) => [a.id, a.data.franchise || null]));
	const fam = (id) => franchiseOf.get(id) || id;
	const covOf = (postId, animeId) => (cards.get(postId)?.coverage ?? []).find((c) => fam(c.anime) === fam(animeId)) ?? null;
	const mainLabels = (postId) => new Set((cards.get(postId)?.labels ?? []).filter((l) => l.level === 'главная').map((l) => l.code));
	const log = [];

	const bySource = new Map();
	for (const c of candidates) {
		if (!bySource.has(c.source)) bySource.set(c.source, []);
		bySource.get(c.source).push(c);
	}
	for (const [src, list] of bySource) {
		for (const c of list) {
			const r = (c.reasons ?? []).find((x) => x.channel === 'titles');
			if (!r) continue;
			const tCov = covOf(c.target, r.anime);
			if (!tCov || tCov.scope !== 'узкий') continue;
			const sCov = covOf(src, r.sourceAnime);
			const sameAspect = sCov?.scope === 'узкий' && [...mainLabels(src)].some((x) => mainLabels(c.target).has(x));
			const entry = { key: c.key, anime: r.anime, source: sCov ? `${sCov.scope}${sCov.aspect ? ` (${sCov.aspect})` : ''}` : 'нет разметки', target: `узкий (${tCov.aspect})` };
			if (sameAspect) {
				entry.verdict = 'остаётся: тот же аспект (общая главная метка)';
			} else {
				const general = list.find((o) => o !== c && fam(o.reasons?.find((x) => x.channel === 'titles')?.anime ?? '') === fam(r.anime) && covOf(o.target, r.anime)?.scope === 'общий');
				if (general) {
					if (c.status === 'основной') c.status = 'запасной';
					c.statusWhy = `узкая цель уступает общей «${general.targetTitle}»`;
					entry.verdict = `уступает общей: ${general.target}`;
				} else {
					c.confidence = LEVELS[Math.max(0, LEVELS.indexOf(c.confidence) - 1)];
					c.flags = { ...(c.flags ?? {}), noGeneralTarget: true };
					entry.verdict = 'общей цели нет — остаётся ступенью ниже';
				}
			}
			log.push(entry);
		}
	}
	return log;
}
