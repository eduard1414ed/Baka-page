// Указатель «какой тайтл в каком выпуске упомянут и на какой минуте»
// (тз/05, шаг 5). Собирается при сборке сайта из расшифровок.
//
// Отдельный модуль, потому что его читают две страницы: /anime/[slug] (карточки
// выпусков и таймкоды в них) и /anime (счётчик упоминаний у каждого тайтла).
// Если бы каждая считала сама, числа на них разъехались бы.

import { groupReplicas, hasUsableTimecodes } from './transcript.mjs';
import { buildAnimeMatcher, collectMentions, findMentions } from './animeMentions.mjs';
import { makeExceptionFilter, parseMentionExceptions } from './mentionExceptions.mjs';
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
			`Проверьте блок «Упоминания тайтлов» у этого поста в админке.`,
	);
}

// КАКИЕ ТАЙТЛЫ УБРАНЫ ИЗ ЭТОГО ПОСТА РУКАМИ — одно место на всех, кто
// спрашивает (хвост 50). Разбор строки кэшируется по самой строке: постов
// 1595, а строка у них почти всегда пустая и одна и та же.
const EMPTY = new Set();
const hiddenCache = new Map();

export function animeHiddenInPost(post) {
	const raw = post?.data?.mentionsHidden ?? '';
	if (!raw) return EMPTY;
	if (!hiddenCache.has(raw)) hiddenCache.set(raw, new Set(parseMentionExceptions(raw).hiddenAnime));
	return hiddenCache.get(raw);
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
 * тайтл попадёт в список, но ссылки в тексте не будет. Замер 11 августа 2026
 * по ВСЕМ 1595 постам: таких мест ноль, и сам замер проверен подлогом —
 * разорванное название он находит. МЕНЯЕТЕ ЗДЕСЬ — ПОСМОТРИТЕ И В ПЛАГИН
 * (src/plugins/remark-anime.mjs).
 *
 * ОТМЕНЁННЫЕ ТАЙТЛЫ СЮДА НЕ ПОПАДАЮТ (хвост 50). Запись «убрать тайтл целиком»
 * из поля «Упоминания тайтлов» действует и здесь, и в плагине разметки. Спроси
 * её только плагин — ссылка из текста пропала бы, а пост на странице тайтла
 * остался, и вышла бы та же несогласица, ради которой чинился хвост 44,
 * только с другой стороны.
 *
 * ФИЛЬТР ОБЯЗАН ПЕРЕДАТЬ ВЫЗЫВАЮЩИЙ, и молчание тут запрещено — как у галочки
 * «только в кавычках». Причина не в церемонии: у поста с расшифровкой фильтр
 * ОДИН на обе половины (текст и живая речь), потому что он же считает, какие
 * правила ни разу не сработали (`lost()`). Построй мы тут свой экземпляр —
 * правило, сработавшее в тексте, для расшифровки осталось бы «потерянным»,
 * и сборка ругалась бы на здоровое поле.
 *
 * @param {{ isHidden: (id: string, replica: number, offset: number) => boolean }} exceptions
 * @returns {string[]} id тайтлов, в порядке первого упоминания
 */
export function animeMentionedInPostText(post, matcher, exceptions) {
	if (typeof exceptions?.isHidden !== 'function') {
		throw new Error(
			'animeMentionedInPostText: передайте фильтр исключений — makeExceptionFilter(post.data.mentionsHidden). ' +
				'Без него отменённый тайтл остался бы на странице тайтла, хотя ссылки в тексте уже нет.',
		);
	}

	const found = findMentions(toPlainText(post.body ?? ''), matcher);
	// Реплики и позиции у текста поста нет — якорь тут «тайтл × пост», то есть
	// работает только запись `animeId:*`. Позиция не годится: тело поста правят
	// в админке, и она сдвинулась бы молча.
	const kept = found.filter((mention) => !exceptions.isHidden(mention.id, -1, -1));
	return [...new Set(kept.map((mention) => mention.id))];
}

/**
 * @returns {Map<string, Map<string, number[]>>} id тайтла → (id поста → таймкоды)
 */
export function buildMentionIndex({ posts, transcripts, animeList }) {
	// Живая речь: галочка «только в кавычках» в расшифровках не действует —
	// кавычек в разговоре не бывает (см. src/lib/animeMentions.mjs).
	const matcher = buildAnimeMatcher(animeList, { quotes: 'ignore', speech: true });
	// Тексты постов: там действует.
	const postMatcher = buildAnimeMatcher(animeList, { quotes: 'apply', speech: false });
	const byTranscriptId = new Map(transcripts.map((entry) => [entry.id, entry]));
	const index = new Map();

	// ФИЛЬТР ИСКЛЮЧЕНИЙ — ОДИН НА ПОСТ, А НЕ ПО ОДНОМУ НА ПОЛОВИНУ. Он же считает,
	// какие правила ни разу не сработали (`lost()`), и правило, снявшее тайтл
	// в ТЕКСТЕ поста, обязано считаться сработавшим и для расшифровки — иначе
	// сборка ругалась бы «правило потерялось» на здоровое поле (хвост 50).
	const filters = new Map(posts.map((post) => [post.id, makeExceptionFilter(post.data.mentionsHidden)]));
	// Чьи правила уже проверены на «сработало ли» — см. второй цикл и хвост ниже.
	const checked = new Set();

	// ТЕКСТ ПОСТА — ТАКОЕ ЖЕ УПОМИНАНИЕ, КАК ЗВУЧАЩЕЕ В ВЫПУСКЕ (хвост 44).
	// Без этого широкая разметка постов дала бы ссылку из поста на страницу
	// тайтла, а на самой странице тайтла этого поста не было бы: читатель
	// нажимает и попадает в список, где его же поста нет.
	// Таймкодов у текста не бывает — отсюда пустой список времён.
	for (const post of posts) {
		for (const animeId of animeMentionedInPostText(post, postMatcher, filters.get(post.id))) {
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

		const filter = filters.get(post.id);
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
		checked.add(post.id);
	}

	// У ПОСТА БЕЗ РАСШИФРОВКИ ПОТЕРЯННОЕ ПРАВИЛО НЕ СПРАШИВАЛ НИКТО — до хвоста
	// 50 такого поста и быть не могло: поле работало только в расшифровках.
	// Теперь может, и молчать тут нельзя: вписанное в поле «уберите этот тайтл»
	// про тайтл, которого в тексте нет, иначе просто ничего не сделало бы,
	// а человек считал бы, что сделало. Ломаться громко лучше, чем тихо врать.
	for (const post of posts) {
		if (checked.has(post.id)) continue;
		warnAboutLost(post.id, filters.get(post.id).lost());
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
		// ОТМЕНА СИЛЬНЕЕ ПОЛЯ «ТАЙТЛЫ ПОСТА» (хвост 50). Пост попадает сюда двумя
		// путями — по найденному упоминанию и по отметке руками, — и убрать надо
		// оба сразу. Уберём только первый — ссылка из текста исчезнет, а пост
		// на странице тайтла останется: ровно та несогласица, ради которой
		// чинился хвост 44. Поле при этом заполняется САМО при сохранении поста,
		// так что «отметил и тут же отменил» — обычное дело, а не противоречие.
		.filter((post) => !animeHiddenInPost(post).has(animeId))
		.filter((post) => perPost.has(post.id) || (post.data.anime ?? []).some((ref) => ref.id === animeId))
		.map((post) => ({ post, times: perPost.get(post.id) ?? [] }))
		.sort((a, b) => b.post.data.date.valueOf() - a.post.data.date.valueOf());
}
