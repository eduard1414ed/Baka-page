// ВНЕШНИЙ ПОИСК СТРАНИЦЫ «МОИ ДЕВЯТЬ АНИМЕ» — Шикимори, потом AniList
// (задача 22, тз-22 «Поиск»).
//
// ЗАПРОСЫ ИДУТ ИЗ БРАУЗЕРА ЧИТАТЕЛЯ, НЕ ЧЕРЕЗ НАС: сервера у сайта нет,
// и пределы частоты каждый тратит свои. Оба сервиса это разрешают — проверено
// заголовками ответа 3 октября 2026 (`access-control-allow-origin: *`
// у обоих API).
//
// ПРЕДЕЛЫ (по документации, 3 октября 2026): Шикимори — 5 запросов в секунду
// и 90 в минуту; AniList — 90 в минуту, сейчас временно 30 (API в урезанном
// режиме), плюс защита от очередей. Считаются по адресу читателя. Страница
// ходит сюда только когда в своём каталоге не нашлось НИЧЕГО, только после
// паузы в наборе и только за тем, чего ещё не спрашивала в этой вкладке.
//
// ШИКИМОРИ ПЕРЕЕХАЛ НА `shikimori.io`. Со старого адреса стоит переадресация,
// а у переадресации нет разрешения для чужого сайта — браузерный запрос на ней
// падает. Поэтому только новый адрес.
//
// ЧУЖОЙ ОТВЕТ НЕ ДОВЕРЯЕТСЯ НА СЛОВО. Не ответил за 6 секунд, ответил ошибкой,
// не тем видом — это «не вышло» (`ok: false`), и страница идёт к следующей
// ступени. Пустой честный ответ — `ok: true` с пустым списком: это РАЗНЫЕ
// исходы, и человеку о них говорится разное («ничего не нашлось» против
// «внешние каталоги не отвечают»).
//
// ВЗРОСЛОЕ ОТСЕКАЕТСЯ НА СТОРОНЕ СЕРВИСА: `censored: true` у Шикимори,
// `isAdult: false` у AniList. Сайт открыт всем, и подсказка поиска не должна
// предлагать то, чего на нём не было бы.

const TIMEOUT = 6000;
const LIMIT = 8;
const SHIKI = 'https://shikimori.io';
const SHIKI_API = `${SHIKI}/api/graphql`;
const ANILIST_API = 'https://graphql.anilist.co';

const SHIKI_FIELDS = 'id russian name airedOn { year } url studios { name } poster { previewUrl mainUrl }';
const ANILIST_FIELDS =
	'id title { romaji english } startDate { year } siteUrl coverImage { medium large } studios(isMain: true) { nodes { name } }';

async function post(url, query, variables) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT);
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query, variables }),
			signal: controller.signal,
		});
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

const text = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const year = (value) => (Number.isInteger(value) && value > 1900 ? value : undefined);
const https = (value) => (typeof value === 'string' && value.startsWith('https://') ? value : undefined);

/** Ответ Шикимори → марки; `null`, если это не ответ. */
export function parseShikimori(json) {
	const list = json?.data?.animes;
	if (!Array.isArray(list)) return null;
	return list
		.map((a) => ({
			src: 'shiki',
			id: String(a?.id ?? ''),
			title: text(a?.russian) || text(a?.name),
			year: year(a?.airedOn?.year),
			studio: text(a?.studios?.[0]?.name) || undefined,
			poster: https(a?.poster?.mainUrl),
			thumb: https(a?.poster?.previewUrl),
			href: https(a?.url),
		}))
		.filter((a) => /^\d+$/.test(a.id) && a.title);
}

/** Ответ AniList → марки; `null`, если это не ответ. Русских названий там нет. */
export function parseAniList(json) {
	const list = json?.data?.Page?.media;
	if (!Array.isArray(list)) return null;
	return list
		.map((a) => ({
			src: 'anilist',
			id: String(a?.id ?? ''),
			title: text(a?.title?.english) || text(a?.title?.romaji),
			year: year(a?.startDate?.year),
			studio: text(a?.studios?.nodes?.[0]?.name) || undefined,
			poster: https(a?.coverImage?.large),
			thumb: https(a?.coverImage?.medium),
			href: https(a?.siteUrl),
		}))
		.filter((a) => /^\d+$/.test(a.id) && a.title);
}

/** @returns {Promise<{ ok: boolean, items: object[] }>} */
export async function searchShikimori(query) {
	const json = await post(SHIKI_API, `query($q: String) { animes(search: $q, limit: ${LIMIT}, censored: true) { ${SHIKI_FIELDS} } }`, {
		q: query,
	});
	const items = parseShikimori(json);
	return items ? { ok: true, items } : { ok: false, items: [] };
}

/** @returns {Promise<{ ok: boolean, items: object[] }>} */
export async function searchAniList(query) {
	const json = await post(
		ANILIST_API,
		`query($q: String) { Page(perPage: ${LIMIT}) { media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ${ANILIST_FIELDS} } } }`,
		{ q: query },
	);
	const items = parseAniList(json);
	return items ? { ok: true, items } : { ok: false, items: [] };
}

/**
 * Постеры и адреса для марок, пришедших ССЫЛКОЙ: в адресе едут только номер,
 * год и название. Один запрос на сервис, сколько бы марок ни было.
 * Не вышло — марки остаются без постера, девятка всё равно видна.
 *
 * @returns {Promise<Map<string, object>>} ключ — `${src}:${id}`
 */
export async function lookupByIds(items) {
	const found = new Map();
	const shiki = items.filter((i) => i.src === 'shiki').map((i) => i.id);
	const anilist = items.filter((i) => i.src === 'anilist').map((i) => Number(i.id));
	const [a, b] = await Promise.all([
		shiki.length
			? post(SHIKI_API, `query($ids: String) { animes(ids: $ids, limit: ${shiki.length}) { ${SHIKI_FIELDS} } }`, { ids: shiki.join(',') })
			: null,
		anilist.length
			? post(ANILIST_API, `query($ids: [Int]) { Page(perPage: ${anilist.length}) { media(id_in: $ids, type: ANIME) { ${ANILIST_FIELDS} } } }`, {
					ids: anilist,
				})
			: null,
	]);
	for (const item of [...(parseShikimori(a) ?? []), ...(parseAniList(b) ?? [])]) found.set(`${item.src}:${item.id}`, item);
	return found;
}
