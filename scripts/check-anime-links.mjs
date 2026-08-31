#!/usr/bin/env node
// СВЯЗЬ «ПОСТ ↔ СТРАНИЦА ТАЙТЛА» ДОЛЖНА РАБОТАТЬ В ОБЕ СТОРОНЫ (этап 11, часть B).
//
// Зачем эта проверка отдельно от прочих. Широкая разметка постов отняла у поля
// «Тайтлы поста» роль единственного ответа на вопрос «упоминает ли пост тайтл»:
// теперь ссылку в тексте ставит один код, а показывают пост на странице тайтла
// и рисуют марку под постом — другой. Разойдись они — читатель нажмёт ссылку,
// попадёт на страницу тайтла и не найдёт там того самого поста, из которого
// пришёл. Ошибки при этом не будет ни одной, сборка пройдёт, разметка будет
// правильной. Увидеть можно только сверкой собранных страниц.
//
// ЧЕГО ЭТА ПРОВЕРКА НЕ ДЕЛАЕТ И ДЕЛАТЬ НЕ МОЖЕТ. Она не проверяет галочку
// «только в кавычках»: все ложные упоминания, ради которых галочка поставлена,
// лежат в ЧЕРНОВИКАХ, а у черновиков страниц нет вовсе. Подлог это показал прямо
// — сняли галочку, пересобрали, и такая проверка осталась зелёной. Галочка
// спрашивается на подложенных данных, `scripts/anime-quotes.test.mjs`.
//
//   npm run build && node scripts/check-anime-links.mjs
//
// Гонять вместе с check-css.mjs и check-hidden.mjs.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DIST = new URL('../dist/', import.meta.url);
const dist = (...parts) => fileURLToPath(new URL(parts.join('/'), DIST));

let problems = 0;
const say = (line) => console.log(line);

