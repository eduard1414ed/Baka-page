// Определяем иконку кнопки по домену ссылки — руками выбирать иконку не нужно.
export function getLinkIcon(url) {
	let host;
	try {
		host = new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}

	if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
	if (host.includes('spotify.com')) return 'spotify';
	if (host.includes('apple.com')) return 'apple';
	if (host.includes('boosty.to')) return 'boosty';
	if (host === 't.me' || host.includes('telegram.')) return 'telegram';

	return null;
}
