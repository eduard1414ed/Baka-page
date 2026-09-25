// ПЕРЕЛИНКОВКА — ВИД СВЯЗИ И ПАЧКА РЕВЬЮ (сессия 2).
//
// Одно место на всех, кто считает по видам: volume.mjs (объём), страница
// ревью (review/model.mjs) и статистика решений (review-stats.mjs). Три
// копии правила разъехались бы молча, и доля одобрений «по человеку» на
// странице и в статистике считалась бы по-разному.
//
// Отдельным файлом, а не экспортом из volume.mjs: импорт модуля выполняет
// его целиком, и volume.mjs печатал бы свой отчёт каждому, кто спросил вид.

/** Вид связи по старшей причине канала «темы» (сессия 1в). */
export function linkKind(c) {
	const r = (c.reasons ?? []).filter((x) => x.channel === 'themes');
	if (!r.length) return 'title';
	const s = new Set(r.map((x) => x.signal));
	for (const k of ['motive', 'subject', 'person', 'studio']) if (s.has(k)) return k;
	return r.some((x) => x.broad) ? 'broad' : 'theme';
}

/** Подписи видов — те же слова, что в отчётах 1в. */
export const KIND_LABEL = {
	title: 'только тайтл',
	theme: 'тема',
	broad: 'широкая тема + сигнал',
	person: 'человек',
	studio: 'студия',
	motive: '«по мотивам»',
	subject: 'тайтл-предмет',
};

// Пачки ревью — по постам, в порядке САМОГО СИЛЬНОГО кандидата поста
// (задание сессии 2, шаг 1; порядок — отчёт 1в, раздел 9):
//   1 — есть сильный, найденный обоими каналами;
//   2 — есть сильный тайтловый;
//   3 — «по мотивам», тайтл-предмет, человек, студия;
//   4 — средние;
//   5 — слабые (их можно пропустить пачкой целиком).
export const BATCH_LABEL = {
	1: 'сильные, найденные обоими каналами',
	2: 'сильные тайтловые',
	3: '«по мотивам», тайтл-предмет, человек, студия',
	4: 'средние',
	5: 'слабые',
};

function batchOfCandidate(c) {
	if (c.confidence === 'сильный' && (c.channels ?? []).length > 1) return 1;
	if (c.confidence === 'сильный' && (c.channels ?? []).includes('titles')) return 2;
	if (['motive', 'subject', 'person', 'studio'].includes(linkKind(c))) return 3;
	if (c.confidence === 'сильный' || c.confidence === 'средний') return 4;
	return 5;
}

/** Пачка поста — по лучшему из его основных кандидатов. */
export function batchOfPost(mains) {
	return Math.min(...mains.map(batchOfCandidate));
}
