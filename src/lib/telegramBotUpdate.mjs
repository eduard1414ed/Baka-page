// ПЕРЕХОДНИК: пост, присланный ботом → сообщение в форме выгрузки Telegram
// Desktop (задача 7.6).
//
// ЗАЧЕМ ОН ВООБЩЕ НУЖЕН. В тз/тз-7.6 записано, что бот присылает пост «в том же
// виде, что и выгрузка». Сведения те же, а ФОРМА другая, и разница
// принципиальная:
//
//   выгрузка:  [{type:'bold', text:'Заголовок'}, {type:'plain', text:'\n\nтекст'}]
//   бот:       text: 'Заголовок\n\nтекст',  entities: [{offset:0, length:9, type:'bold'}]
//
// То есть выгрузка отдаёт текст УЖЕ НАРЕЗАННЫМ на куски, а бот — сплошной
// строкой и отдельным списком «с такого-то знака по такой-то». Значит выбор
// был из двух: либо научить разбор второй форме — то есть завести вторую копию
// правил, которая разъедется молча (в этапе 7 этой ошибки избегали дважды), —
// либо перевести форму бота в форму выгрузки ЗДЕСЬ и не трогать разбор совсем.
// Выбрано второе: ниже нет ни одного правила о том, что такое заголовок, что
// такое анонс и куда встают картинки. Здесь только перевод формы.
//
// СМЕЩЕНИЯ У БОТА СЧИТАЮТСЯ В ЕДИНИЦАХ UTF-16, а не в буквах: эмодзи занимает
// две единицы, а составное (👩‍🌾) — целых восемь. Это ровно та мера, которой
// в JavaScript считает `String.prototype.slice`, поэтому резать надо им
// и никаким «посимвольным» обходом. Проверяется не рассуждением: круговая
// проверка гоняет через переходник ВСЕ 3590 сообщений архива, а эмодзи в них
// на каждом шагу.

/**
 * Часовой пояс, в котором записаны даты архива.
 *
 * ЭТО ЗАМЕР, А НЕ ДОГАДКА. У всех 3590 сообщений выгрузки сдвиг поля `date`
 * от `date_unixtime` равен +1 зимой и +2 летом — среднеевропейское время
 * с переходом на летнее. Расхождений «берлинский день ≠ день в выгрузке»
 * ноль из 3590.
 *
 * ПОЧЕМУ ЭТО НЕ МЕЛОЧЬ: у 42 постов архива (1,2%) берлинский день не совпадает
 * с московским. Считай мы новые посты по Москве — пост, вышедший поздно
 * вечером, получил бы день на единицу больше, чем такой же пост в архиве,
 * и увидеть это можно было бы только сравнением двух соседних постов ленты.
 * Решение заказчика 10 августа 2026: датировать как архив.
 */
export const TG_ZONE = 'Europe/Berlin';

const DATE_FORMAT = new Intl.DateTimeFormat('sv-SE', {
	timeZone: TG_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false,
});

/** Время телеграма (секунды с 1970) → строка даты в форме выгрузки. */
export const exportDate = (unixSeconds) => DATE_FORMAT.format(new Date(unixSeconds * 1000)).replace(' ', 'T');

// Как называется пометка у бота и как — в выгрузке. Слева имена из Bot API,
// справа — те, что понимает разбор (scripts/telegram-import.mjs).
//
// `expandable_blockquote` (цитата, которая раскрывается нажатием) в выгрузке
// отдельным типом не выражена: там это обычная цитата с полем `collapsed`.
// `cashtag` и `text_mention` в архиве не встречались ни разу, но перевод им
// назван явно — иначе они молча стали бы обычным текстом.
const ENTITY_TYPE = {
	bold: 'bold',
	italic: 'italic',
	underline: 'underline',
	strikethrough: 'strikethrough',
	spoiler: 'spoiler',
	code: 'code',
	pre: 'pre',
	blockquote: 'blockquote',
	expandable_blockquote: 'blockquote',
	text_link: 'text_link',
	url: 'link',
	mention: 'mention',
	text_mention: 'mention',
	hashtag: 'hashtag',
	cashtag: 'hashtag',
	bot_command: 'bot_command',
	email: 'email',
	phone_number: 'phone',
	custom_emoji: 'custom_emoji',
};