function main() {
	if (!existsSync(dist('anime/index.html'))) {
		console.error('Папки dist/ нет или в ней нет каталога тайтлов. Сначала npm run build.');
		process.exitCode = 1;
		return;
	}

	const catalog = readFileSync(dist('anime/index.html'), 'utf8');
	const titles = readdirSync(dist('anime'), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	// ─── 1. Два счётчика рядом обязаны считать одно и то же ──────────────────
	//
	// Число у карточки каталога и число карточек на странице тайтла считает один
	// и тот же `postsForAnime`, но проверять это надо не чтением кода: обе
	// стороны только что изменились, и разойтись им было бы легко.
	let mismatched = 0;

	for (const id of titles) {
		const card = new RegExp(`<a[^>]*href="/anime/${id}/"[^>]*>`).exec(catalog);
		const attr = card && /data-mentions="(\d+)"/.exec(card[0]);
		if (!attr) {
			say(`  ? ${id}: в каталоге числа упоминаний не нашлось — карточка размечена иначе`);
			mismatched++;
			continue;
		}

		const page = readFileSync(dist('anime', id, 'index.html'), 'utf8');
		// Карточка материала — единственный <article> на странице тайтла. Считать
		// ссылки на /posts/ нельзя: у поста-ссылки на чужой сайт своей страницы
		// не бывает вовсе, и его карточка ведёт наружу.
		const onPage = (page.match(/<article/g) ?? []).length;

		if (Number(attr[1]) !== onPage) {
			say(`  РАСХОЖДЕНИЕ ${id}: в каталоге ${attr[1]}, на странице тайтла карточек ${onPage}`);
			mismatched++;
		}
	}

	say(
		mismatched === 0
			? `ок      Счётчик каталога и число карточек сходятся у всех ${titles.length} тайтлов`
			: `ПРОВАЛ  Счётчики разошлись у ${mismatched} тайтлов`,
	);
	problems += mismatched;

	// ─── 2. Ссылка в тексте → пост на странице тайтла и марка под постом ─────
	let oneWay = 0;
	let checked = 0;

	for (const dir of readdirSync(dist('posts'), { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const slug = dir.name;
		const file = dist('posts', slug, 'index.html');
		if (!existsSync(file)) continue;

		const html = readFileSync(file, 'utf8');
		// ИЩЕМ ССЫЛКИ ТОЛЬКО ИЗ ТЕЛА МАТЕРИАЛА, и второй класс тут не украшение,
		// а сам вопрос. `anime-mention` носит и расшифровка выпуска — таких ссылок
		// в сборке 1066, — а спрашиваем мы про текст поста. Ослабь выражение
		// до «класс содержит anime-mention», и проверка начнёт отвечать на другой
		// вопрос, оставаясь на вид прежней.
		const linked = new Set(
			[...html.matchAll(/href="\/anime\/([a-z0-9-]+)" class="anime-mention anime-mention--text"/g)].map((m) => m[1]),
		);
		if (linked.size === 0) continue;
		checked++;

		// Марка тайтла живёт в СВОЕЙ секции; искать её по странице целиком нельзя —
		// та же строка нашлась бы в ссылке внутри текста, и проверка сказала бы
		// «марка есть» про марку, которой нет.
		const marks = /<section class="mentions"[\s\S]*?<\/section>/.exec(html);
		const marked = new Set(
			marks ? [...marks[0].matchAll(/href="\/anime\/([a-z0-9-]+)/g)].map((m) => m[1]) : [],
		);

		for (const id of linked) {
			if (!marked.has(id)) {
				say(`  ${slug}: в тексте ссылка на ${id}, а марки под текстом нет`);
				oneWay++;
				continue;
			}
			const animePage = dist('anime', id, 'index.html');
			if (!existsSync(animePage)) {
				say(`  ${slug}: ссылка на ${id}, а страницы такого тайтла в сборке нет`);
				oneWay++;
				continue;
			}
			// Пост-ссылка на чужой сайт своей страницы не имеет, но эта страница
			// есть — значит и в списке упоминаний он обязан быть по своему адресу.
			if (!readFileSync(animePage, 'utf8').includes(`/posts/${slug}/`)) {
				say(`  ${slug}: ссылка на ${id}, а на /anime/${id}/ этого поста в списке нет`);
				oneWay++;
			}
		}
	}

	// НОЛЬ СТРАНИЦ — ЭТО ПОЛОМКА ПРОВЕРКИ, А НЕ ЧИСТАЯ СБОРКА. Ссылка на тайтл
	// есть у 556 страниц из 682; ноль тут значит, что разметку поменяли, а
	// выражение выше — нет, и дальше проверка годами отвечала бы «всё хорошо»
	// про страницы, на которые не посмотрела. Ровно так эта проверка и должна
	// была сломаться 31 августа 2026 — на правке строения ссылки.
	const FLOOR = 100;
	const tooFew = checked < FLOOR;

	if (tooFew) {
		say(`ПРОВАЛ  Ссылки на тайтлы нашлись всего на ${checked} страницах (ждём хотя бы ${FLOOR}).`);
		say('        Похоже, изменилась разметка ссылки, а выражение поиска осталось прежним.');
		problems += 1;
	}

	// «Односторонних связей ноль» на пустом обходе — это не «ок», а «не смотрел».
	// Строчку «ок ... у всех 0 страниц» однажды прочтут без той, что над ней.
	say(
		tooFew
			? '        Про связь в обе стороны сказать нечего: обходить было нечего.'
			: oneWay === 0
				? `ок      Связь работает в обе стороны у всех ${checked} страниц со ссылками на тайтлы`
				: `ПРОВАЛ  Односторонних связей: ${oneWay}`,
	);
	problems += oneWay;

	if (problems > 0) process.exitCode = 1;
}

// Русские буквы в пути к проекту: import.meta.url кодирует их, а process.argv[1]
// нет, и строчное сравнение не совпало бы НИКОГДА — скрипт молча ничего
// не делал бы и выходил с кодом 0 (CLAUDE.md, «Уроки проекта»).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main();
}
