import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

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

	return new Response(JSON.stringify({ guid: entry.id, episodeTitle: entry.data.episodeTitle ?? null, speakers }), {
		headers: { 'Content-Type': 'application/json' },
	});
};
