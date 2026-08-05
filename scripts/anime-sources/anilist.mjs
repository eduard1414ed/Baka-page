// Источник данных о тайтле — AniList. Запасной: пробуем, только если
// в Shikimori тайтл не нашёлся. Форма модуля та же, что у shikimori.mjs.
//
// У AniList не бывает русских названий — titleRu тут всегда пустой,
// его потом вписывают вручную в файл тайтла.

const ENDPOINT = 'https://graphql.anilist.co';
const USER_AGENT = 'BakaPodcastSite/1.0 (+https://github.com/eduard1414ed/Baka-page)';

export const id = 'anilist';
export const label = 'AniList';

const QUERY = `
	query ($search: String) {
		Media(search: $search, type: ANIME) {
			id
			title {
				romaji
			}
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
		}
	}
`;

function stripHtml(text) {
	if (!text) return undefined;
	return (
		text
			.replace(/<[^>]+>/g, '')
			.replace(/\n{3,}/g, '\n\n')
			.trim() || undefined
	);
}

// Возвращает найденные данные тайтла или null, если AniList ничего не нашёл.
// "Не найдено" AniList отдаёт как ошибку с HTTP 404 — это не сбой, а нормальный ответ.
export async function find(query) {
	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
		body: JSON.stringify({ query: QUERY, variables: { search: query } }),
	});

	if (!response.ok && response.status !== 404) {
		throw new Error(`AniList ответил ${response.status}`);
	}

	const json = await response.json();
	const data = json.data?.Media;
	if (!data) return null;

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
	};
}
