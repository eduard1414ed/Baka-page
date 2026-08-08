import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readFile } from 'node:fs/promises';
import { mentionContext } from '../../lib/mentionContext.mjs';
import { fold } from '../../lib/animeMentions.mjs';

// Данные о выпуске для админки (тз/05, шаг 6): один маленький файл на выпуск,
// имя — guid расшифровки. Отсюда виджет правки имён спикеров берёт список
// голосов и подсказки к ним.
//
// ЗАЧЕМ ОТДЕЛЬНЫЕ ФАЙЛЫ, А НЕ ОДИН ОБЩИЙ. Выпусков с расшифровкой 107, и общий
// файл пришлось бы скачивать целиком при правке любого поста. Здесь же админка
// забирает ровно тот выпуск, который открыт.
//
// Считаем всё при сборке, а не в браузере: в админке не должно быть второй,
// отдельно написанной копии правил разметки — разъедется с сайтом незаметно.
export const prerender = true;

export async function getStaticPaths() {
	const transcripts = await getCollection('transcripts');
	return transcripts.map((entry) => ({ params: { guid: entry.id }, props: { entry } }));
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
	const { entry } = props as { entry: any };
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

	const corrections = await readSuggestions(entry.id, entry.data.replicas);

	return new Response(
		JSON.stringify({ guid: entry.id, episodeTitle: entry.data.episodeTitle ?? null, speakers, corrections }),
		{ headers: { 'Content-Type': 'application/json' } },
	);
};
