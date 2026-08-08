import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Категории поста. Одна категория на пост.
//
// Два необязательных признака у категории:
//   hidden   — нет вкладки в ленте и нет своей страницы /category/…/.
//              Категория при этом живёт: её можно поставить посту в админке,
//              она лежит в файле поста, по ней можно будет отличать такие
//              посты в дизайне.
//   feedWith — в чьём разделе показывать её посты. Без него посты скрытой
//              категории видны только в общей ленте на главной.
//
// «Бонус» — указатель на материал, который лежит на Patreon и Boosty, а не
// здесь: обложка, название, описание, а дальше пост будет закрыт всплывающим
// окном с призывом подписаться (это ещё не сделано, дизайн отдельно).
// Своего раздела ему не надо, а рядом с выпусками он на месте.
//
// `description` — что написано в выдаче поисковика под ссылкой на раздел
// и в превью, когда ссылку на раздел кидают в чат (тз/06, шаг 8). Своё у каждой
// категории: одинаковое описание на всех страницах поисковик считает признаком
// пустого сайта. Лежит здесь, рядом с подписью, чтобы не разъехалось.
export const categories = [
	{
		id: 'podcast',
		label: 'Подкаст',
		description: 'Все выпуски подкаста «Бака!» об аниме — с расшифровками, таймкодами и упоминаниями тайтлов.',
	},
	{
		id: 'videoessay',
		label: 'Видеоэссе',
		description: 'Видеоэссе подкаста «Бака!»: разборы аниме, студий и режиссёров.',
	},
	{
		id: 'note',
		label: 'Заметки',
		description: 'Короткие заметки подкаста «Бака!» — о том, что не дотянуло до выпуска, но жалко потерять.',
	},
	{
		id: 'article',
		label: 'Статьи',
		description: 'Статьи подкаста «Бака!»: большие разборы аниме, интервью и рецензии.',
	},
	{
		id: 'bonus',
		label: 'Бонус',
		description: 'Бонусные материалы подкаста «Бака!» для подписчиков Patreon и Boosty.',
		hidden: true,
		feedWith: 'podcast',
	},
] as const;

const categoryIds = categories.map((c) => c.id) as [string, ...string[]];

type Category = (typeof categories)[number];

/** Категории со своим разделом: вкладки в ленте и страницы /category/…/. */
export const visibleCategories = categories.filter((c) => !('hidden' in c && c.hidden)) as readonly Category[];

/**
 * Какие категории показывать в разделе `id` — сам раздел плюс всё, что
 * приписано к нему через `feedWith`. Раздел «Подкаст» так собирает и выпуски,
 * и бонусы.
 */
export function categoriesShownIn(id: string): string[] {
	const attached = categories.filter((c) => 'feedWith' in c && c.feedWith === id).map((c) => c.id);
	return [id, ...attached];
}

/**
 * Куда ведёт ссылка «← назад» с поста и в чьём разделе он лежит. У скрытой
 * категории это чужой раздел, у обычной — свой собственный.
 *
 * Подпись при этом остаётся своя: у бонуса на карточке и в ссылке написано
 * «Бонус», а ведёт она в «Подкаст». Так и задумано — читателю видно, что это
 * за материал, но отдельного раздела под него нет.
 */
export function sectionOf(id: string): string {
	const category = categories.find((c) => c.id === id);
	return category && 'feedWith' in category ? category.feedWith : id;
}

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
	schema: () =>
		z.object({
			title: z.string(),
			date: z.coerce.date(),
			category: z.enum(categoryIds),
			// Обложка для ЛЕНТЫ И СОЦСЕТЕЙ — на самой странице поста она
			// не показывается. Во всех живых случаях картинка на странице уже
			// есть (обложка выпуска в тексте, кадр в статье, плеер ютюба
			// у видеоэссе), и обложка дублировала бы её.
			//
			// Путь к загруженной картинке ('/images/uploads/foo.jpg') СТРОКОЙ,
			// а не image() Astro. Здесь стоял image(), и это была мина: админка
			// кладёт файлы в public/, а image() их не видит — проверено, сборка
			// падает целиком с ImageNotFound. Поля в админке не было, поэтому
			// мина не сработала; стоило его добавить — сработала бы с первого
			// сохранения. Сжатие делает наша интеграция, та же, что для картинок
			// в тексте (src/plugins/optimize-uploads-integration.mjs).
			cover: z.preprocess(emptyToUndefined, z.string().optional()),
			// «Обложки нет намеренно» — не то же самое, что «обложка не задана».
			// Без флага короткая заметка неотличима от поста, которому обложку
			// просто забыли поставить. Нужен ленте: заметка должна выглядеть
			// заголовком в строку, а не карточкой с дырой на месте картинки
			// (окончательный вид — этап дизайна).
			noCover: z.boolean().default(false),
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
			// audioGuid нет вовсе: у видеоэссе, выложенного только на YouTube.
			// У видеоэссе с аудиоверсией в RSS audioGuid будет, как у выпуска —
			// от него же берётся длительность в строке рядом с датой
			// (см. src/lib/postTiming.mjs); без него длительность взять неоткуда
			// и метки просто не будет.
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

// Отдельные страницы сайта, которые правятся в админке. Сейчас там одна —
// «О подкасте». Не пост: у неё нет даты, и в ленту, RSS и поиск она попадать
// не должна.
//
// СХЕМА ЗДЕСЬ НАРОЧНО МАКСИМАЛЬНО СНИСХОДИТЕЛЬНАЯ: обязательных полей нет
// ни одного, всё переживает пустую строку. Причина в CLAUDE.md — падение
// схемы роняет сборку ВСЕГО сайта, и однажды обычное сохранение поста
// из админки так и положило сайт. Ради страницы, которую правят раз в год,
// такой риск брать незачем: пусть лучше блок не покажется, чем упадёт сборка.
const pages = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/pages' }),
	schema: z.object({
		hosts: z
			.array(
				z.object({
					name: z.string().optional(),
					role: z.string().optional(),
					// Путь к загруженной картинке: '/images/uploads/ed.jpg'.
					// Сжатые копии делает сборка, см. src/lib/imageVariants.mjs.
					photo: z.preprocess(emptyToUndefined, z.string().optional()),
					url: z.preprocess(emptyToUndefined, z.string().optional()),
				}),
			)
			.default([]),
		supportNote: z.string().optional(),
		contactEmail: z.preprocess(emptyToUndefined, z.string().optional()),
	}),
});

// Отдельной полки для исключений упоминаний больше нет: они живут строкой
// в поле `mentionsHidden` самого поста (тз/05, шаг 6). Причина — поле стоит
// в редакторе поста, а CMS умеет сохранять только свою же запись. Подробно
// расписано в src/lib/mentionExceptions.mjs.

export const collections = { posts, anime, transcripts, pages };
