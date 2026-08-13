// ПРАВКА 2А ЗАДАЧИ 19: СНОС ОБВЕСА — ССЫЛОК НА СВОИ ПЛОЩАДКИ.
//
// Решение заказчика 13 августа 2026: «обвесы из бусти, патреона и вот этой
// ерунды убрать». Хвост черновика-выпуска устроен одинаково: «Наш телеграм-
// канал — …», «Подписаться, чтобы не пропустить бонусные выпуски „Баки!“
// можно здесь:» и следом Boosty / VK / Patreon / Telegram.
//
// ПОЧЕМУ ЭТО ЗАКОННО. В опубликованных постах 127 врезок ::link, и лишь 21
// из них ведёт на площадки подписки — все в семи выпусках ep-129…ep-135.
// Остальные 106 это ИСТОЧНИКИ. Хвоста «наш телеграм-канал» в опубликованных
// 2021–2022 и 2026 годов нет вовсе; он есть в трёх выпусках 2023–2024, то есть
// ровно в том провале, где лежат и все черновики.
//
// СПИСОК СВОИХ ПЛОЩАДОК ЯВНЫЙ, И ЭТО ГЛАВНОЕ ПРАВИЛО ФАЙЛА. Всё, чего в нём
// нет, остаётся жить и показывается отдельной группой. Молчаливого «прочее»
// тут быть не должно ни в одну сторону: снести чужую ссылку молча — значит
// потерять источник, о котором никто не вспомнит.
//
// ЧЕГО НЕ ТРОГАЕМ:
//   • рекламу (`erid`, промокод, «Реклама.») — это закон, а не вёрстка;
//   • ссылки на магазины («где приобрести мангу») — решение заказчика
//     13 августа: это ссылки ПО ТЕМЕ выпуска, и в опубликованном ep-107
//     они сохранены врезкой;
//   • всё, что не в явном списке.
//
// ЗАПУСК:
//   node scripts/archive-own-links.mjs             — показать, ничего не писать
//   node scripts/archive-own-links.mjs --write     — записать
//   node scripts/archive-own-links.mjs --selftest  — подлоги
//   node scripts/archive-own-links.mjs --only ep-115  — один пост целиком

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, writePostBody, parseBody, cutRanges } from './archive-clean-lib.mjs';
import { effectiveCategory } from './archive-rules-measure.mjs';

const CATEGORY_LABEL = { podcast: 'Выпуск', note: 'Заметка', article: 'Статья', videoessay: 'Видеоэссе', bonus: 'Бонус' };

/**
 * СВОИ ПЛОЩАДКИ — явным списком, с именем для отчёта.
 * Адреса взяты замером по архиву, а не по памяти: 13 августа 2026 посчитаны
 * все домены ссылок черновиков.
 */
