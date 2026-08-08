// Указатель «какой тайтл в каком выпуске упомянут и на какой минуте»
// (тз/05, шаг 5). Собирается при сборке сайта из расшифровок.
//
// Отдельный модуль, потому что его читают две страницы: /anime/[slug] (карточки
// выпусков и таймкоды в них) и /anime (счётчик упоминаний у каждого тайтла).
// Если бы каждая считала сама, числа на них разъехались бы.

import { groupReplicas, hasUsableTimecodes } from './transcript.mjs';
import { buildAnimeMatcher, collectMentions } from './animeMentions.mjs';
import { makeExceptionFilter } from './mentionExceptions.mjs';
import { applyPostOverrides } from './transcriptOverrides.mjs';

// Как страница поста находит свою расшифровку: сначала по полю `transcript`,
// если автор его заполнил, иначе по audioGuid — файл расшифровки называется тем
// же guid, что запись в RSS (см. src/pages/posts/[slug].astro). Тем же именем
// называется и файл исключений в src/content/mention-exceptions/.
export function transcriptIdFor(post) {
	return post.data.transcript ?? post.data.audioGuid ?? null;
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
			`Поправьте src/content/mention-exceptions/${id}.json`,
	);
}

/**
 * @param {object[]} exceptions — коллекция mentionExceptions (может быть пустой)
 * @returns {Map<string, Map<string, number[]>>} id тайтла → (id поста → таймкоды)
 */
export function buildMentionIndex({ posts, transcripts, animeList, exceptions = [] }) {
	const matcher = buildAnimeMatcher(animeList);
	const byTranscriptId = new Map(transcripts.map((entry) => [entry.id, entry]));
	const byExceptionId = new Map(exceptions.map((entry) => [entry.id, entry]));
	const index = new Map();

	for (const post of posts) {
		const transcriptId = transcriptIdFor(post);
		const transcript = transcriptId ? byTranscriptId.get(transcriptId) : undefined;
		// hasUsableTimecodes — те же два начитанных по сценарию эссе, у которых
		// одна реплика на весь выпуск: блок транскрипта им не выводится, значит
		// и ссылаться на минуту внутри них не на что.
		if (!transcript || !hasUsableTimecodes(transcript.data)) continue;

		const filter = makeExceptionFilter(byExceptionId.get(transcriptId)?.data);
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
 * Какие тайтлы прозвучали в одной расшифровке — в порядке первого упоминания.
 * Нужно странице выпуска: плашки тайтлов под текстом должны показывать и то,
 * что нашлось в расшифровке, иначе выходит несогласица — на странице тайтла
 * выпуск есть, а на странице выпуска тайтла нет.
 *
 * Отсев тот же, что у указателя (`hasUsableTimecodes` и исключения), чтобы
 * обе стороны связи видели одно и то же.
 */
export function animeMentionedIn(transcriptData, matcher, exceptions) {
	if (!hasUsableTimecodes(transcriptData)) return [];
	return [...collectMentions(groupReplicas(transcriptData), matcher, exceptions).keys()];
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
