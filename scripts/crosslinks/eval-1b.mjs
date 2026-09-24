// ПЕРЕЛИНКОВКА, СЕССИЯ 1Б, ШАГ 5 — ПРОВЕРКИ ПРОБНОЙ РАЗМЕТКИ.
//
//   node scripts/crosslinks/eval-1b.mjs [--cards карточки-слепо] [--compare карточки]
//
// --cards    чьи карточки проверять (папка внутри 1b/, по умолчанию «карточки»);
// --compare  с чьими сравнивать на устойчивость (по умолчанию «карточки-повтор»).
//            Посты, которые словарь приводит примерами, в сравнении помечены «*»
//            и в среднее не входят: для них ответ подсказан словарём.
//
// Читает ~/baka-audit/crosslinks/1b/ (выборка, пачки, карточки, повтор) и
// печатает: эталон (5.1), смысловой фильтр (5.2), охват (5.3), устойчивость
// (5.4), тематические пары по выборке (5.6). Полный вывод пишет в
// 1b/проверка.json. В репозиторий не пишет ничего.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadCorpus, classifyAnime, animeName } from './lib.mjs';
import { findTitleCandidates } from './finder.mjs';
import { findThemeCandidates } from './themes.mjs';
import { applyCoverage } from './coverage.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);

const B = join(homedir(), 'baka-audit/crosslinks/1b');
const { posts: all, anime } = await loadCorpus();
const posts = all.filter((p) => p.published);
const byId = new Map(posts.map((p) => [p.id, p]));
const sample = JSON.parse(await readFile(join(B, 'выборка.json'), 'utf8'));
const sampleIds = new Set(sample.posts.map((p) => p.id));

