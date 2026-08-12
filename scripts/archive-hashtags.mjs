// ПРАВКА 1 ЗАДАЧИ 16: УБРАТЬ ХЕШТЕГИ ИЗ ТЕЛ ЧЕРНОВИКОВ.
//
//   node scripts/archive-hashtags.mjs            — разведка, не пишет ничего
//   node scripts/archive-hashtags.mjs --write     — применение
//   node scripts/archive-hashtags.mjs --selftest  — подлоги на настоящих данных
//
// ЧТО СЧИТАЕТСЯ ХЕШТЕГОМ. Решётка, перед которой нет буквы или цифры, а после
// неё сразу буква, дальше буквы, цифры, подчёркивание и дефис. Первая буква
// обязательна затем, чтобы `#135` (номер выпуска) хештегом не считался.
//
// ЧЕГО ПРАВИЛО НЕ ЗНАЕТ И ЗНАТЬ НЕ ДОЛЖНО. Ссылку, её адрес, якорь `#таймкод`,
// код и заголовок markdown перечислять тут нечем: об этом знает разбор, и мы
// смотрим только в текстовые узлы дерева (см. шапку archive-clean-lib.mjs).
// Своих оговорок ровно две, и обе не выражаются разбором:
//   1. ЦИТАТА. Внутри `blockquote` текст для дерева обычный, а по ТЗ это чужие
//      слова и трогать их нельзя.
//   2. ЦВЕТ. `#f5f2ea` — тоже «решётка и буквы». Отличается тем, что состоит
//      ТОЛЬКО из шестнадцатеричных цифр и имеет длину 3, 4, 6 или 8.
//      В архиве таких нет ни одного, и оговорка стоит на будущее — но она
//      обязана быть проверяемой, поэтому в подлогах есть свой случай.
//
// ЧТО ОСТАЁТСЯ ПОСЛЕ УДАЛЕНИЯ. Хештеги стоят хвостом поста, и после них
// остаётся то пустая строка, то строка из запятых. Правило: строка, ИЗ КОТОРОЙ
// что-то вырезали, дочищается — справа снимаются пробелы, а если от неё
// не осталось ничего, кроме разделителей, она убирается целиком. Строк,
// которых правка не касалась, это не трогает НИКОГДА: иначе разница пришла бы
// на весь архив и собственно правку в ней было бы не найти.

import { readPostsRaw, writePostBody, parseBody, textNodes, cutRanges } from './archive-clean-lib.mjs';

const HASHTAG = /(?<![\p{L}\p{N}_])#(\p{L}[\p{L}\p{N}_-]*)/gu;

// Строка, от которой после вырезания не осталось ничего, кроме разделителей.
const ONLY_SEPARATORS = /^[\s,;.·•\-–—|/\\]*$/u;

function looksLikeColor(tag) {
	return /^[0-9a-fA-F]+$/.test(tag) && [3, 4, 6, 8].includes(tag.length);
}

/**
 * Тело поста → что из него убрать и что получится.
 *
 * Вынесено функцией, а не написано внутри прогона, ровно затем, чтобы её можно
 * было уронить подлогом: правило, живущее внутри цикла по архиву, спрашивается
 * только полным прогоном, и «ничего не найдено» у него неотличимо от поломки.
 *
 * @returns {{ body: string, tags: string[], skipped: { tag: string, why: string }[], changed: boolean }}
 */
