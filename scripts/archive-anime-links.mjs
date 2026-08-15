// ПРАВКА 4 ЗАДАЧИ 16: ЧУЖИЕ ССЫЛКИ НА ТАЙТЛЫ — В НАШ КАТАЛОГ.
//
//   node scripts/archive-anime-links.mjs            — разведка, не пишет ничего
//   node scripts/archive-anime-links.mjs --write     — применение
//   node scripts/archive-anime-links.mjs --selftest  — подлоги на настоящих данных
//
// СОВПАДЕНИЕ СЧИТАЕТ СУЩЕСТВУЮЩИЙ МАТЧЕР, И ВТОРОГО ПРАВИЛА ТУТ НЕТ (тз/16, 4.1).
// `buildAnimeMatcher` + `findMentions` из src/lib/animeMentions.mjs — тот же код,
// которым размечаются и посты, и расшифровки. Значит сюда сами собой приходят
// оба списка вариантов написания, падежные формы, кусок названия до двоеточия,
// нечувствительность к регистру и «е»/«ё».
//
// ТОЛЬКО ТОЧНОЕ СОВПАДЕНИЕ (тз/16, 4.2). Найденное упоминание обязано покрывать
// подпись ссылки ЦЕЛИКОМ, от первого знака до последнего. «Стальной алхимик»
// и «Стальной алхимик: Братство» — разные тайтлы, и похожесть тут уводит
// читателя не туда.
//
// ГАЛОЧКА «ТОЛЬКО В КАВЫЧКАХ» СПРАШИВАЕТСЯ ПО ВНЕШНЕМУ ТЕКСТУ, А НЕ ПО ПОДПИСИ.
// Кавычки у автора стоят СНАРУЖИ ссылки: «[Бездомный бог](адрес)». Спроси мы
// матчер с `quotes: 'apply'` про одну подпись — он не увидел бы кавычек вовсе
// и молча отверг бы каждый тайтл с галочкой. Поэтому матчер берётся с 'ignore',
// а кавычки проверяются той же `isQuotedAt` по СЫРОМУ ТЕЛУ вокруг всей ссылки.
// Вторая копия правила кавычек тут не заводится — функция та же самая.
//
// ЧТО ПИШЕМ ВМЕСТО ЧУЖОГО АДРЕСА — РЕШЕНО ЗАМЕРОМ, СМ. ОТЧЁТ. Вариантов два:
//   (а) `[Дэаймон](/anime/deaimon)` — ссылка вписана в текст;
//   (б) `Дэаймон` — ссылку снять совсем, разметка сборки сделает её сама.
// Разница не косметическая: вписанная руками ссылка не подчиняется ни правилу
// «ссылкой становится ПЕРВОЕ упоминание», ни отмене через поле «Упоминания
// тайтлов», ни галочке «только в кавычках». То есть (а) заводит в тексте
// ссылку, которую потом нечем отменить.

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, writePostBody, parseBody, ANIME_DIR } from './archive-clean-lib.mjs';
import { buildAnimeMatcher, findMentions, isQuotedAt } from '../src/lib/animeMentions.mjs';
import { parseMentionExceptions } from '../src/lib/mentionExceptions.mjs';

/** Справочник тайтлов — читаем так же, как его читает разметка постов. */
export async function readAnime() {
	const files = (await readdir(ANIME_DIR)).filter((name) => name.endsWith('.json'));
	const entries = [];
	for (const file of files) {
		const data = JSON.parse(await readFile(new URL(file, ANIME_DIR), 'utf8'));
		if (data?.id) entries.push({ id: data.id, data });
	}
	return entries;
}

