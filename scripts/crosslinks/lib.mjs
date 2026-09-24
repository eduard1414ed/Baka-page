// ПЕРЕЛИНКОВКА — ОБЩАЯ ОСНОВА: ДАННЫЕ О ПОСТАХ (сессия 1, шаг 1).
//
// Ничего не пишет в репозиторий. Читает посты и справочник тайтлов, раскладывает
// тело поста на блоки (абзацы, заголовки, картинки, карточки, вставки) и для
// каждого блока спрашивает, какие тайтлы в нём названы.
//
// ТАЙТЛЫ СЧИТАЕТ КОД САЙТА, А НЕ ЭТОТ ФАЙЛ. `buildAnimeMatcher` + `findMentions`
// с `{ quotes: 'apply', speech: false }` — ровно то, чем указатель упоминаний
// (src/lib/animeMentionIndex.mjs) считает текст поста; отменённые в поле
// «Упоминания тайтлов» тайтлы снимаются тем же `makeExceptionFilter`. Свой
// разбор тут только один — нарезка на блоки, потому что указатель отвечает
// «сколько в посте», а нам нужно «в каком абзаце». Сумма по блокам сверяется
// с ответом самого указателя (`animeMentionCountsInPostText`), и расхождение
// печатается вслух — два пути к одним данным проверяют друг друга.
//
// Разбор markdown — тот же, что у разовых скриптов архива
// (scripts/archive-clean-lib.mjs): gfm + директивы.

import { readdir, readFile } from 'node:fs/promises';
import { readPostsRaw, parseBody } from '../archive-clean-lib.mjs';
import { buildAnimeMatcher, findMentions, fold } from '../../src/lib/animeMentions.mjs';
import { animeMentionCountsInPostText } from '../../src/lib/animeMentionIndex.mjs';
import { makeExceptionFilter, parseMentionExceptions } from '../../src/lib/mentionExceptions.mjs';
import { toPlainText } from '../../src/lib/plainText.mjs';
import { normalizeFrontmatter } from '../../src/lib/frontmatter.mjs';
import { isPublished } from '../../src/lib/publishing.mjs';
import { isExternalPost } from '../../src/lib/externalPost.mjs';
import { canPlayInline } from '../../src/lib/postRef.mjs';

const ANIME_DIR = new URL('../../src/content/anime/', import.meta.url);

// ИСКЛЮЧЕНИЯ УПОМИНАНИЙ ПРОЕКТА (сессия 1б). Поле «Упоминания тайтлов» в самом
// посте — правка опубликованного поста, её делает только Эд; поэтому ложные
// упоминания, мешающие перелинковке, снимаются здесь, списком «пост + тайтл».
// Нет файла — нет исключений. Запись с постом или тайтлом, которых нет, —
// опечатка, и о ней говорится вслух (`unusedExceptions` в ответе loadCorpus).
const EXCEPTIONS_FILE = new URL('../../статус/перелинковка/исключения-упоминаний.json', import.meta.url);

export async function loadProjectExceptions(file = EXCEPTIONS_FILE) {
	let list;
	try {
		list = JSON.parse(await readFile(file, 'utf8'));
	} catch (e) {
		if (e.code === 'ENOENT') return [];
		throw new Error(`Не читается список исключений ${file}: ${e.message}`);
	}
	if (!Array.isArray(list)) throw new Error(`Список исключений ${file} — не массив`);
	for (const x of list) if (!x?.post || !x?.anime) throw new Error(`Исключение без поста или тайтла: ${JSON.stringify(x)}`);
	return list;
}

/** Справочник тайтлов — так же, как его читает разметка постов. */
export async function loadAnime() {
	const files = (await readdir(ANIME_DIR)).filter((name) => name.endsWith('.json')).sort();
	const entries = [];
	for (const file of files) {
		const data = JSON.parse(await readFile(new URL(file, ANIME_DIR), 'utf8'));
		if (data?.id) entries.push({ id: data.id, data });
	}
	return entries;
}

