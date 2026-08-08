import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readFile } from 'node:fs/promises';
import { mentionContext } from '../../lib/mentionContext.mjs';
import { fold, buildAnimeMatcher, findMentions } from '../../lib/animeMentions.mjs';
import { formatTimecode } from '../../lib/transcript.mjs';
import { postForTranscript } from '../../lib/animeMentionIndex.mjs';
import { applyPostOverrides } from '../../lib/transcriptOverrides.mjs';

// Данные о выпуске для админки (тз/05, шаг 6): один маленький файл на выпуск,
// имя — guid расшифровки. Отсюда виджеты правки имён спикеров, исправлений
// названий и исключений упоминаний берут всё, что показывают.
//
// ЗАЧЕМ ОТДЕЛЬНЫЕ ФАЙЛЫ, А НЕ ОДИН ОБЩИЙ. Выпусков с расшифровкой 107, и общий
// файл пришлось бы скачивать целиком при правке любого поста. Здесь же админка
// забирает ровно тот выпуск, который открыт.
//
// Считаем всё при сборке, а не в браузере: в админке не должно быть второй,
// отдельно написанной копии правил разметки — разъедется с сайтом незаметно.
export const prerender = true;

export async function getStaticPaths() {
	// Посты берём ВСЕ, вместе с черновиками: в админке правят и неопубликованное.
	const [transcripts, posts, animeList] = await Promise.all([
		getCollection('transcripts'),
		getCollection('posts'),
		getCollection('anime'),
	]);

	// Матчер и названия считаем один раз на всю сборку, а не по разу на каждый
	// из 107 выпусков: справочник у всех один и тот же.
	const matcher = buildAnimeMatcher(animeList);
	const titles = Object.fromEntries(animeList.map((item) => [item.id, item.data.titleRu || item.data.titleOriginal]));

	return transcripts.map((entry) => ({
		params: { guid: entry.id },
		props: { entry, post: postForTranscript(posts, entry.id), matcher, titles },
	}));
}

/**
 * Все упоминания тайтлов в выпуске, сгруппированные по тайтлу.
 *
 * БЕЗ ОТСЕВА ПО ИСКЛЮЧЕНИЯМ: убранное руками должно остаться в списке и просто
 * побледнеть, чтобы его всегда можно было вернуть (тз/05, шаг 6). Что именно
 * убрано, админка знает из самого поля и решает сама.
 *
 * Ищем по репликам, а не по склеенному тексту: позиция внутри реплики —
 * половина якоря исключения, в склейке она была бы чужой.
 */
function collectAllMentions(replicas: { start: number; text: string }[], matcher: any, titles: Record<string, string>) {
	const byAnime = new Map<string, any[]>();

	for (const [index, replica] of replicas.entries()) {
		for (const mention of findMentions(replica.text, matcher)) {
			const list = byAnime.get(mention.id) ?? [];
			list.push({
				replica: index,
				offset: mention.start,
				seconds: Math.floor(replica.start),
				timecode: formatTimecode(replica.start),
				context: mentionContext(replica.text, mention.start, mention.end),
			});
			byAnime.set(mention.id, list);
		}
	}

	// Порядок групп — по первому упоминанию: так карточки в админке идут в том
	// же порядке, в каком тайтлы звучат в выпуске.
	return [...byAnime.entries()].map(([id, mentions]) => ({
		id,
		// Тайтла может не быть в справочнике, если его файл ещё не донабрал
		// робот — тогда показываем хотя бы id, а не пустую карточку.
		title: titles[id] ?? id,
		mentions,
	}));
}

// speaker_2 должен идти после speaker_10 не по алфавиту, а по числу.
function byVoiceNumber(a: string, b: string) {
	return a.localeCompare(b, 'en', { numeric: true });
}

// Предложения исправить название, которые оставил scripts/transcribe/pipeline.py
// (см. src/lib/nameCorrections.mjs — там же, почему применять их можно только
// по одному и вручную). Файлы лежат в transcripts/ в корне репозитория,
// коллекцией Astro они не являются: формат другой, и под схему расшифровок
// они не подходят.
const CORRECTIONS_DIR = new URL('../../../transcripts/', import.meta.url);

async function readSuggestions(guid: string, replicas: { text: string }[]) {
	let raw: string;
	try {
		raw = await readFile(new URL(`${guid}.corrections.json`, CORRECTIONS_DIR), 'utf8');
	} catch {
		// Файла нет — по этому выпуску предложений не было, обычное состояние.
		return [];
	}

	return JSON.parse(raw)
		.map((item: any) => {
			const text = replicas[item.replica_index]?.text ?? '';
			const at = text.indexOf(item.found);
			// Слова в реплике уже нет — предложение устарело, показывать нечего.
			if (at === -1) return null;

			return {
				replica: item.replica_index,
				found: item.found,
				suggested: item.suggested,
				similarity: item.similarity,
				// Разница только в «е»/«ё» — поиск упоминаний её и так не
				// различает, значит замена ничего не даст, кроме вида текста.
				changesSearch: fold(item.found) !== fold(item.suggested),
				context: mentionContext(text, at, at + item.found.length),
			};
		})
		.filter(Boolean);
}

export const GET: APIRoute = async ({ props }) => {
	const { entry, post, matcher, titles } = props as { entry: any; post: any; matcher: any; titles: Record<string, string> };
	const info = entry.data.speakerInfo ?? {};

	const speakers = Object.keys(entry.data.speakers)
		.sort(byVoiceNumber)
		.map((id) => ({
			id,
			name: entry.data.speakers[id],
			// Знак «?» ставит распознавание, когда сомневалось в имени. Читателю
			// такой голос показывается как «Спикер не определён» (см.
			// src/lib/transcript.mjs) — в админке его надо подсветить.
			uncertain: String(entry.data.speakers[id]).includes('?'),
			role: info[id]?.role ?? null,
			pitchHz: info[id]?.pitchHz ?? null,
			speechSeconds: info[id]?.speechSeconds ?? null,
		}));

	// Предложения по названиям читаем по ИСХОДНОМУ тексту, а упоминания — по
	// исправленному. Иначе уже применённое исправление пропало бы из списка,
	// и снять с него галочку стало бы нечем.
	const corrections = await readSuggestions(entry.id, entry.data.replicas);
	const anime = collectAllMentions(applyPostOverrides(entry.data, post?.data).replicas, matcher, titles);

	return new Response(
		JSON.stringify({ guid: entry.id, episodeTitle: entry.data.episodeTitle ?? null, speakers, corrections, anime }),
		{ headers: { 'Content-Type': 'application/json' } },
	);
};
