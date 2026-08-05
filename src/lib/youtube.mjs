const ID_PATTERN = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/;

export function getYoutubeVideoId(url) {
	const match = url?.match(ID_PATTERN);
	return match ? match[1] : null;
}

export function getYoutubeEmbedUrl(url) {
	const id = getYoutubeVideoId(url);
	return id ? `https://www.youtube.com/embed/${id}` : null;
}

export function getYoutubeThumbnailUrl(url) {
	const id = getYoutubeVideoId(url);
	return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
}
