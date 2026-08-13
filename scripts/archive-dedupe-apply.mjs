// УДАЛЕНИЕ ДУБЛИКАТОВ ПО РЕШЕНИЮ ЗАКАЗЧИКА (13 августа 2026).
//
// ПРАВИЛА РАЗНЫЕ ДЛЯ РАЗНЫХ СОРТОВ, и это решение заказчика, а не догадка:
//   • ДОСЛОВНЫЕ КОПИИ  — удаляется НОВЫЙ, остаётся старый;
//   • ПОЧТИ КОПИИ      — остаётся НОВЫЙ, удаляется старый;
//   • ОДИН ДЛИННЕЕ     — не трогаем вовсе.
//
// «НОВЫЙ» И «СТАРЫЙ» СЧИТАЮТСЯ ПО ДАТЕ ПОСТА, а не по номеру в адресе.
// Номер в конце адреса — это идентификатор телеграм-сообщения, и он растёт
// вместе с датой почти всегда, но «почти» тут мало: пост можно перенести
// руками, и тогда адрес соврёт. При равных датах решает номер.
//
// ЗАСЛОН: ОПУБЛИКОВАННОЕ НЕ УДАЛЯЕТСЯ НИКОГДА. У опубликованного поста есть
// живой адрес, на который могли сослаться снаружи; его снос — это 404
// на сайте, а не уборка. Если правило указывает на опубликованный —
// прогон ОСТАНАВЛИВАЕТСЯ и называет пару. Разбирать такое должен человек.
//
// Запуск:
//   node scripts/archive-dedupe-apply.mjs          — показать
//   node scripts/archive-dedupe-apply.mjs --write   — удалить

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, POSTS_DIR } from './archive-clean-lib.mjs';
// ПАРЫ ИЩЕТ ОТЧЁТ, А НЕ ЭТОТ ФАЙЛ. Второй список признаков означал бы, что
// заказчик решает по одному набору пар, а удаляется другой, — и на живых
// данных это уже случилось: пара, найденная по началу текста, пропала
// и из плана, и из заслона.
import { allPairs, plainBody } from './archive-duplicates.mjs';

/**
 * Дата поста ЧИТАЕМОЙ СТРОКОЙ — с годом.
 *
 * `String(new Date(…)).slice(0, 10)` даёт «Wed Mar 19» БЕЗ ГОДА, и в отчёте
 * о том, что старше, это уже не показ, а дезинформация: «Wed May 10» рядом
 * с «Wed Mar 19» читается как «май новее марта», хотя годы разные на два.
 * Сам порядок скрипт считает по метке времени и не ошибается — врал только
 * вывод, то есть ровно то, по чему заказчик меня и проверяет.
 */
export function humanDate(front) {
	const d = front?.date;
	const t = d instanceof Date ? d : new Date(String(d ?? ''));
	return Number.isNaN(t.getTime()) ? '(нет даты)' : t.toISOString().slice(0, 10);
}

/** Дата поста числом. Дата бывает и датой, и строкой. */
function stamp(front) {
	const d = front?.date;
	if (d instanceof Date) return d.getTime();
	const t = Date.parse(String(d ?? ''));
	return Number.isNaN(t) ? 0 : t;
}

/** Сорт пары: то же деление, что в отчёте `archive-duplicates.mjs`. */
function kindOf(a, b) {
	if (a.text === b.text) return 'дословная копия';
	const shorter = a.text.length <= b.text.length ? a : b;
	const longer = shorter === a ? b : a;
	if (longer.text.startsWith(shorter.text) || longer.text.includes(shorter.text)) return 'один длиннее';
	const words = (s) => new Set(s.split(' '));
	const wa = words(a.text);
	const wb = words(b.text);
	const common = [...wa].filter((w) => wb.has(w)).length;
	const share = common / Math.max(wa.size, wb.size);
	return share >= 0.9 ? 'почти копия' : 'разные материалы';
}

async function main() {
	const write = process.argv.includes('--write');
	const posts = (await readPostsRaw()).map((p) => ({ ...p, text: plainBody(p.body), when: stamp(p.front) }));

	const pairs = allPairs(posts);

	const plan = [];
	const blocked = [];

	for (const [a, b] of pairs) {
		const kind = kindOf(a, b);
		if (kind === 'разные материалы' || kind === 'один длиннее') continue;

		const newer = a.when === b.when ? (Number(a.front?.tgId ?? 0) >= Number(b.front?.tgId ?? 0) ? a : b) : a.when > b.when ? a : b;
		const older = newer === a ? b : a;
		const victim = kind === 'дословная копия' ? newer : older;
		const keep = victim === newer ? older : newer;

		if (!victim.draft) {
			blocked.push({ kind, victim, keep });
			continue;
		}
		plan.push({ kind, victim, keep });
	}

	console.log('═'.repeat(96));
	console.log(write ? 'УДАЛЕНИЕ ДУБЛИКАТОВ — ЗАПИСЬ' : 'УДАЛЕНИЕ ДУБЛИКАТОВ — ПОКАЗ, НИЧЕГО НЕ УДАЛЯЕТСЯ');
	console.log('═'.repeat(96));
	console.log();
	console.log('Правила заказчика: у дословных копий уходит НОВЫЙ, у почти-копий уходит СТАРЫЙ,');
	console.log('пары «один длиннее другого» не трогаются вовсе.');
	console.log();

	if (blocked.length) {
		console.log('!'.repeat(96));
		console.log(`ЗАСЛОН: правило указывает на ОПУБЛИКОВАННЫЙ пост — ${blocked.length}. НЕ УДАЛЯЮ.`);
		console.log('!'.repeat(96));
		for (const b of blocked) {
			console.log(`  ${b.kind}: под снос попал бы ОПУБЛИКОВАННЫЙ «${b.victim.id}»`);
			console.log(`      остался бы черновик «${b.keep.id}»`);
		}
		console.log();
	}

	const byKind = {};
	for (const p of plan) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
	console.log(`К удалению: ${plan.length} — ` + Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', '));
	console.log();
	for (const p of plan) {
		console.log(`  ${p.kind}`);
		console.log(`    удаляю:  ${p.victim.id}   (${humanDate(p.victim.front)}, тг ${p.victim.front?.tgId ?? '—'})`);
		console.log(`    остаётся ${p.keep.id}   (${humanDate(p.keep.front)}, тг ${p.keep.front?.tgId ?? '—'}${p.keep.draft ? '' : ', ОПУБЛИКОВАН'})`);
	}
	console.log();

	if (!write) {
		console.log('Ничего не удалено. Для удаления добавьте --write');
		return;
	}

	const { unlink } = await import('node:fs/promises');
	for (const p of plan) await unlink(new URL(p.victim.file, POSTS_DIR));
	console.log(`УДАЛЕНО файлов: ${plan.length}`);
}

const runDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
if (runDirectly) {
	main().catch((err) => {
		console.error('УДАЛЕНИЕ УПАЛО:', err);
		process.exit(1);
	});
}
