// Источник данных о тайтле — Shikimori. Основной (пробуем первым).
//
// Форма модуля одинаковая для всех источников (см. anilist.mjs) —
// это то, что позволяет добавлять новые источники, не трогая
// остальной scripts/fetch-anime.mjs: id, label, find(query).

// Домен переехал: shikimori.one отвечает 301 на shikimori.io. Старые ссылки
// в справочнике продолжают работать через редирект, новые пишем сразу на .io.
// ВАЖНО для запросов POST: редирект превращает их в GET и теряет тело — именно
// поэтому GraphQL ниже ходит на .io напрямую, а не через .one.
const BASE = 'https://shikimori.io';
const USER_AGENT = 'BakaPodcastSite/1.0 (+https://github.com/eduard1414ed/Baka-page)';

export const id = 'shikimori';
export const label = 'Shikimori';

// Shikimori вставляет в описание разметку вида [character=384]Имя[/character] —
// на сайте она не нужна, оставляем только текст внутри тегов.
function cleanDescription(description) {
	if (!description) return undefined;
	return description.replace(/\[\/?\w+(?:=\d+)?\]/g, '').trim() || undefined;
}

async function request(path) {
	const response = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': USER_AGENT } });
	if (!response.ok) {
		throw new Error(`Shikimori ответил ${response.status}`);
	}
	return response.json();
}

// Альтернативные названия из раздела Shikimori «Альтернативные названия».
// Идут в подсказки к полю «Варианты написания» в админке — не в само поле:
// плохой вариант даёт ложные упоминания сразу по всему архиву и молча,
// поэтому добавляет их человек кнопкой (тз/05, шаг 6).
//
// Поле `japanese` не берём вовсе: иероглифы в русской расшифровке не прозвучат
// никогда. `english` берём — ведущие иногда называют тайтл по-английски.
// Полезнее всего `synonyms`: там попадаются русские варианты перевода,
// например «Клуб лёгкой музыки» у «Кэйон!».
function sourceAliases(data) {
	const known = new Set([data.name, data.russian].filter(Boolean));

	return [...(data.synonyms ?? []), ...(data.english ?? [])]
		.map((name) => String(name).trim())
		.filter((name) => name && !known.has(name));
}

/**
 * Настоящий постер из НОВОГО API (GraphQL).
 *
 * ЗАЧЕМ ЭТО НУЖНО. У Shikimori два API, и они расходятся: старый (REST)
 * у части свежих тайтлов до сих пор отдаёт служебную заглушку
 * `missing_original.jpg`, хотя на самом сайте обложка давно стоит и новый
 * API её отдаёт. Так в справочник попали два тайтла 2026 года без обложек:
 * код отработал правильно, врал источник.
 *
 * Спрашиваем только тогда, когда REST сказал «картинки нет»: лишний запрос
 * на каждый тайтл ни к чему, а частоту запросов Shikimori ограничивает.
 *
 * Молчим и возвращаем undefined на любой сбой: обложка — не тот повод,
 * чтобы уронить добор тайтла целиком.
 */
async function posterFromGraphql(animeId) {
	try {
		const response = await fetch(`${BASE}/api/graphql`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
			body: JSON.stringify({
				query: `{ animes(ids: "${animeId}", limit: 1) { poster { originalUrl } } }`,
			}),
		});
		if (!response.ok) return undefined;
		const body = await response.json();
		return body?.data?.animes?.[0]?.poster?.originalUrl ?? undefined;
	} catch {
		return undefined;
	}
}

async function toEntry(data) {
	const year = data.aired_on ? Number(data.aired_on.slice(0, 4)) : undefined;
	const studio = data.studios?.[0]?.name;
	const posterPath = data.image?.original;
	// Служебная заглушка «нет картинки» вместо обложки. Раньше это значило,
	// что обложки нет вовсе; теперь это чаще значит, что старый API её просто
	// не знает, — спрашиваем новый.
	const hasRealPoster = posterPath && !posterPath.includes('missing_');
	const posterUrl = hasRealPoster ? `${BASE}${posterPath}` : await posterFromGraphql(data.id);

	return {
		sourceId: data.id,
		matchedName: data.russian ? `${data.name} (${data.russian})` : data.name,
		titleRu: data.russian || undefined,
		titleOriginal: data.name,
		year,
		studio,
		posterUrl,
		synopsis: cleanDescription(data.description),
		url: data.url ? `${BASE}${data.url}` : undefined,
		sourceAliases: sourceAliases(data),
	};
}

// Возвращает найденные данные тайтла или null, если Shikimori ничего не нашёл.
export async function find(query) {
	const results = await request(`/api/animes?search=${encodeURIComponent(query)}&limit=1`);
	if (results.length === 0) return null;

	const data = await request(`/api/animes/${results[0].id}`);
	return await toEntry(data);
}

// Тайтл уже опознан по id (например, выбран в живом поиске в админке) — без поиска
// по названию, значит без риска перепутать похожие тайтлы. Использует робот,
// который донабирает справочник после публикации поста (scripts/sync-anime.mjs).
export async function findById(sourceId) {
	const data = await request(`/api/animes/${sourceId}`);
	return await toEntry(data);
}
