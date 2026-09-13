// Сборка объектов Schema.org (тз/06, шаг 10). Выводит их <JsonLd> —
// см. src/components/JsonLd.astro.
//
// Зачем это нужно словами: поисковик читает страницу как текст и сам угадывает,
// что на ней. Разметка говорит прямо — «это выпуск подкаста, вот его
// длительность, вот аудиофайл, вот дата». От этого зависит, покажет ли Google
// выпуск в блоке подкастов и появятся ли крошки «Бака! › Подкаст › Название»
// вместо голого адреса под ссылкой в выдаче.

import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, absoluteUrl } from './site.mjs';
import { youtubeMeta } from '../data/youtubeMeta.mjs';

/** Подкаст целиком. К нему привязывается каждый выпуск через partOfSeries. */
function podcastSeries() {
	return {
		'@type': 'PodcastSeries',
		name: SITE_NAME,
		url: `${SITE_URL}/`,
		description: SITE_DESCRIPTION,
	};
}

/** Издатель — сам подкаст. Отдельного юрлица у проекта нет. */
function publisher() {
	return { '@type': 'Organization', name: SITE_NAME, url: `${SITE_URL}/` };
}

/**
 * Секунды → длительность в формате ISO 8601 («PT42M15S»), как требует
 * Schema.org. Именно в таком виде Google понимает, сколько длится выпуск.
 */
export function isoDuration(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}

/**
 * Выпуск подкаста.
 *
 * `associatedMedia` — прямая ссылка на аудио с хостинга подкаста. Свой файл
 * мы не копируем (см. CLAUDE.md), поэтому адрес тот же, что у плеера. Если
 * RSS в момент сборки не ответил, `episode` будет null и поля просто не будет:
 * разметка станет беднее, но останется верной.
 *
 * `@id` С ХВОСТОМ `#episode`, А НЕ ГОЛЫЙ АДРЕС СТРАНИЦЫ. На странице живут
 * несколько объектов разметки — выпуск, ролики, крошки, — и `@id` у каждого
 * обязан быть свой: два объекта с одним именем поисковик читает как один,
 * склеивая поля. Адрес страницы принадлежит самой странице.
 *
 * `transcript` — ГЛАВНОЕ ПОЛЕ ЭТОЙ РАЗМЕТКИ (TASK-markup, часть 1). Полный
 * текст разговора уже лежит на странице обычными абзацами, и поисковику он
 * виден как текст статьи. Это поле говорит, чтó он на самом деле такое —
 * запись разговора. Расшифровки единственное, чего нет больше нигде,
 * и назвать их своим именем стоит дороже любого другого поля здесь.
 * Текст НЕ ОБРЕЗАЕТСЯ: обрезанная расшифровка — это обещание, которого
 * страница не держит.
 *
 * СТОИТ ОНО ВНУТРИ `associatedMedia`, А НЕ У САМОГО ВЫПУСКА, И ЭТО НЕ ВКУС.
 * В задании поле нарисовано у `PodcastEpisode` — validator.schema.org
 * отвечает на такую разметку `UNKNOWN_FIELD: transcript, PodcastEpisode`:
 * у Schema.org `transcript` принадлежит `AudioObject` и `VideoObject`,
 * то есть самой записи, а не рассказу о ней. Переставили на один уровень
 * ниже — ошибок ноль, смысл тот же: «вот у этого звука есть вот такая
 * расшифровка». Проверено запросом к валидатору, а не чтением документации.
 */
export function podcastEpisodeSchema({ url, title, description, image, date, modified, episode, number, transcript }) {
	const duration = episode?.durationSec ? isoDuration(episode.durationSec) : null;

	return {
		'@context': 'https://schema.org',
		'@type': 'PodcastEpisode',
		'@id': `${url}#episode`,
		url,
		name: title,
		description,
		datePublished: date.toISOString(),
		...(modified ? { dateModified: modified } : {}),
		// Номер выпуска — числом, а не строкой «№135»: `episodeNumber`
		// у Schema.org число, и знак номера в нём был бы русской типографикой
		// внутри машинного поля. Номера нет у бонуса и у выпуска с запасным
		// именем файла (см. src/lib/postMeta.mjs) — тогда нет и поля.
		...(number ? { episodeNumber: number } : {}),
		...(image ? { image } : {}),
		...(duration ? { timeRequired: duration } : {}),
		partOfSeries: podcastSeries(),
		...(episode?.audioUrl
			? {
					associatedMedia: {
						// AudioObject, а не общий MediaObject: тип известен точно,
						// а общий отвечает «какое-то медиа» там, где можно
						// ответить «звук».
						'@type': 'AudioObject',
						contentUrl: episode.audioUrl,
						// Формат берём У САМОГО АДРЕСА, а не назначаем: хостинг
						// подкаста отдаёт mp3, и это видно по расширению файла.
						...(audioFormat(episode.audioUrl) ? { encodingFormat: audioFormat(episode.audioUrl) } : {}),
						...(duration ? { duration } : {}),
						...(transcript ? { transcript } : {}),
					},
				}
			: {}),
	};
}

