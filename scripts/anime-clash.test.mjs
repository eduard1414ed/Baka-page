// СТОЛКНОВЕНИЕ НАЗВАНИЙ: КОМУ ПРИНАДЛЕЖИТ ИМЯ, КОГДА НА НЕГО ДВА ПРЕТЕНДЕНТА.
//
//   node scripts/anime-clash.test.mjs             — закон плюс замер по справочнику
//   node scripts/anime-clash.test.mjs --selftest  — то же, но правило подменено
//                                                   на прежнее: обязано покраснеть
//
// ЗАЧЕМ. 11 августа 2026 справочник вырос с 53 тайтлов до 424, и в нём появились
// ПРОДОЛЖЕНИЯ. У «Стального алхимика: Братство» кусок до двоеточия — это ровно
// «Стальной алхимик», то есть полное имя другого тайтла, и длины совпадают.
// Победителя выбирал порядок файлов в папке, и продолжение побеждало ВСЕГДА.
//
// ДВЕ ЧАСТИ, И РАЗДЕЛЕНЫ ОНИ НАРОЧНО (CLAUDE.md: «заслон ловит сломанный код,
// а не растущие данные»):
//
//   ЗАКОН живёт на выдуманном неподвижном наборе и роняется подлогом. Он не
//   зависит от работы заказчика и обязан быть верен всегда.
//
//   ЗАМЕР ходит по живому справочнику и ПЕЧАТАЕТ ЧИСЛА, ничего не роняя.
//   Столкновений будет тем больше, чем больше тайтлов заведено, и падать
//   от этого нельзя: сегодня их 55, завтра будет сто, и ни одно не поломка.

import { readdir, readFile } from 'node:fs/promises';
import { buildAnimeMatcher, findMentions, fold } from '../src/lib/animeMentions.mjs';

const ANIME_DIR = new URL('../src/content/anime/', import.meta.url);
const SELFTEST = process.argv.includes('--selftest');

// ПОДЛОГ — ПРЕЖНЕЕ ПРАВИЛО: только длина, дальше КАК ЛЯГУТ ФАЙЛЫ.
//
// ПЕРВАЯ РЕДАКЦИЯ ЭТОГО ПОДЛОГА НЕ РАБОТАЛА ВОВСЕ, и проверка отвечала
// «всё хорошо» про заведомо сломанное правило. Она пересортировывала
// УЖЕ ОТСОРТИРОВАННЫЙ список по одной длине — а сортировка в JavaScript
// устойчива, то есть при равной длине порядок сохраняется тот, что был.
// Подлог возвращал не прежнее правило, а нынешнее.
//
// Прежнее правило решало равенство ПОРЯДКОМ СПРАВОЧНИКА, поэтому и
// воспроизводить его надо им же: номером тайтла в переданном списке.
function matcherUnderTest(entries, options) {
	const names = buildAnimeMatcher(entries, options);
	if (!SELFTEST) return names;
	const order = new Map(entries.map((entry, i) => [entry.id, i]));
	return [...names].sort((a, b) => b.folded.length - a.folded.length || order.get(a.id) - order.get(b.id));
}

const say = (ok, text) => {
	console.log(`${ok ? '  ок  ' : ' ПЛОХО'}  ${text}`);
	return ok ? 0 : 1;
};

// ─────────────────────── ЗАКОН: выдуманный набор ───────────────────────

function law() {
	let bad = 0;
	console.log('═══ ЗАКОН (выдуманные тайтлы, от справочника не зависит) ═══\n');

	const base = { id: 'seriya', data: { titleRu: 'Кошкин дом', titleOriginal: 'Kошkin dom' } };
	const sequel = { id: 'seriya-vtoraya-chast', data: { titleRu: 'Кошкин дом: Вторая часть', titleOriginal: 'Kошkin dom: Part 2' } };
	const q = { quotes: 'ignore' };

	const who = (entries, text) => {
		const hits = findMentions(text, matcherUnderTest(entries, q));
		return hits[0]?.id ?? null;
	};

	// Главное утверждение, ради которого всё затевалось.
	bad += say(who([base, sequel], 'смотрел Кошкин дом вчера') === 'seriya', 'целое название побеждает кусок до двоеточия');

	// ТО ЖЕ САМОЕ ПРИ ОБРАТНОМ ПОРЯДКЕ. Причиной поломки был именно порядок,
	// поэтому спрашиваем обе стороны: правило, верное лишь в одну сторону,
	// починило бы половину случаев и выглядело бы рабочим.
	bad += say(who([sequel, base], 'смотрел Кошкин дом вчера') === 'seriya', 'и при обратном порядке файлов — тот же ответ');

	// Полное имя продолжения по-прежнему находится и побеждает: длина сильнее.
	bad += say(who([base, sequel], 'смотрел Кошкин дом: Вторая часть вчера') === 'seriya-vtoraya-chast', 'полное имя продолжения находится и побеждает (длина сильнее)');

	// Ключ 3: падеж продолжения посчитан от куска и лежит готовым в aliasesAuto —
	// обрезкой он уже не помечен, и решать приходится по длине собственного имени.
	const baseCase = { id: 'seriya', data: { titleRu: 'Кошкин дом', aliasesAuto: ['Кошкиного дома'] } };
	const sequelCase = { id: 'seriya-vtoraya-chast', data: { titleRu: 'Кошкин дом: Вторая часть', aliasesAuto: ['Кошкиного дома'] } };
	bad += say(who([sequelCase, baseCase], 'не видел Кошкиного дома') === 'seriya', 'падежная форма из aliasesAuto достаётся тому, чьё имя короче');
	bad += say(who([baseCase, sequelCase], 'не видел Кошкиного дома') === 'seriya', '…и при обратном порядке тоже');

	// Исход не должен зависеть от порядка НИ В ОДНОМ случае: перемешиваем
	// и сверяем весь список названий целиком.
	//
	// ID ЗДЕСЬ ОБЯЗАНЫ БЫТЬ РАЗНЫМИ. Первая редакция клала сюда `base`
	// и `baseCase` с одним и тем же id — дубли отсеивались как «уже видели»,
	// столкновению негде было случиться, и проверка оставалась зелёной даже
	// на подложенном прежнем правиле. То есть не проверяла ничего.
	const many = [
		base,
		sequel,
		{ id: 'tretya-chast', data: { titleRu: 'Кошкин дом: Третья часть' } },
		{ id: 'drugoe', data: { titleRu: 'Другое кино' } },
	];
	const straight = matcherUnderTest(many, q).map((n) => n.id + ':' + n.folded).join('|');
	const reversed = matcherUnderTest([...many].reverse(), q).map((n) => n.id + ':' + n.folded).join('|');
	bad += say(straight === reversed, 'порядок справочника на разбор не влияет вовсе');

	// Чужие тайтлы, ничем не связанные, друг друга не трогают.
	bad += say(who([base, sequel], 'смотрел Другое кино') === null, 'чужого названия не находит (правило не стало всеядным)');

	return bad;
}

