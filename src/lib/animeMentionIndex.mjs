// Указатель «какой тайтл в каком выпуске упомянут и на какой минуте»
// (тз/05, шаг 5). Собирается при сборке сайта из расшифровок.
//
// Отдельный модуль, потому что его читают две страницы: /anime/[slug] (карточки
// выпусков и таймкоды в них) и /anime (счётчик упоминаний у каждого тайтла).
// Если бы каждая считала сама, числа на них разъехались бы.

import { groupReplicas, hasUsableTimecodes } from './transcript.mjs';
import { buildAnimeMatcher, collectMentions, findMentions } from './animeMentions.mjs';
import { makeExceptionFilter } from './mentionExceptions.mjs';
import { applyPostOverrides } from './transcriptOverrides.mjs';
import { toPlainText } from './plainText.mjs';

// Как страница поста находит свою расшифровку: сначала по полю `transcript`,
// если автор его заполнил, иначе по audioGuid — файл расшифровки называется тем
// же guid, что запись в RSS (см. src/pages/posts/[slug].astro).
export function transcriptIdFor(post) {
	return post.data.transcript ?? post.data.audioGuid ?? null;
}

// Обратный поиск: чей это выпуск. Нужен там, где на руках расшифровка, а правки
// к ней (имена, исправления, исключения) лежат в посте — например при сборке
// данных для админки, src/pages/admin-data/[guid].json.ts.
export function postForTranscript(posts, transcriptId) {
	return posts.find((post) => transcriptIdFor(post) === transcriptId) ?? null;
}

// Про какие потерянные исключения уже сказали: указатель строится дважды
// за сборку (страница списка тайтлов и страницы самих тайтлов), а ругаться
// на одно и то же дважды незачем.
const warned = new Set();

function warnAboutLost(id, lost) {
	if (lost.length === 0 || warned.has(id)) return;
	warned.add(id);
	console.warn(
		`[упоминания] ${id}: исключение не сработало — привязка потерялась, ` +
			`упоминание осталось на странице (${lost.join('; ')}). ` +
			`Проверьте блок «Упоминания в транскрипте» у этого поста в админке.`,
	);
}

/**
 * КАКИЕ ТАЙТЛЫ УПОМЯНУТЫ В ТЕКСТЕ ПОСТА — ОДНО МЕСТО НА ДВЕ СТОРОНЫ СВЯЗИ.
 *
 * Спрашивают отсюда двое: указатель ниже (чтобы пост попал на страницу тайтла)
 * и сама страница поста (чтобы под текстом встала марка тайтла). Считай каждый
 * сам — и выйдет несогласица: на странице тайтла пост есть, а на странице поста
 * тайтла нет. Ровно та же причина, по которой рядом живёт `animeMentionedIn`
 * для расшифровок.
 *
 * Разметку снимаем `toPlainText` — тем же кодом, которым её снимают подводка
 * и счётчик времени чтения.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ РАЗМЕТКИ САМОГО ТЕКСТА (src/plugins/remark-anime.mjs).
 * Плагин ставит ссылку на КОНКРЕТНОЕ вхождение и работает с деревом markdown,
 * а здесь нужен только СПИСОК тайтлов, и работать с деревом незачем. Список
 * названий и правило совпадения у обоих одни и те же — общий матчер.
 * Разойтись они могут в одном узком случае: если название разорвано разметкой
 * посередине («**Атака** титанов»), плагин его не увидит, а мы увидим — тогда
 * тайтл попадёт в список, но ссылки в тексте не будет. Замер по архиву
 * 11 августа 2026: таких мест ноль. МЕНЯЕТЕ ЗДЕСЬ — ПОСМОТРИТЕ И В ПЛАГИН.
 *
 * @returns {string[]} id тайтлов, в порядке первого упоминания
 */
export function animeMentionedInPostText(post, matcher) {
	const found = findMentions(toPlainText(post.body ?? ''), matcher);
	return [...new Set(found.map((mention) => mention.id))];
}

/**
 * @returns {Map<string, Map<string, number[]>>} id тайтла → (id поста → таймкоды)
 */
