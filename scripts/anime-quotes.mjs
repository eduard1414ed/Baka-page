// РАЗВЕДКА ПЕРЕД ДВУМЯ РЕШЕНИЯМИ ЭТАПА 11, ЧАСТИ B.
//
//   1. КОМУ ВКЛЮЧИТЬ ГАЛОЧКУ «только в кавычках» (тз/11, B.1–B.2). Список
//      для глаз заказчика: признак, замер по архиву и цена включения.
//   2. ВКЛЮЧАТЬ ЛИ ШИРОКУЮ РАЗМЕТКУ ПОСТОВ (СТАТУС.md, хвост 44) — искать
//      в текстах постов ВСЕ названия справочника, а не только те, что стоят
//      в поле «Тайтлы поста».
//
// НИЧЕГО НЕ ПИШЕТ И НИЧЕГО НЕ ВКЛЮЧАЕТ. Устройство как у всех разовых прогонов
// проекта: сначала отчёт, потом, отдельным словом заказчика, применение.
//
//   node scripts/anime-quotes.mjs            — отчёт
//   node scripts/anime-quotes.mjs --show 12  — сколько кандидатов разобрать
//                                              подробно (по умолчанию 8)
//
// Полные списки ложатся в `отчёт-кавычки.txt` рядом с проектом: широких ссылок
// сотни, в переписке они не читаются. Файл в репозиторий не идёт (.gitignore).

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildAnimeMatcher, findMentions, fold, isQuotedAt, MIN_PREFIX_LENGTH } from '../src/lib/animeMentions.mjs';
import { initMorph, readAnimeCollection, strictQuotesHint } from './anime-cases-lib.mjs';
// Тело поста голым текстом, поля шапки и чтение расшифровок — общий код
// с частью C, чтобы два отчёта об одном архиве не разошлись в числах
// (scripts/posts-plain.mjs).
import { readPostsPlain as readPosts, readTranscriptsPlain as readTranscripts } from './posts-plain.mjs';

const ROOT = new URL('../', import.meta.url);
const REPORT_PATH = new URL('отчёт-кавычки.txt', ROOT);

const arg = (name, fallback) => {
	const at = process.argv.indexOf(`--${name}`);
	return at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--') ? process.argv[at + 1] : fallback;
};

const plural = (n, one, few, many) => {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return one;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
	return many;
};

// ─── Тексты ────────────────────────────────────────────────────────────────

const around = (text, start, end) =>
	text.slice(Math.max(0, start - 45), end + 45).replace(/\s+/g, ' ').trim();

