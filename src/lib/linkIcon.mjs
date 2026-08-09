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
	if (host.includes('music.yandex.')) return 'yandex';
	if (host.includes('mave.stream') || host.includes('mave.digital')) return 'mave';
	// ВКонтакте живёт на двух доменах сразу, и у нас используются оба:
	// площадка «VK» записана на vk.ru, VK Donat — на vk.com.
	if (host === 'vk.ru' || host === 'vk.com') return 'vk';
	if (host.includes('tiktok.com')) return 'tiktok';
	if (host.includes('patreon.com')) return 'patreon';

	// Незнакомый домен — иконки нет, и место под неё в списке всё равно
	// занимается: иначе названия встали бы рваным левым краем.
	return null;
}
