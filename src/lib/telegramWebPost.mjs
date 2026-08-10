// ЗАПАСНОЙ ПУТЬ: страница канала t.me/s/podcastbaka → сообщения в форме
// выгрузки Telegram Desktop (задача 7.6).
//
// ЗАЧЕМ ОН НУЖЕН, ЕСЛИ ЕСТЬ БОТ. Телеграм держит невыданное боту около суток,
// а робот ходит раз в шесть часов. Запас четырёхкратный, но если робот
// не отработал двое суток подряд — посты для бота потеряны навсегда. Веб-версия
// этой памяти не имеет: она показывает последние два десятка постов канала
// всегда, кто бы их ни спрашивал.
//
// ЗАВЕДОМО ХУЖЕ БОТА, И ВОТ ЧЕМ ИМЕННО:
//
//   • разметка достаётся разбором HTML, а не приходит списком;
//   • картинки берутся в том размере, в каком их показывает страница,
//     а не в исходном;
//   • страница показывает около двадцати последних постов; глубже надо
//     листать (`?before=<номер>`).
//
// Насколько хуже — НЕ РАССУЖДЕНИЕ, А ЗАМЕР: посты, которые есть и в выгрузке,
// и на странице, разбираются обоими путями и сравниваются буква в букву
// (scripts/telegram-fetch.test.mjs).
//
// ФОРМУ ЗДЕСЬ НЕ ИЗОБРЕТАЕМ. Этот разбор отдаёт то же самое, что переходник
// от бота: сплошной текст плюс список пометок со смещениями, — а нарезкой
// на куски занимается один общий `flattenEntities`. Иначе правил стало бы
// три копии вместо одной.

import { flattenEntities, exportDate } from './telegramBotUpdate.mjs';

// ——— Мелочи HTML ———

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Заменить записи вида `&amp;`, `&#33;`, `&#x41;` на сами знаки. */
export function decodeOnce(text) {
	return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
		if (body[0] === '#') {
			const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}
		return NAMED[body.toLowerCase()] ?? whole;
	});
}

/**
 * Адрес из атрибута `href`. РАСКОДИРУЕТСЯ ДВАЖДЫ, И ЭТО НЕ ОПИСКА.
 *
 * Страница канала экранирует адрес ДВА раза: настоящий
 * `…?utm_medium=clipboard_copy&utm_source=copyLink` лежит в разметке как
 * `…&amp;amp;utm_source=…`. Раскодируй один раз — в поле поста уедет `&amp;`
 * вместо `&`, и адрес будет выглядеть правильным, а вести не туда.
 *
 * Замечено не догадкой: пост №4142 есть и в выгрузке, и на странице, и его
 * четыре адреса сверены посимвольно (`scripts/telegram-fetch.test.mjs`).
 * Именно у Patreon в метке «поделиться» стоит `copyLink` с прописной буквой —
 * тот самый случай, из-за которого в задаче 7.4 чтение ссылок разделили надвое.
 */
export const decodeHref = (text) => decodeOnce(decodeOnce(text));

/**
 * Адрес без того, что дописывает сама страница.
 *
 * СТРАНИЦА САМА ДЕЛАЕТ ССЫЛКИ ИЗ ТОГО, ЧТО ПОХОЖЕ НА ДОМЕН. В посте №3346
 * автор написал «(Signal.MD)» обычным текстом — ни бот, ни выгрузка ссылкой это
 * не считают, — а страница отдала `<a href="http://Signal.MD/">Signal.MD</a>`.
 * Прочитай это ссылкой, и в тексте поста появилось бы `[Signal.MD](http://Signal.MD/)`:
 * ссылка, которой автор не ставил, ведущая на домен, которого он не имел в виду.
 *
 * Отличается такая ссылка ровно тем, что её адрес — это видимый текст плюс
 * приписанные страницей `http://` и косая черта. Тогда кусок объявляется голым
 * адресом (`url`), а разбор выводит голый адрес как есть — то есть ровно тем
 * же текстом, что стоял в посте.
 */
const bare = (url) => String(url).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

const attr = (tagBody, name) => {
	const match = tagBody.match(new RegExp(`${name}="([^"]*)"`, 'i'));
	return match ? match[1] : null;
};

// ——— Разметка текста ———

// Тег страницы → пометка в понятиях Bot API (дальше её нарезает общий
// `flattenEntities`).
const TAG_ENTITY = {
	b: 'bold',
	strong: 'bold',
	i: 'italic',
	em: 'italic',
	u: 'underline',
	ins: 'underline',
	s: 'strikethrough',
	del: 'strikethrough',
	strike: 'strikethrough',
	code: 'code',
	pre: 'pre',
	blockquote: 'blockquote',
	'tg-spoiler': 'spoiler',
	'tg-emoji': 'custom_emoji',
};

