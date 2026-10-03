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
// ВЗРОСЛОЕ ОТСЕКАЕТСЯ НА СТОРОНЕ СЕРВИСА: рейтинг `!rx` у Шикимори,
// `isAdult: false` у AniList. Сайт открыт всем, и подсказка поиска не должна
// предлагать то, чего на нём не было бы.
//
// НЕ `censored: true`: у Шикимори он прячет не рейтинг, а ЖАНРЫ — хентай,
// яой и юри целиком, включая детские по рейтингу. Замер 3 октября 2026:
// «given» не находил Given (PG-13, жанр «яой») вовсе, а вместо него отдавал
// два чужих тайтла — и до AniList дело не доходило, ответ-то непустой.
// `rating: "!rx"` отсекает ровно хентай, как `isAdult` у AniList.

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

/**
 * ПОСТЕР, КОТОРОГО ШИКИМОРИ НЕ ОТДАЁТ, — С ANILIST ПО ТОМУ ЖЕ НОМЕРУ.
 *
 * У тайтлов из жанров, которые Шикимори прячет от гостей (яой, юри), он
 * отдаёт сам тайтл, но `poster: null` — замер 3 октября 2026: Given (39533)
 * без постера, «Паразит» (22535) с постером. Номер тайтла у Шикимори — это
 * номер MyAnimeList, и AniList ищет по нему (`idMal_in`), как и для картинки
 * в `picturePosters`. Один запрос и только когда есть кому: у обычной
 * выдачи постеры на месте, и в AniList она не ходит вовсе. Не ответил —
 * марки остаются как были, без постера.
 */
async function borrowAniListPosters(items) {
	const bare = items.filter((i) => i.src === 'shiki' && !i.poster);
	if (!bare.length) return items;
	const json = await post(
		ANILIST_API,
		`query($mal: [Int]) { Page(perPage: ${bare.length}) { media(idMal_in: $mal, type: ANIME) { idMal coverImage { medium large } } } }`,
		{ mal: bare.map((i) => Number(i.id)) },
	);
	const byMal = new Map((json?.data?.Page?.media ?? []).map((m) => [String(m?.idMal), m]));
	return items.map((i) => {
		const m = i.src === 'shiki' && !i.poster ? byMal.get(i.id) : undefined;
		const poster = https(m?.coverImage?.large);
		return poster ? { ...i, poster, thumb: https(m.coverImage.medium) ?? poster } : i;
	});
}

/** @returns {Promise<{ ok: boolean, items: object[] }>} */
export async function searchShikimori(query) {
	const json = await post(SHIKI_API, `query($q: String) { animes(search: $q, limit: ${LIMIT}, censored: false, rating: "!rx") { ${SHIKI_FIELDS} } }`, {
		q: query,
	});
	const items = parseShikimori(json);
	return items ? { ok: true, items: await borrowAniListPosters(items) } : { ok: false, items: [] };
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
	for (const item of [...(await borrowAniListPosters(parseShikimori(a) ?? [])), ...(parseAniList(b) ?? [])]) found.set(`${item.src}:${item.id}`, item);
	return found;
}

/**
 * ПОСТЕРЫ ДЛЯ КАРТИНКИ — ТОЛЬКО ТЕ, ЧТО МОЖНО СОХРАНИТЬ (задача 22, часть 2).
 *
 * Чужая картинка на холсте запрещает его сохранять, если её сервер не дал
 * разрешения. Проверено запросами 3 октября 2026: AniList (`s4.anilist.co`)
 * отвечает `access-control-allow-origin: <наш адрес>` — и основному, и зеркалу;
 * Шикимори не отвечает ничем. Поэтому постер Шикимори в картинку не берётся
 * НИКОГДА, вместо него — постер AniList по тому же номеру: номер тайтла
 * у Шикимори — это номер MyAnimeList, а AniList ищет по нему (`idMal_in`).
 *
 * Берётся крупный размер (`extraLarge`, около 460 px): марка в картинке 9:16
 * шириной 286 px, а постер со страницы (`large`) уже — растянулся бы.
 *
 * Один запрос на всю девятку. Не вышло — пустой ответ, и марки без постера
 * рисуются заглушкой: одна неудачная не отменяет остальные.
 *
 * @returns {Promise<Map<string, string>>} ключ — `${src}:${id}`, значение — адрес
 */
export async function picturePosters(items) {
	const ids = items.filter((i) => i.src === 'anilist').map((i) => Number(i.id));
	const mal = items.filter((i) => i.src === 'shiki').map((i) => Number(i.id));
	const found = new Map();
	if (!ids.length && !mal.length) return found;
	// В запрос идёт только та половина, у которой есть номера: пустой список
	// в `id_in` AniList понимает как «без отбора», а объявленная, но не
	// использованная переменная — это ошибка всего запроса (замер: девятка
	// из одних тайтлов Шикимори получала пустой ответ).
	const vars = [];
	const parts = [];
	if (ids.length) {
		vars.push('$ids: [Int]');
		parts.push(`a: Page(perPage: ${ids.length}) { media(id_in: $ids, type: ANIME) { id coverImage { extraLarge large } } }`);
	}
	if (mal.length) {
		vars.push('$mal: [Int]');
		parts.push(`m: Page(perPage: ${mal.length}) { media(idMal_in: $mal, type: ANIME) { idMal coverImage { extraLarge large } } }`);
	}
	const json = await post(ANILIST_API, `query(${vars.join(', ')}) { ${parts.join(' ')} }`, { ids, mal });
	const url = (m) => https(m?.coverImage?.extraLarge) || https(m?.coverImage?.large);
	for (const m of json?.data?.a?.media ?? []) if (url(m)) found.set(`anilist:${m.id}`, url(m));
	for (const m of json?.data?.m?.media ?? []) if (url(m)) found.set(`shiki:${m.idMal}`, url(m));
	return found;
}