// Адрес своего материала → id поста. Сайт и зеркало, с доменом и без.
const OWN_POST_RE = /^(?:https?:\/\/(?:www\.)?(?:ru\.)?bakapodcast\.com)?\/posts\/([^/?#]+)\/?(?:[?#].*)?$/u;
const TG_POST_RE = /^https?:\/\/t\.me\/podcastbaka\/(\d+)\/?(?:\?.*)?$/u;

/** Все ссылки блока (адреса), включая вложенные. */
function collectLinks(node, out = []) {
	if (node.type === 'link' && node.url) out.push(node.url);
	for (const child of node.children ?? []) collectLinks(child, out);
	return out;
}

/** Явные метки тайтла в тексте: `:anime[Инуяся]{id="inuyasha"}`. */
function collectAnimeDirectives(node, out = []) {
	if (node.type === 'textDirective' && node.name === 'anime' && node.attributes?.id) out.push(node.attributes.id);
	for (const child of node.children ?? []) collectAnimeDirectives(child, out);
	return out;
}

/** Абзац, в котором нет ничего, кроме картинок (и пробелов). */
function isImageOnly(node) {
	if (node.type !== 'paragraph') return false;
	const kids = (node.children ?? []).filter((c) => !(c.type === 'text' && !c.value.trim()));
	return kids.length > 0 && kids.every((c) => c.type === 'image');
}

/**
 * Вид блока. «Текстовые» — обычный текст, списки и цитаты: так же считала
 * разведка (02-статистика-вставок.md), иначе номера абзацев разъехались бы
 * с отчётом.
 */
function kindOf(node) {
	if (node.type === 'heading') return 'heading';
	if (node.type === 'paragraph') return isImageOnly(node) ? 'image' : 'text';
	if (node.type === 'list' || node.type === 'blockquote') return 'text';
	if (node.type === 'leafDirective' || node.type === 'containerDirective') {
		if (node.name === 'material') return 'material';
		if (node.name === 'anime-ref') return 'anime-ref';
		if (node.name === 'image' || node.name === 'gallery') return 'image';
		if (node.name === 'video') return 'video';
		return 'directive:' + node.name;
	}
	return 'other:' + node.type;
}

/**
 * Все посты с разложенным телом.
 *
 * @returns {Promise<{ posts: object[], anime: object[], mismatches: string[] }>}
 */
export async function loadCorpus({ now = new Date(), exceptions = null } = {}) {
	const anime = await loadAnime();
	const projectExceptions = exceptions ?? (await loadProjectExceptions());
	const projectHidden = new Map(); // пост → Set тайтлов
	for (const x of projectExceptions) {
		if (!projectHidden.has(x.post)) projectHidden.set(x.post, new Set());
		projectHidden.get(x.post).add(x.anime);
	}
	const usedExceptions = new Set();
	const animeById = new Map(anime.map((a) => [a.id, a]));
	const matcher = buildAnimeMatcher(anime, { quotes: 'apply', speech: false });
	// Для заголовка поста: тайтл с галочкой «только в кавычках» засчитывается
	// и без кавычек, но только если занимает ЦЕЛЫЙ кусок заголовка между
	// «|», «—», «:» («Железобетон | Первое аниме…»). Слово посреди фразы
	// («Большой город и …») так не пройдёт.
	const looseMatcher = buildAnimeMatcher(anime, { quotes: 'ignore', speech: false });
	const titleMentions = (title, hidden) => {
		const counts = new Map();
		for (const m of findMentions(title, matcher)) if (!hidden.has(m.id)) counts.set(m.id, 1);
		const segments = fold(title).split(/\s*[|—:]\s*/u).map((s) => s.trim().replace(/^[«"„“]+|[»"”?!.…]+$/gu, ''));
		for (const m of findMentions(title, looseMatcher)) {
			if (counts.has(m.id) || hidden.has(m.id)) continue;
			const piece = fold(title).slice(m.start, m.end);
			if (segments.includes(piece)) counts.set(m.id, 1);
		}
		return counts;
	};
	const raws = await readPostsRaw();

	const byTg = new Map();
	for (const r of raws) if (r.front?.tgId) byTg.set(String(r.front.tgId), r.id);

	const posts = [];
	const mismatches = [];

	for (const r of raws) {
		const data = normalizeFrontmatter(r.front);
		const published = isPublished({ draft: data.draft, publishAt: data.publishAt }, now);
		const external = isExternalPost(data);
		const category = data.category ?? '';
		const hidden = new Set(parseMentionExceptions(data.mentionsHidden ?? '').hiddenAnime);
		const ownHidden = projectHidden.get(r.id) ?? new Set();
		for (const id of ownHidden) hidden.add(id);

		// Сколько тайтлов в куске текста — тем же матчером, с теми же отменами.
		const mentionsIn = (plain) => {
			const counts = new Map();
			for (const m of findMentions(plain, matcher)) {
				if (hidden.has(m.id)) continue;
				counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
			}
			return counts;
		};

		const tree = parseBody(r.body);
		const blocks = [];
		let textN = 0;
		let sectionHeading = null; // номер блока-заголовка текущего раздела

		for (const node of tree.children) {
			const kind = kindOf(node);
			const start = node.position.start.offset;
			const end = node.position.end.offset;
			const raw = r.body.slice(start, end);
			const block = { n: blocks.length, kind, start, end };

			if (kind === 'heading') {
				block.depth = node.depth;
				// Заголовок ##### в подборках — служебная строка раздела
				// («Количество серий: 112»), раздел он не открывает.
				if (node.depth <= 4) sectionHeading = block.n;
			}
			if (kind === 'text' || kind === 'heading') {
				const plain = toPlainText(raw);
				block.plain = plain;
				block.chars = plain.length;
				const counts = mentionsIn(plain);
				// Явная метка тайтла побеждает догадку матчера: её поставил человек.
				for (const id of collectAnimeDirectives(node)) {
					if (!counts.has(id) && animeById.has(id) && !hidden.has(id)) counts.set(id, 1);
				}
				block.anime = Object.fromEntries(counts);
				const links = collectLinks(node);
				block.ownLinks = [];
				for (const url of links) {
					const own = url.match(OWN_POST_RE);
					if (own) block.ownLinks.push({ url, target: decodeURIComponent(own[1]) });
					const tg = url.match(TG_POST_RE);
					if (tg) block.ownLinks.push({ url, target: byTg.get(tg[1]) ?? null, tg: tg[1] });
				}
			}
			if (kind === 'text') block.textN = ++textN;
			if (kind === 'material') {
				block.target = node.attributes?.id ?? null;
				block.label = node.attributes?.label ?? null;
				block.mode = node.attributes?.mode ?? null;
			}
			if (kind === 'anime-ref') block.animeId = node.attributes?.id ?? null;
			block.section = sectionHeading;
			blocks.push(block);
		}

		const title = String(data.title ?? '');
		const titleAnime = Object.fromEntries(titleMentions(title, hidden));

		// Итог по тексту — сумма по блокам. Сверка с указателем сайта ниже.
		const textAnime = {};
		for (const b of blocks) for (const [id, c] of Object.entries(b.anime ?? {})) textAnime[id] = (textAnime[id] ?? 0) + c;

		const official = animeMentionCountsInPostText(
			{ body: r.body, data },
			matcher,
			makeExceptionFilter(data.mentionsHidden),
		);
		// Исключение проекта указатель сайта не знает: сверяем без него.
		for (const id of ownHidden) {
			if (official.has(id)) usedExceptions.add(`${r.id}→${id}`);
			official.delete(id);
		}
		// Сверка в обе стороны и по числу. Явная метка `:anime[…]{id}`, которую
		// матчер не узнал, даёт законное «по блокам больше» — она помечается.
		for (const id of new Set([...official.keys(), ...Object.keys(textAnime)])) {
			const a = official.get(id) ?? 0;
			const b = textAnime[id] ?? 0;
			if (a !== b) mismatches.push(`${r.id}: «${id}» указатель ×${a}, по блокам ×${b}`);
		}

		const plainAll = blocks.filter((b) => b.kind === 'text').map((b) => b.plain).join(' ');

		posts.push({
			id: r.id,
			title,
			category,
			date: data.date instanceof Date && !isNaN(data.date) ? data.date.toISOString().slice(0, 10) : null,
			published,
			external,
			bonus: category === 'bonus',
			ownPage: !external,
			canPlay: canPlayInline({ data }),
			field: Array.isArray(data.anime) ? data.anime.filter(Boolean) : [],
			titleAnime,
			textAnime,
			officialAnime: Object.fromEntries(official),
			textChars: plainAll.length,
			bodyChars: toPlainText(r.body).length,
			blocks,
		});
	}

	const unusedExceptions = projectExceptions
		.filter((x) => !usedExceptions.has(`${x.post}→${x.anime}`))
		.map((x) => `${x.post} → ${x.anime}: такого упоминания в тексте поста нет`);
	return { posts, anime, mismatches, unusedExceptions };
}

/** Короткое имя тайтла для отчётов. */
export function animeName(anime, id) {
	const a = anime.find((x) => x.id === id);
	return a ? a.data.titleRu || a.data.titleOriginal || id : id;
}

/** Первые слова абзаца — для отчёта и для ревью. */
export function firstWords(text, n = 8) {
	const words = String(text ?? '').split(/\s+/).filter(Boolean);
	return words.slice(0, n).join(' ') + (words.length > n ? '…' : '');
}

// ─────────────────────────────────────────────────────────────────────────────
// ШАГ 2. ГЛАВНЫЙ ТАЙТЛ ИЛИ УПОМЯНУТЫЙ МИМОХОДОМ.
//
// Для каждого тайтла поста — два ответа, потому что пост бывает и целью, и
// источником, а спрашивают с них по-разному:
//
//   role (как ЦЕЛЬ — «про что этот материал»):
//     'main'    — предмет материала;
//     'section' — предмет одного раздела подборки или один из длинного
//                 списка в поле «тайтлы» (обзор сезона, эссе про жанр);
//     'passing' — назван мимоходом.
//   weighty (как ИСТОЧНИК — «можно ли отсюда вести на материал про него»).
//
// Поле «тайтлы» и карточки в конце — один признак: замер 24.09.2026, у всех
// 434 постов с карточками карточки входят в поле. Длинное поле (подборка,
// обзор сезона) — это «упомянут», а не «предмет», поэтому оно даёт 'main'
// только когда в нём не больше FIELD_MAIN_MAX тайтлов.

export const FIELD_MAIN_MAX = 2;
export const LAST_PARAGRAPH_MAX = 2;

/** Номер блока-заголовка раздела → тайтлы в этом заголовке. */
function sectionTitles(post) {
	const map = new Map();
	for (const b of post.blocks) {
		if (b.kind === 'heading' && b.depth <= 4 && b.anime && Object.keys(b.anime).length) {
			map.set(b.n, Object.keys(b.anime));
		}
	}
	return map;
}

export function classifyAnime(post) {
	const out = {};
	const counts = post.textAnime;
	const total = Object.values(counts).reduce((s, c) => s + c, 0);
	const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	const topCount = ranked[0]?.[1] ?? 0;
	const secondCount = ranked[1]?.[1] ?? 0;
	const all = new Set([...Object.keys(counts), ...Object.keys(post.titleAnime), ...post.field]);
	const textBlocks = post.blocks.filter((b) => b.kind === 'text');
	const lastText = textBlocks[textBlocks.length - 1];
	// Последний абзац весом, только если он не перечисление: «плакали, когда
	// кончились „Наруто“, „Друзья“ и „Моб Психо“» — это сравнение, а не тема.
	const lastIsList = Object.keys(lastText?.anime ?? {}).length > LAST_PARAGRAPH_MAX;
	const sections = sectionTitles(post);
	const shortField = post.field.length > 0 && post.field.length <= FIELD_MAIN_MAX;
	const titleHasAnime = Object.keys(post.titleAnime).length > 0;

	for (const id of all) {
		const count = counts[id] ?? 0;
		const why = [];
		const inTitle = id in post.titleAnime;
		const inField = post.field.includes(id);
		const inCard = post.blocks.some((b) => b.kind === 'anime-ref' && b.animeId === id);
		const inLast = Boolean(lastText?.anime?.[id]) && !lastIsList;
		const sectionOf = [...sections].filter(([, ids]) => ids.includes(id)).map(([n]) => n);
		const sole = all.size === 1;
		// Лидер текста: назван чаще всех, минимум дважды, не меньше половины
		// всех упоминаний тайтлов и строго чаще второго.
		// Заголовок сильнее счёта: если в заголовке назван тайтл, лидер текста
		// другого тайтла главным не становится («Как создаются „Цугаи“?», где
		// «Стальной алхимик» назван дважды для сравнения).
		const leader =
			!titleHasAnime && count >= 2 && count === topCount && count > secondCount && count * 2 >= total;

		let role = 'passing';
		if (inTitle) (role = 'main'), why.push('в заголовке');
		if (sole) (role = 'main'), why.push('единственный тайтл');
		if (leader) (role = 'main'), why.push(`лидер текста (${count} из ${total})`);
		if (inField && shortField) (role = 'main'), why.push('в коротком поле «тайтлы»');
		if (role !== 'main' && sectionOf.length) (role = 'section'), why.push('заголовок раздела');
		if (role === 'passing' && inField) (role = 'section'), why.push(`в длинном поле «тайтлы» (${post.field.length})`);
		if (role === 'passing') why.push(count ? `назван ${count} раз` : 'только в поле');

		// Весомость у источника — хотя бы одно из: заголовок, карточка/поле,
		// назван не один раз, назван в последнем абзаце, заголовок раздела.
		const w = [];
		if (inTitle) w.push('в заголовке');
		if (inCard || inField) w.push(inCard ? 'карточка в конце' : 'в поле «тайтлы»');
		if (count >= 2) w.push(`назван ${count} раз`);
		if (inLast) w.push('в последнем абзаце');
		if (sectionOf.length) w.push('заголовок раздела');
		if (sole && !w.length) w.push('единственный тайтл');

		out[id] = {
			role,
			why,
			weighty: w.length > 0,
			weightWhy: w,
			count,
			inTitle,
			inField,
			leader,
			sole,
			// Насколько очевидно, что материал про этот тайтл (для цели):
			// заголовок 1, лидер текста 0.85, короткое поле 0.75, единственный 0.6.
			centrality: role !== 'main' ? 0 : inTitle ? 1 : leader ? 0.85 : inField && shortField ? 0.75 : 0.6,
			inCard,
			inLast,
			sectionOf,
			// В каких блоках назван — по номеру блока.
			blocks: post.blocks.filter((b) => b.anime?.[id]).map((b) => b.n),
		};
	}
	return out;
}