export function stripHashtags(body) {
	const tree = parseBody(body);
	const cuts = [];
	const tags = [];
	const skipped = [];

	for (const { node, inQuote, inLink } of textNodes(tree)) {
		const base = node.position?.start?.offset;
		if (base === undefined) continue;

		for (const match of node.value.matchAll(HASHTAG)) {
			const tag = match[1];
			// Внутри ссылки текст трогать нельзя: подпись ссылки принадлежит
			// автору, а не нам. Дерево про это знает, мы только спрашиваем.
			if (inLink) {
				skipped.push({ tag, why: 'подпись ссылки' });
				continue;
			}
			if (inQuote) {
				skipped.push({ tag, why: 'цитата' });
				continue;
			}
			if (looksLikeColor(tag)) {
				skipped.push({ tag, why: 'похоже на цвет' });
				continue;
			}
			tags.push(tag);
			cuts.push({ start: base + match.index, end: base + match.index + match[0].length });
		}
	}

	if (cuts.length === 0) return { body, tags, skipped, changed: false };

	// Какие строки исходного тела задеты — считаем ДО вырезания, по смещениям.
	const lineOfOffset = (offset) => {
		let line = 0;
		for (let i = 0; i < offset && i < body.length; i++) if (body[i] === '\n') line++;
		return line;
	};
	const touched = new Set(cuts.map((cut) => lineOfOffset(cut.start)));

	const lines = cutRanges(body, cuts).split('\n');
	const out = [];
	const gaps = [];

	for (let i = 0; i < lines.length; i++) {
		if (!touched.has(i)) {
			out.push(lines[i]);
			continue;
		}
		const cleaned = lines[i].replace(/[ \t]+$/u, '');
		// От строки не осталось ничего, кроме разделителей, — убираем её целиком
		// и запоминаем место стыка: там могли сойтись две пустые строки подряд.
		if (ONLY_SEPARATORS.test(cleaned)) {
			gaps.push(out.length);
			continue;
		}
		out.push(cleaned);
	}

	// Стык, где сошлись две пустые строки: одну убираем, иначе на месте бывшего
	// хвоста останется лишний пустой абзац. Идём с конца, чтобы номера не поехали.
	for (const gap of [...new Set(gaps)].sort((a, b) => b - a)) {
		if (out[gap - 1] === '' && out[gap] === '') out.splice(gap, 1);
	}

	// Хвост тела: пустые строки в конце оставлять нельзя — это и есть тот самый
	// «пустой хвост, видный на странице». Приводим к одному переводу строки.
	let result = out.join('\n').replace(/\s+$/u, '\n');
	if (!body.endsWith('\n')) result = result.replace(/\n$/u, '');

	return { body: result, tags, skipped, changed: result !== body };
}

// ─────────────────────────── подлоги ───────────────────────────
// Случаи собраны НАСТОЯЩИМИ строками архива, а не сочинены под формулировку
// правила: подлог, повторяющий формулировку, проверяет не правило, а мою
// аккуратность (CLAUDE.md, урок про `grid-template-columns`).

