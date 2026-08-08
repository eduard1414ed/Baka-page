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
 */
export function podcastEpisodeSchema({ url, title, description, image, date, episode }) {
	const duration = episode?.durationSec ? isoDuration(episode.durationSec) : null;

	return {
		'@context': 'https://schema.org',
		'@type': 'PodcastEpisode',
		'@id': url,
		url,
		name: title,
		description,
		datePublished: date.toISOString(),
		...(image ? { image } : {}),
		...(duration ? { timeRequired: duration } : {}),
		partOfSeries: podcastSeries(),
		...(episode?.audioUrl
			? {
					associatedMedia: {
						'@type': 'MediaObject',
						contentUrl: episode.audioUrl,
						...(duration ? { duration } : {}),
					},
				}
			: {}),
	};
}

/** Обычный пост: заметка, статья, видеоэссе. */
export function articleSchema({ url, title, description, image, date }) {
	return {
		'@context': 'https://schema.org',
		'@type': 'Article',
		'@id': url,
		mainEntityOfPage: url,
		headline: title,
		description,
		datePublished: date.toISOString(),
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
