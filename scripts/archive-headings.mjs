// ПРАВКА 1 ЗАДАЧИ 19: ЖИРНЫЙ ВНУТРИ ЗАГОЛОВКА СНИМАЕТСЯ.
//
// Решение заказчика 12 августа 2026: жирного внутри заголовка не бывает.
// Задача 16 сняла его в четырёх опубликованных постах, но прошла не везде —
// осталось шесть опубликованных и часть черновиков. 13 августа заказчик
// подтвердил: править ВЕЗДЕ, включая опубликованное.
//
// ЗАЧЕМ ЭТО ВООБЩЕ ЗАМЕТНО. В «Пара слов о режиссёре Тацуюки Нагаи» первый
// заголовок чистый, а следующие три жирные — в ОДНОМ посте две формы разом.
// Тот же случай, что «Хоримия» в задаче 16.
//
// РАЗБОР ТОТ ЖЕ, ЧТО У СБОРКИ, И РЕЖЕМ ПО СМЕЩЕНИЯМ. Звёздочку по строкам
// не ищем: она живёт и в тексте абзаца, и внутри кода, и в адресе. Где
// заголовок и где внутри него жирный — знает дерево. Дерево отвечает только
// на вопрос «где», а режется исходная строка: пересборка дерева переписала бы
// каждый файл по-своему, и правку в этой разнице было бы не найти.
//
// ЗАПУСК:
//   node scripts/archive-headings.mjs             — показать, ничего не писать
//   node scripts/archive-headings.mjs --write     — записать
//   node scripts/archive-headings.mjs --selftest  — подлоги

import { readPostsRaw, writePostBody, parseBody, cutRanges } from './archive-clean-lib.mjs';

/** Все узлы поддерева (свой обход: нужны и вложенные `strong`). */
function allNodes(node) {
	const out = [];
	const walk = (n) => {
		out.push(n);
		if (Array.isArray(n.children)) n.children.forEach(walk);
	};
	walk(node);
	return out;
}

/**
 * Куски, которые надо вырезать из тела, чтобы у заголовков не осталось жирного.
 *
 * У узла `strong` смещения охватывают ВЕСЬ узел вместе с `**`, а у его детей —
 * только содержимое. Значит вырезать надо ровно два зазора: от начала узла
 * до начала первого ребёнка и от конца последнего ребёнка до конца узла.
 * Так снимается и `**`, и `__`, и любая другая запись, какую поймёт разбор, —
 * длину разделителя мы не назначаем, а спрашиваем.
 *
 * @returns {{ cuts: {start:number,end:number}[], headings: {before:string, after:string}[] }}
 */
function planFor(body) {
	const tree = parseBody(body);
	const cuts = [];
	const headings = [];

	for (const block of tree.children ?? []) {
		if (block.type !== 'heading') continue;
		const strongs = allNodes(block).filter((n) => n.type === 'strong');
		if (!strongs.length) continue;

		const local = [];
		for (const s of strongs) {
			const kids = s.children ?? [];
			if (!kids.length) continue; // `****` без содержимого — не наш случай, не трогаем
			const first = kids[0].position?.start?.offset;
			const last = kids[kids.length - 1].position?.end?.offset;
			const start = s.position?.start?.offset;
			const end = s.position?.end?.offset;
			if ([first, last, start, end].some((v) => typeof v !== 'number')) continue;
			if (start < first) local.push({ start, end: first });
			if (last < end) local.push({ start: last, end });
		}
		if (!local.length) continue;

		const hStart = block.position.start.offset;
		const hEnd = block.position.end.offset;
		const before = body.slice(hStart, hEnd);
		const after = cutRanges(
			before,
			local.map((c) => ({ start: c.start - hStart, end: c.end - hStart })),
		);
		headings.push({ before, after });
		cuts.push(...local);
	}

	return { cuts, headings };
}

/** Новое тело поста — или null, если правки нет. */
function fixBody(body) {
	const { cuts, headings } = planFor(body);
	if (!cuts.length) return null;
	return { body: cutRanges(body, cuts), headings };
}

// ── ЗАМЕР ОДНООБРАЗИЯ ─────────────────────────────────────────────────────
// «Чтобы во всех заголовках внутри одного текста было одинаково» — это
// про два признака сразу: жирный (его снимаем) и УРОВЕНЬ. Уровень мы не
// трогаем, но молчать о нём нельзя: разъехавшийся уровень выглядит так же,
// как разъехавшийся жирный.
function levelMix(body) {
	const heads = (parseBody(body).children ?? []).filter((b) => b.type === 'heading');
	const depths = [...new Set(heads.map((h) => h.depth))];
	return depths.length > 1 ? depths.sort() : null;
}

