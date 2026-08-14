// ПРАВКА 3 ЗАДАЧИ 16: ЗАГОЛОВКИ СЕЗОННЫХ ОБЗОРОВ.
//
//   node scripts/archive-season-titles.mjs            — разведка, не пишет ничего
//   node scripts/archive-season-titles.mjs --write     — применение
//   node scripts/archive-season-titles.mjs --selftest  — подлоги
//
// САМАЯ РИСКОВАННАЯ ИЗ ЧЕТЫРЁХ, И РИСК НАЗВАН В ТЗ ПРЯМО: заголовок
// ПРИДУМЫВАЕТСЯ из содержимого поста. Ошибётся — заголовок выйдет
// бессмысленным, и увидит это только заказчик.
//
// «Обзор всех аниме весны:» → «Обзор аниме «Рыцарь-скелет вступает
// в параллельный мир»». Формат взят не из головы: ровно так называется уже
// правленный рукой заказчика пост `obzor-anime-bezdomnyy-bog.md`.
//
// ОТКУДА БЕРЁТСЯ НАЗВАНИЕ. Два источника, и первый сильнее:
//   1. ХВОСТ САМОГО ЗАГОЛОВКА после сезона — если там уже стоит тайтл
//      («Обзор всех аниме лета: «Вермейл в золотом»»). Это утверждение автора,
//      и спорить с ним нечем.
//   2. ПЕРВЫЙ АБЗАЦ ТЕЛА — если хвост пуст. В этих постах он устроен
//      на удивление ровно: одна короткая строка с названием, дальше пустая
//      строка и текст.
//
// ПЕРВЫЙ АБЗАЦ, А НЕ ПЕРВАЯ СТРОКА, И ЭТО НЕ ПРИДИРКА. У части постов тело
// начинается с картинки (`::image`), и «первая строка» была бы разметкой.
// Абзац спрашивается у разбора markdown — он про такое знает сам.
//
// АДРЕС СТРАНИЦЫ ОТ ЭТОГО НЕ МЕНЯЕТСЯ: он берётся из имени файла
// (`params: { slug: post.id }` в src/pages/posts/[slug].astro), а не из
// заголовка. Проверено на эталоне: файл `obzor-anime-bezdomnyy-bog.md`
// с заголовком «Обзор аниме «Бездомный бог»».
//
// ЧТО ПИШЕТСЯ В ФАЙЛ — ТОЛЬКО СТРОКА ЗАГОЛОВКА. Тело не трогается вовсе,
// остальные поля шапки тоже: правится ровно `title:` и ничего больше.

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { readPostsRaw, POSTS_DIR, ANIME_DIR, parseBody } from './archive-clean-lib.mjs';
import { buildAnimeMatcher, findMentions } from '../src/lib/animeMentions.mjs';
import { toPlainText } from '../src/lib/plainText.mjs';
import { initMorph, notNounPhraseStart } from './anime-cases-lib.mjs';
import { writeFile } from 'node:fs/promises';

// «Обзор всех аниме весны», «Обзор всех новых аниме осени» — и хвост после.
const SEASON = /^Обзор\s+всех\s+(?:новых\s+)?аниме\s+(весны|зимы|лета|осени)\s*(.*)$/iu;

// Длиннее этого — не название тайтла, а фраза. Порог назван числом и выведен
// замером: см. распределение длин в отчёте разведки.
export const MAX_NAME_LENGTH = 60;

