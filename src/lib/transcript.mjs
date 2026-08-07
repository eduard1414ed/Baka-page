// Подготовка расшифровки к показу на странице (тз/05, шаг 5).
// Чистые функции без обращений к сети и файлам — сборка сайта вызывает их
// на готовых данных из src/content/transcripts/*.json.

// Реплики одного человека склеиваются в один блок, но не бесконечно: если блок
// дорос до этого порога, начинается новый — даже если говорит тот же человек.
//
// Зачем: в ТЗ есть пункт приёмки «кликаю по реплике в середине — плеер
// перематывается туда». Без порога подряд идущие реплики одного голоса
// склеивались в стену без единого таймкода внутри — в архиве 49 таких блоков
// длиннее трёх минут, худший 7,5 минут и 7230 знаков. Ткнуть в середину
// такого блока некуда.
//
// Рвём только по границам реплик, у каждой из которых свой настоящий таймкод из
// распознавания. На глаз, по числу букв, не режем никогда — клик уезжал бы не
// туда, куда обещает плашка.
export const MAX_BLOCK_SEC = 90;

// Что показываем вместо имени, когда автоматика в нём сомневалась.
export const UNKNOWN_SPEAKER = 'Спикер не определён';

// Таймкод в вид 4:07 или 1:23:45 — как в тексте постов (remark-timecode.mjs).
export function formatTimecode(seconds) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	const pad = (n) => String(n).padStart(2, '0');
	const s = total % 60;
	const m = Math.floor(total / 60) % 60;
	const h = Math.floor(total / 3600);
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Имя голоса для читателя.
//
// Знак `?` в имени ставит pipeline.py, когда на роль ведущего по высоте голоса
// подошёл кто-то ещё и говорил заметно (сейчас таких выпусков два: «Кайдзю № 8»
// и «Anime Awards 2024»). Читателю показываем нейтрально, а не как ошибку:
// утверждать «Ксюша», когда мы не уверены, нельзя, но и «Гость» не годится —
// в тех же выпусках есть настоящий гость, вышла бы путаница.
//
// ВАЖНО: судим только по знаку `?` в имени. Флаг needsName в speakerInfo для
// этого не годится — он стоит у КАЖДОГО гостя (их в архиве 64), и по нему все
// гости превратились бы в «Спикер не определён».
export function speakerLabel(speakers, id) {
	const raw = speakers?.[id];
	if (!raw || raw.includes('?')) return UNKNOWN_SPEAKER;
	return raw;
}

// Есть ли смысл показывать расшифровку. Одна реплика на весь выпуск — это два
// начитанных по готовому сценарию эссе («Как стать лучше?», 24 мин, и «Каким
// получился этот аниме-год», 17 мин): монолог, распознаванию нечего было делить.
// Внутри такой реплики таймкодов не существует, честно порезать не по чему.
// Оба ждут выравнивания готового текста по звуку (тз/05, шаг 2) — до тех пор
// блок транскрипта у них просто не выводится.
export function hasUsableTimecodes(transcript) {
	return Array.isArray(transcript?.replicas) && transcript.replicas.length > 1;
}

// Реплики → блоки для вывода. У блока:
//   speaker  — номер голоса (speaker_0), нужен для отладки и будущей разметки
//   name     — имя для читателя (см. speakerLabel)
//   start    — таймкод начала в секундах, на нём стоит кликабельная плашка
//   end      — таймкод конца, понадобится «слежению за плеером» (вторая сессия)
//   text     — склеенный текст реплик блока
//   continues — true, если предыдущий блок был того же голоса (значит блок
//               оторвался по порогу, а не потому что заговорил другой человек).
//               По этому флагу имя во втором и дальше блоке не повторяется —
//               читается как одна непрерывная речь, но плашка есть каждые
//               полторы минуты.
export function groupReplicas(transcript, maxBlockSec = MAX_BLOCK_SEC) {
	const replicas = transcript?.replicas ?? [];
	const speakers = transcript?.speakers ?? {};
	const blocks = [];

	for (const replica of replicas) {
		const last = blocks[blocks.length - 1];
		const sameSpeaker = last && last.speaker === replica.speaker;
		const fitsInBlock = last && replica.end - last.start <= maxBlockSec;

		if (sameSpeaker && fitsInBlock) {
			last.end = replica.end;
			last.text += ` ${replica.text}`;
			continue;
		}

		blocks.push({
			speaker: replica.speaker,
			name: speakerLabel(speakers, replica.speaker),
			start: replica.start,
			end: replica.end,
			text: replica.text,
			continues: Boolean(sameSpeaker),
		});
	}

	return blocks;
}