const OWN_PLATFORM = [
	// ДОМЕН ЦЕЛИКОМ, А НЕ ОДИН ПУТЬ. Живой прогон нашёл
	// `patreon.com/posts/bonusnyi-vypusk-109021331` — тот же Патреон, другой
	// адрес, и правило по пути его не узнало.
	[/^https?:\/\/(www\.)?patreon\.com\//i, 'Патреон подкаста'],
	[/^https?:\/\/(www\.)?boosty\.to\//i, 'Бусти подкаста'],
	[/^https?:\/\/(www\.)?vk\.com\/podcast\.baka/i, 'группа ВК подкаста'],
	[/^https?:\/\/t\.me\/podcastbaka(\/|$|\?)/i, 'телеграм подкаста'],
	[/^https?:\/\/t\.me\/bakapodcast(\/|$|\?)/i, 'чат подкаста в телеграме'],
	[/^https?:\/\/t\.me\/\+nz2JG4WhGvQ2NjMy/i, 'закрытый телеграм по приглашению'],
	[/^https?:\/\/t\.me\/tribute\/app/i, 'закрытый телеграм через Tribute'],
	[/^https?:\/\/t\.me\/in_da_tresh(\/|$|\?)/i, 'телеграм монтажёра'],
	[/^https?:\/\/t\.me\/livebaka(\/|$|\?)/i, 'второй телеграм подкаста'],
	[/^https?:\/\/(www\.)?twitch\.tv\/bakapodcast/i, 'твич подкаста'],
];

/** Признаки рекламы: такой абзац не трогаем ВООБЩЕ. */
const AD_MARK = /\berid\b|промокод|реклама\.|рекламодател|\bинн\b/i;

const txtOf = (n) =>
	n.type === 'text' || n.type === 'inlineCode' ? (n.value ?? '') : (n.children ?? []).map(txtOf).join('');

function linksIn(node) {
	const out = [];
	const walk = (n) => {
		if (n.type === 'link') out.push(n);
		(n.children ?? []).forEach(walk);
	};
	walk(node);
	return out;
}

/** Голый адрес абзацем считается ссылкой не хуже размеченной. */
function bareUrlOf(block) {
	const t = txtOf(block).trim();
	return /^https?:\/\/\S+$/.test(t) ? t : null;
}

export function ownNameOf(url) {
	// АДРЕС ПОДРЕЗАЕМ. В архиве есть `[…](https://t.me/podcastbaka  )` —
	// пробелы внутри скобок, и совпадение по концу строки не срабатывало:
	// обвес уцелел молча.
	const clean = String(url ?? '').trim();
	const hit = OWN_PLATFORM.find(([re]) => re.test(clean));
	return hit ? hit[1] : null;
}

/**
 * Абзац — чистый обвес?
 *
 * СПРАШИВАЕМ ФОРМУ СТРОКИ, А НЕ СЛОВАРЬ. Первая попытка держала список
 * служебных слов («наш», «телеграм», «канал»…) и на живых данных провалилась
 * сразу: в списке было «телеграм», а в тексте стояло «телеграме», и строка
 * «Либо вступить в закрытый канал прямо в телеграме: …» уцелела — вместе
 * с шестнадцатью такими же. Список русских слов разъедется с жизнью на первом
 * же падеже, и заметить это можно только глазами.
 *
 * Форма обвеса всегда одна: `подпись‹разделитель› ссылка` и БОЛЬШЕ НИЧЕГО.
 * Условия все сразу:
 *   • это абзац (не заголовок, не цитата, не наш блок);
 *   • рекламных признаков нет;
 *   • ссылка есть, и КАЖДАЯ ведёт на нашу площадку;
 *   • ПОСЛЕ последней ссылки не осталось текста;
 *   • ДО первой ссылки либо пусто, либо подпись, кончающаяся разделителем.
 *
 * Последние два условия и отделяют обвес от рассказа: у «в прошлом выпуске
 * [мы говорили об этом](…) и вот почему это важно» после ссылки идёт текст,
 * то есть ссылка вплетена в предложение, а не подписана.
 */
const SEPARATOR_END = /[—–:\-•·|]\s*$/u;
/** Подпись длиннее этого — скорее рассказ, кончившийся двоеточием. */
const MAX_LABEL = 90;

function ownOnlyParagraph(block) {
	if (block.type !== 'paragraph') return null;
	const whole = txtOf(block).trim();
	if (!whole) return null;
	if (AD_MARK.test(whole)) return null;

	const links = linksIn(block);
	const bare = bareUrlOf(block);
	const urls = links.length ? links.map((l) => l.url ?? '') : bare ? [bare] : [];
	if (!urls.length) return null;

	const names = urls.map(ownNameOf);
	if (names.some((n) => n === null)) return null;

	// Голый адрес абзацем: подписи нет вовсе, хвоста нет вовсе.
	if (!links.length) return names.filter(Boolean).join(', ');

	const firstText = txtOf(links[0]);
	const lastText = txtOf(links[links.length - 1]);
	const before = whole.slice(0, whole.indexOf(firstText));
	const after = whole.slice(whole.lastIndexOf(lastText) + lastText.length);

	// После последней ссылки допустима только пунктуация и пробелы.
	if (after.replace(/[\s.,;)]/gu, '') !== '') return null;

	const label = before.trim();
	if (label !== '') {
		if (label.length > MAX_LABEL) return null;
		if (!SEPARATOR_END.test(before)) return null;
	}

	return names.filter(Boolean).join(', ');
}

/**
 * Подводка перед группой обвеса — тоже обвес.
 * «Подписаться, чтобы не пропустить бонусные выпуски „Баки!“ можно здесь:»
 * без своих ссылок превращается в обрубок, указывающий в пустоту.
 * Условия: кончается двоеточием, ссылок в ней нет, и СЛЕДУЮЩИЙ абзац — обвес.
 */
function isLeadIn(block, nextIsOwn) {
	if (!nextIsOwn) return false;
	if (block.type !== 'paragraph') return false;
	const t = txtOf(block).trim();
	if (!t.endsWith(':')) return false;
	if (linksIn(block).length) return false;
	if (AD_MARK.test(t)) return false;
	// Длинная подводка — это, скорее всего, рассказ, кончившийся двоеточием.
	// Порог поставлен с запасом: самая длинная живая — 78 знаков
	// («Подписаться, чтобы не пропустить бонусные выпуски «Баки!» можно здесь:»).
	return t.length <= 100;
}

/** План правки одного тела. */
function planFor(body) {
	const tree = parseBody(body);
	const blocks = tree.children ?? [];
	const own = blocks.map((b) => ownOnlyParagraph(b));
	const cuts = [];
	const removed = [];

	blocks.forEach((b, i) => {
		const isOwn = own[i] !== null;
		const lead = isLeadIn(b, own[i + 1] !== null && own[i + 1] !== undefined);
		if (!isOwn && !lead) return;
		const start = b.position.start.offset;
		const end = b.position.end.offset;
		removed.push({
			text: body.slice(start, end).replace(/\s+/g, ' ').trim(),
			why: isOwn ? own[i] : 'подводка к снесённой группе',
		});
		cuts.push({ start, end });
	});

	if (!cuts.length) return null;

	// Режем вместе с пустыми строками ПОСЛЕ абзаца, иначе в теле остаются
	// дыры из трёх переводов строки подряд, и разница пойдёт по всему файлу.
	const widened = cuts.map((c) => {
		let end = c.end;
		while (end < body.length && (body[end] === '\n' || body[end] === '\r' || body[end] === ' ' || body[end] === '\t')) end++;
		return { start: c.start, end };
	});

	let next = cutRanges(body, widened);
	// Хвост тела: после сноса концовки остаётся пустота. Приводим к одному
	// переводу строки — так же, как лежат нетронутые файлы.
	next = next.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
	return { body: next, removed };
}

// ── отчёт ─────────────────────────────────────────────────────────────────

async function main() {
	const write = process.argv.includes('--write');
	const onlyAt = process.argv.indexOf('--only');
	const only = onlyAt !== -1 ? process.argv[onlyAt + 1] : null;

	const posts = await readPostsRaw();
	const changed = [];

	for (const post of posts) {
		if (only && post.id !== only) continue;
		const plan = planFor(post.body);
		if (!plan) continue;
		changed.push({ post, ...plan });
	}

	// ОПУБЛИКОВАННЫЕ ЧИСТЯТСЯ ТОЖЕ — решение заказчика 13 августа 2026.
	// Показываются отдельным списком: они на сайте, и правка видна сразу.
	const published = changed.filter((c) => !c.post.draft);

	console.log('═'.repeat(92));
	console.log(write ? 'ПРАВКА 2А: СНОС ОБВЕСА — ЗАПИСЬ' : 'ПРАВКА 2А: СНОС ОБВЕСА — ПОКАЗ, НИЧЕГО НЕ ПИШЕТСЯ');
	console.log('═'.repeat(92));
	console.log();

	const byCat = {};
	let paras = 0;
	for (const c of changed) {
		const cat = effectiveCategory(c.post.front);
		byCat[cat] = (byCat[cat] ?? 0) + 1;
		paras += c.removed.length;
	}
	console.log(`Постов к правке: ${changed.length} (черновиков ${changed.length - published.length}, ОПУБЛИКОВАННЫХ ${published.length}). Абзацев к сносу: ${paras}.`);
	console.log('По категориям: ' + Object.entries(byCat).map(([c, n]) => `${CATEGORY_LABEL[c] ?? c} ${n}`).join(', '));
	console.log();

	// ГРУППЫ ПО ПРИЧИНЕ — что именно сносится и почему.
	const why = {};
	for (const c of changed) for (const r of c.removed) why[r.why] = (why[r.why] ?? 0) + 1;
	console.log('ЧТО СНОСИТСЯ, ГРУППАМИ ПО ПРИЧИНЕ:');
	for (const [k, v] of Object.entries(why).sort((a, b) => b[1] - a[1])) {
		console.log(`  ${String(v).padStart(4)}  ${k}`);
	}
	console.log();

	if (published.length) {
		console.log('─'.repeat(92));
		console.log(`ОПУБЛИКОВАННЫЕ — ${published.length}. ОНИ НА САЙТЕ, правка видна сразу.`);
		console.log('─'.repeat(92));
		for (const s of published) {
			console.log(`  ${s.post.id} (${CATEGORY_LABEL[effectiveCategory(s.post.front)] ?? '?'}):`);
			for (const r of s.removed) console.log(`      − ${r.text.slice(0, 84)}   ⟵ ${r.why}`);
		}
		console.log();
	}

	// Десяток постов целиком «было → станет».
	const show = only ? changed : changed.slice(0, 10);
	console.log('─'.repeat(92));
	console.log(only ? `ПОСТ ${only} ЦЕЛИКОМ` : `ПЕРВЫЕ ${show.length} ПОСТОВ: ЧТО УЙДЁТ`);
	console.log('─'.repeat(92));
	for (const c of show) {
		console.log(`\n  ▸ ${c.post.id}  (${CATEGORY_LABEL[effectiveCategory(c.post.front)] ?? '?'}, ${String(c.post.front?.date ?? '').slice(0, 10)})`);
		for (const r of c.removed) console.log(`      − ${r.text.slice(0, 96)}   ⟵ ${r.why}`);
		if (only) {
			console.log('\n    ── ТЕЛО ПОСЛЕ ПРАВКИ ──');
			for (const line of c.body.split('\n')) console.log('    | ' + line);
		}
	}
	console.log();

	if (!write) {
		console.log('Ничего не записано. Для записи: node scripts/archive-own-links.mjs --write');
		return;
	}

	for (const c of changed) await writePostBody(c.post, c.body);
	console.log(`ЗАПИСАНО постов: ${changed.length}`);

	const again = (await readPostsRaw()).filter((p) => planFor(p.body));
	if (again.length) {
		console.log(`!! ПОВТОРНЫЙ ПРОГОН НАШЁЛ ЕЩЁ ${again.length} — правка не идемпотентна:`);
		for (const p of again) console.log(`   ${p.id}`);
		process.exit(1);
	}
	console.log('Повторный прогон меняет 0 постов — правка идемпотентна.');
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
const FAKES = [
	['Наш телеграм-канал — [https://t.me/podcastbaka](https://t.me/podcastbaka)', '', 'свой телеграм сносится'],
	['Boosty — [https://boosty.to/bakapodcast](https://boosty.to/bakapodcast)', '', 'Бусти сносится'],
	['Patreon: [https://patreon.com/bakapodcast](https://patreon.com/bakapodcast)', '', 'Патреон сносится'],
	['VK — [https://vk.com/podcast.baka](https://vk.com/podcast.baka)', '', 'группа ВК сносится'],
	['Великолепный монтаж видеоэссе — Ваня Королёв: [https://t.me/in_da_tresh](https://t.me/in_da_tresh)', '', 'кредит монтажёра сносится'],
	['https://t.me/podcastbaka', '', 'голый адрес своей площадки сносится'],
	// ЭТОТ СЛУЧАЙ ПОЙМАЛ ЖИВОЙ ПРОГОН, а не воображение: первая версия правила
	// держала список слов, «телеграме» в него не попало, и шестнадцать таких
	// строк уцелели молча. Подлог остаётся навсегда.
	[
		'Либо вступить в закрытый канал прямо в телеграме: [https://t.me/tribute/app?startapp=s26z](https://t.me/tribute/app?startapp=s26z)',
		'',
		'падеж в подписи роли не играет — решает форма строки',
	],
	[
		'Наш телеграм-канал с новостями и интересными текстами: [https://t.me/podcastbaka](https://t.me/podcastbaka)',
		'',
		'длинная подпись площадки всё равно подпись',
	],
	[
		'Подписаться, чтобы не пропустить бонусные выпуски «Баки!» можно здесь: \n\nBoosty — [https://boosty.to/bakapodcast](https://boosty.to/bakapodcast)',
		'',
		'подводка уходит вместе с группой',
	],
	[
		'текст поста\n\nНаш телеграм-канал — [https://t.me/podcastbaka](https://t.me/podcastbaka)',
		'текст поста',
		'текст выше остаётся',
	],
	// ── обязано НЕ тронуть ──
	['Гид по аниме — [https://youtu.be/abc](https://youtu.be/abc)', null, 'чужая ссылка не наша забота'],
	['Читай-город — [https://vk.cc/cxJIX5](https://vk.cc/cxJIX5)', null, 'магазин: решение заказчика — оставить'],
	[
		'Сайт Tripster: [https://clck.ru/3GzanN](https://clck.ru/3GzanN) Скидка 10% по промокоду BAKA',
		null,
		'реклама с промокодом не трогается',
	],
	['Реклама. ООО «ХДС». ИНН 9717171550. erid: 2VtzqufNsjZ', null, 'строка маркировки не трогается'],
	[
		'В прошлом выпуске [мы говорили об этом](https://t.me/podcastbaka/1132) и вот почему это важно',
		null,
		'наша ссылка ВНУТРИ рассказа — абзац остаётся',
	],
	['Просто абзац без ссылок', null, 'абзац без ссылок не трогаем'],
	['### Наш телеграм-канал', null, 'заголовок не абзац'],
	['> Наш телеграм-канал — [https://t.me/podcastbaka](https://t.me/podcastbaka)', null, 'внутри цитаты не трогаем'],
	['::link{label="Телеграм" url="https://t.me/podcastbaka"}', null, 'готовую врезку не трогаем'],
	[
		'Обещанные ссылки: \n\nGigguk: [https://youtu.be/cNbxe1mzdLM](https://youtu.be/cNbxe1mzdLM)',
		null,
		'подводка к ЧУЖИМ ссылкам не сносится',
	],
];

function selftest() {
	let bad = 0;
	for (const [body, expect, note] of FAKES) {
		const plan = planFor('\n' + body + '\n');
		const got = plan ? plan.body.trim() : null;
		const want = expect === null ? null : expect;
		if (got !== want) {
			console.log(`  ✗ «${note}»`);
			console.log(`      дано:      ${JSON.stringify(body.slice(0, 90))}`);
			console.log(`      ожидалось: ${JSON.stringify(want)}`);
			console.log(`      вышло:     ${JSON.stringify(got)}`);
			bad++;
		}
	}
	const neg = FAKES.filter(([, e]) => e === null).length;
	console.log();
	console.log(`Подлогов: ${FAKES.length}. «Обязано снести»: ${FAKES.length - neg}, «обязано НЕ тронуть»: ${neg}.`);
	if (bad) {
		console.log(`ПОДЛОГИ ПРОВАЛЕНЫ: ${bad}`);
		process.exit(1);
	}
	console.log('Все подлоги сошлись.');
}

// «Запустили напрямую или подключили?» — сравнение ПУТЯМИ, а не строками:
// в пути к проекту русские буквы, и `import.meta.url` их кодирует, а
// `process.argv[1]` нет (урок проекта). Без развилки любой `import` отсюда
// запускал бы правку целиком — а она пишет в посты.
const runDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');

if (runDirectly) {
	if (process.argv.includes('--selftest')) {
		selftest();
	} else {
		main().catch((err) => {
			console.error('ПРАВКА УПАЛА:', err);
			process.exit(1);
		});
	}
}
