// Сборка объектов Schema.org (тз/06, шаг 10). Выводит их <JsonLd> —
// см. src/components/JsonLd.astro.
//
// Зачем это нужно словами: поисковик читает страницу как текст и сам угадывает,
// что на ней. Разметка говорит прямо — «это выпуск подкаста, вот его
// длительность, вот аудиофайл, вот дата». От этого зависит, покажет ли Google
// выпуск в блоке подкастов и появятся ли крошки «Бака! › Подкаст › Название»
// вместо голого адреса под ссылкой в выдаче.

import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, absoluteUrl } from './site.mjs';

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
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. `name`, `description` и `uploadDate` в источнике
 * не существуют: ролик стоит в тексте блоком `::video{youtube="…"}`, и всё,
 * что о нём известно, — это его адрес. Заголовок поста роликом не является:
 * в одном выпуске их бывает несколько, и назвать каждый именем выпуска
 * значило бы соврать про все, кроме первого. Пустое поле лучше выдуманного —
 * см. «Чего не делать» в задании.
 *
 * `thumbnailUrl` при этом не выдумка, а правило адресов самого YouTube:
 * кадр ролика лежит по имени ролика. Картинку эту мы никуда не грузим
 * и на страницу не ставим — она только называется в разметке.
 *
 * @param {string[]} embedUrls Адреса вида https://www.youtube.com/embed/<id>
 * @param {string} pageUrl Адрес страницы — нужен `@id`, чтобы два ролика
 *   на одной странице не слились в один объект.
 */
export function videoObjectsSchema(embedUrls, pageUrl) {
	return embedUrls.map((embedUrl) => {
		const id = embedUrl.split('/').pop();
		return {
			'@context': 'https://schema.org',
			'@type': 'VideoObject',
			'@id': `${pageUrl}#video-${id}`,
			embedUrl,
			thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
		};
	});
}

/** Обычный пост: заметка, статья, видеоэссе. */
export function articleSchema({ url, title, description, image, date, modified }) {
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
		author: publisher(),
		publisher: publisher(),
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