async function selftest() {
	const posts = await readPostsRaw();
	// Настоящая строка архива с хештегом — берём первую попавшуюся, а не вписываем
	// именем: вписанное именем протухает от первой же работы заказчика.
	let realLine = null;
	for (const post of posts) {
		const line = post.body.split('\n').find((l) => HASHTAG.test(l) && !l.startsWith('#'));
		HASHTAG.lastIndex = 0;
		if (line) {
			realLine = line;
			break;
		}
	}
	if (!realLine) throw new Error('подлоги: в архиве не нашлось ни одной строки с хештегом — проверять нечем');

	const cases = [
		{
			name: 'настоящая строка архива: хештег убран',
			body: `\n${realLine}\n`,
			must: (r) => r.changed && r.tags.length > 0,
		},
		{
			name: 'хештег строкой в конце: строка уходит целиком',
			body: '\nТекст поста.\n\n#полезное\n',
			must: (r) => r.body === '\nТекст поста.\n' && r.tags.length === 1,
		},
		{
			name: 'строка из запятых после удаления уходит тоже',
			body: '\nТекст поста.\n\n#полезное, #прочее,\n',
			must: (r) => r.body === '\nТекст поста.\n' && r.tags.length === 2,
		},
		{
			name: 'хвост строки: пробел перед хештегом не остаётся',
			body: '\nПользуйтесь! #полезное\n',
			must: (r) => r.body === '\nПользуйтесь!\n',
		},
		{
			name: 'ЗАГОЛОВОК MARKDOWN НЕ ТРОГАЕМ',
			body: '\n## Что это?\n\nТекст.\n',
			must: (r) => !r.changed && r.tags.length === 0,
		},
		{
			name: 'ЯКОРЬ В АДРЕСЕ ССЫЛКИ НЕ ТРОГАЕМ',
			body: '\nСмотри [тут](https://example.com/page#таймкод) дальше.\n',
			must: (r) => !r.changed,
		},
		{
			name: 'ПОДПИСЬ ССЫЛКИ НЕ ТРОГАЕМ',
			body: '\nСмотри [#полезное](https://example.com/) дальше.\n',
			must: (r) => !r.changed && r.skipped.some((s) => s.why === 'подпись ссылки'),
		},
		{
			name: 'ГОЛЫЙ АДРЕС С ЯКОРЕМ НЕ ТРОГАЕМ',
			body: '\nhttps://kinopoisk.ru/special/index/#/?dateFrom=2024-04-29\n',
			must: (r) => !r.changed,
		},
		{
			name: 'РЕШЁТКА ВНУТРИ КОДА НЕ ТРОГАЕТСЯ',
			body: '\nЦвет `#полезное` в коде.\n',
			must: (r) => !r.changed,
		},
		{
			name: 'ЦИТАТУ НЕ ТРОГАЕМ',
			body: '\n> Он писал: #полезное\n',
			must: (r) => !r.changed && r.skipped.some((s) => s.why === 'цитата'),
		},
		{
			name: 'ЦВЕТ НЕ ТРОГАЕМ',
			body: '\nФон #f5f2ea на сайте.\n',
			must: (r) => !r.changed && r.skipped.some((s) => s.why === 'похоже на цвет'),
		},
		{
			name: 'НОМЕР ВЫПУСКА НЕ ХЕШТЕГ',
			body: '\nСлушайте выпуск #135 у нас.\n',
			must: (r) => !r.changed,
		},
		{
			name: 'решётка посреди слова не хештег',
			body: '\nадрес вида a#b тут.\n',
			must: (r) => !r.changed,
		},
		{
			name: 'хештег посреди абзаца: строка остаётся',
			body: '\nЯ писал #полезное про это раньше.\n',
			must: (r) => r.body === '\nЯ писал про это раньше.\n' || r.body === '\nЯ писал  про это раньше.\n',
		},
		{
			name: 'ПОВТОРНЫЙ ПРОГОН НИЧЕГО НЕ МЕНЯЕТ',
			body: '\nТекст поста.\n\n#полезное\n',
			must: (r) => !stripHashtags(r.body).changed,
		},
	];

	let bad = 0;
	for (const test of cases) {
		const result = stripHashtags(test.body);
		const ok = test.must(result);
		if (!ok) bad++;
		console.log(`${ok ? '  ок  ' : ' ПЛОХО'}  ${test.name}`);
		if (!ok) console.log('          получилось:', JSON.stringify(result.body), 'теги:', result.tags);
	}

	console.log(`\nПодлогов ${cases.length}, провалилось ${bad}.`);
	if (bad > 0) process.exit(1);
}

// ─────────────────────────── прогон ───────────────────────────

