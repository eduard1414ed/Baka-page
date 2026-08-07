// Указатель «какой тайтл в каком выпуске упомянут и на какой минуте»
// (тз/05, шаг 5). Собирается при сборке сайта из расшифровок.
//
// Отдельный модуль, потому что его читают две страницы: /anime/[slug] (карточки
// выпусков и таймкоды в них) и /anime (счётчик упоминаний у каждого тайтла).
// Если бы каждая считала сама, числа на них разъехались бы.

import { groupReplicas, hasUsableTimecodes } from './transcript.mjs';
import { buildAnimeMatcher, collectBlockMentions } from './animeMentions.mjs';

// Как страница поста находит свою расшифровку: сначала по полю `transcript`,
// если автор его заполнил, иначе по audioGuid — файл расшифровки называется тем
// же guid, что запись в RSS (см. src/pages/posts/[slug].astro).
export function transcriptIdFor(post) {
	return post.data.transcript ?? post.data.audioGuid ?? null;
}

/**
 * @returns {Map<string, Map<string, number[]>>} id тайтла → (id поста → таймкоды)
 */
export function buildMentionIndex({ posts, transcripts, animeList }) {
	const matcher = buildAnimeMatcher(animeList);
	const byTranscriptId = new Map(transcripts.map((entry) => [entry.id, entry]));
	const index = new Map();

	for (const post of posts) {
		const transcriptId = transcriptIdFor(post);
		const transcript = transcriptId ? byTranscriptId.get(transcriptId) : undefined;
		// hasUsableTimecodes — те же два начитанных по сценарию эссе, у которых
		// одна реплика на весь выпуск: блок транскрипта им не выводится, значит
		// и ссылаться на минуту внутри них не на что.
		if (!transcript || !hasUsableTimecodes(transcript.data)) continue;

		for (const [animeId, times] of collectBlockMentions(groupReplicas(transcript.data), matcher)) {
			const perPost = index.get(animeId) ?? new Map();
			perPost.set(post.id, times);
			index.set(animeId, perPost);
		}
	}

	return index;
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