// ─────────────────────── ЗАМЕР: живой справочник ───────────────────────

async function measure() {
	const files = (await readdir(ANIME_DIR)).filter((n) => n.endsWith('.json'));
	const entries = [];
	for (const file of files) {
		const data = JSON.parse(await readFile(new URL(file, ANIME_DIR), 'utf8'));
		if (data?.id) entries.push({ id: data.id, data });
	}

	console.log(`\n═══ ЗАМЕР по живому справочнику (${entries.length} тайтлов) ═══\n`);

	const names = matcherUnderTest(entries, { quotes: 'ignore' });
	const byId = new Map(entries.map((e) => [e.id, e.data]));

	const byName = new Map();
	for (const n of names) {
		if (!byName.has(n.folded)) byName.set(n.folded, []);
		byName.get(n.folded).push(n);
	}
	const clashes = [...byName].filter(([, list]) => new Set(list.map((x) => x.id)).size > 1);

	console.log(`названий, на которые претендуют разные тайтлы: ${clashes.length}`);
	console.log(`затронутых тайтлов: ${new Set(clashes.flatMap(([, l]) => l.map((x) => x.id))).size}`);

	// Кому досталось имя и является ли оно его СОБСТВЕННЫМ именем целиком.
	const ownName = (id, folded) => {
		const d = byId.get(id);
		return [d.titleRu, d.titleOriginal, ...(d.aliases ?? []), ...(d.aliasesAuto ?? [])]
			.filter(Boolean)
			.some((t) => fold(t) === folded);
	};

	const wrong = [];
	for (const [name, list] of clashes) {
		const winner = list[0].id;
		if (ownName(winner, name)) {
			// Победитель носит это имя сам — спорить не о чем, только если
			// у соперника оно тоже своё И его собственное имя КОРОЧЕ.
			const better = list.find((x) => x.id !== winner && ownName(x.id, name) && x.canon < list[0].canon);
			if (better) wrong.push({ name, winner, better: better.id });
			continue;
		}
		const better = list.find((x) => x.id !== winner && ownName(x.id, name));
		if (better) wrong.push({ name, winner, better: better.id });
	}

	console.log(`\nимя досталось НЕ ТОМУ (у соперника оно собственное и он «главнее»): ${wrong.length}`);
	for (const w of wrong.slice(0, 40)) console.log(`  «${w.name}»  →  ${w.winner}   (должно ${w.better})`);

	// Что имена достаются оригиналам, а не продолжениям, — показываем списком:
	// это то самое, что видно на живом сайте.
	console.log('\nконтрольные названия и их нынешние хозяева:');
	for (const probe of ['Наруто', 'Стальной алхимик', 'Бездомный бог', 'Хоримия', 'Человек-бензопила', 'Блич', 'Ван-Пис', 'Хвост феи']) {
		const hits = findMentions(probe, matcherUnderTest(entries, { quotes: 'ignore' }));
		console.log(`  «${probe}» → ${hits[0]?.id ?? '(не найдено)'}`);
	}

	return wrong.length;
}

// ─────────────────────────── прогон ───────────────────────────

const bad = law();
const wrong = await measure();

console.log('\n═══════════════════════════════════════');
if (SELFTEST) {
	// Подлог обязан провалиться: иначе проверка ничего не проверяет.
	const caught = bad > 0 || wrong > 0;
	console.log(caught
		? `ПОДЛОГ ПОЙМАН: закон провалился ${bad} раз, замер нашёл ${wrong} чужих имён. Так и должно быть.`
		: 'ПОДЛОГ НЕ ПОЙМАН — проверка ничего не проверяет, чинить её.');
	process.exit(caught ? 0 : 1);
}

console.log(`Закон: провалилось ${bad}. Замер: имён не у того хозяина ${wrong}.`);
if (bad > 0) process.exit(1);
