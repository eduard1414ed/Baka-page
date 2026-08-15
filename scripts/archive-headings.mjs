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

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, writePostBody, parseBody } from './archive-clean-lib.mjs';
import { телоБезЖирного } from './heading-bold.mjs';

/**
 * Новое тело поста — или null, если правки нет.
 *
 * САМО ПРАВИЛО ЖИВЁТ В `scripts/heading-bold.mjs` — одно место на проект.
 * Здесь оставалась его копия, и она отвечала ИНАЧЕ, чем копия в
 * `archive-subheads.mjs`: смотрела только верхний уровень дерева, то есть
 * заголовок внутри цитаты или пункта списка не трогала. Одно правило
 * заказчика — два ответа, и какой сработает, решал запуск (доревизия
 * задачи 15, находка 36).
 */
export function fixBody(body) {
	const план = телоБезЖирного(parseBody(body), body);
	if (!план) return null;
	return { body: план.тело, headings: план.заголовки.map((h) => ({ before: h.было, after: h.стало })) };
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
	// РЕШЕНИЕ ЗАКАЗЧИКА 15 АВГУСТА 2026, И ОНО ПЕРЕВЕРНУЛО ЭТОТ ПОДЛОГ.
	// Прежде тут стояло «цитату не правим» — и ровно на этом два скрипта
	// отвечали по-разному: соседний обходил дерево целиком и снимал.
	// Заголовок есть заголовок, где бы он ни стоял; слова цитаты при этом
	// не меняются, меняется только жирность.
	['> ### **в цитате**', '> ### в цитате', 'заголовок внутри цитаты — тоже заголовок'],
	['- ### **в пункте списка**', '- ### в пункте списка', 'заголовок внутри пункта списка — тоже заголовок'],
	[':::spoiler{noun="кусок"}\n### **в спойлере**\n:::', ':::spoiler{noun="кусок"}\n### в спойлере\n:::', 'заголовок внутри спойлера — тоже заголовок'],
	['> Обычная цитата с **жирным**', null, 'жирный в тексте цитаты — не заголовок, не трогаем'],
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

// ЗАПУСКАЕМСЯ ТОЛЬКО ТОГДА, КОГДА НАС ПОЗВАЛИ НАПРЯМУЮ. Без этой проверки файл
// начинает работать от простого `import` — а он пишет во ВСЕ посты архива,
// и ключ `--write` достался бы ему от чужой командной строки: он смотрит
// на общую.
//
// Сравниваем ПУТЯМИ, а не строками: в пути к проекту русские буквы, и
// `import.meta.url` кодирует их (`%D0%A0%D0%B0…`), а `process.argv[1]` нет
// (CLAUDE.md, урок про русские буквы в пути).
const calledDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');

if (calledDirectly) {
	if (process.argv.includes('--selftest')) {
		selftest();
	} else {
		main().catch((err) => {
			console.error('ПРАВКА УПАЛА:', err);
			process.exit(1);
		});
	}
}
