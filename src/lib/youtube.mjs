const ID_PATTERN = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/;

export function getYoutubeVideoId(url) {
	const match = url?.match(ID_PATTERN);
	return match ? match[1] : null;
}

export function getYoutubeEmbedUrl(url) {
	const id = getYoutubeVideoId(url);
	return id ? `https://www.youtube.com/embed/${id}` : null;
}

// КАДРА С ЮТЮБА ПО ССЫЛКЕ ЗДЕСЬ БОЛЬШЕ НЕТ. `getYoutubeThumbnailUrl` брала
// картинку карточки прямо с `img.youtube.com`, и звала её одна ступень
// в `postCardMedia.mjs` — та, что читала снятое поле «Ссылка на ролик»
// (решение заказчика 15 августа 2026). У видеоэссе архива кадр лежит
// настоящим файлом в поле «Обложка»: так его положила задача 19, и это
// не только замена — превью ссылки в телеграме чужой домен не разворачивает
// вовсе (правило проекта «картинку превью отдавать со своего домена»).

// Все ролики YouTube, вставленные в текст материала, — по порядку и без
// повторов (TASK-markup, пункт 1.2).
//
// ЧИТАЕМ ТЕКСТ, А НЕ РАЗОБРАННОЕ ДЕРЕВО, и это вторая копия правила «как
// выглядит вставка ролика»: первая живёт в src/plugins/remark-video.mjs
// и работает уже на разобранной разметке, куда странице хода нет — она видит
// только исходный markdown. Правило при этом одно и то же: блок `::video`,
// атрибут `youtube`, и он же побеждает, если рядом заполнен `video`.
//
// ЧТОБЫ КОПИИ НЕ РАЗЪЕХАЛИСЬ МОЛЧА, их сверяет проверка
// scripts/video-schema.test.mjs: она считает ролики в собранных страницах
// и требует, чтобы у каждого нашёлся свой объект разметки. Пометки
// «меняете тут — поправьте и там» тут мало: в этом проекте она не удержала
// ни одной копии.
const VIDEO_DIRECTIVE_RE = /^\s*::video\{([^}\n]*)\}/gm;
const YOUTUBE_ATTR_RE = /\byoutube="([^"]*)"/;

export function youtubeEmbedsInBody(body) {
	const found = [];

	for (const [, attrs] of String(body ?? '').matchAll(VIDEO_DIRECTIVE_RE)) {
		const raw = attrs.match(YOUTUBE_ATTR_RE)?.[1];
		if (!raw) continue;
		const embed = getYoutubeEmbedUrl(raw);
		// Повтор одного ролика в тексте бывает (ссылка и разбор ниже) —
		// объект разметки у него всё равно один: `@id` строится из имени
		// ролика, и два одинаковых имени поисковик склеил бы сам.
		if (embed && !found.includes(embed)) found.push(embed);
	}

	return found;
}
