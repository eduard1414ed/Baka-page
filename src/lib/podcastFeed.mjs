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
//
// НО ОДНА МОРГНУВШАЯ СЕТЬ НЕ ИМЕЕТ ПРАВА СТОИТЬ САЙТУ ВСЕХ ПЛЕЕРОВ СРАЗУ
// (ревизия 15 августа 2026, находка 1). Фид не отвечал уже дважды, и оба раза
// это значило сборку без единого плеера и без единой длительности. Поэтому
// поход к нему идёт с повторами — тем же кодом, что и все походы в чужие
// сервисы (`scripts/retry.mjs`, одно место на проект; своя копия правила
// «что считать сбоем сети» разошлась бы с ним молча). Паузы короткие: ждёт
// не робот, а сборка, и за ней стоит человек.
//
// А ЕСЛИ НЕ ПОМОГЛО И ПЛЕЕРОВ НЕТ ВОВСЕ — сборку останавливает
// `scripts/check-players.mjs`, последним шагом `npm run build`.

import { сПовторами, сроком } from '../../scripts/retry.mjs';

export const FEED_URL = 'https://cloud.mave.digital/33503';

/** Паузы перед повторными заходами к фиду. */
export const ПАУЗЫ = [2000, 6000, 18000];

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
		.replace(/&apos;/g, "'")
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

function parseItem(block, fallbackImageUrl) {
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
		// Своя обложка у выпуска (itunes:image) — если её вдруг нет, берём
		// обложку подкаста целиком, чтобы поле не осталось пустым.
		imageUrl: attrField(block, 'itunes:image', 'href') ?? fallbackImageUrl,
		// HTML как есть (CDATA) — форматирование и ссылки сохраняются, для
		// текста поста переводится в markdown отдельно, см. htmlToMarkdown.mjs.
		descriptionHtml: textField(block, 'description'),
	};
}

let cachedItems = null;

/**
 * НЕУДАЧНЫЙ ПОХОД ЗАПОМИНАЕТСЯ ТАК ЖЕ, КАК УДАЧНЫЙ.
 *
 * Прежде запоминался только успех, и при недоступном хостинге сборка ходила
 * к фиду ЗАНОВО НА КАЖДОЙ странице выпуска — 142 медленных попытки вместо
 * одной (ревизия задачи 15, находка 15).
 *
 * ЦЕНА ЭТОГО ВЫРОСЛА 15 АВГУСТА, а не осталась прежней. Сначала походу
 * добавили три повтора с паузами 2, 6 и 18 секунд, потом — срок в 30 секунд
 * на попытку. Считаем худшее: (30 + 30 + 30 + 30) + (2 + 6 + 18) ≈ 146 секунд
 * на одну страницу, и это при 142 страницах выпусков — шесть часов сборки
 * вместо двух с половиной минут. То есть каждая починка по отдельности была
 * правильной, а вместе они превратили «медленно» в «никогда».
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФЛАГ, А НЕ `cachedItems = []`. Пустой список — законный
 * ответ: у подкаста может не быть ни одного выпуска. Приравняв одно к другому,
 * мы потеряли бы возможность сказать в отчёте, что случилось; а сказать надо,
 * потому что заслон `scripts/check-players.mjs` роняет сборку именно на этом.
 */
let походНеУдался = false;

// Фид тянется по сети один раз за сборку (или за запуск робота) и кэшируется
// в памяти процесса — на странице выпуска не нужно перекачивать все 140+
// эпизодов ради одного нужного.
export async function fetchFeedItems() {
	if (cachedItems) return cachedItems;
	if (походНеУдался) return [];

	try {
		const xml = await сПовторами(
			async () => {
				const response = await fetch(FEED_URL, сроком());
				// Отказ хостинга — тоже повод зайти ещё раз: 502 и 503 у него
				// живут секунды, а стоят нам всех плееров сайта.
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return await response.text();
			},
			{ паузы: ПАУЗЫ, назвать: 'RSS подкаста', сказать: (text) => console.warn(`[podcastFeed]${text}`) },
		);

		const channelImage = attrField(xml, 'itunes:image', 'href') ?? textField(xml, 'url');

		const items = [];
		for (const match of xml.matchAll(ITEM_RE)) {
			const item = parseItem(match[1], channelImage);
			if (item) items.push(item);
		}
		cachedItems = items;
		return items;
	} catch (error) {
		// Говорим ОДИН раз и запоминаем отказ: иначе это предупреждение
		// напечаталось бы 142 раза, а каждое из них стоило бы двух минут.
		походНеУдался = true;
		console.warn(`[podcastFeed] Не удалось получить или разобрать RSS: ${error.message}`);
		console.warn('[podcastFeed] Больше в этой сборке к фиду не хожу. Со страниц выпусков пропадут плееры,');
		console.warn('[podcastFeed] и на этом сборку остановит scripts/check-players.mjs — на сайте останется прежняя версия.');
		return [];
	}
}

/**
 * Забыть, что фид не ответил. Нужно ровно проверкам: в одном процессе они
 * гоняют несколько случаев подряд, и отказ первого не должен решать за второй.
 */
export function забытьОтказФида() {
	походНеУдался = false;
	cachedItems = null;
}

export async function findEpisodeByGuid(guid) {
	if (!guid) return null;
	const items = await fetchFeedItems();
	return items.find((item) => item.guid === guid) ?? null;
}
