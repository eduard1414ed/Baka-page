// Источник данных о тайтле — Shikimori. Основной (пробуем первым).
//
// Форма модуля одинаковая для всех источников (см. anilist.mjs) —
// это то, что позволяет добавлять новые источники, не трогая
// остальной scripts/fetch-anime.mjs: id, label, find(query).

const BASE = 'https://shikimori.one';
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

function toEntry(data) {
	const year = data.aired_on ? Number(data.aired_on.slice(0, 4)) : undefined;
	const studio = data.studios?.[0]?.name;
	const posterPath = data.image?.original;
	// На совсем свежих тайтлах вместо обложки — служебная заглушка "нет картинки".
	const hasRealPoster = posterPath && !posterPath.includes('missing_');

	return {
		sourceId: data.id,
		matchedName: data.russian ? `${data.name} (${data.russian})` : data.name,
		titleRu: data.russian || undefined,
		titleOriginal: data.name,
		year,
		studio,
		posterUrl: hasRealPoster ? `${BASE}${posterPath}` : undefined,
		synopsis: cleanDescription(data.description),
		url: data.url ? `${BASE}${data.url}` : undefined,
	};
}

// Возвращает найденные данные тайтла или null, если Shikimori ничего не нашёл.
export async function find(query) {
	const results = await request(`/api/animes?search=${encodeURIComponent(query)}&limit=1`);
	if (results.length === 0) return null;

	const data = await request(`/api/animes/${results[0].id}`);
	return toEntry(data);
}

// Тайтл уже опознан по id (например, выбран в живом поиске в админке) — без поиска
// по названию, значит без риска перепутать похожие тайтлы. Использует робот,
// который донабирает справочник после публикации поста (scripts/sync-anime.mjs).
export async function findById(sourceId) {
	const data = await request(`/api/animes/${sourceId}`);
	return toEntry(data);
}