export async function main() {
	await initMorph();

	const showCount = Number(arg('show', '8'));
	const entries = await readAnimeCollection();
	const posts = await readPosts();
	const transcripts = await readTranscripts();

	// Матчер строим ТОТ ЖЕ, что и сборка, и на нём же считаем. Свой список
	// названий тут был бы третьей копией правила «по чему ищем» — той самой,
	// из-за которой чинится хвост 45.
	//
	// `quotes: 'ignore'` — то есть галочки НЕ применяем, и это весь смысл отчёта:
	// он меряет, СКОЛЬКО галочка отняла бы. Применяй он их — у тайтла с уже
	// включённой галочкой строка «без кавычек» стала бы нулём, и отчёт перестал
	// бы отвечать на свой единственный вопрос.
	const matcher = buildAnimeMatcher(
		entries.map((e) => ({ id: e.data.id, data: e.data })),
		{ quotes: 'ignore', speech: false },
	);

	// Какие из названий тайтла — кусок до двоеточия. Известная болячка проекта:
	// «Апокалипсис: Отель» ловится словом «апокалипсис», и надо знать, сколько
	// именно ссылок держится на этом куске.
	const prefixNames = new Set();
	for (const entry of entries) {
		for (const name of [entry.data.titleRu, entry.data.titleOriginal, ...(entry.data.aliases ?? []), ...(entry.data.aliasesAuto ?? [])]) {
			if (!name) continue;
			const colon = name.indexOf(':');
			if (colon >= MIN_PREFIX_LENGTH) prefixNames.add(entry.data.id + ' ' + fold(name.slice(0, colon).trim()));
		}
	}

	const byId = new Map(entries.map((e) => [e.data.id, e.data]));
	const titleOf = (id) => byId.get(id)?.titleRu || byId.get(id)?.titleOriginal || id;

	// ─── Все совпадения по всему архиву ──────────────────────────────────────

	// ЛАТИНИЦУ СЧИТАЕМ ОТДЕЛЬНО, И ЭТО НЕ ПРИДИРКА. Галочка «только в кавычках»
	// ставится тайтлу целиком, то есть и его оригинальному названию тоже —
	// а в русском тексте «Jujutsu Kaisen», «Shirobako», «K-On!» и «Bleach»
	// в кавычки не ставят почти никогда, и обычным русским словом они не бывают
	// по определению. Значит включение галочки отнимет заодно и эти упоминания,
	// хотя опасности в них нет никакой. Числом это надо назвать ДО решения.
	const isLatin = (piece) => !/\p{Script=Cyrillic}/u.test(piece);

	/** @type {Map<string, {inQuotes: number, plain: number, plainLatin: number, prefix: number, samples: string[]}>} */
	const stats = new Map();
	const bump = (id) => {
		if (!stats.has(id)) stats.set(id, { inQuotes: 0, plain: 0, plainLatin: 0, prefix: 0, samples: [] });
		return stats.get(id);
	};

	for (const post of posts) {
		for (const mention of findMentions(post.text, matcher)) {
			const quoted = isQuotedAt(post.text, mention.start, mention.end);
			const piece = post.text.slice(mention.start, mention.end);

			const stat = bump(mention.id);
			if (quoted) stat.inQuotes++;
			else {
				stat.plain++;
				if (isLatin(piece)) stat.plainLatin++;
			}
			if (prefixNames.has(mention.id + ' ' + fold(piece))) stat.prefix++;
			if (!quoted && stat.samples.length < 4) stat.samples.push(`${post.id}: …${around(post.text, mention.start, mention.end)}…`);
		}
	}

	// А ВОТ РАЗМЕТКУ ПОСТОВ СЧИТАЕМ УЖЕ С ГАЛОЧКАМИ (`quotes: 'apply'`), потому
	// что здесь вопрос другой: не «сколько отняла бы галочка», а «что правда
	// встанет ссылкой на странице». Считай мы это тем же матчером, что таблицу
	// выше, — отчёт называл бы ссылки, которых на сайте нет.
	//
	// Ссылкой становится ПЕРВОЕ упоминание тайтла в посте, поэтому берём его,
	// а не все позиции: иначе число вышло бы больше, чем ссылок на страницах.
	const linkMatcher = buildAnimeMatcher(
		entries.map((e) => ({ id: e.data.id, data: e.data })),
		{ quotes: 'apply', speech: false },
	);

	const foundInPost = new Map();
	for (const post of posts) {
		const first = new Map();
		for (const mention of findMentions(post.text, linkMatcher)) {
			if (first.has(mention.id)) continue;
			const piece = post.text.slice(mention.start, mention.end);
			first.set(mention.id, {
				piece,
				quoted: isQuotedAt(post.text, mention.start, mention.end),
				isPrefix: prefixNames.has(mention.id + ' ' + fold(piece)),
				where: around(post.text, mention.start, mention.end),
			});
		}
		foundInPost.set(post.id, first);
	}

	// Расшифровки считаем отдельно: они уже размечены широко, и галочка
	// «только в кавычках» ударит по ним ТОЖЕ. Это и есть цена включения,
	// и назвать её надо до, а не после.
	/** @type {Map<string, {inQuotes: number, plain: number, plainLatin: number, samples: string[]}>} */
	const trStats = new Map();
	for (const transcript of transcripts) {
		for (const [index, replica] of (transcript.replicas ?? []).entries()) {
			const text = replica.text ?? '';
			for (const mention of findMentions(text, matcher)) {
				if (!trStats.has(mention.id)) trStats.set(mention.id, { inQuotes: 0, plain: 0, plainLatin: 0, samples: [] });
				const stat = trStats.get(mention.id);
				if (isQuotedAt(text, mention.start, mention.end)) stat.inQuotes++;
				else {
					stat.plain++;
					if (isLatin(text.slice(mention.start, mention.end))) stat.plainLatin++;
					if (stat.samples.length < 3) stat.samples.push(`${transcript.id} реплика ${index}: …${around(text, mention.start, mention.end)}…`);
				}
			}
		}
	}

	// ─── Печать ──────────────────────────────────────────────────────────────

	const out = [];
	const say = (line = '') => {
		out.push(line);
		console.log(line);
	};

	// ─── 1. Кому предложить галочку ──────────────────────────────────────────

	const candidates = [];
	for (const entry of entries) {
		const hint = strictQuotesHint(entry.data.titleRu);
		if (!hint) continue;
		const post = stats.get(entry.data.id) ?? { inQuotes: 0, plain: 0, plainLatin: 0, prefix: 0, samples: [] };
		const tr = trStats.get(entry.data.id) ?? { inQuotes: 0, plain: 0, plainLatin: 0, samples: [] };
		candidates.push({
			entry,
			hint,
			post,
			tr,
			loss: post.plain + tr.plain,
			lossLatin: post.plainLatin + tr.plainLatin,
		});
	}
	candidates.sort((a, b) => b.loss - a.loss);

	say('=== ЭТАП 11, ЧАСТЬ B: РАЗВЕДКА. НИЧЕГО НЕ ЗАПИСАНО И НЕ ВКЛЮЧЕНО ===');
	say();
	say(`Тайтлов в справочнике: ${entries.length}. Постов: ${posts.length}. Расшифровок: ${transcripts.length}.`);
	say(`Уже включена галочка «только в кавычках»: ${entries.filter((e) => e.data.strictQuotes === true).length}.`);
	say();
	say(`=== 1. КОМУ Я ПРЕДЛОЖИЛ БЫ ГАЛОЧКУ «ТОЛЬКО В КАВЫЧКАХ»: ${candidates.length} ===`);
	say('Это список для ваших глаз. Сам я не включил ни одной и не включу.');
	say('«в кавычках» и «без кавычек» — сколько совпадений в архиве стоит так и так;');
	say('«отсечётся» — сколько ссылок пропало бы, включи вы галочку прямо сейчас;');
	say('«из них латиницей» — сколько из отсечённого приходится на ОРИГИНАЛЬНОЕ');
	say('название («Jujutsu Kaisen», «Shirobako»): его в кавычки не ставят, а обычным');
	say('русским словом оно не бывает — то есть эти ссылки отнялись бы напрасно.');
	say();
	say('  название                        признак               в кавычках  без кавычек  из них латиницей');
	for (const c of candidates) {
		const on = c.entry.data.strictQuotes === true;
		const name = ((on ? '✔ ' : '  ') + (c.entry.data.titleRu ?? c.entry.data.id)).slice(0, 32).padEnd(32);
		const mark = (c.hint.words === 1 && c.hint.why[0].startsWith('одно слово') ? 'одно короткое слово' : 'обычные слова').padEnd(20);
		say(
			`  ${name}  ${mark}  ${String(c.post.inQuotes + c.tr.inQuotes).padStart(9)}  ${String(c.loss).padStart(11)}  ${String(c.lossLatin).padStart(16)}`,
		);
	}
	say();
	say('Галочкой ✔ помечены те, у кого она УЖЕ включена: у них «без кавычек» — это');
	say('не «отсечётся», а «уже отсечено», и цифра оставлена нарочно, чтобы решение');
	say('можно было пересмотреть.');

	say();
	say(`=== 2. ЧТО ИМЕННО ОТСЕЧЁТСЯ У ПЕРВЫХ ${Math.min(showCount, candidates.length)} ===`);
	for (const c of candidates.slice(0, showCount)) {
		say();
		say(`«${c.entry.data.titleRu}» (${c.entry.data.id}) — ${c.hint.why.join('; ')}`);
		say(`  в постах: ${c.post.inQuotes} в кавычках, ${c.post.plain} без; из них кусок до двоеточия — ${c.post.prefix}`);
		say(`  в расшифровках: ${c.tr.inQuotes} в кавычках, ${c.tr.plain} без`);
		for (const sample of [...c.post.samples, ...c.tr.samples]) say(`    ${sample}`);
		if (c.post.plain + c.tr.plain === 0) say('    без кавычек не встречается ни разу — включение ничего не отнимет');
	}

	// ─── 3. Широкая разметка постов ──────────────────────────────────────────

	const newLinks = [];
	for (const post of posts) {
		for (const [id, hit] of foundInPost.get(post.id) ?? []) {
			if (post.tagged.has(id)) continue;
			newLinks.push({ post, id, ...hit });
		}
	}

	const postsTouched = new Set(newLinks.map((link) => link.post.id));
	const published = newLinks.filter((link) => !link.post.draft);
	const byPrefix = newLinks.filter((link) => link.isPrefix);
	const quotedShare = newLinks.filter((link) => link.quoted);

	const byTitle = new Map();
	for (const link of newLinks) byTitle.set(link.id, [...(byTitle.get(link.id) ?? []), link]);

	say();
	say('=== 3. ШИРОКАЯ РАЗМЕТКА ПОСТОВ (хвост 44) ===');
	say('Ссылки, которых при узкой разметке не было бы: тайтла нет в поле «Тайтлы');
	say('поста», а название стоит в тексте. Считано С УЧЁТОМ галочек — это то,');
	say('что правда встанет ссылкой на странице.');
	say();
	say(`  новых ссылок — ${newLinks.length} в ${postsTouched.size} ${plural(postsTouched.size, 'посте', 'постах', 'постах')};`);
	say(`  из них в опубликованных постах — ${published.length} (${new Set(published.map((l) => l.post.id)).size} ${plural(new Set(published.map((l) => l.post.id)).size, 'пост', 'поста', 'постов')}), остальное черновики;`);
	say(`  стоят в кавычках — ${quotedShare.length}, без кавычек — ${newLinks.length - quotedShare.length};`);
	say(`  держатся на куске названия до двоеточия — ${byPrefix.length} (известная болячка).`);
	say();
	say('  по тайтлам, от частого к редкому:');
	for (const [id, links] of [...byTitle].sort((a, b) => b[1].length - a[1].length)) {
		const risky = candidates.some((c) => c.entry.data.id === id);
		say(
			`    ${String(links.length).padStart(4)}  ${titleOf(id).slice(0, 40).padEnd(40)}  ${risky ? '⚑ кандидат на галочку' : ''}`,
		);
	}

	// ─── 4. Что тут сомнительно ──────────────────────────────────────────────
	//
	// СПИСОК СОМНИТЕЛЬНОГО — НЕ ФИЛЬТР. По нему ничего не выбрасывается: он
	// собран затем, чтобы заказчик посмотрел глазами на самое рискованное,
	// а не листал все сотни строк.

	const doubtful = newLinks.filter(
		(link) => !link.quoted && (link.isPrefix || candidates.some((c) => c.entry.data.id === link.id)),
	);

	say();
	say(`=== 4. НОВЫЕ ССЫЛКИ, КОТОРЫЕ Я САМ СЧИТАЮ СОМНИТЕЛЬНЫМИ: ${doubtful.length} ===`);
	say('Признак ровно один: стоит без кавычек И либо это кусок названия до двоеточия,');
	say('либо название совпадает с обычным словом. Ничего не выброшено, это для глаз.');
	for (const link of doubtful.slice(0, 40)) {
		say(`  ${link.post.draft ? 'черновик ' : 'НА САЙТЕ '}${link.post.id}`);
		say(`    «${link.piece}» → ${titleOf(link.id)}   …${link.where}…`);
	}
	if (doubtful.length > 40) say(`  …и ещё ${doubtful.length - 40}, все они в файле отчёта`);

	// ─── Полные списки в файл ────────────────────────────────────────────────

	out.push('', `=== ВСЕ НОВЫЕ ССЫЛКИ ШИРОКОЙ РАЗМЕТКИ: ${newLinks.length} ===`);
	for (const link of newLinks) {
		out.push(
			`${link.post.draft ? 'черновик' : 'НА САЙТЕ'} ${link.post.id} | «${link.piece}» → ${titleOf(link.id)}` +
				`${link.quoted ? ' | в кавычках' : ''}${link.isPrefix ? ' | кусок до двоеточия' : ''} | …${link.where}…`,
		);
	}
	out.push('', `=== ВСЕ СОМНИТЕЛЬНЫЕ: ${doubtful.length} ===`);
	for (const link of doubtful) {
		out.push(`${link.post.draft ? 'черновик' : 'НА САЙТЕ'} ${link.post.id} | «${link.piece}» → ${titleOf(link.id)} | …${link.where}…`);
	}

	await writeFile(REPORT_PATH, out.join('\n') + '\n', 'utf8');
	say();
	say(`Полные списки — в файле ${fileURLToPath(REPORT_PATH)}`);
	say('Ничего не включено. Широкая разметка постов и галочки — по вашему слову.');
}

// Русские буквы в пути к проекту: import.meta.url кодирует их, а process.argv[1]
// нет, и строчное сравнение не совпало бы НИКОГДА — скрипт молча ничего
// не делал бы и выходил с кодом 0 (CLAUDE.md, «Уроки проекта»).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	await main();
}