export function buildMentionIndex({ posts, transcripts, animeList }) {
	// Живая речь: галочка «только в кавычках» в расшифровках не действует —
	// кавычек в разговоре не бывает (см. src/lib/animeMentions.mjs).
	const matcher = buildAnimeMatcher(animeList, { quotes: 'ignore' });
	// Тексты постов: там действует.
	const postMatcher = buildAnimeMatcher(animeList, { quotes: 'apply' });
	const byTranscriptId = new Map(transcripts.map((entry) => [entry.id, entry]));
	const index = new Map();

	// ТЕКСТ ПОСТА — ТАКОЕ ЖЕ УПОМИНАНИЕ, КАК ЗВУЧАЩЕЕ В ВЫПУСКЕ (хвост 44).
	// Без этого широкая разметка постов дала бы ссылку из поста на страницу
	// тайтла, а на самой странице тайтла этого поста не было бы: читатель
	// нажимает и попадает в список, где его же поста нет.
	// Таймкодов у текста не бывает — отсюда пустой список времён.
	for (const post of posts) {
		for (const animeId of animeMentionedInPostText(post, postMatcher)) {
			const perPost = index.get(animeId) ?? new Map();
			if (!perPost.has(post.id)) perPost.set(post.id, []);
			index.set(animeId, perPost);
		}
	}

	for (const post of posts) {
		const transcriptId = transcriptIdFor(post);
		const transcript = transcriptId ? byTranscriptId.get(transcriptId) : undefined;
		// hasUsableTimecodes — те же два начитанных по сценарию эссе, у которых
		// одна реплика на весь выпуск: блок транскрипта им не выводится, значит
		// и ссылаться на минуту внутри них не на что.
		if (!transcript || !hasUsableTimecodes(transcript.data)) continue;

		const filter = makeExceptionFilter(post.data.mentionsHidden);
		// Подтверждённые исправления названий меняют текст, а значит и то, что
		// в нём находится. Считать по неисправленному нельзя: тайтл нашёлся бы
		// на странице выпуска, но не на своей собственной.
		const data = applyPostOverrides(transcript.data, post.data);

		for (const [animeId, times] of collectMentions(groupReplicas(data), matcher, filter)) {
			const perPost = index.get(animeId) ?? new Map();
			perPost.set(post.id, times);
			index.set(animeId, perPost);
		}

		warnAboutLost(transcriptId, filter.lost());
	}

	return index;
}

/**
 * Какие тайтлы прозвучали в одной расшифровке — в порядке первого упоминания,
 * и на каких минутах. Нужно странице выпуска: марки тайтлов под текстом должны
 * показывать и то, что нашлось в расшифровке, иначе выходит несогласица —
 * на странице тайтла выпуск есть, а на странице выпуска тайтла нет. Число
 * таймкодов у тайтла — это и есть «7 фрагментов» в подписи марки.
 *
 * Отсев тот же, что у указателя (`hasUsableTimecodes` и исключения), чтобы
 * обе стороны связи видели одно и то же.
 *
 * @returns {Map<string, number[]>} id тайтла → таймкоды упоминаний
 */
export function animeMentionedIn(transcriptData, matcher, exceptions) {
	if (!hasUsableTimecodes(transcriptData)) return new Map();
	return collectMentions(groupReplicas(transcriptData), matcher, exceptions);
}

/**
 * Посты, где тайтл упомянут: и те, у кого он стоит в поле `anime` (разметка
 * в тексте поста, тз/03), и те, где он прозвучал в расшифровке.
 *
 * @returns {{ post: object, times: number[] }[]} по дате, свежие сверху
 */
export function postsForAnime(animeId, posts, index) {
	const perPost = index.get(animeId) ?? new Map();

	return posts
		.filter((post) => perPost.has(post.id) || (post.data.anime ?? []).some((ref) => ref.id === animeId))
		.map((post) => ({ post, times: perPost.get(post.id) ?? [] }))
		.sort((a, b) => b.post.data.date.valueOf() - a.post.data.date.valueOf());
}
