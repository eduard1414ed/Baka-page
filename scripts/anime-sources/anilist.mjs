// Источник данных о тайтле — AniList. Запасной: пробуем, только если
// в Shikimori тайтл не нашёлся. Форма модуля та же, что у shikimori.mjs.
//
// У AniList не бывает русских названий — titleRu тут всегда пустой,
// его потом вписывают вручную в файл тайтла.

const ENDPOINT = 'https://graphql.anilist.co';
const USER_AGENT = 'BakaPodcastSite/1.0 (+https://github.com/eduard1414ed/Baka-page)';

export const id = 'anilist';
export const label = 'AniList';

const FIELDS = `
	id
	title {
		romaji
		english
	}
	synonyms
	startDate {
		year
	}
	studios(isMain: true) {
		nodes {
			name
		}
	}
	coverImage {
		extraLarge
		large
	}
	description(asHtml: false)
	siteUrl
`;

const QUERY = `query ($search: String) { Media(search: $search, type: ANIME) { ${FIELDS} } }`;
const QUERY_BY_ID = `query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`;

function stripHtml(text) {
	if (!text) return undefined;
	return (
		text
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim() || undefined
	);
}

// Альтернативные названия — в подсказки к полю «Варианты написания»
// (см. тот же комментарий в shikimori.mjs). `native` не берём: это иероглифы,
// в русской расшифровке они не прозвучат.
function sourceAliases(data) {
	const known = new Set([data.title?.romaji].filter(Boolean));

	return [...(data.synonyms ?? []), data.title?.english]
		.map((name) => String(name ?? '').trim())
		.filter((name) => name && !known.has(name));
}

function toEntry(data) {
	return {
		sourceId: data.id,
		matchedName: data.title.romaji,
		titleRu: undefined,
		titleOriginal: data.title.romaji,
		year: data.startDate?.year,
		studio: data.studios?.nodes?.[0]?.name,
		posterUrl: data.coverImage?.extraLarge || data.coverImage?.large,
		synopsis: stripHtml(data.description),
		url: data.siteUrl,
		sourceAliases: sourceAliases(data),
	};
}

async function request(query, variables) {
	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
		body: JSON.stringify({ query, variables }),
	});

	// "Не найдено" AniList отдаёт как ошибку с HTTP 404 — это не сбой, а нормальный ответ.
	if (!response.ok && response.status !== 404) {
		throw new Error(`AniList ответил ${response.status}`);
	}

	const json = await response.json();
	return json.data?.Media ?? null;
}

// Возвращает найденные данные тайтла или null, если AniList ничего не нашёл.
export async function find(query) {
	const data = await request(QUERY, { search: query });
	return data ? toEntry(data) : null;
}

// Тайтл уже опознан по id (например, выбран в живом поиске в админке) — без поиска
// по названию. Использует робот, который донабирает справочник после публикации
// поста (scripts/sync-anime.mjs).
export async function findById(sourceId) {
	const data = await request(QUERY_BY_ID, { id: sourceId });
	return data ? toEntry(data) : null;
}
