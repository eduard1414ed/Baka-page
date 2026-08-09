// Площадки подкаста. Один список на весь сайт: подвал, страница «О подкасте»,
// страница «Поддержать» и плашка подписки у бонусов берут его отсюда, поэтому
// забыть обновить ссылку в одном месте из четырёх невозможно.
//
// `kind` — куда площадка относится по смыслу. В подвале выводятся все подряд
// (там просто строчка ссылок), а «О подкасте» и «Поддержать» делят их
// на разделы: слушать — отдельно, поддержать — отдельно. Раньше поля не было,
// и Boosty с Patreon стояли в одном ряду со Spotify.
//
//   listen  — где слушать и смотреть выпуски
//   social  — где общаемся и постим
//   support — где поддержать деньгами
// Порядок менять осторожно: в этом же порядке кнопки стоят в подвале,
// в хиро страницы «Поддержать» и в плашке подписки у бонусов.
//
// ОДНА ЗАПИСЬ — ЧЕТЫРЕ МЕСТА СРАЗУ. Добавили строчку ради страницы
// «Поддержать» — она в тот же день появилась в подвале каждой страницы
// и на кнопках бонусного выпуска. Это не побочный эффект, а смысл файла,
// но помнить об этом надо до правки, а не после.
//
// `inFooter: false` — «площадка настоящая, но в подвале не нужна». Поле
// заведено ради VK Donat: он ведёт на ту же страницу ВКонтакте, что и площадка
// «VK» строкой выше, и в общей строчке подвала это выглядело двумя ссылками
// в одно место. На странице «Поддержать» и на кнопках бонуса он при этом
// нужен: там он не дубль, а способ заплатить.
//
// ПРЯТАТЬ УДАЛЕНИЕМ ЗАПИСИ НЕЛЬЗЯ — она нужна трём другим местам. Признак
// стоит на самой площадке, а не списком имён внутри подвала: список чужих
// имён в чужом файле пришлось бы дописывать при каждой новой площадке.
export const platforms = [
	{ label: 'YouTube', url: 'https://www.youtube.com/@bakapodcast', kind: 'listen' },
	{ label: 'Telegram', url: 'https://t.me/podcastbaka', kind: 'social' },
	{ label: 'Apple Podcasts', url: 'https://podcasts.apple.com/podcast/id1577387113', kind: 'listen' },
	{ label: 'Яндекс Музыка', url: 'https://music.yandex.ru/album/16989745', kind: 'listen' },
	{ label: 'Spotify', url: 'https://open.spotify.com/show/23VyxCbBLw6hh8NcsWZy7N', kind: 'listen' },
	{ label: 'VK', url: 'https://vk.ru/podcast.baka', kind: 'listen' },
	{ label: 'Boosty', url: 'https://boosty.to/bakapodcast', kind: 'support' },
	{ label: 'Patreon', url: 'https://www.patreon.com/bakapodcast', kind: 'support' },
	{ label: 'Закрытый TG-канал', url: 'https://t.me/tribute/app?startapp=s26z', kind: 'support' },
	{ label: 'VK Donat', url: 'https://vk.com/podcast.baka', kind: 'support', inFooter: false },
];

/** Площадки одного вида, в том же порядке, что в списке выше. */
export function platformsOfKind(kind) {
	return platforms.filter((platform) => platform.kind === kind);
}

/** Что показывает подвал: всё, кроме помеченного `inFooter: false`. */
export function footerPlatforms() {
	return platforms.filter((platform) => platform.inFooter !== false);
}