/**
 * Текст поста в HTML → сплошная строка и пометки со смещениями.
 *
 * ГЛАВНАЯ ЛОВУШКА ЗДЕСЬ — ОБЁРТКА ВОКРУГ ЭМОДЗИ, И ОНА СРАБОТАЛА БЫ У КАЖДОГО
 * ВТОРОГО ПОСТА. Страница рисует эмодзи картинкой, а сам знак прячет внутрь
 * ЖИРНОГО тега:
 *
 *   <i class="emoji" style="background-image:url(…)"><b>🌅</b></i> <b>Обои и календари</b>
 *
 * Прочитай это в лоб — и пост начинается с жирного куска «🌅». А правило
 * заголовка ищет ровно жирное в начале первой строки: заголовком стал бы
 * ОДИН ЭМОДЗИ, из него вышел бы пустой адрес страницы, а настоящий заголовок
 * уехал бы в тело. Автор ставит эмодзи перед заголовком почти всегда, так что
 * это не редкий случай, а обычный.
 *
 * Поэтому обёртка `<i class="emoji">` прозрачна: знак внутри неё в текст
 * попадает, а всё оформление внутри — нет.
 */
export function htmlToEntities(html) {
	let text = '';
	const entities = [];
	const stack = [];
	// Глубина «прозрачных» обёрток: внутри них оформление не считается.
	let plainDepth = 0;

	const pattern = /<(\/?)([a-zA-Z0-9-]+)([^>]*?)\/?>|([^<]+)/g;
	let match;
	while ((match = pattern.exec(html)) !== null) {
		const [, closing, rawName, body = '', plain] = match;

		if (plain !== undefined) {
			text += decodeOnce(plain);
			continue;
		}

		const name = rawName.toLowerCase();
		if (name === 'br') {
			text += '\n';
			continue;
		}

		if (!closing) {
			// Обёртка эмодзи прозрачна целиком, вместе со всем, что внутри.
			const isEmojiWrap = name === 'i' && /(^|\s)emoji(\s|$)/.test(attr(body, 'class') ?? '');
			if (isEmojiWrap) {
				stack.push({ name, entity: null, transparent: true });
				plainDepth += 1;
				continue;
			}
			if (plainDepth > 0) {
				stack.push({ name, entity: null, transparent: false });
				continue;
			}

			if (name === 'a') {
				const href = decodeHref(attr(body, 'href') ?? '');
				stack.push({ name, entity: { offset: text.length, type: 'text_link', url: href }, transparent: false });
				continue;
			}
			const type = TAG_ENTITY[name];
			stack.push({ name, entity: type ? { offset: text.length, type } : null, transparent: false });
			continue;
		}

		// Закрывающий тег: снимаем со стопки до одноимённого.
		let frame = null;
		while (stack.length) {
			frame = stack.pop();
			if (frame.transparent) plainDepth -= 1;
			if (frame.name === name) break;
			frame = null;
		}
		if (!frame?.entity) continue;

		const entity = frame.entity;
		entity.length = text.length - entity.offset;
		if (entity.length <= 0) continue;

		// Ссылка, чей видимый текст — тег или упоминание, у бота приходит
		// не ссылкой: `#подкаст` это `hashtag`, `@baka` это `mention`.
		// Страница рисует всё это одинаково, тегом `<a>`, и без этой поправки
		// тег превратился бы в ссылку на поиск по каналу.
		if (entity.type === 'text_link') {
			const shown = text.slice(entity.offset, entity.offset + entity.length);
			if (shown.startsWith('#')) entity.type = 'hashtag';
			else if (shown.startsWith('@')) entity.type = 'mention';
			else if (bare(shown) === bare(entity.url)) entity.type = 'url';
			if (entity.type !== 'text_link') delete entity.url;
		}

		entities.push(entity);
	}

	return { text, entities };
}

// ——— Разбор страницы ———

const PHOTO_WRAP = /<a class="tgme_widget_message_photo_wrap[^"]*"[^>]*?>/g;

/**
 * Страница канала → посты в той же форме, что отдаёт склейка альбомов
 * (`{ id, members, caption }`).
 *
 * АЛЬБОМ ЗДЕСЬ УЖЕ СОБРАН САМОЙ СТРАНИЦЕЙ, и это её единственное преимущество
 * перед выгрузкой: угадывать границы пачки не приходится. Номер КАЖДОГО снимка
 * страница тоже называет — он стоит в ссылке `t.me/канал/4145?single`, — а
 * значит имена файлов считаются тем же правилом, что и всегда (`photoFileName`),
 * и картинка, привезённая запасным путём, не задвоится с привезённой основным.
 */