/**
 * Тип аудиофайла по его адресу — или null, если расширение незнакомое.
 *
 * Спрашиваем адрес, а не пишем `audio/mpeg` постоянной: у всех 144 выпусков
 * архива сейчас mp3, но хостинг подкаста может отдать и другое, а неверный
 * тип хуже отсутствующего — по нему решают, чем файл открывать.
 */
function audioFormat(url) {
	const ТИПЫ = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav' };
	const ext = String(url).split('?')[0].split('.').pop()?.toLowerCase();
	return ТИПЫ[ext] ?? null;
}

/**
 * Встроенные ролики YouTube — по объекту на ролик (TASK-markup, пункт 1.2).
 *
 * ОТКУДА БЕРУТСЯ `name`, `description` И `uploadDate`. В тексте материала их
 * нет: ролик стоит блоком `::video{youtube="…"}`, и всё, что о нём знает
 * страница, — адрес. Заголовок поста роликом не является: в одном материале
 * их бывает несколько, и назвать каждый именем материала значило бы соврать
 * про все, кроме первого. Поэтому у YouTube про них спросили ОДИН раз
 * и положили ответ в репозиторий — src/data/youtubeMeta.mjs, пишет его
 * scripts/fetch-youtube-meta.mjs. Сборка в сеть не ходит.
 *
 * ЧЕГО В КЭШЕ НЕТ — ТОГО НЕТ И В РАЗМЕТКЕ, А БЕЗ ИМЕНИ И ДАТЫ НЕТ И САМОГО
 * ОБЪЕКТА. Прежде объект печатался всегда, хоть из одного адреса: считалось,
 * что окошко на странице стоит, значит и разметка ему положена. 13 сентября
 * 2026 Google Search Console ответил на это письмом «отсутствует поле name,
 * отсутствует поле uploadDate» и пометкой «к показу в результатах поиска
 * не допускается». Оба поля у `VideoObject` ОБЯЗАТЕЛЬНЫЕ, и огрызок без них
 * не даёт ничего, кроме ошибки в консоли: разметка без обязательных полей
 * хуже отсутствующей. Теперь такой ролик молча выпадает из разметки —
 * окошко на странице остаётся, читатель ничего не теряет.
 *
 * Случилось это с ep-154: пост вышел 10 сентября с новым роликом, а кэш
 * последний раз писался 31 августа, и про этот ролик не знал ничего.
 * ЗНАЧИТ, ДЫРА ОТКРЫВАЕТСЯ САМА — при каждом выпуске с новым роликом, пока
 * `scripts/fetch-youtube-meta.mjs` никто не позвал. Заслон на это стоит
 * в сборке: scripts/video-schema.test.mjs.
 *
 * ОПИСАНИЕ — ПОЛЕ НЕОБЯЗАТЕЛЬНОЕ, И ЕМУ РАЗРЕШЕНА ПОДМЕНА. Его у ролика
 * может не быть вовсе: у двух старых заставок в «Самых важных опенингах»
 * описание пустое на самом YouTube. Тогда берётся описание материала —
 * страница и ролик там об одном, и это не выдумка, а пересказ соседним
 * текстом. Имя и дату так подменить нельзя: дата поста и дата выхода ролика
 * — разные вещи, и Google их сверяет.
 *
 * `thumbnailUrl` не из кэша, а из правила адресов самого YouTube: кадр ролика
 * лежит по имени ролика. Сверено с тем, что отдаёт oEmbed, — адрес совпадает
 * знак в знак. Картинку эту мы никуда не грузим и на страницу не ставим.
 *
 * РАСШИФРОВКА ПРИЦЕПЛЯЕТСЯ ТОЛЬКО К ЕДИНСТВЕННОМУ РОЛИКУ СТРАНИЦЫ. У выпуска
 * подкаста расшифровка принадлежит звуку и лежит в `associatedMedia`; у
 * видеоэссе звука нет вовсе, и разговор записан ровно тем роликом, что стоит
 * на странице. А вот когда роликов два, чей это разговор — неизвестно:
 * угадать нельзя, и мы не угадываем. Замер по архиву: из 37 видеоэссе
 * с расшифровкой у 36 ролик ровно один, а у 37-го (ep-67) вставлена ссылка
 * на канал вместо ролика, и прицеплять расшифровку не к чему.
 *
 * @param {string[]} embedUrls Адреса вида https://www.youtube.com/embed/<id>
 * @param {string} pageUrl Адрес страницы — нужен `@id`, чтобы два ролика
 *   на одной странице не слились в один объект.
 * @param {{transcript?: string|null, description?: string|null}} [что]
 *   `transcript` — расшифровка, если она принадлежит ролику, а не звуку;
 *   `description` — описание материала, запасное на случай ролика без своего.
 */