// ИТОГОВЫЕ ПОСТЫ СЕЗОНА — НЕ ОБЗОРЫ ОДНОГО ТАЙТЛА, И ПЕРЕИМЕНОВЫВАТЬ ИХ НЕЧЕМ.
// Решение заказчика 12 августа 2026, после чтения всех 89 строк разведки.
//
//   149 и 120 — «что я советую посмотреть в итоге?»: рейтинг сезона со ссылками
//               на сами обзоры;
//   485 и 162 — сводки со ссылкой на большую статью на DTF.
//
// СПИСОК ИМЕНАМИ, А НЕ ПРАВИЛОМ, И ЭТО НАРОЧНО. Признака, отличающего их
// от настоящих названий, нет: «Я стала злодейкой, поэтому мне нужно заарканить
// последнего босса» — тоже длинное предложение с местоимением в начале, и оно
// настоящее название. Любое правило, отсекающее эту четвёрку, отсекло бы вместе
// с ними двенадцать верных. Решение тут редакторское, и отвечает за него человек.
//
// ЧТОБЫ СПИСОК НЕ ПРОТУХ МОЛЧА, прогон ругается, если хоть одного из четырёх
// среди сезонных обзоров больше нет: пост могли переименовать руками или удалить,
// и тогда исключение стало бы враньём (CLAUDE.md: пример, вписанный именем,
// протухает от первой же работы заказчика).
export const SKIP = new Set([
	'obzor-vseh-anime-vesny-149',
	'obzor-vseh-anime-zimy-120',
	'obzor-vseh-anime-leta-485',
	'obzor-vseh-anime-vesny-162',
]);

