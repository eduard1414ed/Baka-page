// ПЕРЕЛИНКОВКА, ШАГ 4 — ПРОВЕРКА ПОИСКОВИКА НА СУЩЕСТВУЮЩИХ ВСТАВКАХ ЭДА.
//
//   node scripts/crosslinks/check71.mjs [--out <файл.md>]
//
// Поисковику дают посты БЕЗ их вставок (убираются в памяти, файлы не трогаются)
// и спрашивают, нашёл ли он ту же цель, туда ли поставил и насколько уверен.
// Вставка считается «тайтловой», если у источника и цели есть общий тайтл
// (или родственный по франшизе), и у цели он не мимоходом. Остальные — эталон
// для канала «темы» (сессия 1б).

import { writeFile } from 'node:fs/promises';
import { loadCorpus, classifyAnime, animeName } from './lib.mjs';
import { findTitleCandidates } from './finder.mjs';

const args = process.argv.slice(2);
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

const { posts: all, anime } = await loadCorpus();
const posts = all.filter((p) => p.published);
const byId = new Map(posts.map((p) => [p.id, p]));
const franchiseOf = new Map(anime.map((a) => [a.id, a.data.franchise || null]));
const { candidates } = findTitleCandidates({ posts, anime, stripExisting: true });
const byKey = new Map(candidates.map((c) => [c.key, c]));

// Позиция вставки Эда в посте без вставок: номер текстового абзаца перед ней.
const rows = [];
for (const p of posts) {
	let textN = 0;
	for (const b of p.blocks) {
		if (b.kind === 'text') textN++;
		if (b.kind !== 'material') continue;
		const tgt = byId.get(b.target);
		const cs = classifyAnime(p);
		const ct = tgt ? classifyAnime(tgt) : {};
		const shared = Object.keys(cs).filter((id) => ct[id] && ct[id].role !== 'passing');
		const fam = Object.keys(cs).filter((id) => franchiseOf.get(id) && Object.keys(ct).some((t) => t !== id && ct[t].role !== 'passing' && franchiseOf.get(t) === franchiseOf.get(id)));
		const anyShared = Object.keys(cs).filter((id) => ct[id]);
		const c = byKey.get(`${p.id}→${b.target}`);
		// Кто занял место, если цель Эда ушла в запасные: основной кандидат того же
		// источника на ближайшем месте. «Равноценная» — если связь по той же франшизе.
		let instead = '';
		if (c && c.status === 'запасной') {
			const rivals = candidates.filter((x) => x.source === p.id && x.status === 'основной' && x.place);
			const near = rivals.sort((a, b2) => Math.abs(a.place.afterTextN - (c.place?.afterTextN ?? 0)) - Math.abs(b2.place.afterTextN - (c.place?.afterTextN ?? 0)))[0];
			if (near) {
				const fam = (id) => franchiseOf.get(id) || id;
				const same = near.reasons.some((r) => c.reasons.some((q) => fam(q.anime) === fam(r.anime)));
				instead = `${near.target} (${near.targetCategory}) — ${same ? 'равноценная, тот же тайтл' : 'другой тайтл'}`;
			} else instead = 'основного нет';
		}
		let where = '—';
		if (c?.place) {
			const d = Math.abs(c.place.afterTextN - textN);
			where = d === 0 ? 'то же' : d === 1 ? 'соседний' : `далеко (${c.place.afterTextN} против ${textN})`;
		}
		rows.push({
			source: p.id,
			sourceCat: p.category,
			target: b.target,
			targetCat: tgt?.category ?? '?',
			edTextN: textN,
			type: shared.length || fam.length ? 'тайтл' : 'тема',
			shared: [...shared, ...fam.map((x) => '~' + x)],
			anyShared,
			found: c ? c.status : 'нет',
			confidence: c?.confidence ?? '',
			signal: c?.signal ?? '',
			mine: c?.place ? `${c.place.afterTextN} (${c.place.mode})` : '',
			where,
			reason: c?.reason ?? '',
			instead,
			statusWhy: c?.statusWhy ?? '',
		});
	}
}

const t = rows.filter((r) => r.type === 'тайтл');
const th = rows.filter((r) => r.type === 'тема');
const cnt = (xs, f) => xs.filter(f).length;
const lines = [];
const say = (s = '') => lines.push(s);
say(`Вставок: ${rows.length}; тайтловых ${t.length}, тематических ${th.length}.`);
say(`Тайтловые: цель найдена ${cnt(t, (r) => r.found !== 'нет')} из ${t.length} (основной ${cnt(t, (r) => r.found === 'основной')}, запасной ${cnt(t, (r) => r.found === 'запасной')}, шаг 5 ${cnt(t, (r) => r.found === 'шаг 5')}, отсеян ${cnt(t, (r) => r.found === 'отсеян')}).`);
say(`Запасные: равноценная замена по тому же тайтлу ${cnt(t, (r) => r.instead.includes('равноценная'))}, вытеснены другим тайтлом ${cnt(t, (r) => r.instead.includes('другой тайтл'))}.`);
say(`Место (из найденных с местом): то же ${cnt(t, (r) => r.where === 'то же')}, соседний ${cnt(t, (r) => r.where === 'соседний')}, далеко ${cnt(t, (r) => r.where.startsWith('далеко'))}.`);
say(`Уверенность у найденных: сильный ${cnt(t, (r) => r.confidence === 'сильный')}, средний ${cnt(t, (r) => r.confidence === 'средний')}, слабый ${cnt(t, (r) => r.confidence === 'слабый')}.`);
say(`Тематические, которые канал «тайтлы» всё равно нашёл: ${cnt(th, (r) => r.found !== 'нет')} из ${th.length}.`);
say();
say('| источник | → цель | тип | общий тайтл | найден | уверенность | место Эда | моё место | совпадение | вместо | почему |');
say('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows.sort((a, b) => a.type.localeCompare(b.type) || a.found.localeCompare(b.found))) {
	say(`| ${r.source} (${r.sourceCat}) | ${r.target} (${r.targetCat}) | ${r.type} | ${r.shared.map((x) => (x.startsWith('~') ? '~' + animeName(anime, x.slice(1)) : animeName(anime, x))).join(', ') || (r.anyShared.length ? 'мимоходом: ' + r.anyShared.map((x) => animeName(anime, x)).join(', ') : '—')} | ${r.found} | ${r.confidence} | ${r.edTextN} | ${r.mine} | ${r.where} | ${r.instead} | ${r.statusWhy || r.reason} |`);
}
const text = lines.join('\n');
if (outFile) await writeFile(outFile, text);
console.log(text);
