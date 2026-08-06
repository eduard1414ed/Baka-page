// Разбор RSS подкаста — общий код для сборки сайта (плеер на странице выпуска,
// см. src/pages/posts/[slug].astro) и робота сверки (scripts/sync-episodes.mjs),
// см. тз/04-выпуски-и-плеер.md.
//
// Своего мини-парсера вместо библиотеки достаточно: нужно вытащить всего
// несколько полей из тегов известной структуры (фид отдаёт Mave, формат
// стабильный), а не разобрать произвольный XML.
//
// РСС может быть недоступен или отдать не то, что мы ждём (пункт «подводные
// камни» в ТЗ) — при любой ошибке возвращаем пустой список, а не роняем
// сборку. Пост без пары в RSS просто останется без плеера.

export const FEED_URL = 'https://cloud.mave.digital/33503';

const ITEM_RE = /<item>([\s\S]*?)<\/item>/g;

function textField(block, tag) {
	const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
	return match ? decodeXmlText(match[1]) : null;
}

function attrField(block, tag, attr) {
	const match = block.match(new RegExp(`<${tag}\\s[^>]*\\b${attr}="([^"]*)"`));
	return match ? match[1] : null;
}

function decodeXmlText(raw) {
	const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
	const text = cdata ? cdata[1] : raw;
	return text
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")
		.replace(/&amp;/g, '&')
		.trim();
}

// itunes:duration встречается и как секунды ("2054"), и как "чч:мм:сс" —
// на практике у этого фида всегда первое, но формат учитываем на всякий случай.
function parseDuration(raw) {
	if (/^\d+$/.test(raw)) return Number(raw);
	const parts = raw.split(':').map(Number);
	if (parts.some(Number.isNaN)) return null;
	return parts.reduce((acc, part) => acc * 60 + part, 0);
}

function parseItem(block) {
	const guid = textField(block, 'guid');
	const audioUrl = attrField(block, 'enclosure', 'url');
	if (!guid || !audioUrl) return null; // без этих двух полей выпуск бесполезен

	const pubDateRaw = textField(block, 'pubDate');
	const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
	const durationRaw = textField(block, 'itunes:duration');

	return {
		guid,
		title: textField(block, 'title') ?? 'Без названия',
		pubDate: pubDate && !Number.isNaN(pubDate.valueOf()) ? pubDate : null,
		audioUrl,
		durationSec: durationRaw ? parseDuration(durationRaw) : null,
		link: textField(block, 'link'),
	};
}

let cachedItems = null;

// Фид тянется по сети один раз за сборку (или за запуск робота) и кэшируется
// в памяти процесса — на странице выпуска не нужно перекачивать все 140+
// эпизодов ради одного нужного.
export async function fetchFeedItems() {
	if (cachedItems) return cachedItems;

	try {
		const response = await fetch(FEED_URL);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const xml = await response.text();

		const items = [];
		for (const match of xml.matchAll(ITEM_RE)) {
			const item = parseItem(match[1]);
			if (item) items.push(item);
		}
		cachedItems = items;
		return items;
	} catch (error) {
		console.warn(`[podcastFeed] Не удалось получить или разобрать RSS: ${error.message}`);
		return [];
	}
}

export async function findEpisodeByGuid(guid) {
	if (!guid) return null;
	const items = await fetchFeedItems();
	return items.find((item) => item.guid === guid) ?? null;
}
