// ПОИСК ДУБЛИКАТОВ ПОСТОВ. ТОЛЬКО ПОКАЗЫВАЕТ, НИЧЕГО НЕ УДАЛЯЕТ.
//
// Часть материалов выходила в телеграме по нескольку раз (обновляемые списки,
// перезапощенное), и импорт завёл на каждый выход свой пост.
//
// ГЛАВНОЕ ПРАВИЛО ФАЙЛА: СНОС ДУБЛЯ — ЭТО НЕ ТОЛЬКО УДАЛЕНИЕ ФАЙЛА, НО И
// ПОТЕРЯ ТОГО, ЧЕМ ОН ОТЛИЧАЛСЯ. Поэтому у каждой пары печатается не «дубль»,
// а РАЗНИЦА: длина текста, дата, номер в телеграме, категория, обложка,
// внешняя ссылка, и чем тела расходятся. Решение принимает заказчик.
//
// И ВТОРОЕ: ЧЕРНОВИК И ОПУБЛИКОВАННОЕ В СПИСКЕ ВЫГЛЯДЯТ ОДИНАКОВО, А ЦЕНА
// СНОСА У НИХ РАЗНАЯ. Опубликованный дубль помечается отдельно и крупно:
// у него есть адрес, на который могли сослаться снаружи.
//
// Запуск: node scripts/archive-duplicates.mjs

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, parseBody } from './archive-clean-lib.mjs';

const txtOf = (n) =>
	n.type === 'text' || n.type === 'inlineCode' ? (n.value ?? '') : (n.children ?? []).map(txtOf).join('');

