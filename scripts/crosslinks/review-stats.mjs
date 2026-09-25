// ПЕРЕЛИНКОВКА — СТАТИСТИКА РЕШЕНИЙ РЕВЬЮ (сессия 2).
//
//   node scripts/crosslinks/review-stats.mjs [--dir <папка решений>] [--batch N]
//
// Читает статус/перелинковка/решения.json и отклонено.json (их пишет страница
// ревью, review/server.mjs) и печатает долю одобрений по виду связи,
// уверенности, виду цели и пачке, причины отказов и ручное. Это основа для
// подкрутки правил после каждой пачки: правила 1в подогнаны под 40 ответов
// Эда, и насколько они верны на всём архиве, показывает только ревью.
//
// Вид связи и уверенность берутся ИЗ ЗАПИСИ РЕШЕНИЯ (на момент решения),
// а не из нынешнего списка кандидатов: пересчёт правил не должен задним
// числом переписывать, за что Эд голосовал. Ничего не пишет.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KIND_LABEL, BATCH_LABEL } from './kinds.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const DIR = opt('--dir', join(REPO, 'статус/перелинковка'));
const onlyBatch = opt('--batch', null);

async function read(name, dflt) {
	try {
		return JSON.parse(await readFile(join(DIR, name), 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return dflt;
		throw e;
	}
}

const dec = await read('решения.json', { approved: [], deferred: [] });
const rej = (await read('отклонено.json', [])).map((x) => (typeof x === 'string' ? { key: x } : x));
let all = [...(dec.approved ?? []).map((r) => ({ ...r, state: 'approved' })), ...(dec.deferred ?? []).map((r) => ({ ...r, state: 'deferred' })), ...rej.map((r) => ({ ...r, state: 'rejected' }))];
if (onlyBatch) all = all.filter((r) => String(r.batch) === onlyBatch);
// Отказ основной при подстановке запасной — не голос против связи, а выбор
// лучшей цели; в долях по виду связи он считается, но помечен отдельно ниже.

const KIND = { ...KIND_LABEL, manual: 'своя цель' };
const TARGET = { podcast: 'выпуск', bonus: 'бонус', videoessay: 'эссе', note: 'заметка', article: 'статья', external: 'внешний' };

function table(title, keyOf, labels = {}) {
	const rows = new Map();
	for (const r of all) {
		const k = keyOf(r) ?? '—';
		if (!rows.has(k)) rows.set(k, { approved: 0, rejected: 0, deferred: 0 });
		rows.get(k)[r.state]++;
	}
	console.log(`\n${title}`);
	console.log('  ' + 'вид'.padEnd(26) + 'да'.padStart(5) + 'нет'.padStart(6) + 'отлож'.padStart(7) + 'доля «да»'.padStart(11));
	for (const [k, v] of [...rows].sort((a, b) => b[1].approved + b[1].rejected - (a[1].approved + a[1].rejected))) {
		const done = v.approved + v.rejected;
		const share = done ? `${Math.round((100 * v.approved) / done)} %` : '—';
		console.log('  ' + String(labels[k] ?? k).padEnd(26) + String(v.approved).padStart(5) + String(v.rejected).padStart(6) + String(v.deferred).padStart(7) + share.padStart(11));
	}
}

console.log(`Решений: ${all.length}${onlyBatch ? ` (пачка ${onlyBatch})` : ''} — одобрено ${all.filter((r) => r.state === 'approved').length}, отклонено ${all.filter((r) => r.state === 'rejected').length}, отложено ${all.filter((r) => r.state === 'deferred').length}. Папка: ${DIR}`);
if (!all.length) process.exit(0);
table('По виду связи', (r) => r.kind, KIND);
table('По уверенности', (r) => r.confidence);
table('По виду цели', (r) => r.targetKind, TARGET);
table('По пачке', (r) => r.batch, Object.fromEntries(Object.entries(BATCH_LABEL).map(([k, v]) => [k, `${k}: ${v}`.slice(0, 26)])));
table('По каналу', (r) => (r.channels?.length > 1 ? 'оба' : r.channels?.[0] === 'titles' ? 'тайтлы' : r.channels?.[0] === 'themes' ? 'темы' : 'ручная'));

const reasons = {};
for (const r of all.filter((r) => r.state === 'rejected')) reasons[r.reasonText ?? r.reason ?? 'без причины'] = (reasons[r.reasonText ?? r.reason ?? 'без причины'] ?? 0) + 1;
console.log('\nПричины отказов:');
for (const [k, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
const replaced = all.filter((r) => r.state === 'rejected' && r.reason === 'better' && r.comment?.startsWith('заменена на'));
if (replaced.length) console.log(`  (из «есть лучше» — заменены запасной целью: ${replaced.length})`);

const comments = all.filter((r) => r.state === 'rejected' && r.comment && !r.comment.startsWith('заменена на'));
if (comments.length) {
	console.log('\nКомментарии к отказам:');
	for (const r of comments) console.log(`  ${r.key} [${KIND[r.kind] ?? r.kind}]: ${r.comment}`);
}

const ok = all.filter((r) => r.state === 'approved');
console.log('\nРучное:');
console.log(`  своих целей: ${ok.filter((r) => r.manual).length}`);
console.log(`  подставлено из запасных: ${ok.filter((r) => r.from === 'reserve').length}`);
console.log(`  перенесённых мест: ${ok.filter((r) => r.moved).length}`);
console.log(`  «играет здесь» включено: ${ok.filter((r) => r.play).length}`);
console.log(`  своих подписей: ${ok.filter((r) => r.label).length}`);
const manual = ok.filter((r) => r.manual);
if (manual.length) {
	// Материал для будущей правки правил (решение Эда по вопросу 1 сессии 1в):
	// какие цели Эд находит сам, а поиск — нет.
	console.log('\nСвои цели Эда (материал для правки правил):');
	for (const r of manual) console.log(`  ${r.source} → ${r.target}`);
}