export function parseChannelPage(html, { channel }) {
	const posts = [];
	const blockStart = new RegExp(`<div class="tgme_widget_message[^"]*"[^>]*data-post="${channel}/(\\d+)"`, 'g');

	const found = [...html.matchAll(blockStart)];
	for (let i = 0; i < found.length; i += 1) {
		const id = Number(found[i][1]);
		const block = html.slice(found[i].index, i + 1 < found.length ? found[i + 1].index : html.length);

		const when = block.match(/<time[^>]*datetime="([^"]+)"/);
		if (!when) continue;
		const unix = Math.floor(Date.parse(when[1]) / 1000);

		// Текст: у телеграма внутри него не бывает <div>, поэтому первый
		// закрывающий и есть конец.
		//
		// ИЩЕМ `js-message_text`, А НЕ ПРОСТО `…_message_text`, И ЭТО НЕ ПРИДИРКА.
		// У поста, написанного ОТВЕТОМ на другой пост, страница показывает сверху
		// кусок того, другого, — и обёрнут он в тот же класс
		// `tgme_widget_message_text`, только с пометкой `js-message_reply_text`.
		// Первый попавшийся блок текста в таком посте — ЧУЖОЙ. Замер по 79 постам,
		// которые есть и в выгрузке, и на странице: таких постов два (№4054
		// «Отмена эфира» и №4068 «Любуемся!»), и оба приехали бы с чужим текстом,
		// чужим заголовком и чужим адресом страницы. На пяти постах первого экрана
		// не было видно ни одного — потому и меряли на восьми экранах.
		const textStart = block.match(/<div class="[^"]*\bjs-message_text\b[^"]*"[^>]*>/);
		let text = '';
		let entities = [];
		if (textStart) {
			const from = textStart.index + textStart[0].length;
			const to = block.indexOf('</div>', from);
			({ text, entities } = htmlToEntities(block.slice(from, to === -1 ? undefined : to)));
		}

		// Снимки: номер берётся из ссылки, сам файл — из фона.
		const photos = [];
		for (const wrap of block.match(PHOTO_WRAP) ?? []) {
			const href = attr(wrap, 'href') ?? '';
			const url = wrap.match(/background-image:url\('([^']+)'\)/);
			const num = href.match(new RegExp(`${channel}/(\\d+)`));
			if (!url || !num) continue;
			photos.push({ id: Number(num[1]), url: decodeHref(url[1]) });
		}

		const base = {
			type: block.includes('tgme_widget_message_service') ? 'service' : 'message',
			date: exportDate(unix),
			date_unixtime: String(unix),
		};

		const forwarded = block.match(/<a class="tgme_widget_message_forwarded_from_name"[^>]*>([\s\S]*?)<\/a>/);
		const extra = {};
		if (forwarded) extra.forwarded_from = decodeOnce(forwarded[1].replace(/<[^>]+>/g, '')).trim();
		if (/tgme_widget_message_poll\b/.test(block)) extra.poll = { question: '' };
		// Видео и кружки на странице лежат своими блоками. Такие посты импорт
		// не берёт — правило то же, что у архива, и меняться здесь не должно.
		if (/tgme_widget_message_video\b/.test(block)) extra.media_type = 'video_file';
		else if (/tgme_widget_message_roundvideo\b/.test(block)) extra.media_type = 'video_message';
		else if (/tgme_widget_message_voice\b/.test(block)) extra.media_type = 'voice_message';
		else if (/tgme_widget_message_sticker\b/.test(block)) extra.media_type = 'sticker';
		else if (/tgme_widget_message_document\b/.test(block)) extra.media_type = 'document';

		const members = photos.length
			? photos.map((photo) => ({ ...base, id: photo.id, photo: photo.url, text_entities: [], text: '' }))
			: [{ ...base, id, text_entities: [], text: '' }];

		// Подпись достаётся тому сообщению, чей номер стоит у поста, — так же,
		// как в выгрузке номер поста это номер подписи.
		const caption = members.find((m) => m.id === id) ?? members[0];
		caption.text = text;
		caption.text_entities = flattenEntities(text, entities);
		Object.assign(caption, extra);
		// Отсев смотрит вложения у ВСЕХ сообщений пачки, а на странице признак
		// один на весь пост — значит он и относится ко всей пачке.
		if (extra.media_type || extra.poll || extra.forwarded_from) for (const m of members) Object.assign(m, extra);

		posts.push({ id: caption.id, members, caption, source: 'web' });
	}

	return posts;
}