/** Голый текст тела: без картинок, врезок и меток — только слова. */
function plainBody(body) {
	const blocks = parseBody(body).children ?? [];
	return blocks
		.filter((b) => b.type === 'paragraph' || b.type === 'heading' || b.type === 'list')
		.map(txtOf)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Название, приведённое к сравнимому виду. */
const normTitle = (t) =>
	String(t ?? '')
		.toLowerCase()
		.replace(/ё/g, 'е')
		.replace(/[«»„“”"'`’]/g, '')
		.replace(/[^a-zа-я0-9]+/gi, ' ')
		.trim();

/** Первые слова текста — ими ловятся копии с подправленным заголовком. */
const opening = (t) => t.slice(0, 120).toLowerCase().replace(/[^a-zа-я0-9 ]/gi, '');

/**
 * ПРИЗНАКИ, ПО КОТОРЫМ ИЩУТСЯ ПАРЫ — ОДИН СПИСОК НА ВЕСЬ ПРОЕКТ.
 * Его же берёт `archive-dedupe-apply.mjs`. Пока список был написан дважды,
 * они разошлись: у отчёта было четыре признака, у удаления два, и пара
 * «Проработка аниме» ↔ «Проработка аниме „Тетрадь смерти“» (нашлась по
 * началу текста) пропала И из плана, И из заслона — то есть молча.
 */
export const PAIR_KEYS = [
	['ОДИНАКОВОЕ НАЗВАНИЕ', (p) => normTitle(p.front?.title)],
	['ОДИНАКОВЫЙ ТЕКСТ', (p) => (p.text.length > 40 ? p.text : null)],
	['ОДИНАКОВОЕ НАЧАЛО ТЕКСТА', (p) => (p.text.length > 120 ? opening(p.text) : null)],
	['ОДНА И ТА ЖЕ ВНЕШНЯЯ ССЫЛКА', (p) => String(p.front?.externalUrl ?? '').trim() || null],
];

/** Все пары-подозрения, каждая ровно один раз. */
export function allPairs(posts) {
	const byKey = new Map();
	for (const [, key] of PAIR_KEYS) {
		for (const p of posts) {
			const k = key(p);
			if (!k) continue;
			const kk = String(key) + '::' + k;
			if (!byKey.has(kk)) byKey.set(kk, []);
			byKey.get(kk).push(p);
		}
	}
	const seen = new Set();
	const out = [];
	for (const list of byKey.values()) {
		if (list.length < 2) continue;
		for (let i = 0; i < list.length; i++)
			for (let j = i + 1; j < list.length; j++) {
				const id = [list[i].id, list[j].id].sort().join('|');
				if (seen.has(id)) continue;
				seen.add(id);
				out.push([list[i], list[j]]);
			}
	}
	return out;
}

export { plainBody, diffNote };

function groupBy(list, key) {
	const m = new Map();
	for (const x of list) {
		const k = key(x);
		if (!k) continue;
		if (!m.has(k)) m.set(k, []);
		m.get(k).push(x);
	}
	return [...m.entries()].filter(([, v]) => v.length > 1);
}

function show(post) {
	const f = post.front ?? {};
	return [
		post.draft ? 'черновик' : '★ ОПУБЛИКОВАН',
		String(f.date ?? '').slice(0, 10),
		`${post.words} слов`,
		f.tgId ? `тг ${f.tgId}` : 'тг —',
		f.category ?? '?',
		f.cover ? 'обложка есть' : 'без обложки',
		f.externalUrl ? 'внешняя ссылка' : '',
		Array.isArray(f.anime) && f.anime.length ? `тайтлов ${f.anime.length}` : '',
	]
		.filter(Boolean)
		.join(' · ');
}

/** Чем отличаются два тела — коротко и по существу. */
function diffNote(a, b) {
	if (a.text === b.text) return 'тексты СОВПАДАЮТ ДОСЛОВНО';
	const shorter = a.text.length <= b.text.length ? a : b;
	const longer = shorter === a ? b : a;
	if (longer.text.startsWith(shorter.text)) {
		return `у «${longer.id}» текст ДЛИННЕЕ на ${longer.text.length - shorter.text.length} знаков, начало совпадает`;
	}
	if (longer.text.includes(shorter.text)) return `текст «${shorter.id}» целиком внутри «${longer.id}»`;
	const words = (s) => new Set(s.split(' '));
	const wa = words(a.text);
	const wb = words(b.text);
	const common = [...wa].filter((w) => wb.has(w)).length;
	const share = Math.round((common / Math.max(wa.size, wb.size)) * 100);
	// ОДИНАКОВОЕ НАЗВАНИЕ — ЭТО ЕЩЁ НЕ ДУБЛЬ. У подкаста есть повторяющиеся
	// рубрики: «Что смотреть в этом сезоне?», «Бонусный выпуск | Рекомендуем
	// новую мангу», «Лучшие аниме-сериалы N года — обновляемый список». Они
	// выходят раз в сезон под одним заголовком и каждый раз про НОВОЕ.
	// Сложи их в одну кучу с настоящими копиями — и заказчик снесёт материал.
	// Порог 90 % взят по разрыву в замере: у пар-копий общих слов 91…98 %,
	// у рубрик — 10…47 %, между ними пусто.
	const kind = share >= 90 ? 'ПОЧТИ КОПИЯ' : 'РАЗНЫЕ МАТЕРИАЛЫ ПОД ОДНИМ НАЗВАНИЕМ';
	return `${kind}, общих слов ${share}% (${a.text.length} и ${b.text.length} знаков)`;
}

async function main() {
	const posts = (await readPostsRaw()).map((p) => {
		const text = plainBody(p.body);
		return { ...p, text, words: text ? text.split(' ').length : 0 };
	});

	console.log('═'.repeat(96));
	console.log('ПОИСК ДУБЛИКАТОВ. НИЧЕГО НЕ УДАЛЯЕТСЯ — ТОЛЬКО ПОКАЗ.');
	console.log('═'.repeat(96));
	console.log();
	console.log(`Постов всего: ${posts.length}`);
	console.log();

	const seen = new Set();
	let n = 0;

	const groups = PAIR_KEYS; const unusedGroups = [
		['ОДИНАКОВОЕ НАЗВАНИЕ', (p) => normTitle(p.front?.title)],
		['ОДИНАКОВЫЙ ТЕКСТ', (p) => (p.text.length > 40 ? p.text : null)],
		['ОДИНАКОВОЕ НАЧАЛО ТЕКСТА', (p) => (p.text.length > 120 ? opening(p.text) : null)],
		['ОДНА И ТА ЖЕ ВНЕШНЯЯ ССЫЛКА', (p) => String(p.front?.externalUrl ?? '').trim() || null],
	];

	for (const [label, key] of groups) {
		// ДЕДУП ПО ПАРАМ, А НЕ ПО ГРУППАМ. Одна и та же пара попадает и в
		// «одинаковое название», и в «одинаковый текст», а состав групп при
		// этом разный (во второй третьего файла нет) — сравнение групп целиком
		// её не ловит, и в отчёте она считается дважды. На живых данных так
		// и вышло: «Спа-источники из Гунмы» удвоили счёт дословных копий.
		const found = groupBy(posts, key).filter((g) => {
			const ids = g[1].map((p) => p.id).sort();
			const pairs = [];
			for (let i = 0; i < ids.length; i++)
				for (let j = i + 1; j < ids.length; j++) pairs.push(`${ids[i]}|${ids[j]}`);
			if (pairs.every((x) => seen.has(x))) return false;
			for (const x of pairs) seen.add(x);
			return true;
		});
		if (!found.length) continue;

		console.log('─'.repeat(96));
		console.log(`${label} — ${found.length} групп`);
		console.log('─'.repeat(96));
		for (const [, list] of found) {
			n++;
			const hasPublished = list.some((p) => !p.draft);
			console.log();
			console.log(`  ▸ «${list[0].front?.title}»${hasPublished ? '   ★ СРЕДИ НИХ ЕСТЬ ОПУБЛИКОВАННЫЙ' : ''}`);
			for (const p of list) console.log(`      ${p.id}\n          ${show(p)}`);
			// Все пары, а не только «с первым»: в группе из трёх файлов пара
			// второго с третьим не менее важна, а без неё отчёт молчит о ней.
			for (let i = 0; i < list.length; i++)
				for (let j = i + 1; j < list.length; j++) {
					console.log(`      разница «${list[i].id}» ↔ «${list[j].id}»: ${diffNote(list[i], list[j])}`);
				}
		}
		console.log();
	}

	console.log('═'.repeat(96));
	console.log(`Групп-подозрений всего: ${n}. Ни один файл не тронут.`);
	console.log('═'.repeat(96));
}

const runDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
if (runDirectly) {
	main().catch((err) => {
		console.error('ПОИСК УПАЛ:', err);
		process.exit(1);
	});
}
