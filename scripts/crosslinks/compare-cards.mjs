// ПЕРЕЛИНКОВКА — СВЕРКА ДВУХ РАЗМЕТОК ОДНИХ ПОСТОВ (сессия 1в).
//
//   node scripts/crosslinks/compare-cards.mjs <папка или файл А> <папка или файл Б> [--except код,код]
//
// Похожесть главных меток — та же формула, что в 1б (eval-1b.mjs, «устойчивость»):
// у каждого поста доля общих меток уровня «главная» и «раздел» среди всех
// (Жаккар), затем среднее по постам, размеченным в обоих наборах.
// --except убирает метки из сравнения с обеих сторон: нужно, когда определение
// метки поменялось между разметками (1в: `история-жанра` сужена, `вечное-лето`
// новая) — иначе расхождение считается шумом разметчика, а это правка словаря.
// Плюс совпадение ответов фильтра, охвата, главных людей и тайтлов-предметов.
// Ничего не пишет.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const except = new Set(args.includes('--except') ? args[args.indexOf('--except') + 1].split(',') : []);
const [a, b] = args.filter((x, i) => !x.startsWith('--') && args[i - 1] !== '--except');

export async function readCardSet(path) {
	const files = (await stat(path)).isDirectory() ? (await readdir(path)).filter((f) => f.endsWith('.json')).sort().map((f) => join(path, f)) : [path];
	const map = new Map();
	for (const f of files) for (const c of JSON.parse(await readFile(f, 'utf8'))) map.set(c.id, c);
	return map;
}

export function compareCards(A, B, { except = new Set() } = {}) {
	const jac = (x, y) => {
		const X = new Set(x), Y = new Set(y), U = new Set([...X, ...Y]);
		return U.size ? [...X].filter((v) => Y.has(v)).length / U.size : 1;
	};
	const mains = (c) => (c.labels ?? []).filter((l) => l.level !== 'мимоходом' && !except.has(l.code)).map((l) => l.code);
	const rows = [];
	let fa = 0, fn = 0, ca = 0, cn = 0, pa = 0, sa = 0;
	for (const [id, c1] of A) {
		const c2 = B.get(id);
		if (!c2) continue;
		const x = mains(c1), y = mains(c2);
		const pm = (c) => (c.people ?? []).filter((p) => p.level === 'главный').map((p) => p.name).sort().join(', ');
		const subj = (c) => (c.subjectAnime ?? []).map((s) => s.anime).sort().join(', ');
		for (const f of c1.filter ?? []) {
			const g = (c2.filter ?? []).find((z) => z.q === f.q);
			if (g) (fn++, g.verdict === f.verdict && fa++);
		}
		for (const v of c1.coverage ?? []) {
			const w = (c2.coverage ?? []).find((z) => z.anime === v.anime);
			if (w) (cn++, w.scope === v.scope && ca++);
		}
		if (pm(c1) === pm(c2)) pa++;
		if (subj(c1) === subj(c2)) sa++;
		rows.push({ id, j: jac(x, y), a: x, b: y, peopleA: pm(c1), peopleB: pm(c2), subjA: subj(c1), subjB: subj(c2) });
	}
	const n = rows.length;
	return {
		n,
		labels: rows.reduce((s, r) => s + r.j, 0) / Math.max(n, 1),
		same: rows.filter((r) => r.j === 1).length,
		none: rows.filter((r) => r.j === 0).length,
		filter: fn ? fa / fn : null,
		filterN: fn,
		coverage: cn ? ca / cn : null,
		people: n ? pa / n : null,
		subject: n ? sa / n : null,
		rows,
	};
}

if (a && b) {
	const r = compareCards(await readCardSet(a), await readCardSet(b), { except });
	for (const x of r.rows) {
		const extra = [x.peopleA !== x.peopleB ? `люди: [${x.peopleA}] / [${x.peopleB}]` : '', x.subjA !== x.subjB ? `предмет: [${x.subjA}] / [${x.subjB}]` : ''].filter(Boolean).join(' | ');
		console.log(`${x.j.toFixed(2)} ${x.id} | А: ${x.a.join(', ') || '—'} | Б: ${x.b.join(', ') || '—'}${extra ? ' | ' + extra : ''}`);
	}
	const pct = (v) => (v == null ? '—' : v.toFixed(2));
	console.log(`\nПостов в обоих: ${r.n}${except.size ? `; без меток: ${[...except].join(', ')}` : ''}`);
	console.log(`Похожесть главных меток: ${pct(r.labels)} (совпали целиком ${r.same}, ничего общего ${r.none})`);
	console.log(`Фильтр: ${pct(r.filter)} из ${r.filterN}; охват: ${pct(r.coverage)}; главные люди: ${pct(r.people)}; предмет: ${pct(r.subject)}`);
}