async function main() {
	const write = process.argv.includes('--write');
	const posts = await readPostsRaw();

	const drafts = posts.filter((post) => post.draft);
	const published = posts.filter((post) => !post.draft);

	const changed = [];
	const counts = new Map();
	const skippedAll = [];
	let inPublished = 0;

	for (const post of published) {
		const result = stripHashtags(post.body);
		if (result.changed) inPublished += result.tags.length;
	}

	for (const post of drafts) {
		const result = stripHashtags(post.body);
		for (const item of result.skipped) skippedAll.push({ ...item, id: post.id });
		if (!result.changed) continue;
		for (const tag of result.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		changed.push({ post, result });
	}

	const total = changed.reduce((sum, item) => sum + item.result.tags.length, 0);

	console.log('═══════════ ПРАВКА 1: ХЕШТЕГИ ═══════════\n');
	console.log(`Постов в репозитории: ${posts.length} (черновиков ${drafts.length}, опубликованных ${published.length}).`);
	console.log(`ТРОНЕМ: ${changed.length} черновиков, из них уберём ${total} хештегов.`);
	console.log(`В опубликованных постах хештегов ${inPublished} — НЕ ТРОГАЕМ, они не черновики.\n`);

	console.log('─── самые частые хештеги ───');
	const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	for (const [tag, count] of top.slice(0, 15)) console.log(`  ${String(count).padStart(4)}  #${tag}`);
	if (top.length > 15) console.log(`  …и ещё ${top.length - 15} разных`);
	console.log(`  Всего разных хештегов: ${top.length}\n`);

	console.log('─── что правило НЕ тронуло и почему ───');
	if (skippedAll.length === 0) {
		console.log('  правило само не отвергло ничего: случаев «текст, а трогать нельзя» в архиве нет');
	}
	for (const item of skippedAll) console.log(`  ${item.id}: #${item.tag} — ${item.why}`);

	// СВЕРКА С ГРУБЫМ ПОИСКОМ. Без неё строчка выше читается как «защита нигде
	// не понадобилась», а это не то же самое, что «защита работает». Грубый поиск
	// по сырому телу находит ВСЕ решётки, включая те, до которых правило
	// не дотянулось вовсе: адреса, код, заголовки. Разница между двумя числами
	// и есть работа разбора, и она обязана быть названа поимённо.
	console.log('\n─── а до чего правило не дотянулось вовсе (разбор отсёк раньше) ───');
	let unreached = 0;
	for (const post of drafts) {
		const result = stripHashtags(post.body);
		const rough = [...post.body.matchAll(HASHTAG)].map((m) => m[1]);
		const seen = new Set([...result.tags, ...result.skipped.map((s) => s.tag)]);
		for (const tag of rough) {
			if (seen.has(tag)) continue;
			unreached++;
			const line = post.body.split('\n').find((l) => l.includes('#' + tag)) ?? '';
			console.log(`  ${post.id}: #${tag}`);
			console.log(`     ${line.trim().slice(0, 150)}`);
		}
	}
	if (unreached === 0) {
		console.log('  ни одной — значит на живом архиве защита разбора ни разу не понадобилась,');
		console.log('  и проверить её можно только подлогами: node scripts/archive-hashtags.mjs --selftest');
	}
	console.log();

	const sample = Number(process.env.SAMPLE ?? 10);
	console.log(`─── разбор ${sample} постов целиком (было → стало, только тронутые строки) ───\n`);
	for (const { post, result } of changed.slice(0, sample)) {
		console.log(`▼ ${post.id}   [${post.front.title ?? ''}]`);
		const was = post.body.split('\n');
		const now = result.body.split('\n');
		let i = 0;
		let j = 0;
		while (i < was.length || j < now.length) {
			if (was[i] === now[j]) {
				i++;
				j++;
				continue;
			}
			// строка изменилась или исчезла
			const nextSame = now.indexOf(was[i + 1] ?? ' ', j);
			console.log(`    было:  ${JSON.stringify(was[i])}`);
			if (nextSame === j) {
				console.log('    стало: (строка убрана)');
			} else {
				console.log(`    стало: ${JSON.stringify(now[j])}`);
				j++;
			}
			i++;
		}
		console.log();
	}

	if (!write) {
		console.log('═══ Это была РАЗВЕДКА. Ничего не записано. Применить: --write ═══');
		return;
	}

	console.log('═══ ЗАПИСЬ ═══');
	let done = 0;
	for (const { post, result } of changed) {
		// Пишем и СРАЗУ говорим: прогон, падающий посреди очереди, обязан
		// оставлять по себе список сделанного, а не «половина числится несделанной».
		await writePostBody(post, result.body);
		done++;
		console.log(`  ✓ ${done}/${changed.length}  ${post.id}  (−${result.tags.length})`);
	}
	console.log(`\nЗаписано постов: ${done}. Убрано хештегов: ${total}.`);
}

if (process.argv.includes('--selftest')) await selftest();
else await main();
