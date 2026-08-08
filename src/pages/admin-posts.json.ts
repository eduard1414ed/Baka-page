import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { transcriptIdFor } from '../lib/animeMentionIndex.mjs';

// Какому посту какая расшифровка — для админки (тз/05, шаг 6).
//
// ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Виджету надо знать guid выпуска, чтобы показать
// голоса и упоминания. Взять его в админке неоткуда:
//   1. Sveltia CMS не передаёт в своё поле саму запись. Передаётся ровно
//      { value, field, forID, classNameWrapper, onChange, ref } — проверено
//      по коду CMS. В Decap, по документации которого писались виджеты,
//      запись передаётся, отсюда и была ошибка.
//   2. Прочитать `audioGuid` из формы тоже нельзя: его нет среди полей
//      в public/admin/config.yml, поля для него на экране не существует.
//      (В файл поста он при этом попадает и при сохранении через CMS
//      не теряется — проверено на истории ep-134.)
//
// Поэтому связь берётся отсюда, а какой пост открыт — из адреса страницы
// админки (#/collections/posts/entries/ep-134).
//
// Список считается при сборке, поэтому у поста, созданного только что,
// связи тут ещё нет — поле заработает после ближайшей сборки сайта.
// Черновики включены: в админке правят и неопубликованное.
export const prerender = true;

export const GET: APIRoute = async () => {
	const [posts, transcripts] = await Promise.all([getCollection('posts'), getCollection('transcripts')]);

	// Только те, у кого расшифровка правда есть. Выпуск в RSS указан у 143
	// постов, а расшифровок 107 (36 эссе и «Врат аниме» не распознавали) —
	// без этого отсева админка ходила бы за несуществующим файлом.
	const known = new Set(transcripts.map((entry) => entry.id));

	const map = Object.fromEntries(
		posts.map((post) => [post.id, transcriptIdFor(post)]).filter(([, transcriptId]) => transcriptId && known.has(transcriptId)),
	);

	return new Response(JSON.stringify(map), { headers: { 'Content-Type': 'application/json' } });
};
