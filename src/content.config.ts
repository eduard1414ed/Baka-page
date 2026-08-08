import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Категории поста. Одна категория на пост.
export const categories = [
	{ id: 'podcast', label: 'Подкаст' },
	{ id: 'videoessay', label: 'Видеоэссе' },
	{ id: 'note', label: 'Заметки' },
	{ id: 'review', label: 'Обзоры' },
	{ id: 'bonus', label: 'Бонусы' },
] as const;

const categoryIds = categories.map((c) => c.id) as [string, ...string[]];

// Необязательная дата, которая переживает пустое поле из админки.
//
// CMS, сохраняя запись, пишет в незаполненное поле даты ПУСТУЮ СТРОКУ, а не
// пропускает его. Без этой поправки `z.coerce.date()` превращал её в Invalid
// Date, схема падала — и вместе с ней СБОРКА ВСЕГО САЙТА. То есть обычным
// сохранением поста из админки можно было положить сайт целиком; так и вышло
// с ep-134 8 августа, причём заметно это стало только по тому, что правки
// перестали появляться на страницах.
//
// Правило на будущее: со стороны CMS в схему может прийти пустая строка
// в любом необязательном поле, и схема обязана это пережить.
const emptyToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

const optionalDate = z.preprocess(emptyToUndefined, z.coerce.date().optional());
const optionalNumber = z.preprocess(emptyToUndefined, z.number().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const posts = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			date: z.coerce.date(),
			category: z.enum(categoryIds),
			cover: image().optional(),
			youtube: optionalUrl,
			video: z.string().optional(),
			audioGuid: z.string().optional(),
			buttons: z
				.array(
					z.object({
						label: z.string(),
						url: z.string().url(),
						style: z.enum(['primary', 'secondary']).default('secondary'),
					}),
				)
				.optional(),
			// Имя файла расшифровки в src/content/transcripts/ (без .json).
			// Обычно заполнять не нужно: у выпусков подкаста расшифровка находится
			// сама по audioGuid — файл называется тем же guid. Поле нужно там, где
			// audioGuid нет вовсе: видеоэссе живут на YouTube, в RSS их нет,
			// а расшифровка у них по тз/05 (шаг 2) будет.
			transcript: z.string().optional(),
			// Имена голосов, вписанные руками в админке, одной строкой:
			// 'speaker_0=Эд; speaker_1=Ксюша'. Побеждают автоматические имена
			// из файла расшифровки. Почему строкой и почему в посте —
			// см. src/lib/speakerNames.mjs.
			speakers: z.string().optional(),
			// Подтверждённые руками исправления названий в расшифровке, одной
			// строкой: '9|Фринен|Фрирен'. Пусто = не исправлено ничего, и это
			// нормальное состояние — предложения из transcripts/*.corrections.json
			// применяются только отмеченные. См. src/lib/nameCorrections.mjs.
			corrections: z.string().optional(),
			// Что убрано из упоминаний руками, одной строкой:
			// 'monster:* k-on:12,45.1'. Пусто = не убрано ничего, это обычное
			// состояние. Разбор и правила — src/lib/mentionExceptions.mjs.
			mentionsHidden: z.string().optional(),
			script: z.string().optional(),
			draft: z.boolean().default(false),
			// Когда пост должен появиться на сайте — независимая ось от `date`
			// (см. тз/09-отложенный-постинг.md). Пусто = ни на что не влияет.
			// Обычный сценарий: галочка «Черновик» стоит, а publishAt задаёт время —
			// робот на Cloudflare Cron Trigger сам снимает «Черновик», когда время
			// наступает. Проверка тут — на случай, если галочку сняли вручную раньше
			// срока: сборка всё равно не покажет пост, пока publishAt в будущем.
			publishAt: optionalDate,
			// Пока проставляется вручную в файле поста. Автозаполнение из разметки
			// названий в тексте — следующий шаг (см. тз/03-тайтлы.md).
			anime: z.array(reference('anime')).optional(),
		}),
});