export function videoObjectsSchema(embedUrls, pageUrl, { transcript = null, description = null } = {}) {
	// «Ролик на странице один» считается по ВСЕМ окошкам страницы, а не по тем,
	// что дожили до разметки. Вопрос тут не «сколько объектов вышло», а «чей
	// это разговор», и выпавший из разметки ролик на него влияет так же.
	const один = embedUrls.length === 1;

	return embedUrls.flatMap((embedUrl) => {
		const id = embedUrl.split('/').pop();
		const про = youtubeMeta[id] ?? {};

		// ТРИ ОБЯЗАТЕЛЬНЫХ ПОЛЯ ИЛИ НИЧЕГО. `thumbnailUrl` строится из имени
		// ролика, поэтому спрашиваем само имя: пустое — и адрес кадра вышел бы
		// указывающим в никуда.
		if (!про.name || !про.uploadDate || !id) return [];

		const описание = про.description || description || null;

		return [
			{
				'@context': 'https://schema.org',
				'@type': 'VideoObject',
				'@id': `${pageUrl}#video-${id}`,
				name: про.name,
				...(описание ? { description: описание } : {}),
				uploadDate: про.uploadDate,
				embedUrl,
				thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
				...(transcript && один ? { transcript } : {}),
			},
		];
	});
}

/**
 * Обычный пост: заметка, статья, видеоэссе.
 *
 * АВТОР — ЧЕЛОВЕК, ИЗДАТЕЛЬ — ОРГАНИЗАЦИЯ (TASK-markup, 3.1). Раньше обоими
 * был сайт, и получалось «текст написал сайт». Кто именно человек и откуда
 * про него известно — см. src/lib/author.mjs; сюда он приезжает готовым,
 * потому что данные о нём живут в коллекции, а этот файл коллекций не читает.
 *
 * НЕ ПРИЕХАЛ — ОСТАЁТСЯ ОРГАНИЗАЦИЯ. Беднее, но не ложь.
 */
export function articleSchema({ url, title, description, image, date, modified, author }) {
	return {
		'@context': 'https://schema.org',
		'@type': 'Article',
		'@id': url,
		mainEntityOfPage: url,
		headline: title,
		description,
		datePublished: date.toISOString(),
		...(modified ? { dateModified: modified } : {}),
		...(image ? { image } : {}),
		author: author ?? publisher(),
		publisher: publisher(),
	};
}

/**
 * Тип тайтла на языке Schema.org.
 *
 * ПОЛЕ `kind` ЗАВЕДЕНО 31 АВГУСТА 2026 по решению заказчика: Shikimori отдаёт
 * его в том же ответе `GET /api/animes/<id>`, который проект и так
 * запрашивает за франшизой, — и один прогон scripts/anime-kind.mjs
 * проставил его всем 659 карточкам.
 *
 * ЧТО В АРХИВЕ (замер 31.08.2026): tv 537, movie 82, ona 25, ova 11,
 * tv_special 3, music 1.
 *
 * ПЕРЕВОДЯТСЯ ТОЛЬКО ДВА ЗНАЧЕНИЯ ИЗ ШЕСТИ, И ЭТО НЕ ЛЕНЬ. `Movie`
 * и `TVSeries` — утверждения о форме произведения, и ошибиться в них хуже,
 * чем промолчать:
 *
 *   OVA и ONA — «вышло сразу на видео» и «вышло сразу в сеть». Это способ
 *     ВЫХОДА, а не форма: под обоими словами живут и односерийные фильмы,
 *     и полноценные сериалы;
 *   tv_special — разовая передача. У нас их три, и одна из них «Здесь слышен
 *     океан» (Ghibli, 1993) — полнометражный фильм, снятый для телевидения.
 *     Назови мы её сериалом — это была бы прямая неправда;
 *   music — клип. Ни то, ни другое.
 *
 * Всё это остаётся `CreativeWork` — «произведение», без уточнения. Честно
 * и валидно, просто менее выразительно.
 */