// КОГДА ДВЕ ПОМЕТКИ НАКЛАДЫВАЮТСЯ, ОДНА ОБЯЗАНА УСТУПИТЬ, И ВОТ ПОЧЕМУ.
//
// У бота пометки умеют вкладываться друг в друга: жирная ссылка — это две
// пометки на одном куске текста. В форме выгрузки у куска ровно один тип,
// выразить обе нельзя ФИЗИЧЕСКИ, и вопрос только в том, какая уступит.
//
// Порядок здесь не вкусовой, он выведен из цены потери:
//
//   цитата и блок кода — 200. Они разбираются ПОСТРОЧНО (каждая строка цитаты
//     получает «> »), и разорви их вложенным жирным — вместо одной цитаты
//     выйдут три куска: цитата, обычный абзац, снова цитата. Ломается не
//     оформление, а строение текста.
//   ссылка — 100. Уступи она — из текста пропадёт АДРЕС, то есть сведения,
//     которых больше взять неоткуда. Потерянное начертание видно глазом,
//     потерянный адрес не видно ничем.
//   моноширинный — 90. Внутри него разметка не работает по определению.
//   ЖИРНОЕ — 60, и выше остальных начертаний. Не потому, что оно красивее:
//     на нём держится ЗАГОЛОВОК. Уступи оно курсиву — пост, чей заголовок
//     набран жирным курсивом, приедет вовсе без заголовка, а адрес страницы
//     получит из даты и номера.
//   упоминания, теги, эмодзи канала, спойлер — ниже всего. Разбор выводит их
//     текст как есть, поэтому потерять такую пометку не стоит НИЧЕГО: спойлер
//     и так становится обычным текстом, а эмодзи канала — обычным эмодзи.
//
// ПОРЯДОК ЗДЕСЬ НЕ ВЫДУМАН, А СВЕРЕН С ВЫГРУЗКОЙ. Первая его редакция ставила
// курсив выше жирного и эмодзи канала выше обоих — и замер по 179 постам,
// которые есть и в выгрузке, и на странице канала, нашёл три расхождения:
// у №3708 «Маленький аниме-мир» пропал заголовок (он набран `<b><i>`), у №3600
// и №3786 разъехались начертания на эмодзи. Выгрузка в тех же местах выбирает
// жирное — значит и мы выбираем жирное.
//
// ЦЕНА НАЗВАНА ВСЛУХ: заголовок, целиком набранный ЖИРНОЙ ССЫЛКОЙ, заголовком
// не станет — кусок получит тип ссылки, а правило заголовка ищет жирное.
// Такой пост приедет без заголовка и попадёт в отчёт отдельным списком «без
// заголовка», то есть молча это не пройдёт.
const PRIORITY = {
	blockquote: 200,
	pre: 200,
	text_link: 100,
	link: 100,
	code: 90,
	bold: 60,
	strikethrough: 50,
	italic: 40,
	underline: 30,
	mention: 20,
	hashtag: 20,
	bot_command: 20,
	email: 20,
	phone: 20,
	custom_emoji: 15,
	spoiler: 10,
	plain: 0,
};

/** Поля, которые кусок несёт сверх типа и текста, — как их пишет выгрузка. */
function extraOf(entity) {
	if (entity.type === 'text_link') return { href: entity.url };
	if (entity.type === 'text_mention') return {};
	if (entity.type === 'custom_emoji') return { document_id: entity.custom_emoji_id };
	return {};
}

/**
 * Сплошной текст + список пометок бота → нарезанные куски в форме выгрузки.
 *
 * ОДНА ПОМЕТКА — ОДИН КУСОК, И СКЛЕИВАТЬ ИХ НЕЛЬЗЯ. Соблазн склеить соседние
 * куски одного типа велик и выглядит улучшением: две ссылки подряд с одним
 * адресом станут одной, `[я ](адрес)[писал](адрес)` превратится в
 * `[я писал](адрес)`. Круговая проверка по архиву поймала это на десяти
 * сообщениях: выгрузка их НЕ склеивает, и разметка, которую увидел бы разбор,
 * разошлась бы с той, по которой привезены полторы тысячи постов. Приём,
 * улучшающий вид, но меняющий вывод, — это расхождение с архивом, а не польза.
 *
 * Склейка остаётся ровно одна и по другому поводу: кусок, РАЗРЕЗАННЫЙ надвое
 * вложенной пометкой, которая проиграла по цене потери, сшивается обратно.
 * Узнаётся это по тому, что обе половины пришли из ОДНОЙ И ТОЙ ЖЕ пометки
 * бота, а не по совпадению типа.
 *
 * Пометка, которой у выгрузки соответствия нет вовсе, границ не создаёт
 * и куском не становится: её текст остаётся обычным. Иначе он стал бы куском
 * типа `plain`, и в выгрузке появились бы два `plain` подряд — чего там нет
 * ни разу (замер: 0 случаев из 15242 кусков).
 */