/** Наша ли это ссылка. */
function isOurs(url) {
	return /^[/#]/u.test(url) || /(^|\/\/)(www\.)?(ru\.)?bakapodcast\.com/u.test(url);
}

// СНИМАЕМ ТОЛЬКО ССЫЛКУ НА СПРАВОЧНУЮ КАРТОЧКУ АНИМЕ. Решение заказчика
// 12 августа 2026, и оно от замера: из 39 ссылок с точным совпадением подписи
// 27 вели на карточку аниме, а 12 — совсем на другое.
//
//   YouTube (6) — МУЗЫКА, А НЕ АНИМЕ. «Kenshi Yonezu написал тему для
//   „Человека-бензопилы“» со ссылкой на песню: замени её каталогом — и фраза
//   потеряет смысл, потому что обещала послушать, а ведёт читать.
//
//   t.me/podcastbaka (6) — НАШИ СОБСТВЕННЫЕ ПОСТЫ В КАНАЛЕ. Их переписывала
//   задача 7.3, и эти остались нарочно: цель не импортирована (хвост 36).
//
// Отсюда правило: домен решает. Список явный, и всё, чего в нём нет, скрипт
// НАЗЫВАЕТ ВСЛУХ отдельным разделом отчёта. Молчаливого «прочее» тут быть
// не должно ни в одну сторону: тихо снятая ссылка теряется навсегда, а тихо
// пропущенная ждёт следующей сессии, и обе выглядят как «всё хорошо».
const ANIME_DB_HOSTS = new Set([
	'anilist.co',
	'shikimori.one',
	'shikimori.org',
	'shikimori.me',
	'myanimelist.net',
	'kinopoisk.ru',
]);

function isAnimeCard(url) {
	try {
		return ANIME_DB_HOSTS.has(new URL(url).hostname.replace(/^www\./u, ''));
	} catch {
		return false;
	}
}

/**
 * Тело поста → чужие ссылки, подпись которых ТОЧНО совпала с тайтлом.
 *
 * @param {{ id: string, data: object }[]} entries — справочник
 * @param {object} front — шапка поста: нужна отмена упоминаний
 */
export function findAnimeLinks(body, entries, front = {}) {
	// 'ignore' — потому что кавычки мы спрашиваем сами, ниже, по внешнему тексту.
	const matcher = buildAnimeMatcher(entries, { quotes: 'ignore', speech: false });
	const strict = new Map();
	for (const entry of entries) strict.set(entry.id, entry.data?.strictQuotes === true);

	const hidden = new Set(parseMentionExceptions(front.mentionsHidden).hiddenAnime);
	const tree = parseBody(body);

	const hits = [];
	const rejected = [];

	const walk = (node) => {
		if (node.type === 'link') {
			const url = String(node.url ?? '');
			const inner = node.children;
			const from = inner[0]?.position?.start?.offset;
			const to = inner[inner.length - 1]?.position?.end?.offset;

			if (from !== undefined && to !== undefined) {
				const text = body.slice(from, to);
				const mentions = findMentions(text, matcher);
				const exact = mentions.find((m) => m.start === 0 && m.end === text.length);

				if (exact) {
					const item = {
						id: exact.id,
						text,
						url,
						start: node.position.start.offset,
						end: node.position.end.offset,
					};
					if (isOurs(url)) rejected.push({ ...item, why: 'это наша собственная ссылка' });
					else if (!isAnimeCard(url)) rejected.push({ ...item, why: 'адрес ведёт НЕ на карточку аниме — не трогаем (решение 12 августа)' });
					else if (hidden.has(exact.id)) rejected.push({ ...item, why: 'тайтл отменён в этом посте полем «Упоминания тайтлов»' });
					else if (strict.get(exact.id) && /\p{Script=Cyrillic}/u.test(text) && !isQuotedAt(body, item.start, item.end))
						rejected.push({ ...item, why: 'у тайтла стоит галочка «только в кавычках», а кавычек вокруг ссылки нет' });
					else hits.push(item);
				} else if (mentions.length > 0 && !isOurs(url)) {
					rejected.push({
						id: mentions[0].id,
						text,
						url,
						why: 'название есть в подписи, но покрывает её НЕ ЦЕЛИКОМ — точного совпадения нет',
					});
				}
			}
		}
		if (Array.isArray(node.children)) for (const child of node.children) walk(child);
	};
	walk(tree);

	return { hits, rejected };
}

/**
 * Ссылка снимается, остаётся голое название: разметка сборки сделает его
 * ссылкой сама — тем же правилом, которым размечает весь остальной текст.
 */
export function stripLinks(body, hits) {
	const sorted = [...hits].sort((a, b) => a.start - b.start);
	const pieces = [];
	let cursor = 0;
	for (const hit of sorted) {
		pieces.push(body.slice(cursor, hit.start));
		pieces.push(hit.text);
		cursor = hit.end;
	}
	pieces.push(body.slice(cursor));
	return pieces.join('');
}

/**
 * Станет ли это упоминание ссылкой при сборке — то есть ПЕРВОЕ ли оно
 * в посте. Считается по тому же матчеру и в том же порядке, что у разметки.
 */
export function isFirstMention(body, entries, id, offset) {
	const matcher = buildAnimeMatcher(entries, { quotes: 'apply', speech: false });
	const tree = parseBody(body);
	let first = null;
	const walk = (node, inLink) => {
		if (node.type === 'text' && !inLink) {
			const base = node.position?.start?.offset ?? 0;
			for (const m of findMentions(node.value, matcher)) {
				if (m.id !== id) continue;
				const at = base + m.start;
				if (first === null || at < first) first = at;
			}
		}
		if (Array.isArray(node.children)) for (const child of node.children) walk(child, inLink || node.type === 'link' || node.type === 'linkReference');
	};
	walk(tree, false);
	return first === null || offset <= first;
}

// ─────────────────────────── подлоги ───────────────────────────

async function selftest() {
	const entries = await readAnime();
	const posts = await readPostsRaw();

	// Настоящий тайтл справочника — берём из данных, а не вписываем именем:
	// вписанное именем протухает от первой же работы заказчика.
	const real = entries.find((e) => e.data.titleRu && !e.data.strictQuotes);
	if (!real) throw new Error('подлоги: в справочнике нет ни одного тайтла с русским названием');
	const name = real.data.titleRu;

	// Тайтл с галочкой «только в кавычках» — тоже из данных.
	const strictOne = entries.find((e) => e.data.strictQuotes === true && e.data.titleRu);

	// Настоящая падежная форма — из посчитанного морфологией списка.
	const withCase = entries.find((e) => (e.data.aliasesAuto ?? []).length > 0);

	const cases = [
		{
			name: `настоящий тайтл справочника («${name}») ловится`,
			body: `\nСмотрел [${name}](https://anilist.co/anime/1) вчера.\n`,
			must: (r) => r.hits.length === 1 && r.hits[0].id === real.id,
		},
		{
			name: 'ЧУЖОЙ ТАЙТЛ, КОТОРОГО НЕТ В СПРАВОЧНИКЕ, НЕ ТРОГАЕМ',
			body: '\nСмотрел [Совершенно выдуманное название](https://anilist.co/anime/1) вчера.\n',
			must: (r) => r.hits.length === 0,
		},
		{
			name: 'ПОДПИСЬ НЕ ЦЕЛИКОМ НАЗВАНИЕ — НЕ ТРОГАЕМ',
			body: `\nСмотрел [сериал ${name} целиком](https://anilist.co/anime/1).\n`,
			must: (r) => r.hits.length === 0 && r.rejected.some((x) => x.why.includes('НЕ ЦЕЛИКОМ')),
		},
		{
			name: 'ПОДПИСЬ-ФРАЗА («смотрите здесь») НЕ ТРОГАЕМ',
			body: '\nПодробности [смотрите здесь](https://anilist.co/anime/1).\n',
			must: (r) => r.hits.length === 0,
		},
		{
			name: 'ССЫЛКУ НА МУЗЫКУ (YouTube) НЕ ТРОГАЕМ, ХОТЬ ПОДПИСЬ И НАЗВАНИЕ',
			body: `\nKenshi Yonezu написал тему для «[${name}](https://www.youtube.com/watch?v=LmZD-TU96q4)».\n`,
			must: (r) => r.hits.length === 0 && r.rejected.some((x) => x.why.includes('НЕ на карточку')),
		},
		{
			name: 'ССЫЛКУ НА НАШ ПОСТ В ТЕЛЕГРАМЕ НЕ ТРОГАЕМ',
			body: `\nПисал про «[${name}](https://t.me/podcastbaka/830)» раньше.\n`,
			must: (r) => r.hits.length === 0 && r.rejected.some((x) => x.why.includes('НЕ на карточку')),
		},
		{
			name: 'а карточку кинопоиска — трогаем',
			body: `\nСмотрел «[${name}](https://www.kinopoisk.ru/film/958722/)» вчера.\n`,
			must: (r) => r.hits.length === 1,
		},
		{
			name: 'и карточку shikimori — тоже',
			body: `\nСмотрел «[${name}](https://shikimori.one/animes/2848-kappa)» вчера.\n`,
			must: (r) => r.hits.length === 1,
		},
		{
			name: 'НАШУ СОБСТВЕННУЮ ССЫЛКУ НЕ ТРОГАЕМ',
			body: `\nСмотрел [${name}](/anime/${real.id}) вчера.\n`,
			must: (r) => r.hits.length === 0 && r.rejected.some((x) => x.why.includes('наша собственная')),
		},
		{
			name: 'ССЫЛКУ НА НАШ ДОМЕН НЕ ТРОГАЕМ',
			body: `\nСмотрел [${name}](https://bakapodcast.com/anime/${real.id}) вчера.\n`,
			must: (r) => r.hits.length === 0,
		},
		{
			name: 'ОТМЕНЁННЫЙ В ПОСТЕ ТАЙТЛ НЕ ТРОГАЕМ',
			body: `\nСмотрел [${name}](https://anilist.co/anime/1) вчера.\n`,
			front: { mentionsHidden: `${real.id}:*` },
			must: (r) => r.hits.length === 0 && r.rejected.some((x) => x.why.includes('отменён')),
		},
		{
			name: 'ссылка снимается, название остаётся голым',
			body: `\nСмотрел [${name}](https://anilist.co/anime/1) вчера.\n`,
			must: (r, body) => stripLinks(body, r.hits) === `\nСмотрел ${name} вчера.\n`,
		},
		{
			name: 'ПОВТОРНЫЙ ПРОГОН НИЧЕГО НЕ МЕНЯЕТ',
			body: `\nСмотрел [${name}](https://anilist.co/anime/1) вчера.\n`,
			must: (r, body) => findAnimeLinks(stripLinks(body, r.hits), entries).hits.length === 0,
		},
	];

	if (withCase) {
		const form = withCase.data.aliasesAuto[0];
		cases.push({
			name: `падежная форма из справочника («${form}») тоже ловится`,
			body: `\nПро [${form}](https://anilist.co/anime/1) говорили.\n`,
			must: (r) => r.hits.length === 1 && r.hits[0].id === withCase.id,
		});
	}

	if (strictOne) {
		const strictName = strictOne.data.titleRu;
		cases.push({
			name: `ГАЛОЧКА «ТОЛЬКО В КАВЫЧКАХ» ДЕЙСТВУЕТ: «${strictName}» без кавычек не берём`,
			body: `\nСмотрел [${strictName}](https://anilist.co/anime/1) вчера.\n`,
			must: (r) => r.hits.length === 0 && r.rejected.some((x) => x.why.includes('кавычк')),
		});
		cases.push({
			name: `а в кавычках — берём («${strictName}»)`,
			body: `\nСмотрел «[${strictName}](https://anilist.co/anime/1)» вчера.\n`,
			must: (r) => r.hits.length === 1,
		});
	}

	// Подлог на настоящем посте архива, если такой есть.
	for (const post of posts) {
		const found = findAnimeLinks(post.body, entries, post.front);
		if (found.hits.length > 0) {
			cases.push({
				name: `НАСТОЯЩИЙ пост архива (${post.id}): ссылка снимается, текст цел`,
				body: post.body,
				front: post.front,
				must: (r, body) => {
					const out = stripLinks(body, r.hits);
					return out.length < body.length && out.includes(r.hits[0].text);
				},
			});
			break;
		}
	}

	let bad = 0;
	for (const test of cases) {
		const result = findAnimeLinks(test.body, entries, test.front ?? {});
		const ok = test.must(result, test.body);
		if (!ok) bad++;
		console.log(`${ok ? '  ок  ' : ' ПЛОХО'}  ${test.name}`);
		if (!ok) console.log('          нашлось:', JSON.stringify(result.hits), 'отвергнуто:', JSON.stringify(result.rejected));
	}
	console.log(`\nПодлогов ${cases.length}, провалилось ${bad}.`);
	if (bad > 0) process.exit(1);
}

// ─────────────────────────── прогон ───────────────────────────

async function main() {
	const write = process.argv.includes('--write');
	const entries = await readAnime();
	const posts = await readPostsRaw();
	const byId = new Map(entries.map((e) => [e.id, e.data]));

	const rows = [];
	const rejectedAll = [];
	for (const post of posts) {
		const found = findAnimeLinks(post.body, entries, post.front);
		for (const hit of found.hits) rows.push({ post, hit });
		for (const item of found.rejected) rejectedAll.push({ post, item });
	}

	const drafts = rows.filter((r) => r.post.draft);
	const published = rows.filter((r) => !r.post.draft);

	console.log('═══════════ ПРАВКА 4: ЧУЖИЕ ССЫЛКИ НА ТАЙТЛЫ ═══════════\n');
	console.log(`Тайтлов в справочнике: ${entries.length}.`);
	console.log(`Найдено ссылок с ТОЧНЫМ совпадением подписи: ${rows.length}`);
	console.log(`  в черновиках:     ${drafts.length} в ${new Set(drafts.map((r) => r.post.id)).size} постах`);
	console.log(`  в опубликованных: ${published.length} в ${new Set(published.map((r) => r.post.id)).size} постах — НЕ ТРОГАЕМ\n`);

	console.log('─── КУДА ВЕЛИ ЭТИ ССЫЛКИ (тз 4.5: что теряется навсегда) ───');
	const domains = new Map();
	for (const { hit } of drafts) {
		const host = new URL(hit.url).hostname.replace(/^www\./u, '');
		domains.set(host, (domains.get(host) ?? 0) + 1);
	}
	for (const [host, n] of [...domains].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${host}`);

	console.log('\n─── ПО ТАЙТЛАМ ───');
	const titles = new Map();
	for (const { hit } of drafts) titles.set(hit.id, (titles.get(hit.id) ?? 0) + 1);
	for (const [id, n] of [...titles].sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(n).padStart(4)}  ${id}  «${byId.get(id)?.titleRu ?? ''}»`);
	}

	console.log('\n─── ПЕРЕСЕЧЕНИЕ С ЭТАПОМ 11: станет ли название ссылкой само ───');
	let firstYes = 0;
	let firstNo = 0;
	const notFirst = [];
	for (const { post, hit } of drafts) {
		if (isFirstMention(stripLinks(post.body, [hit]), entries, hit.id, hit.start)) firstYes++;
		else {
			firstNo++;
			notFirst.push({ post, hit });
		}
	}
	console.log(`  снятая ссылка — ПЕРВОЕ упоминание тайтла в посте: ${firstYes}`);
	console.log(`  раньше в тексте есть другое упоминание:            ${firstNo}`);
	console.log('  (во втором случае ссылку поставит то, раннее упоминание — тайтл всё равно');
	console.log('   станет ссылкой, но выше по тексту. Список ниже.)');
	for (const { post, hit } of notFirst.slice(0, 20)) console.log(`      ${post.id}: «${hit.text}»`);

	// ОСТАВЛЕННОЕ ИЗ-ЗА ДОМЕНА ПЕРЕЧИСЛЯЕТСЯ ПОИМЁННО, А НЕ ЧИСЛОМ. Это ровно то,
	// про что заказчик принимал решение, и увидеть он должен КАЖДУЮ строку:
	// молчаливого «прочее» тут быть не должно ни в одну сторону.
	console.log('\n─── ОСТАВЛЕНО, ПОТОМУ ЧТО АДРЕС НЕ КАРТОЧКА АНИМЕ ───');
	const offCard = rejectedAll.filter((x) => x.item.why.includes('НЕ на карточку'));
	const offHosts = new Map();
	for (const { item } of offCard) {
		const host = new URL(item.url).hostname.replace(/^www\./u, '');
		offHosts.set(host, (offHosts.get(host) ?? 0) + 1);
	}
	for (const [host, n] of [...offHosts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${host}`);
	for (const { post, item } of offCard) {
		console.log(`    ${post.id}: «${item.text}» → ${item.url.slice(0, 95)}`);
	}

	console.log('\n─── ЧТО ОТВЕРГНУТО И ПОЧЕМУ ───');
	const byWhy = new Map();
	for (const { item } of rejectedAll) byWhy.set(item.why, (byWhy.get(item.why) ?? 0) + 1);
	for (const [why, n] of [...byWhy].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${why}`);
	console.log('\n  ПРИМЕРЫ ОТВЕРГНУТОГО (читать глазами — тут живут ошибки):');
	for (const { post, item } of rejectedAll.filter((x) => x.item.why.includes('НЕ ЦЕЛИКОМ')).slice(0, 25)) {
		console.log(`    ${post.id}`);
		console.log(`      подпись: «${item.text.slice(0, 90)}»   ← похоже на «${byId.get(item.id)?.titleRu ?? item.id}»`);
	}

	const sample = Number(process.env.SAMPLE ?? 15);
	console.log(`\n─── ${sample} ССЫЛОК ЦЕЛИКОМ: было → станет ───\n`);
	for (const { post, hit } of drafts.slice(0, sample)) {
		const line = post.body.slice(Math.max(0, hit.start - 90), hit.end + 60).replace(/\n/gu, ' ');
		console.log(`▼ ${post.id}  [${post.front.title}]`);
		console.log(`    было:  …${line}…`);
		console.log(`    адрес: ${hit.url}`);
		console.log(`    тайтл: ${hit.id} «${byId.get(hit.id)?.titleRu ?? ''}»`);
		console.log(`    станет: …${line.replace(`[${hit.text}](${hit.url})`, hit.text)}…`);
		console.log();
	}

	if (!write) {
		console.log('═══ Это была РАЗВЕДКА. Ничего не записано. Применить: --write ═══');
		return;
	}

	console.log('═══ ЗАПИСЬ ═══');
	const byPost = new Map();
	for (const { post, hit } of drafts) {
		if (!byPost.has(post.id)) byPost.set(post.id, { post, hits: [] });
		byPost.get(post.id).hits.push(hit);
	}
	let done = 0;
	for (const { post, hits } of byPost.values()) {
		await writePostBody(post, stripLinks(post.body, hits));
		done++;
		console.log(`  ✓ ${done}/${byPost.size}  ${post.id}  (−${hits.length} чужих ссылок)`);
	}
	console.log(`\nЗаписано постов: ${done}. Снято ссылок: ${drafts.length}.`);
}

// ЗАПУСКАЕМСЯ ТОЛЬКО ТОГДА, КОГДА НАС ПОЗВАЛИ НАПРЯМУЮ. Без этой проверки
// простой `import { readAnime }` из соседнего скрипта прогонял всю разведку
// и печатал её отчёт посреди чужого замера — наступил в тот же день.
//
// Сравниваем ПУТЯМИ, а не строками: в пути к проекту русские буквы, и
// `import.meta.url` кодирует их (`%D0%A0%D0%B0…`), а `process.argv[1]` нет.
// Строчное сравнение не совпало бы НИКОГДА, и скрипт молча ничего не делал бы
// (CLAUDE.md, урок про русские буквы в пути).
const calledDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');

if (calledDirectly) {
	if (process.argv.includes('--selftest')) await selftest();
	else await main();
}
