/**
 * Домен ссылки без «www.», или null, если это вообще не адрес.
 *
 * Живёт здесь, а не в двух местах: по домену у нас решаются две разные вещи —
 * иконка кнопки (ниже) и название чужой площадки у поста-ссылки
 * (src/lib/externalPost.mjs). Сам разбор адреса при этом один на оба случая.
 */
export function hostOf(url) {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}

// Определяем иконку кнопки по домену ссылки — руками выбирать иконку не нужно.
export function getLinkIcon(url) {
	const host = hostOf(url);
	if (!host) return null;

	if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
	if (host.includes('spotify.com')) return 'spotify';
	if (host.includes('apple.com')) return 'apple';
	if (host.includes('boosty.to')) return 'boosty';
	if (host === 't.me' || host.includes('telegram.')) return 'telegram';

	return null;
}