export function animeSchemaType(kind) {
	if (kind === 'movie') return 'Movie';
	if (kind === 'tv') return 'TVSeries';
	return 'CreativeWork';
}

/**
 * Сам тайтл: что за произведение показывает эта страница
 * (TASK-markup, пункт 2.1).
 *
 * Раньше страница «Унесённых призраками» не сообщала поисковику ни одним
 * словом, что она про фильм: на ней стояли только хлебные крошки.
 *
 * `sameAs` — ссылка на ту же вещь в чужом справочнике (Shikimori или AniList).
 * Ровно для этого поле у Schema.org и заведено: «это то же самое, что вон там».
 * По нему поисковик связывает нашу страницу с известной ему сущностью.
 */
export function animeSchema({ url, name, alternateName, year, image, sameAs, modified, kind }) {
	return {
		'@context': 'https://schema.org',
		'@type': animeSchemaType(kind),
		'@id': `${url}#anime`,
		url,
		name,
		// Оригинальное название — только если оно и правда другое. У тайтла
		// без русского названия заголовком идёт оригинал, и `alternateName`,
		// повторяющий `name`, был бы пустым утверждением.
		...(alternateName && alternateName !== name ? { alternateName } : {}),
		// Год — это год, а не дата: `datePublished` принимает и такую точность
		// (ISO 8601 разрешает запись из одних лет). Выдумывать день ради
		// полноты поля нельзя.
		...(year ? { datePublished: String(year) } : {}),
		...(image ? { image } : {}),
		...(modified ? { dateModified: modified } : {}),
		...(sameAs ? { sameAs } : {}),
	};
}

/**
 * Блок «упоминания» — список материалов, где тайтл обсуждали
 * (TASK-markup, пункт 2.1).
 *
 * ЭТО И ЕСТЬ УНИКАЛЬНОЕ СОДЕРЖАНИЕ СТРАНИЦЫ. Синопсис у нас чужой, постер
 * чужой, а «в каких разговорах это звучало» нет больше нигде.
 *
 * `itemListOrder` НЕ СТАВИМ. Список отсортирован по числу упоминаний, а из трёх
 * значений Schema.org («по возрастанию», «по убыванию», «без порядка») ни одно
 * этого не описывает: порядок есть, но не по свойству, которое в списке
 * названо. Пустое поле лучше неверного.
 *
 * @param {{href: string, title: string}[]} items В том же порядке, в каком
 *   карточки стоят на странице.
 */
export function mentionsListSchema({ url, name, items }) {
	return {
		'@context': 'https://schema.org',
		'@type': 'ItemList',
		'@id': `${url}#mentions`,
		name: `Материалы «${SITE_NAME}», где обсуждали: ${name}`,
		numberOfItems: items.length,
		itemListElement: items.map((item, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			// Внешняя статья ведёт на чужой сайт — тем же адресом, что и карточка
			// на странице. Своего адреса у неё нет: страницы на сайте она не имеет.
			url: item.href,
			name: item.title,
		})),
	};
}

/**
 * Хлебные крошки: путь к странице от главной.
 *
 * @param {{name: string, path: string}[]} trail Без главной — она добавляется
 *   сама первым звеном. У последнего звена (самой страницы) `item` не ставим:
 *   так советует Google, ссылаться странице на саму себя незачем.
 */
export function breadcrumbsSchema(trail) {
	const items = [{ name: 'Главная', path: '/' }, ...trail];

	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((step, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: step.name,
			...(i < items.length - 1 ? { item: absoluteUrl(step.path) } : {}),
		})),
	};
}

/** Сайт целиком — ставится только на главную. */
export function webSiteSchema() {
	return {
		'@context': 'https://schema.org',
		'@graph': [
			{
				'@type': 'WebSite',
				'@id': `${SITE_URL}/#website`,
				url: `${SITE_URL}/`,
				name: SITE_NAME,
				description: SITE_DESCRIPTION,
				inLanguage: 'ru-RU',
			},
			{ ...podcastSeries(), '@id': `${SITE_URL}/#podcast` },
		],
	};
}
