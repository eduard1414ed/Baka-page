// Площадки подкаста. Один список на весь сайт: подвал, главная и страница
// «О подкасте» берут его отсюда, поэтому забыть обновить ссылку в одном месте
// из трёх невозможно.
//
// `kind` — куда площадка относится по смыслу. На главной и в подвале выводятся
// все подряд (там просто строчка ссылок), а страница «О подкасте» делит их
// на разделы: слушать — отдельно, поддержать — отдельно. Раньше поля не было,
// и Boosty с Patreon стояли в одном ряду со Spotify.
//
//   listen  — где слушать и смотреть выпуски
//   social  — где общаемся и постим
//   support — где поддержать деньгами
// Порядок менять осторожно: в этом же порядке кнопки стоят на главной
// и в подвале.
export const platforms = [
	{ label: 'YouTube', url: 'https://www.youtube.com/@bakapodcast', kind: 'listen' },
	{ label: 'Telegram', url: 'https://t.me/podcastbaka', kind: 'social' },
	{ label: 'Apple Podcasts', url: 'https://podcasts.apple.com/podcast/id1577387113', kind: 'listen' },
	{ label: 'Яндекс Музыка', url: 'https://music.yandex.ru/album/16989745', kind: 'listen' },
	{ label: 'Spotify', url: 'https://open.spotify.com/show/23VyxCbBLw6hh8NcsWZy7N', kind: 'listen' },
	{ label: 'VK', url: 'https://vk.ru/podcast.baka', kind: 'listen' },
	{ label: 'Boosty', url: 'https://boosty.to/bakapodcast', kind: 'support' },
	{ label: 'Patreon', url: 'https://www.patreon.com/bakapodcast', kind: 'support' },
];

/** Площадки одного вида, в том же порядке, что в списке выше. */
export function platformsOfKind(kind) {
	return platforms.filter((platform) => platform.kind === kind);
}