export function flattenEntities(text, entities = []) {
	const source = String(text ?? '');
	if (!source) return [];

	const marks = (entities ?? [])
		.filter((e) => ENTITY_TYPE[e.type])
		.map((e) => ({
			from: e.offset,
			to: e.offset + e.length,
			type: ENTITY_TYPE[e.type],
			extra: extraOf(e),
		}))
		.filter((m) => m.to > m.from);

	// Границы всех пометок — по ним и режем.
	const cuts = new Set([0, source.length]);
	for (const mark of marks) {
		cuts.add(mark.from);
		cuts.add(mark.to);
	}
	const points = [...cuts].filter((p) => p >= 0 && p <= source.length).sort((a, b) => a - b);

	const pieces = [];
	for (let i = 0; i < points.length - 1; i += 1) {
		const from = points[i];
		const to = points[i + 1];
		const covering = marks.filter((m) => m.from <= from && m.to >= to);

		// Побеждает старшая по цене потери; при равенстве — та, что короче,
		// то есть вложенная. Курсив внутри жирного — это курсив.
		let best = null;
		for (const mark of covering) {
			if (!best) best = mark;
			else if ((PRIORITY[mark.type] ?? 0) > (PRIORITY[best.type] ?? 0)) best = mark;
			else if ((PRIORITY[mark.type] ?? 0) === (PRIORITY[best.type] ?? 0) && mark.to - mark.from < best.to - best.from) best = mark;
		}

		pieces.push({ mark: best, piece: { type: best?.type ?? 'plain', text: source.slice(from, to), ...(best?.extra ?? {}) } });
	}

	// Сшиваем обратно только то, что разрезала вложенная пометка: половины
	// одной и той же пометки бота. Совпадения типа для этого мало (см. выше).
	const out = [];
	let lastMark = null;
	for (const { mark, piece } of pieces) {
		if (mark && mark === lastMark) {
			out.at(-1).text += piece.text;
			continue;
		}
		out.push(piece);
		lastMark = mark;
	}
	return out;
}

// Вложение у бота и как оно называется в выгрузке. Имена справа взяты
// из самой выгрузки (замер архива: animation 41, video_file 167,
// video_message 16, sticker 2, audio_file 1), а не из документации.
//
// `document` в архиве не встретился ни разу, и всё же назван: без строчки
// здесь пост с приложенным файлом приехал бы обычной заметкой, потеряв файл
// молча. С ней — попадёт в отсев строкой с причиной, как видео и гифки.
const BOT_MEDIA = [
	['animation', 'animation'],
	['video', 'video_file'],
	['video_note', 'video_message'],
	['voice', 'voice_message'],
	['audio', 'audio_file'],
	['sticker', 'sticker'],
	['document', 'document'],
];

// Служебные сообщения канала: закрепление, смена названия, смена картинки.
// В выгрузке у них `type: 'service'`, и разбор их отсеивает по этому полю.
const SERVICE_KEYS = [
	'pinned_message',
	'new_chat_title',
	'new_chat_photo',
	'delete_chat_photo',
	'channel_chat_created',
	'message_auto_delete_timer_changed',
	'video_chat_started',
	'video_chat_ended',
	'giveaway_created',
	'giveaway_completed',
];

/** Самый большой из размеров, которые телеграм предлагает для фотографии. */
const biggestPhoto = (sizes) => [...sizes].sort((a, b) => (a.file_size ?? a.width) - (b.file_size ?? b.width)).at(-1);

/**
 * Пост от бота → сообщение в форме выгрузки.
 *
 * Поле `photo` здесь — НЕ путь к файлу, а опознаватель файла в телеграме
 * (`file_id`). Разбору всё равно: он смотрит только, есть ли поле вообще
 * (`hasMedia`) и в каком порядке идут снимки (`photosOf`). А скачиванием
 * занимается робот, и ему нужен именно опознаватель.
 */
export function botMessageToExport(message) {
	const text = message.text ?? message.caption ?? '';
	const entities = message.entities ?? message.caption_entities ?? [];

	const out = {
		id: message.message_id,
		type: SERVICE_KEYS.some((key) => key in message) ? 'service' : 'message',
		date: exportDate(message.date),
		date_unixtime: String(message.date),
		text,
		text_entities: flattenEntities(text, entities),
	};

	// Признак альбома телеграм присылает САМ — угадывать по времени и номеру,
	// как приходится на выгрузке, здесь не нужно вовсе (см. groupByMediaGroup
	// в scripts/telegram-fetch.mjs).
	if (message.media_group_id) out.media_group_id = String(message.media_group_id);

	const origin = message.forward_origin ?? null;
	if (origin) {
		out.forwarded_from =
			origin.chat?.title ??
			origin.sender_chat?.title ??
			origin.sender_user_name ??
			[origin.sender_user?.first_name, origin.sender_user?.last_name].filter(Boolean).join(' ') ??
			'неизвестный источник';
	}
	if (message.poll) out.poll = { question: message.poll.question };

	const media = BOT_MEDIA.find(([key]) => message[key]);
	if (media) {
		out.media_type = media[1];
		out.file = `(файл «${media[1]}» лежит в телеграме)`;
	}

	if (Array.isArray(message.photo) && message.photo.length) {
		const size = biggestPhoto(message.photo);
		out.photo = size.file_id;
		if (size.file_size) out.photo_file_size = size.file_size;
	}

	return out;
}
