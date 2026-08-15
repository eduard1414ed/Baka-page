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