async function readCards(dir) {
	const map = new Map();
	for (const f of (await readdir(dir)).filter((x) => x.endsWith('.json')).sort()) {
		for (const c of JSON.parse(await readFile(join(dir, f), 'utf8'))) map.set(c.id, c);
	}
	return map;
}
const cards = await readCards(join(B, arg('--cards', 'карточки')));
const cards2 = await readCards(join(B, arg('--compare', 'карточки-повтор')));
const dictText = await readFile(new URL('../../статус/перелинковка/словарь.md', import.meta.url), 'utf8');
// Примеры словаря — строки «Примеры: …» (с переносами до пустой строки).
const exampleText = dictText.split(/\n\s*\n/).map((par) => par.slice(par.indexOf('Примеры'))).filter((par) => par.startsWith('Примеры')).join('\n');
const norm = (x) => x.replace(/[«»„“"]/g, '').toLowerCase();
const cited = new Set(sample.posts.filter((p) => norm(exampleText).includes(norm(p.title).slice(0, 16)) || new RegExp(`\\b${p.id}\\b`).test(exampleText)).map((p) => p.id));
console.log(`Карточки: ${arg('--cards', 'карточки')} (${cards.size}), сравнение: ${arg('--compare', 'карточки-повтор')} (${cards2.size}); постов-примеров словаря в выборке: ${cited.size}`);
const manifest = JSON.parse(await readFile(join(B, 'пачки/пачки.json'), 'utf8'));
const qsOf = new Map(manifest.batches.flatMap((b) => b.posts).map((p) => [p.id, p.questions]));
const report = {};
const line = (s = '') => console.log(s);

// ── 5.1 ЭТАЛОН ──────────────────────────────────────────────────────────────
// Тематический канал на всём архиве как цели (motive ищет по архиву), но
// размечены только посты выборки — значит, по метке пары ищутся внутри выборки.
const { candidates: themeAll } = findThemeCandidates({ posts, cards, anime });
const { candidates: titleStrip } = findTitleCandidates({ posts, anime, stripExisting: true });
const titleByKey = new Map(titleStrip.map((c) => [c.key, c]));
const themeByKey = new Map(themeAll.map((c) => [c.key, c]));
line('═══ 5.1 ЭТАЛОН ═══');
report.etalon = [];
let found = 0;
for (const [s, t] of sample.etalon) {
	const th = themeByKey.get(`${s}→${t}`);
	const ti = titleByKey.get(`${s}→${t}`);
	const ok = Boolean(th);
	if (ok) found++;
	const why = th ? th.reasons.map((r) => `${r.signal}:${r.code ?? r.anime ?? ''} [${r.level}]`).join(', ') : '—';
	line(`${ok ? '✓' : '✗'} ${s} → ${t}\n    темы: ${why}\n    тайтлы: ${ti ? `${ti.confidence}, ${ti.status}` : '—'}`);
	report.etalon.push({ s, t, themes: th?.reasons ?? null, titles: ti ? { confidence: ti.confidence, status: ti.status } : null });
}
line(`Найдено каналом «темы»: ${found} из ${sample.etalon.length}`);

// Эталонные пары «в лоб»: какие метки у обеих сторон.
line('\nМетки сторон по эталону (главные):');
const mainsOf = (c) => (c?.labels ?? []).filter((l) => l.level !== 'мимоходом').map((l) => `${l.code}${l.level === 'раздел' ? '(р)' : ''}`).join(', ') || '—';
for (const [s, t] of sample.etalon) line(`  ${s}: ${mainsOf(cards.get(s))}\n    ${t}: ${mainsOf(cards.get(t))}`);

// ── 5.2 СМЫСЛОВОЙ ФИЛЬТР ─────────────────────────────────────────────────────
line('\n═══ 5.2 СМЫСЛОВОЙ ФИЛЬТР ═══');
function verdictFor(source, target) {
	const c = titleByKey.get(`${source}→${target}`);
	if (!c) return { asked: false, why: 'пары нет среди кандидатов канала «тайтлы»' };
	if (!['средний', 'слабый'].includes(c.confidence)) return { asked: false, why: `кандидат ${c.confidence} — фильтр к нему не применяется` };
	const src = byId.get(source);
	const aid = c.reasons.find((r) => r.channel === 'titles').sourceAnime;
	const place = src.blocks.filter((b) => b.kind !== 'material')[c.place.anchorBlock].n;
	const named = src.blocks.filter((b) => b.anime?.[aid]).map((b) => b.n);
	const block = named.filter((n) => n <= place).pop() ?? named[0] ?? null;
	const q = (qsOf.get(source) ?? []).find((x) => x.anime === aid && x.block === block);
	if (!q) return { asked: false, why: 'вопрос не задан' };
	const ans = (cards.get(source)?.filter ?? []).find((f) => f.q === q.q);
	return { asked: true, q: q.q, anime: aid, verdict: ans?.verdict, why: ans?.why, confidence: c.confidence };
}
report.filter = { keep: [], drop: [] };
let keepOk = 0, keepAsked = 0;
line('Одобренные Эдом — фильтр НЕ должен выкинуть:');
for (const [s, t, a] of sample.keep) {
	const v = verdictFor(s, t);
	if (v.asked) keepAsked++;
	const kept = !v.asked || v.verdict === 'тема';
	if (kept) keepOk++;
	line(`  ${kept ? '✓' : '✗ ВЫКИНУТ'} ${s} → ${t} («${a}»): ${v.asked ? `${v.q} ${v.verdict} [${v.confidence}] — ${v.why}` : v.why}`);
	report.filter.keep.push({ s, t, a, ...v, kept });
}
line(`Оставлено ${keepOk} из ${sample.keep.length} (спрошено ${keepAsked}).`);

line('\nЛожные находки сессии 1 — фильтр ДОЛЖЕН отсеять:');
const DROP_ANIME = {
	'sportivnaya-manga-kak-praroditel-syonenov': 'bleach',
	'reklamu-pohoron-zakazyvali': 'death-note',
	'trend-na-uskorenie': 'sousou-no-frieren',
	'anime-belyy-albom-pro-lyubov-shou-biznes-iskusstvo-muzyki': 'nana',
	'minutka-estetiki': 'naruto',
	'zrya-ty-eto-uslyshal': 'gyakkyou-burai-kaiji-ultimate-survivor',
};
let dropOk = 0;
for (const [s, a, w] of sample.drop) {
	const aid = DROP_ANIME[s];
	const qs = (qsOf.get(s) ?? []).filter((q) => q.anime === aid);
	const ans = qs.map((q) => (cards.get(s)?.filter ?? []).find((f) => f.q === q.q));
	const dropped = qs.length > 0 && ans.every((x) => x?.verdict === 'пример');
	const note = !qs.length ? (aid === 'nana' ? 'снято исключением на шаге 1 — вопроса нет' : 'вопроса нет (кандидат не средний/слабый)') : ans.map((x, i) => `${qs[i].q} ${x?.verdict} — ${x?.why}`).join('; ');
	const ok = dropped || aid === 'nana';
	if (ok) dropOk++;
	line(`  ${ok ? '✓' : '✗ ОСТАВЛЕН'} ${s} «${a}» (${w}): ${note}`);
	report.filter.drop.push({ s, a, w, qs, ans, ok });
}
line(`Отсеяно ${dropOk} из ${sample.drop.length}.`);

// Все ответы фильтра по выборке.
const allAns = [...cards.values()].flatMap((c) => (c.filter ?? []).map((f) => f.verdict));
line(`\nВсего ответов фильтра: ${allAns.length}; тема ${allAns.filter((v) => v === 'тема').length}, пример ${allAns.filter((v) => v === 'пример').length}.`);

// ── 5.3 ОХВАТ ────────────────────────────────────────────────────────────────
line('\n═══ 5.3 ОХВАТ ═══');
const cov = (id, a) => (cards.get(id)?.coverage ?? []).find((c) => c.anime === a);
const narutoIds = ['naruto', 'naruto-shippuuden'];
line('Как размечены материалы про «Наруто» в выборке:');
for (const [id, c] of cards) {
	for (const x of c.coverage ?? []) if (narutoIds.includes(x.anime)) line(`  ${id} [${byId.get(id).category}]: ${x.anime} — ${x.scope}${x.aspect ? ` (${x.aspect})` : ''}`);
	for (const x of c.subjectAnime ?? []) if (narutoIds.includes(x.anime)) line(`  ${id}: предмет по прочтению — ${x.anime}`);
}
line('\nУзкие цели в выборке (бонусы, выпуски, эссе, статьи):');
report.narrow = [];
for (const [id, c] of cards) {
	const p = byId.get(id);
	if (!['bonus', 'podcast', 'videoessay', 'article'].includes(p.category)) continue;
	for (const x of c.coverage ?? []) if (x.scope === 'узкий') {
		line(`  ${id} [${p.category}] «${p.title.slice(0, 50)}»: ${animeName(anime, x.anime)} — ${x.aspect}`);
		report.narrow.push({ id, ...x });
	}
}

// ── 5.4 УСТОЙЧИВОСТЬ ─────────────────────────────────────────────────────────
line('\n═══ 5.4 УСТОЙЧИВОСТЬ (два независимых разметчика) ═══');
const jac = (a, b) => { const A = new Set(a), Bs = new Set(b); const u = new Set([...A, ...Bs]); return u.size ? [...A].filter((x) => Bs.has(x)).length / u.size : 1; };
const mainSet = (c) => (c.labels ?? []).filter((l) => l.level !== 'мимоходом').map((l) => l.code);
report.stability = [];
const diffs = new Map();
let fa = 0, fn = 0, ca = 0, cn = 0;
for (const [id, c2] of cards2) {
	const c1 = cards.get(id);
	if (!c1) continue;
	const a = mainSet(c1), b = mainSet(c2);
	const j = jac(a, b);
	for (const x of a.filter((x) => !b.includes(x))) diffs.set(x, (diffs.get(x) ?? 0) + 1);
	for (const x of b.filter((x) => !a.includes(x))) diffs.set(x, (diffs.get(x) ?? 0) + 1);
	const pm1 = (c1.people ?? []).filter((p) => p.level === 'главный').map((p) => p.name), pm2 = (c2.people ?? []).filter((p) => p.level === 'главный').map((p) => p.name);
	const sa1 = (c1.subjectAnime ?? []).map((x) => x.anime), sa2 = (c2.subjectAnime ?? []).map((x) => x.anime);
	for (const f of c1.filter ?? []) { const g = (c2.filter ?? []).find((x) => x.q === f.q); if (g) { fn++; if (g.verdict === f.verdict) fa++; } }
	for (const x of c1.coverage ?? []) { const y = (c2.coverage ?? []).find((z) => z.anime === x.anime); if (y) { cn++; if (y.scope === x.scope) ca++; } }
	line(`  ${cited.has(id) ? '*' : ' '}${id}: метки ${j.toFixed(2)} | 1: ${a.join(', ') || '—'} | 2: ${b.join(', ') || '—'}${pm1.join() !== pm2.join() ? ` | люди: [${pm1}] vs [${pm2}]` : ''}${sa1.join() !== sa2.join() ? ` | предмет: [${sa1}] vs [${sa2}]` : ''}`);
	report.stability.push({ id, j, a, b, pm1, pm2, sa1, sa2, cited: cited.has(id) });
}
const fair = report.stability.filter((x) => !x.cited);
const avg = fair.reduce((s, x) => s + x.j, 0) / Math.max(fair.length, 1);
const same = fair.filter((x) => x.j === 1).length, part = fair.filter((x) => x.j > 0 && x.j < 1).length, none = fair.filter((x) => x.j === 0).length;
line(`Без постов-примеров (${fair.length}): средняя похожесть главных меток ${avg.toFixed(2)}; совпали целиком ${same}, частично ${part}, ничего общего ${none}.`);
line(`Со всеми (${report.stability.length}): ${(report.stability.reduce((s, x) => s + x.j, 0) / report.stability.length).toFixed(2)}.`);
line(`Прочее: фильтр совпал ${fa} из ${fn}. Охват совпал ${ca} из ${cn}.`);
line(`Метки, на которых разметчики разошлись: ${[...diffs].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ')}`);

// ── 5.3б ПРАВИЛО ОХВАТА В ДЕЛЕ ─────────────────────────────────────────────
line('\n═══ 5.3б ПРАВИЛО ОХВАТА (канал «тайтлы», выборка) ═══');
{
	const { candidates: live } = findTitleCandidates({ posts, anime, stripExisting: true });
	const mine = live.filter((c) => cards.has(c.source) && cards.has(c.target) && ['основной', 'запасной'].includes(c.status));
	const log = applyCoverage({ candidates: mine, cards, anime });
	for (const e of log) line(`  ${e.key} | «${animeName(anime, e.anime)}» | источник: ${e.source} | цель: ${e.target} → ${e.verdict}`);
	report.coverageLog = log;
	// «Наруто» во всём архиве: какие цели вообще есть и есть ли среди них общие по заголовку.
	const naru = posts.filter((p) => ['bonus', 'podcast', 'videoessay', 'article', 'note'].includes(p.category) && Object.entries(classifyAnime(p)).some(([id, x]) => ['naruto', 'naruto-shippuuden'].includes(id) && x.role === 'main'));
	line(`  Материалов, где «Наруто» главный по счётчику: ${naru.length} (выпусков ${naru.filter((p) => p.category === 'podcast').length}, бонусов ${naru.filter((p) => p.category === 'bonus').length}, заметок ${naru.filter((p) => p.category === 'note').length}).`);
}

// ── 5.6 ПРОБНЫЙ ПОИСК ПАР ────────────────────────────────────────────────────
line('\n═══ 5.6 ТЕМАТИЧЕСКИЕ ПАРЫ ПО ВЫБОРКЕ ═══');
const { candidates: themeSample, df } = findThemeCandidates({ posts, cards, anime, targetsOnly: sampleIds });
const fresh = themeSample.filter((c) => c.status !== 'уже стоит');
const bySignal = {};
for (const c of fresh) bySignal[c.signal] = (bySignal[c.signal] ?? 0) + 1;
const byLevel = {};
for (const c of fresh) byLevel[c.confidence] = (byLevel[c.confidence] ?? 0) + 1;
const srcCount = [...cards.keys()].filter((id) => ['note', 'article'].includes(byId.get(id).category) && byId.get(id).ownPage).length;
line(`Источников в выборке: ${srcCount}. Пар: ${fresh.length} (уже стоят: ${themeSample.length - fresh.length}), у источников: ${new Set(fresh.map((c) => c.source)).size}`);
line(`По сигналу: ${JSON.stringify(bySignal)}; по уверенности: ${JSON.stringify(byLevel)}`);
line(`Самые частые метки (главные, по карточкам): ${[...df].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ')}`);
for (const c of fresh.sort((a, b) => ['сильный', 'средний', 'слабый'].indexOf(a.confidence) - ['сильный', 'средний', 'слабый'].indexOf(b.confidence) || b.weight - a.weight)) {
	line(`  [${c.confidence}] ${c.source} → ${c.target} (${c.targetCategory}) | ${c.reason} | место: после [${c.place?.afterBlock}] «${c.place?.anchorWords}…» (${c.place?.mode})`);
}
report.pairs = fresh;
await writeFile(join(B, 'проверка.json'), JSON.stringify(report, null, 1));
line(`\nЗаписано: ${join(B, 'проверка.json')}`);