// Справочник тайтлов. Файлы — кэш данных с Shikimori, их создаёт и обновляет
// scripts/fetch-anime.mjs, сама сборка сайта Shikimori не дёргает никогда.
const anime = defineCollection({
	loader: glob({ pattern: '**/*.json', base: './src/content/anime' }),
	schema: z.object({
		id: z.string(),
		// Откуда взяты данные — Shikimori основной, AniList запасной (если
		// в Shikimori тайтла нет). Список источников — scripts/fetch-anime.mjs.
		source: z.enum(['shikimori', 'anilist']),
		sourceId: z.number(),
		// У AniList не бывает русских названий — тогда titleRu пустой,
		// на страницах тайтла это явно помечено, вписывается вручную.
		titleRu: z.string().optional(),
		titleOriginal: z.string(),
		year: optionalNumber,
		studio: z.string().optional(),
		// Путь к обложке в public/anime/ — см. src/lib/animePoster.mjs.
		poster: z.string().optional(),
		synopsis: z.string().optional(),
		url: optionalUrl,
		// Варианты написания, по которым упоминания ищутся наравне с titleRu
		// и titleOriginal: падежи («Ходячего замка»), как говорят вслух («K-On!»
		// вместо «Кэйон!»), как искажает распознавание («Фринен»). Правятся
		// в админке, ни Shikimori, ни AniList их не отдают — поэтому обновление
		// справочника их не трогает. Зеркало исключений упоминаний: варианты
		// упоминания добавляют, исключения убирают.
		aliases: z.array(z.string()).default([]),
		// Альтернативные названия, как их знает источник (раздел Shikimori
		// «Альтернативные названия»). ПО НИМ УПОМИНАНИЯ НЕ ИЩУТСЯ — это только
		// подсказки к полю выше: в админке они показываются кнопкой «добавить».
		// Молча пускать их в поиск нельзя, среди них попадается мусор вроде
		// «K-ON! Season 1», а плохой вариант даёт ложные упоминания сразу
		// по всему архиву и незаметно.
		sourceAliases: z.array(z.string()).default([]),
		// Какие поля правлены руками. Обновление из Shikimori/AniList такое поле
		// не перезаписывает, а пишет в лог, что данные из API проигнорированы
		// (scripts/anime-lib.mjs). Признак по каждому полю отдельно, а не на всю
		// карточку — так и сказано в CLAUDE.md: описание заказчик переписывает
		// своими словами, а обложку хочет обновлять автоматически.
		manual: z.array(z.enum(['titleRu', 'synopsis', 'poster'])).default([]),
	}),
});

// Расшифровки выпусков. Файлы делает scripts/transcribe/pipeline.py на Hetzner
// (см. тз/05-транскрипты.md), сайт их только читает. Имя файла — guid выпуска
// из RSS, по нему страница поста и находит свою расшифровку: сначала по полю
// `transcript`, если оно заполнено, иначе по `audioGuid` (см. src/pages/posts/[slug].astro).
const transcripts = defineCollection({
	// Не '**/*.json': рядом в transcripts/ в корне лежат ещё *.corrections.json
	// и state.json — у них другой формат, и попади они сюда, сборка бы упала.
	loader: glob({ pattern: '*.json', base: './src/content/transcripts' }),
	schema: z.object({
		// Откуда взялся текст. `recognized` — распознано с аудио; `aligned` —
		// готовый сценарий, выровненный по звуку (шаг 2 тз/05, ещё не делали).
		// Сейчас во всех 107 файлах стоит `recognized`.
		source: z.enum(['recognized', 'aligned']),
		provider: z.string().optional(),
		episodeGuid: z.string(),
		episodeTitle: z.string().optional(),
		// Карта «номер голоса → имя»: speaker_0 → «Эд». Имена лежат отдельно от
		// реплик специально — переименование это правка одной строки, а не всего
		// файла (тз/05, шаг 4). Знак `?` в имени = автоматика сомневалась;
		// читателю такой голос показываем как «Спикер не определён»,
		// см. src/lib/transcript.mjs.
		speakers: z.record(z.string(), z.string()),
		// Подсказки для ручной простановки имён. На странице не используются —
		// нужны будущему виджету правки имён в админке (тз/05, шаг 4).
		// Осторожно: needsName стоит у КАЖДОГО гостя (их в архиве 64), поэтому
		// судить по нему о сомнении нельзя — только по знаку `?` в имени.
		speakerInfo: z
			.record(
				z.string(),
				z.object({
					role: z.string(),
					detectedBy: z.string(),
					// null, если высоту голоса измерить не удалось
					pitchHz: z.number().nullable().optional(),
					speechSeconds: z.number().optional(),
					needsName: z.boolean().optional(),
					// true = имя вписано человеком, --recheck-speakers такое не трогает
					manual: z.boolean().optional(),
				}),
			)
			.optional(),
		// Таймкоды в секундах от начала выпуска, с точностью до сотых.
		replicas: z.array(
			z.object({
				start: z.number(),
				end: z.number(),
				speaker: z.string(),
				text: z.string(),
			}),
		),
	}),
});

// Отдельной полки для исключений упоминаний больше нет: они живут строкой
// в поле `mentionsHidden` самого поста (тз/05, шаг 6). Причина — поле стоит
// в редакторе поста, а CMS умеет сохранять только свою же запись. Подробно
// расписано в src/lib/mentionExceptions.mjs.

export const collections = { posts, anime, transcripts };