async function main() {
	const write = process.argv.includes('--write');
	const posts = await readPostsRaw();

	const changed = [];
	const mixes = [];

	for (const post of posts) {
		const fix = fixBody(post.body);
		if (fix) changed.push({ post, ...fix });
		const mix = levelMix(post.body);
		if (mix) mixes.push({ post, mix });
	}

	console.log('═'.repeat(88));
	console.log(write ? 'ПРАВКА 1: ЖИРНЫЙ В ЗАГОЛОВКАХ — ЗАПИСЬ' : 'ПРАВКА 1: ЖИРНЫЙ В ЗАГОЛОВКАХ — ПОКАЗ, НИЧЕГО НЕ ПИШЕТСЯ');
	console.log('═'.repeat(88));
	console.log();

	const pub = changed.filter((c) => !c.post.draft);
	const dra = changed.filter((c) => c.post.draft);
	const totalHeads = changed.reduce((s, c) => s + c.headings.length, 0);
	console.log(`Постов к правке: ${changed.length} (опубликованных ${pub.length}, черновиков ${dra.length})`);
	console.log(`Заголовков к правке: ${totalHeads}`);
	console.log();

	for (const group of [
		['ОПУБЛИКОВАННЫЕ — они на сайте, правка видна сразу', pub],
		['ЧЕРНОВИКИ', dra],
	]) {
		const [title, list] = group;
		if (!list.length) continue;
		console.log('─'.repeat(88));
		console.log(`${title} — ${list.length}`);
		console.log('─'.repeat(88));
		for (const c of list) {
			console.log(`\n  ${c.post.id}   (${c.post.front?.category ?? '?'}, ${String(c.post.front?.date ?? '').slice(0, 10)})`);
			for (const h of c.headings) {
				console.log(`    было:  ${h.before.replace(/\s+$/, '')}`);
				console.log(`    стало: ${h.after.replace(/\s+$/, '')}`);
			}
		}
		console.log();
	}

	if (mixes.length) {
		console.log('─'.repeat(88));
		console.log(`ПОПУТНО: ПОСТЫ, ГДЕ ЗАГОЛОВКИ РАЗНЫХ УРОВНЕЙ — ${mixes.length}. НЕ ТРОГАЮ, только говорю.`);
		console.log('─'.repeat(88));
		for (const m of mixes) {
			console.log(`  ${m.post.draft ? 'черновик' : 'ОПУБЛ.  '} ${m.post.id}: уровни ${m.mix.map((d) => '#'.repeat(d)).join(' и ')}`);
		}
		console.log();
	}

	if (!write) {
		console.log('Ничего не записано. Для записи: node scripts/archive-headings.mjs --write');
		return;
	}

	for (const c of changed) await writePostBody(c.post, c.body);
	console.log(`ЗАПИСАНО постов: ${changed.length}`);

	// Повторный прогон обязан не найти ничего: иначе правка не идемпотентна.
	const again = (await readPostsRaw()).filter((p) => fixBody(p.body));
	if (again.length) {
		console.log(`!! ПОВТОРНЫЙ ПРОГОН НАШЁЛ ЕЩЁ ${again.length} — правка не идемпотентна, разбираться:`);
		for (const p of again) console.log(`   ${p.id}`);
		process.exit(1);
	}
	console.log('Повторный прогон меняет 0 постов — правка идемпотентна.');
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
// В обе стороны: «обязано снять» и «обязано НЕ трогать». Правило, которое
// только снимает, снимет и то, чего трогать нельзя, — и это будет незаметно.
const FAKES = [
	// [тело, ожидаемое тело или null «не трогать», пояснение]
	['### **Весь заголовок жирный**', '### Весь заголовок жирный', 'заголовок целиком жирный'],
	['#### **Как отличить эти работы?** ', '#### Как отличить эти работы? ', 'жирный с хвостовым пробелом'],
	['### Часть **жирная**, часть нет', '### Часть жирная, часть нет', 'жирный внутри заголовка'],
	['### **Два** слова **жирных**', '### Два слова жирных', 'два жирных куска в одном заголовке'],
	['### __Подчёркиванием__', '### Подчёркиванием', 'жирный записан подчёркиваниями'],
	['##### **Пятый уровень**', '##### Пятый уровень', 'уровень заголовка роли не играет'],
	['### **Жирный** тут\n\nи **жирный** в абзаце', '### Жирный тут\n\nи **жирный** в абзаце', 'в абзаце жирный остаётся'],
	['### Заголовок с *курсивом*', null, 'курсив в заголовке НЕ трогаем'],
	['### Обычный заголовок', null, 'чистый заголовок не трогаем'],
	['**Весь абзац жирный**', null, 'жирный абзац — не заголовок, не наше дело'],
	['текст **жирный** в абзаце', null, 'жирный в тексте не трогаем'],
	['`### **код**`', null, 'решётка и звёздочки внутри кода до заголовка не доезжают'],
	['    ### **отступом**', null, 'блок с отступом — это код, а не заголовок'],
	['> ### **в цитате**', null, 'заголовок внутри цитаты не наш: цитату не правим'],
	['Ссылка [**жирная**](https://x.ru)', null, 'жирный внутри ссылки в абзаце не трогаем'],
	['### [**жирная ссылка**](https://x.ru)', '### [жирная ссылка](https://x.ru)', 'жирный внутри ссылки В ЗАГОЛОВКЕ снимаем'],
];

function selftest() {
	let bad = 0;
	for (const [body, expect, note] of FAKES) {
		const got = fixBody('\n' + body + '\n');
		const gotBody = got ? got.body.slice(1, -1) : null;
		if (gotBody !== expect) {
			console.log(`  ✗ «${note}»`);
			console.log(`      дано:      ${JSON.stringify(body)}`);
			console.log(`      ожидалось: ${JSON.stringify(expect)}`);
			console.log(`      вышло:     ${JSON.stringify(gotBody)}`);
			bad++;
		}
	}
	const neg = FAKES.filter(([, e]) => e === null).length;
	console.log();
	console.log(`Подлогов: ${FAKES.length}. Из них «обязано тронуть»: ${FAKES.length - neg}, «обязано НЕ тронуть»: ${neg}.`);
	if (bad) {
		console.log(`ПОДЛОГИ ПРОВАЛЕНЫ: ${bad}`);
		process.exit(1);
	}
	console.log('Все подлоги сошлись.');
}

if (process.argv.includes('--selftest')) {
	selftest();
} else {
	main().catch((err) => {
		console.error('ПРАВКА УПАЛА:', err);
		process.exit(1);
	});
}