/** Кавычки, которыми автор мог обернуть название в заголовке. */
const WRAP = /^[«»„“”"'‘’\s]+|[«»„“”"'‘’\s]+$/gu;

function unwrap(text) {
	return String(text ?? '').replace(WRAP, '').trim();
}

/**
 * Первый абзац тела ЧИСТЫМ ТЕКСТОМ, без разметки.
 *
 * Сырой исходник тут не годится: у части постов первый абзац — это ссылка
 * целиком, `[Солнечная улыбка Арснотории](https://anilist.co/…)`, и в заголовок
 * уехал бы адрес. Правка 4 такие не сняла и не должна была: этого тайтла нет
 * в нашем справочнике.
 *
 * Снимаем разметку тем же `toPlainText`, которым сайт делает описания и превью,
 * — второй копии этого правила в проекте быть не должно (src/lib/plainText.mjs).
 * Он же схлопывает пробелы, а нам как раз нужна одна строка.
 */
function firstParagraph(body) {
	const tree = parseBody(body);
	for (const node of tree.children ?? []) {
		if (node.type !== 'paragraph') continue;
		const raw = body.slice(node.position.start.offset, node.position.end.offset);
		return { raw, text: toPlainText(raw) };
	}
	return { raw: '', text: '' };
}

/**
 * Пост → что с ним станет и что в этом подозрительного.
 *
 * Вынесено функцией, чтобы её можно было уронить подлогом: правило, живущее
 * внутри цикла по архиву, спрашивается только полным прогоном.
 */
export function planTitle(front, body, isKnownTitle = () => false) {
	const title = String(front?.title ?? '');
	const match = title.match(SEASON);
	if (!match) return null;

	const [, season, tail] = match;

	// Хвост заголовка сильнее тела: там автор уже назвал тайтл.
	const fromTitle = unwrap(tail.replace(/^[:\s—–-]+/u, ''));
	const paragraph = firstParagraph(body);
	const fromBody = unwrap(paragraph.text);

	const source = fromTitle ? 'заголовок' : 'первая строка тела';
	const name = fromTitle || fromBody;

	const why = [];
	if (!name) why.push('название взять НЕОТКУДА: хвост заголовка пуст и первого абзаца нет');

	if (name) {
		// ПРИЗНАКИ, ЧТО ЭТО НЕ НАЗВАНИЕ, А ФРАЗА (тз/16, 3.2). Словами:
		if (name.length > MAX_NAME_LENGTH) why.push(`длиннее ${MAX_NAME_LENGTH} знаков — для названия тайтла это много`);
		if (/[.!?]\s/u.test(name)) why.push('внутри стоит точка или другой конец предложения — похоже на фразу, а не на название');
		if (/\n/u.test(paragraph.raw) && source === 'первая строка тела') why.push('первый абзац в несколько строк');
		if (name.split(/\s+/u).length > 8) why.push('больше восьми слов');
		const notNoun = notNounPhraseStart(name);
		if (notNoun) why.push(`${notNoun} — названия так почти не начинаются`);
		// Кавычек в исходнике не было вовсе — по ТЗ это отдельный повод посмотреть.
		if (source === 'заголовок' && !/[«»„“”"]/u.test(tail)) why.push('в заголовке название стояло БЕЗ кавычек');
		if (!isKnownTitle(name)) why.push('в каталоге аниме такого названия нет');
	}

	const next = name ? `Обзор аниме «${name}»` : title;

	return { season, source, name, next, was: title, why, changed: next !== title };
}

/** Строка заголовка в шапке: правим ровно её, остальное не трогаем. */
export function replaceTitle(head, next) {
	// Как записать значение, спрашиваем у того же `js-yaml`, которым шапку читает
	// сборка, а не у списка опасных знаков. Своё правило кавычек в этом проекте
	// уже проглядело двоеточие В КОНЦЕ строки и положило сборку всего сайта.
	const line = yaml.dump({ title: next }, { lineWidth: -1 }).trimEnd();
	const out = head.replace(/^title:.*$/mu, line);
	if (out === head) throw new Error('строка title в шапке не найдена — не трогаю файл');
	return out;
}

// ─────────────────────────── подлоги ───────────────────────────

async function selftest() {
	await initMorph();
	const posts = await readPostsRaw();

	// Настоящий сезонный обзор берём ИЗ ДАННЫХ, а не вписываем именем:
	// вписанное именем протухает от первой же работы заказчика.
	const real = posts.find((p) => SEASON.test(String(p.front.title ?? '')));
	if (!real) throw new Error('подлоги: в архиве нет ни одного сезонного обзора — проверять нечем');

	const known = new Set(['Рыцарь-скелет вступает в параллельный мир', 'Вермейл в золотом']);
	const isKnown = (name) => known.has(name);

	const cases = [
		{
			name: `настоящий пост архива (${real.id}) разбирается и меняется`,
			run: () => planTitle(real.front, real.body, isKnown),
			must: (r) => r !== null && r.changed && r.next.startsWith('Обзор аниме «'),
		},
		{
			name: 'название из ХВОСТА заголовка сильнее тела',
			run: () => planTitle({ title: 'Обзор всех аниме лета: «Вермейл в золотом»' }, '\nСовсем другой текст\n', isKnown),
			must: (r) => r.name === 'Вермейл в золотом' && r.source === 'заголовок' && r.next === 'Обзор аниме «Вермейл в золотом»',
		},
		{
			name: 'пустой хвост — название берём из первого абзаца',
			run: () => planTitle({ title: 'Обзор всех аниме весны:' }, '\nРыцарь-скелет вступает в параллельный мир\n\nТекст.\n', isKnown),
			must: (r) => r.source === 'первая строка тела' && r.next === 'Обзор аниме «Рыцарь-скелет вступает в параллельный мир»',
		},
		{
			// Поймано разведкой 12 августа: первый абзац у части постов — ссылка
			// целиком, и в заголовок уезжал адрес вместе со скобками.
			name: 'ССЫЛКА В ПЕРВОМ АБЗАЦЕ: В ЗАГОЛОВОК ИДЁТ ПОДПИСЬ, А НЕ АДРЕС',
			run: () => planTitle({ title: 'Обзор всех аниме лета:' }, '\n[Вермейл в золотом](https://anilist.co/anime/149874/Smile/)\n\nТекст.\n', isKnown),
			must: (r) => r.next === 'Обзор аниме «Вермейл в золотом»' && !r.next.includes('http'),
		},
		{
			name: 'ЖИРНОЕ В ПЕРВОМ АБЗАЦЕ ТОЖЕ СНИМАЕТСЯ',
			run: () => planTitle({ title: 'Обзор всех аниме лета:' }, '\n**Вермейл в золотом**\n\nТекст.\n', isKnown),
			must: (r) => r.next === 'Обзор аниме «Вермейл в золотом»',
		},
		{
			name: 'КАРТИНКА В НАЧАЛЕ ТЕЛА НЕ СТАНОВИТСЯ НАЗВАНИЕМ',
			run: () => planTitle({ title: 'Обзор всех аниме весны:' }, '\n::image{src="/x.jpg" alt="" width="column"}\n\nВермейл в золотом\n\nТекст.\n', isKnown),
			must: (r) => r.name === 'Вермейл в золотом',
		},
		{
			name: 'ЧУЖОЙ ЗАГОЛОВОК НЕ ТРОГАЕМ ВОВСЕ',
			run: () => planTitle({ title: 'Обзор аниме «Бездомный бог»' }, '\nТекст.\n', isKnown),
			must: (r) => r === null,
		},
		{
			name: 'и «Лучшая новая манга 2023 года» тоже не трогаем',
			run: () => planTitle({ title: 'Лучшая новая манга 2023 года' }, '\nТекст.\n', isKnown),
			must: (r) => r === null,
		},
		{
			name: 'ФРАЗА ВМЕСТО НАЗВАНИЯ ПОМЕЧАЕТСЯ: начинается с глагола',
			run: () => planTitle({ title: 'Обзор всех аниме весны:' }, '\nПосмотрел вчера новинку сезона\n\nТекст.\n', isKnown),
			must: (r) => r.why.some((w) => w.includes('именной группы')),
		},
		{
			name: 'ФРАЗА ПОМЕЧАЕТСЯ: точка внутри',
			run: () => planTitle({ title: 'Обзор всех аниме весны:' }, '\nОтличный сериал. Всем советую\n\nТекст.\n', isKnown),
			must: (r) => r.why.some((w) => w.includes('точка')),
		},
		{
			name: 'ФРАЗА ПОМЕЧАЕТСЯ: слишком длинная',
			run: () => planTitle({ title: 'Обзор всех аниме весны:' }, `\n${'Слово '.repeat(20)}\n\nТекст.\n`, isKnown),
			must: (r) => r.why.some((w) => w.includes('длиннее')),
		},
		{
			name: 'ОТСУТСТВИЕ В КАТАЛОГЕ ПОМЕЧАЕТСЯ (п. 3.3)',
			run: () => planTitle({ title: 'Обзор всех аниме весны:' }, '\nСовершенно выдуманное название\n\nТекст.\n', isKnown),
			must: (r) => r.why.some((w) => w.includes('в каталоге аниме такого названия нет')),
		},
		{
			name: 'а известное каталогу НЕ помечается этим признаком',
			run: () => planTitle({ title: 'Обзор всех аниме весны:' }, '\nВермейл в золотом\n\nТекст.\n', isKnown),
			must: (r) => !r.why.some((w) => w.includes('в каталоге')),
		},
		{
			name: 'ПОВТОРНЫЙ ПРОГОН НИЧЕГО НЕ МЕНЯЕТ',
			run: () => planTitle({ title: 'Обзор аниме «Вермейл в золотом»' }, '\nТекст.\n', isKnown),
			must: (r) => r === null,
		},
		{
			name: 'ЗАГОЛОВОК ЗАПИСЫВАЕТСЯ ТАК, ЧТО ЧИТАЕТСЯ ОБРАТНО',
			run: () => {
				const head = "---\ntitle: 'Обзор всех аниме весны:'\ndate: 2022-05-15\ndraft: true\n---";
				const out = replaceTitle(head, 'Обзор аниме «Рыцарь: Скелет»');
				const back = yaml.load(out.replace(/^---\n|\n---$/gu, ''));
				return { out, back };
			},
			must: (r) => r.back.title === 'Обзор аниме «Рыцарь: Скелет»' && r.back.draft === true && String(r.back.date).includes('2022'),
		},
		{
			name: 'ДВОЕТОЧИЕ В КОНЦЕ НАЗВАНИЯ ТОЖЕ ПЕРЕЖИВАЕТ ЗАПИСЬ',
			run: () => {
				const head = '---\ntitle: X\n---';
				const out = replaceTitle(head, 'Обзор аниме «Всё зря:»');
				return { back: yaml.load(out.replace(/^---\n|\n---$/gu, '')) };
			},
			must: (r) => r.back.title === 'Обзор аниме «Всё зря:»',
		},
	];

	let bad = 0;
	for (const test of cases) {
		let result;
		let ok;
		try {
			result = test.run();
			ok = test.must(result);
		} catch (error) {
			ok = false;
			result = String(error.message);
		}
		if (!ok) bad++;
		console.log(`${ok ? '  ок  ' : ' ПЛОХО'}  ${test.name}`);
		if (!ok) console.log('          получилось:', JSON.stringify(result));
	}
	console.log(`\nПодлогов ${cases.length}, провалилось ${bad}.`);
	if (bad > 0) process.exit(1);
}

// ─────────────────────────── прогон ───────────────────────────

async function main() {
	const write = process.argv.includes('--write');
	await initMorph();

	// Справочник — чтобы ответить на вопрос 3.3 «есть ли такое в каталоге».
	// Спрашиваем ТЕМ ЖЕ матчером, которым сайт ищет упоминания: своё сравнение
	// названий было бы второй копией правила.
	const entries = [];
	for (const file of (await readdir(ANIME_DIR)).filter((n) => n.endsWith('.json'))) {
		const data = JSON.parse(await readFile(new URL(file, ANIME_DIR), 'utf8'));
		if (data?.id) entries.push({ id: data.id, data });
	}
	const matcher = buildAnimeMatcher(entries, { quotes: 'ignore', speech: false });
	const byId = new Map(entries.map((e) => [e.id, e.data]));
	const catalogId = (name) => {
		const hits = findMentions(name, matcher);
		const exact = hits.find((h) => h.start === 0 && h.end === name.length);
		return exact?.id ?? null;
	};
	const isKnown = (name) => catalogId(name) !== null;

	const posts = await readPostsRaw();
	const rows = [];
	for (const post of posts) {
		const plan = planTitle(post.front, post.body, isKnown);
		if (plan) rows.push({ post, plan });
	}

	const drafts = rows.filter((r) => r.post.draft);
	const published = rows.filter((r) => !r.post.draft);

	console.log('═══════════ ПРАВКА 3: ЗАГОЛОВКИ СЕЗОННЫХ ОБЗОРОВ ═══════════\n');
	console.log(`Постов с таким заголовком: ${rows.length}`);
	console.log(`  черновиков:     ${drafts.length}`);
	console.log(`  опубликованных: ${published.length} — НЕ ТРОГАЕМ`);
	const bySeason = new Map();
	for (const { plan } of drafts) bySeason.set(plan.season, (bySeason.get(plan.season) ?? 0) + 1);
	console.log('  по сезонам: ' + [...bySeason].map(([s, n]) => `${s} ${n}`).join(', '));
	const bySource = new Map();
	for (const { plan } of drafts) bySource.set(plan.source, (bySource.get(plan.source) ?? 0) + 1);
	console.log('  откуда берётся название: ' + [...bySource].map(([s, n]) => `${s} — ${n}`).join(', '));

	console.log('\n─── ДЛИНЫ НАЗВАНИЙ: порог виден или назначен? ───');
	const lengths = drafts.map((r) => r.plan.name.length).sort((a, b) => a - b);
	let prev = 0;
	for (const edge of [10, 20, 30, 40, 50, 60, 80, 120, 1000]) {
		const n = lengths.filter((l) => l > prev && l <= edge).length;
		const mark = prev < MAX_NAME_LENGTH && edge >= MAX_NAME_LENGTH ? `   ← ПОРОГ ${MAX_NAME_LENGTH}` : '';
		console.log(`  ${String(prev + 1).padStart(4)}–${String(edge).padEnd(5)} ${'█'.repeat(Math.min(60, n))} ${n}${mark}`);
		prev = edge;
	}
	console.log(`  Самое длинное: ${lengths[lengths.length - 1] ?? 0} знаков.`);

	// ГРУППАМИ ПО ПРИЧИНЕ, А НЕ ОДНОЙ КУЧЕЙ. Список в полсотни строк с общей
	// пометкой никто не прочитает, а три группы по своей причине — прочитает,
	// и находка в них стоит наверху сама (CLAUDE.md, урок про отвергнутое).
	const notCatalog = (w) => !w.includes('в каталоге');
	const hard = drafts.filter((r) => r.plan.why.some(notCatalog));
	const onlyCatalog = drafts.filter((r) => r.plan.why.length > 0 && !r.plan.why.some(notCatalog));
	const clean = drafts.filter((r) => r.plan.why.length === 0);

	console.log('\n╔═══ ГРУППА 0. НЕ ТРОГАЕМ ВОВСЕ — ИТОГОВЫЕ ПОСТЫ СЕЗОНА ═══╗');
	console.log('Решение заказчика 12 августа: это не обзоры одного тайтла, а сводки.\n');
	for (const { post, plan } of drafts.filter((r) => SKIP.has(r.post.id))) {
		console.log(`  ${post.id}`);
		console.log(`     заголовок остаётся: ${plan.was}`);
		console.log(`     (иначе стал бы: ${plan.next.slice(0, 90)}…)`);
	}
	const stale = [...SKIP].filter((id) => !drafts.some((r) => r.post.id === id));
	if (stale.length > 0) console.log(`  ⚠ ПРОТУХЛО, таких постов больше нет: ${stale.join(', ')}`);

	console.log('\n╔═══ ГРУППА 1. ЧИТАТЬ ГЛАЗАМИ: ПОХОЖЕ НЕ НА НАЗВАНИЕ, А НА ФРАЗУ ═══╗');
	console.log(`Таких ${hard.length} из ${drafts.length}. Тут живут ошибки.\n`);
	for (const { post, plan } of hard) {
		console.log(`▼ ${post.id}`);
		console.log(`    было:   ${plan.was}`);
		console.log(`    СТАНЕТ: ${plan.next}`);
		console.log(`    взято:  ${plan.source}`);
		for (const w of plan.why) console.log(`    ⚠ ${w}`);
		console.log();
	}

	console.log('\n╔═══ ГРУППА 2. НАЗВАНИЕ ПОХОЖЕ НА НАЗВАНИЕ, НО ЕГО НЕТ В КАТАЛОГЕ ═══╗');
	console.log('Это НЕ приговор (тз 3.2): сезонные обзоры про новинки, а в справочнике');
	console.log(`их может не быть вовсе. Таких ${onlyCatalog.length}.\n`);
	for (const { plan } of onlyCatalog) {
		console.log(`  ${plan.was}`);
		console.log(`     →  ${plan.next}    (взято: ${plan.source})`);
	}

	console.log('\n╔═══ ГРУППА 3. ЧИСТО: НАЗВАНИЕ ЕСТЬ В КАТАЛОГЕ И НИ ОДНОГО ПОДОЗРЕНИЯ ═══╗');
	console.log(`Таких ${clean.length}.\n`);
	for (const { plan } of clean) {
		const id = catalogId(plan.name);
		console.log(`  ${plan.was}`);
		console.log(`     →  ${plan.next}`);
		console.log(`        каталог: ${id ?? '—'}${id ? ` «${byId.get(id)?.titleRu ?? ''}»` : ''}   (взято: ${plan.source})`);
	}

	if (published.length > 0) {
		console.log('\n─── ОПУБЛИКОВАННЫЕ С ТАКИМ ЗАГОЛОВКОМ (не трогаю) ───');
		for (const { post, plan } of published) console.log(`  ${post.id}: ${plan.was}  →  был бы ${plan.next}`);
	}

	if (!write) {
		console.log('\n═══ Это была РАЗВЕДКА. Ничего не записано. Применить: --write ═══');
		return;
	}

	// Список исключений обязан оставаться правдой: пост могли переименовать
	// руками или удалить, и тогда исключение молча перестало бы кого-то защищать.
	const missing = [...SKIP].filter((id) => !drafts.some((r) => r.post.id === id));
	if (missing.length > 0) {
		console.error('\n✗✗ СПИСОК ИСКЛЮЧЕНИЙ ПРОТУХ: этих постов среди сезонных обзоров больше нет:');
		for (const id of missing) console.error(`   ${id}`);
		console.error('   Разберитесь, прежде чем писать: возможно, их уже переименовали руками.');
		process.exit(1);
	}

	console.log('\n═══ ЗАПИСЬ ═══');
	const queue = drafts.filter((r) => r.plan.changed && !SKIP.has(r.post.id));
	let done = 0;
	for (const { post, plan } of queue) {
		const head = replaceTitle(post.head, plan.next);
		await writeFile(new URL(post.file, POSTS_DIR), head + post.body, 'utf8');
		done++;
		console.log(`  ✓ ${done}/${queue.length}  ${post.id}  →  ${plan.next}`);
	}
	console.log(`\nЗаписано постов: ${done}.`);
}

const calledDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
if (calledDirectly) {
	if (process.argv.includes('--selftest')) await selftest();
	else await main();
}
