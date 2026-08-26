#!/usr/bin/env node
// Проверки регулярного импорта (задача 7.6).
//
// ФАЙЛОМ, А НЕ ОДНОСТРОЧНИКОМ `node -e`. Обратный слэш внутри однострочника
// проходит через две системы экранирования подряд и доезжает до JavaScript
// литеральным слэшем: выражение перестаёт совпадать вообще ни с чем, а проверка
// при этом не падает — она отвечает «ничего не найдено». За проект так уже
// врали дважды подряд.
//
// РЕЖИМ --selftest СУЩЕСТВУЕТ НА САМОМ ДЕЛЕ, а не только в этом заголовке
// (флаг, обещанный в шапке и не написанный в коде, — это ложь в сторону «всё
// хорошо»; такое в проекте уже было). Он ломает данные нарочно и требует,
// чтобы каждая проверка это поймала.
//
//   node scripts/telegram-fetch.test.mjs
//   node scripts/telegram-fetch.test.mjs --export=<папка ChatExport_…>
//   node scripts/telegram-fetch.test.mjs --export=<…> --page=<сохранённая страница>
//   node scripts/telegram-fetch.test.mjs --selftest
//
// БЕЗ --export КРУГОВАЯ ПРОВЕРКА ПЕРЕХОДНИКА НЕ ВЫПОЛНЯЕТСЯ, и она об этом
// ГОВОРИТ. Проверка, которую не запустили, обязана выглядеть как невыполненная,
// а не как успешная: «пусто» и «не спрашивали» — разные состояния, и путать
// их дороже, чем кажется.

import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { flattenEntities, exportDate, botMessageToExport } from '../src/lib/telegramBotUpdate.mjs';
import { parseChannelPage, decodeHref, decodeOnce } from '../src/lib/telegramWebPost.mjs';
import { groupAlbums, buildPost, renderPost, plainOf } from './telegram-import.mjs';
import {
	readUpdates,
	groupByMediaGroup,
	isUnsettled,
	classify,
	missedOnPage,
	askAgainForMissed,
	confirmUpTo,
	seenUpTo,
	appendPhotos,
	markLastPost,
	readState,
	writeState,
	hideToken,
} from './telegram-fetch.mjs';

const arg = (name, fallback = null) => {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
};
const SELFTEST = process.argv.includes('--selftest');
const CHANNEL = 'podcastbaka';

// ——— Случаи, написанные ЖИВЫМ СИНТАКСИСОМ БОТА ———
//
// То есть ровно так, как их присылает Bot API, а не так, как удобно проверке.
// Подлог, повторяющий формулировку проверки, проверяет не проверку, а
// собственную аккуратность — этой ошибкой в проекте уже платили.
//
// Смещения пометок СЧИТАЮТСЯ по самому тексту (`at`), а не пишутся числами:
// число, вписанное руками, переживает правку текста рядом и начинает врать.
// Единственное исключение — случай с составным эмодзи: там смещение написано
// числом нарочно, потому что проверяется именно единица счёта.

let nextId = 5000;
const message = (over = {}) => ({
	message_id: nextId++,
	date: 1786000000, // 2026-08-11T14:26:40Z
	chat: { id: -1001755919716, title: 'Бака! Подкаст об аниме', type: 'channel' },
	...over,
});
const post = (msg) => ({ update_id: 900000 + msg.message_id, channel_post: msg });
const editOf = (msg) => ({ update_id: 900000 + msg.message_id, edited_channel_post: msg });

/** Смещение и длина куска текста — так, как их считает телеграм (UTF-16). */
const at = (text, part, type, extra = {}) => ({ offset: text.indexOf(part), length: part.length, type, ...extra });

const photoSizes = (tag) => [
	{ file_id: `small-${tag}`, file_unique_id: `u1-${tag}`, width: 320, height: 180, file_size: 8000 },
	{ file_id: `big-${tag}`, file_unique_id: `u2-${tag}`, width: 1280, height: 720, file_size: 120000 },
];

const TITLE_TEXT = '🖋 Нарисуй это, потом умри\n\nПо понятным причинам я фанат всех тайтлов про мангак.';
const NO_TITLE_TEXT = 'Вчера мы записали новый выпуск про студию Ghibli. Слушайте на неделе.';
const BONUS_TEXT =
	'🐎 Девушки-пони\n\nОбсуждаем спортивное аниме.\n\nГде слушать?\n\nBoosty (за рубли)\nPatreon (за валюту)';
const ALBUM_TEXT = '🌅 Обои и календари\n\nПоследний месяц лета. Как ваше настроение?';

const CASES = [];

CASES.push({
	name: 'жирный заголовок в начале первой строки — берётся',
	updates: [post(message({ text: TITLE_TEXT, entities: [at(TITLE_TEXT, 'Нарисуй это, потом умри', 'bold')] }))],
	expect: (r) => {
		const built = r.ready[0]?.built;
		if (!built) return 'пост не разобрался';
		if (built.title !== 'Нарисуй это, потом умри') return `заголовок «${built.title}»`;
		if (built.slug !== 'narisuy-eto-potom-umri') return `адрес «${built.slug}»`;
		if (built.body.startsWith('🖋')) return 'эмодзи заголовка осталось в теле';
		if (!built.body.startsWith('По понятным причинам')) return `тело начинается с «${built.body.slice(0, 30)}»`;
		return null;
	},
});

CASES.push({
	name: 'жирного нет вовсе — заголовок не выдумывается',
	updates: [post(message({ text: NO_TITLE_TEXT }))],
	expect: (r) => {
		const built = r.ready[0]?.built;
		if (!built) return 'пост не разобрался';
		if (built.title !== '') return `заголовок «${built.title}» взялся из ниоткуда`;
		if (!/^tg-\d{4}-\d{2}-\d{2}-\d+$/.test(built.slug)) return `адрес «${built.slug}» — ждали адрес из даты и номера`;
		return null;
	},
});

CASES.push({
	name: 'составное эмодзи: смещение считается в единицах UTF-16, а не в буквах',
	updates: [
		post(
			message({
				text: '👩‍🌾 Крестьянский вопрос\n\nТекст поста.',
				// 👩 это две единицы, соединитель одна, 🌾 ещё две, пробел одна —
				// итого заголовок начинается с шестой. Написано числом НАРОЧНО:
				// проверяется ровно то, чем считает телеграм.
				entities: [{ offset: 6, length: 20, type: 'bold' }],
			}),
		),
	],
	expect: (r) => {
		const built = r.ready[0]?.built;
		if (built?.title !== 'Крестьянский вопрос') return `заголовок «${built?.title}»`;
		return null;
	},
});

CASES.push({
	name: 'альбом целиком: шесть снимков одним постом, номер поста — номер подписи',
	updates: (() => {
		const group = '13800000000000001';
		const first = message({ caption: ALBUM_TEXT, caption_entities: [at(ALBUM_TEXT, 'Обои и календари', 'bold')], media_group_id: group, photo: photoSizes('a1') });
		const rest = [2, 3, 4, 5, 6].map((n) => message({ media_group_id: group, photo: photoSizes(`a${n}`) }));
		return [first, ...rest].map(post);
	})(),
	expect: (r) => {
		if (r.ready.length !== 1) return `постов вышло ${r.ready.length}, а не один`;
		const built = r.ready[0].built;
		if (built.photos.length !== 6) return `снимков ${built.photos.length}, а не шесть`;
		if (built.title !== 'Обои и календари') return `заголовок «${built.title}»`;
		return null;
	},
});

CASES.push({
	name: 'альбом с подписью не на первом снимке — номер поста берётся у подписи',
	updates: (() => {
		const group = '13800000000000002';
		const silent = message({ media_group_id: group, photo: photoSizes('b1') });
		const captioned = message({ caption: ALBUM_TEXT, caption_entities: [at(ALBUM_TEXT, 'Обои и календари', 'bold')], media_group_id: group, photo: photoSizes('b2') });
		const tail = message({ media_group_id: group, photo: photoSizes('b3') });
		return [silent, captioned, tail].map(post);
	})(),
	expect: (r) => {
		if (r.ready.length !== 1) return `постов вышло ${r.ready.length}`;
		const item = r.ready[0];
		if (item.built.photos.length !== 3) return `снимков ${item.built.photos.length}`;
		if (item.built.id !== item.post.caption.id) return 'номер поста взят не у подписи';
		if (item.built.id === item.post.members[0].id) return 'номер поста взят у первого снимка, а подпись на втором';
		return null;
	},
});

CASES.push({
	name: 'альбом разорвался между заходами: вторая половина дописывается в тот же пост',
	updates: [3, 4, 5].map((n) => post(message({ media_group_id: '13800000000000003', photo: photoSizes(`c${n}`) }))),
	albums: { '13800000000000003': { slug: 'oboi-i-kalendari', tgId: 4144, photoIds: [4144, 4145, 4146] } },
	expect: (r) => {
		if (r.addToAlbum.length !== 1) return `к дописыванию отобрано ${r.addToAlbum.length} пачек, а не одна`;
		if (r.skipped.length) return `часть снимков ушла в отсев: ${r.skipped[0].reason}`;
		if (r.addToAlbum[0].home.slug !== 'oboi-i-kalendari') return 'выбран не тот пост';
		return null;
	},
});

CASES.push({
	name: 'та же вторая половина, но пачка роботу незнакома — уходит в отсев, а не заводит пустой пост',
	updates: [3, 4, 5].map((n) => post(message({ media_group_id: '13800000000000004', photo: photoSizes(`d${n}`) }))),
	expect: (r) => {
		if (r.ready.length) return 'из снимков без подписи завёлся пост';
		if (r.skipped.length !== 1) return `в отсеве ${r.skipped.length} записей`;
		if (!r.skipped[0].reason.includes('без текста')) return `причина отсева «${r.skipped[0].reason}»`;
		return null;
	},
});

CASES.push({
	name: 'ссылка на Boosty — категория «Бонус», адрес выпуска в поле площадки',
	updates: [
		post(
			message({
				text: BONUS_TEXT,
				entities: [
					at(BONUS_TEXT, 'Девушки-пони', 'bold'),
					at(BONUS_TEXT, 'Boosty (за рубли)', 'text_link', { url: 'https://boosty.to/bakapodcast/posts/da99fba8-bb4b-40fb-a264-ca38b52813ca?share=post_link' }),
					at(BONUS_TEXT, 'Patreon (за валюту)', 'text_link', { url: 'https://www.patreon.com/bakapodcast/posts/devushki-poni-v-165914541?utm_source=copyLink' }),
				],
			}),
		),
	],
	expect: (r) => {
		const built = r.ready[0]?.built;
		if (!built) return 'пост не разобрался';
		if (built.category !== 'bonus') return `категория «${built.category}»`;
		if (!built.bonusLinks?.boosty?.includes('da99fba8')) return `в Boosty попало «${built.bonusLinks?.boosty}»`;
		// Метка «поделиться» у Patreon пишется с прописной буквой — ровно тот
		// случай, из-за которого в задаче 7.4 чтение ссылок разделили надвое.
		if (!built.bonusLinks?.patreon?.includes('copyLink')) return `адрес Patreon испорчен: «${built.bonusLinks?.patreon}»`;
		if (built.bonusLinks?.tgClosed !== '') return 'в «Закрытый TG-канал» что-то вписалось, хотя ссылки не было';
		return null;
	},
});

CASES.push({
	name: 'репост чужого канала — не наш текст, в отсев',
	updates: [
		post(
			message({
				text: 'Смотрите, что пишут коллеги про новый сезон.',
				forward_origin: { type: 'channel', chat: { id: -100123, title: 'Кусогаки', type: 'channel' }, message_id: 77, date: 1785000000 },
			}),
		),
	],
	expect: (r) => (r.skipped[0]?.reason?.includes('Кусогаки') ? null : `причина отсева «${r.skipped[0]?.reason}»`),
});

CASES.push({
	name: 'опрос — на сайте опросов нет, в отсев',
	updates: [post(message({ poll: { id: '1', question: 'Какой тайтл сезона?', options: [] } }))],
	expect: (r) => (r.skipped[0]?.reason === 'опрос' ? null : `причина отсева «${r.skipped[0]?.reason}»`),
});

CASES.push({
	name: 'видео в альбоме — пропускается ВЕСЬ пост, а не одно сообщение',
	updates: (() => {
		const group = '13800000000000005';
		const text = 'Итоги розыгрыша!';
		return [
			post(message({ caption: text, caption_entities: [at(text, 'Итоги розыгрыша!', 'bold')], media_group_id: group, photo: photoSizes('e1') })),
			post(message({ media_group_id: group, video: { file_id: 'v1', width: 1, height: 1, duration: 5 } })),
		];
	})(),
	expect: (r) => {
		if (r.ready.length) return 'пост с видео внутри альбома всё-таки завёлся';
		if (r.skipped.length !== 1) return `в отсеве ${r.skipped.length} записей, а не одна — значит альбом развалился`;
		return r.skipped[0].reason.includes('video_file') ? null : `причина отсева «${r.skipped[0].reason}»`;
	},
});

CASES.push({
	name: 'служебное сообщение канала (закрепление) — в отсев',
	updates: [post(message({ pinned_message: { message_id: 1, date: 1786000000, chat: {} } }))],
	expect: (r) => (r.skipped[0]?.reason === 'служебное сообщение канала' ? null : `причина отсева «${r.skipped[0]?.reason}»`),
});

CASES.push({
	name: 'повторный заход с тем же постом — дубля не заводит',
	updates: [post(message({ text: TITLE_TEXT, entities: [at(TITLE_TEXT, 'Нарисуй это, потом умри', 'bold')] }))],
	known: (updates) => new Map([[updates[0].channel_post.message_id, 'narisuy-eto-potom-umri']]),
	expect: (r) => {
		if (r.ready.length) return 'пост завёлся вторым файлом';
		if (r.already.length !== 1) return `узнано своих ${r.already.length}`;
		return null;
	},
});

CASES.push({
	name: 'вложенная разметка: у жирной ссылки уцелевает адрес, а не начертание',
	updates: (() => {
		const text = 'Смотрите наш новый выпуск сегодня.';
		return [
			post(
				message({
					text,
					entities: [at(text, 'наш новый выпуск', 'bold'), at(text, 'наш новый выпуск', 'text_link', { url: 'https://example.com/x' })],
				}),
			),
		];
	})(),
	expect: (r) => {
		const built = r.ready[0]?.built;
		if (!built) return 'пост не разобрался';
		if (!built.body.includes('](https://example.com/x)')) return 'адрес ссылки потерян';
		return null;
	},
});

// ——— Проверки ———

/** Прогнать случай ТЕМИ ЖЕ функциями, которыми это делает робот. */
function runCase(item) {
	const { messages } = readUpdates(item.updates);
	const posts = groupByMediaGroup(messages);
	const known = item.known ? item.known(item.updates) : new Map();
	return {
		posts,
		...classify(
			posts.map((p) => ({ post: p, from: 'бот' })),
			{ known, albums: item.albums ?? {} },
		),
	};
}

function caseProblems(cases, run = runCase) {
	const problems = [];
	for (const item of cases) {
		let verdict;
		try {
			verdict = item.expect(run(item));
		} catch (error) {
			verdict = `упало: ${error.message}`;
		}
		if (verdict) problems.push(`${item.name} — ${verdict}`);
	}
	return problems;
}

/**
 * КРУГОВАЯ ПРОВЕРКА ПЕРЕХОДНИКА НА ВСЁМ АРХИВЕ.
 *
 * Из кусков выгрузки собирается то, что прислал бы бот (сплошной текст плюс
 * смещения), гонится через переходник — и обязано совпасть с исходными кусками.
 * Это единственный способ спросить про смещения UTF-16 на живых данных: эмодзи
 * в архиве на каждом шагу, а ошибка в единице счёта сдвинула бы разметку
 * на пару знаков и выглядела бы опечаткой автора.
 *
 * Заодно сверяется дата: она обязана совпасть с той, что записана в выгрузке,
 * иначе новые посты датировались бы иначе, чем весь привезённый архив.
 */
const BACK_TO_BOT = {
	link: 'url',
	phone: 'phone_number',
	text_link: 'text_link',
	bold: 'bold',
	italic: 'italic',
	underline: 'underline',
	strikethrough: 'strikethrough',
	spoiler: 'spoiler',
	code: 'code',
	pre: 'pre',
	blockquote: 'blockquote',
	mention: 'mention',
	hashtag: 'hashtag',
	bot_command: 'bot_command',
	email: 'email',
	custom_emoji: 'custom_emoji',
};

export function roundtripProblems(messages, flatten = flattenEntities, date = exportDate) {
	const problems = [];
	let checked = 0;

	for (const source of messages) {
		const want = (source.text_entities ?? []).filter((e) => (e.text ?? '') !== '');
		if (!want.length) continue;
		checked += 1;

		let text = '';
		const entities = [];
		for (const piece of want) {
			const offset = text.length;
			text += piece.text;
			if (piece.type === 'plain') continue;
			const type = BACK_TO_BOT[piece.type];
			if (!type) {
				problems.push(`№${source.id}: переходник не знает пометки «${piece.type}»`);
				continue;
			}
			const entity = { offset, length: piece.text.length, type };
			if (piece.href) entity.url = piece.href;
			if (piece.document_id) entity.custom_emoji_id = piece.document_id;
			entities.push(entity);
		}

		const show = (list) => list.map((e) => `${e.type}|${e.text}|${e.href ?? ''}`).join('\n');
		const got = flatten(text, entities);
		if (show(got) !== show(want) && problems.length < 6) {
			problems.push(`№${source.id}: куски текста разошлись\n      выгрузка: ${show(want).slice(0, 160)}\n      переходник: ${show(got).slice(0, 160)}`);
		}

		if (date(Number(source.date_unixtime)) !== source.date && problems.length < 10) {
			problems.push(`№${source.id}: дата ${date(Number(source.date_unixtime))}, а в выгрузке ${source.date}`);
		}
	}

	return { problems, checked };
}

// ИЗВЕСТНЫЕ ОТЛИЧИЯ — СПИСКОМ, А НЕ СМЯГЧЁННЫМ СРАВНЕНИЕМ.
//
// Соблазн «сравнивать помягче» убивает проверку целиком: она перестаёт замечать
// и настоящие поломки. Список — это утверждение, за которое кто-то отвечает.
//
// Пока он ровно один, и это не ошибка разбора, а ОШИБКА АРХИВА, которую разбор
// как раз и нашёл: №1478 «Ранобэ или аниме?» — альбом из десяти снимков, и
// телеграм отдаёт его десятью и боту, и странице. В выгрузке у снимка №1484
// стоит СВОЯ подпись — текст поста «Хороший исекай?», вписанный туда правкой
// 26 октября 2025 года, через два года после отправки альбома. В канале эта
// подпись не видна нигде: телеграм показывает подпись альбома, а она у первого
// снимка. Склейка-догадка задачи 7.5 приняла её за начало нового поста —
// и завела черновик `horoshiy-isekay.md` из четырёх чужих снимков, при том что
// настоящий пост с этим текстом уже привезён из сообщения №3445.
const KNOWN_DIFFS = [
	{
		id: 1478,
		why: 'альбом из 10 снимков; выгрузка отдаёт 6, потому что у №1484 стоит подпись, вписанная правкой в 2025 году',
	},
];

/**
 * НАСКОЛЬКО ЗАПАСНОЙ ПУТЬ ХУЖЕ ОСНОВНОГО — ЗАМЕР, А НЕ РАССУЖДЕНИЕ.
 *
 * Посты, которые есть и в выгрузке, и на странице канала, разбираются обоими
 * путями, и результат сравнивается: заголовок, адрес, тело, категория, номера
 * снимков и ссылки бонуса. «Заведомо хуже» без числа — это не знание, а
 * предчувствие.
 */
export function webProblems(webPosts, exportPosts, parse = buildPost, known = KNOWN_DIFFS) {
	const twins = new Map(exportPosts.map((p) => [p.id, p]));
	const problems = [];
	let compared = 0;

	for (const web of webPosts) {
		const twin = twins.get(web.id);
		if (!twin) continue;
		if (known.some((item) => item.id === web.id)) continue;
		compared += 1;

		const a = parse(web);
		const b = parse(twin);
		for (const key of ['date', 'slug', 'title', 'body', 'category']) {
			if (a[key] !== b[key]) {
				const x = String(b[key]);
				const y = String(a[key]);
				let i = 0;
				while (i < x.length && x[i] === y[i]) i += 1;
				problems.push(`№${web.id}: поле «${key}» разошлось с ${i}-го знака\n      выгрузка: …${JSON.stringify(x.slice(i, i + 60))}\n      страница: …${JSON.stringify(y.slice(i, i + 60))}`);
			}
		}
		const ids = (p) => p.photos.map((x) => x.id).join(',');
		if (ids(a) !== ids(b)) problems.push(`№${web.id}: номера снимков ${ids(a)} против ${ids(b)}`);
		if (JSON.stringify(a.bonusLinks) !== JSON.stringify(b.bonusLinks)) {
			problems.push(`№${web.id}: ссылки бонуса ${JSON.stringify(a.bonusLinks)} против ${JSON.stringify(b.bonusLinks)}`);
		}
	}

	return { problems, compared };
}

/** Придерживание свежей пачки и подтверждение очереди перед ней. */
export function holdProblems(unsettled = isUnsettled, confirm = confirmUpTo, seen = seenUpTo) {
	const problems = [];
	const now = 1786000000;
	const group = '1';
	const fresh = {
		id: 7001,
		mediaGroupId: group,
		members: [
			{ id: 7001, date_unixtime: String(now - 5) },
			{ id: 7002, date_unixtime: String(now - 4) },
		],
	};
	const old = {
		id: 7001,
		mediaGroupId: group,
		members: [
			{ id: 7001, date_unixtime: String(now - 4000) },
			{ id: 7002, date_unixtime: String(now - 3999) },
		],
	};
	const single = { id: 7010, mediaGroupId: null, members: [{ id: 7010, date_unixtime: String(now - 1) }] };

	if (!unsettled(fresh, now)) problems.push('альбом, снимок которого пришёл пять секунд назад, не придержан');
	if (unsettled(old, now)) problems.push('давний альбом придержан зря');
	if (unsettled(single, now)) problems.push('одиночный пост придержан, хотя дособирать в нём нечего');

	// Очередь подтверждается только до придержанного, и «последнее виденное»
	// тоже не перешагивает его. Второе забыть легче всего.
	const updates = [
		{ update_id: 11, channel_post: { message_id: 6990 } },
		{ update_id: 12, channel_post: { message_id: 7001 } },
		{ update_id: 13, channel_post: { message_id: 7002 } },
	];
	if (confirm(updates, 0, 7001) !== 12) problems.push(`очередь подтверждена до ${confirm(updates, 0, 7001)}, а надо до 12 — перед придержанным`);
	if (confirm(updates, 0, Infinity) !== 14) problems.push('без придержанного очередь подтверждена не до конца');
	if (seen(6000, [7002, 6990], 7001) !== 6990) problems.push(`«последнее виденное» стало ${seen(6000, [7002, 6990], 7001)}, а надо 6990 — иначе запасной путь не поймает потерянное`);
	if (seen(6000, [7002], Infinity) !== 7002) problems.push('без придержанного «последнее виденное» не сдвинулось');
	if (seen(7100, [], 7001) !== 7000) problems.push('«последнее виденное» не обрезано сверху придержанным');

	return problems;
}

/** Пропуск бота узнаётся по странице канала — и только по ней. */
export function missProblems(find = missedOnPage) {
	const problems = [];
	const page = [
		{ id: 8001, members: [{ id: 8001 }] },
		{ id: 8002, members: [{ id: 8002 }, { id: 8003 }] },
		{ id: 8004, members: [{ id: 8004 }] },
	];

	const all = find(page, { lastSeenId: 8000, botSeen: new Set(), known: new Map() });
	if (all.length !== 3) problems.push(`бот не принёс ничего, а пропущенными названы ${all.length} постов из трёх`);

	const some = find(page, { lastSeenId: 8000, botSeen: new Set([8002, 8003]), known: new Map() });
	if (some.map((p) => p.id).join(',') !== '8001,8004') problems.push(`при принесённом альбоме пропущенными названы ${some.map((p) => p.id).join(',')}`);

	const none = find(page, { lastSeenId: 8004, botSeen: new Set(), known: new Map() });
	if (none.length) problems.push('пропущенные нашлись там, где всё уже видено');

	// Пост, который импорт не берёт по правилам, пропущенным считаться не должен
	// вечно: иначе робот ругался бы каждый заход и его перестали бы читать.
	const known = find(page, { lastSeenId: 8000, botSeen: new Set(), known: new Map([[8001, 'slug']]) });
	if (known.some((p) => p.id === 8001)) problems.push('уже заведённый пост назван пропущенным');

	return problems;
}

/**
 * ВТОРОЙ ВОПРОС БОТУ — с ожиданием, и только когда есть что искать.
 *
 * ОТКУДА ОН ВЗЯЛСЯ. 25 и 26 августа 2026 подряд пост висел на странице канала,
 * а в очереди бота его ещё не было: №4163 вышел в 07:01 и доехал к 14:02,
 * №4165 вышел в 07:01, в 08:02 очереди не достиг и лежал в ней в 09:30.
 * Запасной путь такие посты забирает, но картинки берёт со страницы —
 * то есть в том размере, в каком их показывает страница, а не в исходном.
 *
 * ПРОВЕРЯЕТСЯ ТРИ ВЕЩИ, И ВТОРАЯ ВАЖНА НЕ МЕНЬШЕ ПЕРВОЙ: вопрос задан там,
 * где есть что искать; НЕ задан там, где искать нечего (иначе это двадцать
 * секунд молчания на каждом заходе ни за чем); и ответ склеивается по номеру
 * обновления, а не дописывается — второй вопрос задаётся с ТЕМ ЖЕ номером,
 * значит телеграм отдаёт всё прежнее заново, и дописанный ответ завёл бы
 * каждый пост дважды.
 */
export async function secondAskProblems(again = askAgainForMissed) {
	const problems = [];
	const quiet = () => {};
	const page = [{ id: 4165, members: [{ id: 4165 }] }];
	const late = { update_id: 232983443, channel_post: { message_id: 4165, date: 1787727690, chat: { id: -100 }, caption: 'Разочарование сезона' } };
	const next = { update_id: 232983444, channel_post: { message_id: 4166, date: 1787727700, chat: { id: -100 }, caption: 'Следующий' } };
	const ask = (lastSeenId, updates) =>
		missedOnPage(page, {
			lastSeenId,
			botSeen: new Set(groupByMediaGroup(readUpdates(updates).messages).flatMap((post) => post.members.map((m) => m.id))),
			known: new Map(),
		});

	// 1. Страница показывает то, чего у бота нет: вопрос задан, и с ожиданием.
	const missed = ask(4164, []);
	if (missed.length !== 1) problems.push('образец собран неверно: пропущенным считается не один пост — проверять дальше нечего');

	let waited = null;
	const got = await again([], {
		missed,
		ask: async (wait) => {
			waited = wait;
			return [late];
		},
		say: quiet,
	});
	if (waited === null) problems.push('страница показывает то, чего у бота нет, а второй вопрос не задан — пост уедет со страницы, с картинкой похуже');
	else if (waited < 5) problems.push(`второй вопрос задан с ожиданием ${waited} с — это тот же «отдай что есть», от которого он и не помогает`);
	if (got.updates.length !== 1) problems.push(`после второго вопроса обновлений ${got.updates.length}, а бот отдал одно`);
	if (!got.askedAgain) problems.push('вопрос задан, а робот считает, что не задавал, — в письме будет сказано не то');
	if (ask(4164, got.updates).length) problems.push('пост приехал от бота, а всё ещё числится пропущенным — его заберут ещё и со страницы');

	// 2. Искать нечего — не спрашиваем. Цена ожидания платится только за дело.
	let touched = false;
	const idle = await again([], {
		missed: [],
		ask: async () => {
			touched = true;
			return [late];
		},
		say: quiet,
	});
	if (touched) problems.push('второй вопрос задан там, где искать нечего — это ожидание на каждом заходе просто так');
	if (idle.askedAgain) problems.push('вопрос не задавался, а робот считает, что задавал');

	// 3. Телеграм отдаёт с того же номера, то есть ПОВТОРЯЕТ уже отданное.
	const dup = await again([late], { missed, ask: async () => [late, next], say: quiet });
	if (dup.updates.length !== 2) problems.push(`повторно отданное обновление посчитано заново: обновлений ${dup.updates.length}, а разных два`);
	if (dup.arrived.length !== 1) problems.push(`новыми названы ${dup.arrived.length} обновлений, а новое одно`);
	if (dup.updates.map((u) => u.update_id).join(',') !== '232983443,232983444') {
		problems.push('обновления идут не по возрастанию номера — очередь подтвердится не там, где надо');
	}

	return problems;
}

/** Отметка о забранном: читается, пишется и НЕ ТЕРЯЕТ пояснение. */
export function stateProblems(read = readState, save = writeState) {
	const problems = [];
	const dir = mkdtempSync(join(tmpdir(), 'baka-tg-state-'));
	const file = join(dir, 'telegramFeed.mjs');

	try {
		const head = '// Пояснение, которое стоит дороже самих данных.\n';
		writeFileSync(file, `${head}export const telegramFeed = {\n\t"offset": 0,\n\t"lastSeenId": 4143,\n\t"lastPostAt": null,\n\t"lastRunAt": null,\n\t"albums": {}\n};\n`, 'utf8');

		const first = read(file);
		if (first.lastSeenId !== 4143) problems.push(`прочитано lastSeenId=${first.lastSeenId}, а в файле 4143`);

		save(file, { ...first, offset: 12, lastSeenId: 4149, albums: { g1: { slug: 's', tgId: 1, photoIds: [1] } } });
		const raw = readFileSync(file, 'utf8');
		if (!raw.startsWith(head)) problems.push('пояснение в начале файла затёрто записью');

		const second = read(file);
		if (second.offset !== 12 || second.lastSeenId !== 4149) problems.push('записанное не прочиталось обратно');
		if (second.albums.g1?.slug !== 's') problems.push('альбомы не пережили запись');

		// Файла нет вовсе — это не поломка, а первый запуск.
		const missing = read(join(dir, 'нет-такого.mjs'));
		if (missing.offset !== 0 || missing.lastSeenId !== 0) problems.push('пустая отметка прочиталась не пустой');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	return problems;
}

/** Дописывание снимков в уже заведённый пост. */
export function appendProblems(append = appendPhotos) {
	const problems = [];
	const dir = mkdtempSync(join(tmpdir(), 'baka-tg-append-'));

	try {
		const head = "title: Обои и календари\ndate: 2026-08-10\ncategory: note\ndraft: true\ndescription: ''\ncover: /images/uploads/tg-4144.jpg\nnoCover: false\ntgId: 4144";
		const body = '::image{src="/images/uploads/tg-4144.jpg" alt="" width="column"}\n\nПоследний месяц лета.\n\n::image{src="/images/uploads/tg-4145.jpg" alt="" width="column"}';
		const file = join(dir, 'oboi.md');
		writeFileSync(file, `---\n${head}\n---\n\n${body}\n`, 'utf8');

		const result = append(file, ['/images/uploads/tg-4146.jpg', '/images/uploads/tg-4147.jpg'], [4144, 4145, 4146, 4147]);
		if (result.trouble) problems.push(`дописать не вышло: ${result.trouble}`);
		const after = readFileSync(file, 'utf8');
		if (!after.includes('tg-4146.jpg') || !after.includes('tg-4147.jpg')) problems.push('новые снимки в пост не попали');
		if (!after.includes('Последний месяц лета')) problems.push('текст поста потерялся');
		if ((after.match(/tg-4144\.jpg/g) ?? []).length !== 2) problems.push('первый снимок задвоился или пропал');
		if (!after.includes('cover: /images/uploads/tg-4144.jpg')) problems.push('обложка съехала, хотя она уже стояла');
		if (after.indexOf('tg-4146') < after.indexOf('Последний месяц лета')) problems.push('новые снимки встали ПЕРЕД текстом');

		// ОПУБЛИКОВАННЫЙ ПОСТ НЕ ТРОГАЕТСЯ ВОВСЕ.
		const live = join(dir, 'live.md');
		const raw = `---\n${head.replace('draft: true', 'draft: false')}\n---\n\n${body}\n`;
		writeFileSync(live, raw, 'utf8');
		const refused = append(live, ['/images/uploads/tg-4146.jpg'], [4144, 4146]);
		if (!refused.trouble) problems.push('опубликованный пост дописан — так делать нельзя никогда');
		if (readFileSync(live, 'utf8') !== raw) problems.push('опубликованный пост изменён на диске');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	return problems;
}

/**
 * Адрес со страницы канала раскодируется ДВАЖДЫ.
 *
 * Страница экранирует его два раза подряд, и раскодированный один раз адрес
 * выглядит правильным, а ведёт не туда: `&amp;` вместо `&`. Замер по всем
 * скачанным страницам: адресов с амперсандом десять, и во всех десяти стоит
 * `&amp;amp;` — ни одного с одинарным экранированием.
 */
export function hrefProblems(decode = decodeHref) {
	const problems = [];
	const real = 'https://www.patreon.com/bakapodcast/posts/devushki-poni-v-165914541?utm_medium=clipboard_copy&utm_source=copyLink';
	const onPage = 'https://www.patreon.com/bakapodcast/posts/devushki-poni-v-165914541?utm_medium=clipboard_copy&amp;amp;utm_source=copyLink';
	const got = decode(onPage);
	if (got !== real) problems.push(`адрес раскодирован как «${got.slice(-60)}», а надо «${real.slice(-60)}»`);
	if (decode('https://t.me/tribute/app?startapp=s26z') !== 'https://t.me/tribute/app?startapp=s26z') {
		problems.push('адрес без экранирования испорчен раскодированием');
	}
	// Видимый текст экранирован ОДИН раз: раскодируй его дважды — и `&amp;`,
	// написанный автором словами, превратился бы в амперсанд.
	if (decodeOnce('Бака&#33; &amp;amp; компания') !== 'Бака! &amp; компания') problems.push('видимый текст раскодирован не один раз');

	// ДВА РАЗА — ЗНАЧИТ РОВНО ДВА, А НЕ «ПОБОЛЬШЕ». Случая, где это видно,
	// в канале сегодня нет ни одного: он появится, когда автор скопирует адрес
	// с плохо собранной страницы и в самом адресе окажутся буквы `&amp;`.
	// Утверждение от этого не перестаёт быть настоящим, поэтому случай
	// ПОДЛОЖЕН: без него проверка не могла бы провалиться никак, то есть
	// ничем не отличалась бы от сломанной.
	const withEntity = 'https://example.com/?a=1&amp;amp;amp;b=2';
	if (decode(withEntity) !== 'https://example.com/?a=1&amp;b=2') {
		problems.push(`адрес, в котором буквы «&amp;» стоят нарочно, раскодирован до «${decode(withEntity)}»`);
	}
	return problems;
}

/**
 * Отсчёт молчания бота начинается с ПЕРВОГО захода, а не с первого поста.
 *
 * Иначе у бота, который не принёс ни разу (выкинули из канала, не выдали прав),
 * считать было бы не от чего — и правило «молчит дольше недели» не сработало бы
 * ровно в том случае, ради которого написано.
 */
export function silenceProblems(mark = markLastPost) {
	const problems = [];
	const now = '2026-08-10T20:00:00.000Z';
	const before = '2026-08-01T10:00:00.000Z';

	if (mark(null, false, now) !== now) problems.push('первый заход без постов не начал отсчёт молчания — считать будет не от чего');
	if (mark(null, true, now) !== now) problems.push('первый заход с постами не поставил отметку');
	if (mark(before, true, now) !== now) problems.push('пришли посты, а отметка осталась старой');
	if (mark(before, false, now) !== before) problems.push('заход без постов сдвинул отметку — молчание обнулялось бы каждые шесть часов');
	return problems;
}

/** Токен не должен попасть ни в одну строку вывода. */
export function tokenProblems(hide = hideToken) {
	const token = '1234567890:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
	const problems = [];
	const said = hide(`ошибка запроса https://api.telegram.org/bot${token}/getUpdates — таймаут`, token);
	if (said.includes(token)) problems.push('токен остался в тексте ошибки');
	if (!said.includes('<токен>')) problems.push('на месте токена не осталось пометки');
	if (hide('обычная ошибка', '') !== 'обычная ошибка') problems.push('без токена текст испортился');
	return problems;
}

// ——— Запуск ———

function show(title, problems, note = '') {
	const ok = problems.length === 0;
	console.log(`${ok ? '  чисто ' : '  БЕДЫ  '} ${title}${note ? ' — ' + note : ''}`);
	for (const line of problems) console.log(`      • ${line}`);
	return problems.length;
}

async function main() {
	const exportDir = arg('export');
	const pageFile = arg('page');

	let messages = null;
	if (exportDir) messages = JSON.parse(readFileSync(join(exportDir, 'result.json'), 'utf8')).messages;

	let pages = [];
	if (pageFile) {
		// `--page=` берёт и один файл, и ПАПКУ сохранённых страниц: сверять
		// запасной путь на пяти постах первого экрана мало — обе настоящие
		// поломки (чужой текст у постов-ответов и разъехавшиеся начертания)
		// нашлись только на восьмом десятке.
		pages = statSync(pageFile).isDirectory()
			? readdirSync(pageFile).filter((n) => n.endsWith('.html')).map((n) => readFileSync(join(pageFile, n), 'utf8'))
			: [readFileSync(pageFile, 'utf8')];
	} else {
		try {
			const response = await fetch(`https://t.me/s/${CHANNEL}`);
			if (!response.ok) throw new Error(`код ${response.status}`);
			pages = [await response.text()];
		} catch (error) {
			pages = [];
			console.log(`  НЕ СПРОШЕНО  страница канала не скачалась (${error.message}) — сверка запасного пути пропущена`);
		}
	}

	// Один и тот же пост попадается на нескольких страницах — берём по разу.
	const webPosts = [];
	const seenWeb = new Set();
	for (const html of pages) {
		for (const post of parseChannelPage(html, { channel: CHANNEL })) {
			if (seenWeb.has(post.id)) continue;
			seenWeb.add(post.id);
			webPosts.push(post);
		}
	}

	if (SELFTEST) return selftest({ messages, pages, webPosts });

	console.log('ПРОВЕРКИ РЕГУЛЯРНОГО ИМПОРТА (задача 7.6)\n');
	let bad = 0;

	bad += show(`случаи бота, живым синтаксисом: ${CASES.length}`, caseProblems(CASES));
	bad += show('придерживание свежего альбома и отметка о забранном', holdProblems());
	bad += show('пропуск бота узнаётся по странице канала', missProblems());
	bad += show('второй вопрос боту: с ожиданием, только за делом и без дублей', await secondAskProblems());
	bad += show('отметка читается, пишется и не теряет пояснение', stateProblems());
	bad += show('дописывание снимков в уже заведённый пост', appendProblems());
	bad += show('токен не попадает в вывод', tokenProblems());
	bad += show('адрес со страницы канала раскодируется дважды', hrefProblems());
	bad += show('отсчёт молчания бота начинается с первого захода', silenceProblems());

	if (messages) {
		const { problems, checked } = roundtripProblems(messages);
		bad += show('круговая проверка переходника на всём архиве', problems, `сообщений с текстом ${checked}`);
	} else {
		console.log('  НЕ СПРОШЕНО  круговая проверка переходника — нужен ключ --export=<папка ChatExport_…>');
	}

	if (messages && webPosts.length) {
		const { problems, compared } = webProblems(webPosts, groupAlbums(messages));
		bad += show('запасной путь против выгрузки', problems, `общих постов ${compared}, известных отличий ${KNOWN_DIFFS.length}`);
		for (const item of KNOWN_DIFFS) console.log(`      известное отличие №${item.id}: ${item.why}`);
		if (!compared) {
			bad += 1;
			console.log('      • общих постов не нашлось вовсе — сверять было нечего, и это НЕ «чисто»');
		}
	} else if (!messages) {
		console.log('  НЕ СПРОШЕНО  сверка запасного пути с выгрузкой — нужен ключ --export=');
	}

	// «Не спрошено» и «чисто» — РАЗНЫЕ состояния. Проверка, которую не запустили,
	// не имеет права выглядеть успешной: за проект такое враньё случалось шесть раз.
	const unasked = (messages ? 0 : 2) + (pages.length ? 0 : 1);
	console.log(bad === 0 ? `\nВсе проверки чистые.${unasked ? ` НЕ СПРОШЕНО: ${unasked}.` : ''}` : `\nБЕД: ${bad}.`);
	process.exit(bad === 0 ? 0 : 1);
}

/**
 * САМОПРОВЕРКА: ломаю нарочно, каждая проверка обязана заругаться.
 *
 * Молчание здесь — не «всё хорошо», а «проверка мертва». Подлоги написаны так,
 * как в жизни ошибаются, а не так, как удобно проверке: половина из них — это
 * настоящие поломки, которые в проекте уже случались.
 */
async function selftest({ messages, pages, webPosts }) {
	console.log('САМОПРОВЕРКА: ломаю нарочно, проверки обязаны это поймать\n');

	const traps = [
		{
			name: 'смещения считаются в буквах, а не в единицах UTF-16 (эмодзи сдвигает разметку)',
			problems: caseProblems(CASES, (item) => {
				const shifted = item.updates.map((u) => {
					const m = u.channel_post ?? u.edited_channel_post;
					const text = m.text ?? m.caption ?? '';
					const list = m.entities ?? m.caption_entities;
					if (!list) return u;
					// Так выглядит ошибка «считаю по буквам»: смещение берётся
					// в кодовых точках, а телеграм считает в единицах UTF-16.
					const points = [...text];
					const fix = (offset) => [...text.slice(0, offset)].length;
					const moved = list.map((e) => ({ ...e, offset: fix(e.offset) }));
					void points;
					return { ...u, [u.channel_post ? 'channel_post' : 'edited_channel_post']: { ...m, ...(m.entities ? { entities: moved } : { caption_entities: moved }) } };
				});
				return runCase({ ...item, updates: shifted });
			}),
		},
		{
			name: 'альбом собирается по номерам подряд, а не по признаку пачки',
			problems: caseProblems(
				CASES.filter((c) => c.name.includes('альбом')),
				(item) => {
					const { messages: list } = readUpdates(item.updates);
					// Пометку альбома выбрасываем — телеграм её прислал, а мы
					// сделали вид, что её нет.
					const posts = groupByMediaGroup(list.map((m) => ({ ...m, media_group_id: undefined })));
					return {
						posts,
						...classify(posts.map((p) => ({ post: p, from: 'бот' })), { known: new Map(), albums: item.albums ?? {} }),
					};
				},
			),
		},
		{
			name: 'снимки без подписи вылетают в отсев, хотя их пачка уже завелась постом',
			problems: caseProblems(
				CASES.filter((c) => c.name.includes('разорвался')),
				(item) => runCase({ ...item, albums: {} }),
			),
		},
		{
			name: 'узнавание своего сломано — повторный заход заводит дубль',
			problems: caseProblems(
				CASES.filter((c) => c.name.includes('Повторный') || c.name.includes('повторный')),
				(item) => runCase({ ...item, known: () => new Map() }),
			),
		},
		{
			name: 'придерживание выключено — половина альбома уезжает постом',
			problems: holdProblems(() => false),
		},
		{
			name: 'очередь подтверждается до конца, не глядя на придержанное',
			problems: holdProblems(isUnsettled, (updates) => updates.at(-1).update_id + 1),
		},
		{
			name: '«последнее виденное» перешагивает придержанное (запасной путь ослеп)',
			problems: holdProblems(isUnsettled, confirmUpTo, (previous, ids) => Math.max(previous, 0, ...ids)),
		},
		{
			name: 'пропуск ищется сравнением с импортированным, а не с виденным',
			problems: missProblems((page, { known }) => page.filter((p) => !known.has(p.id))),
		},
		{
			name: 'второй вопрос боту задаётся ВСЕГДА — двадцать секунд молчания на каждом заходе ни за чем',
			problems: await secondAskProblems(async (updates, { missed, ask, say = () => {} }) => {
				void missed;
				if (!ask) return { updates, askedAgain: false, arrived: [] };
				say('');
				const more = await ask(20);
				const seen = new Set(updates.map((u) => u.update_id));
				const arrived = more.filter((u) => !seen.has(u.update_id));
				return { updates: [...updates, ...arrived].sort((a, b) => a.update_id - b.update_id), askedAgain: true, arrived };
			}),
		},
		{
			name: 'ответ на второй вопрос дописывается как есть — телеграм отдал прежнее заново, и посты завелись бы дважды',
			problems: await secondAskProblems(async (updates, { missed, ask, say = () => {} }) => {
				if (!missed.length || !ask) return { updates, askedAgain: false, arrived: [] };
				say('');
				const more = await ask(20);
				return { updates: [...updates, ...more], askedAgain: true, arrived: more };
			}),
		},
		{
			name: 'второй вопрос задан без ожидания — тот же «отдай что есть», от которого он и не помогает',
			problems: await secondAskProblems(async (updates, { missed, ask, say = () => {} }) => {
				if (!missed.length || !ask) return { updates, askedAgain: false, arrived: [] };
				say('');
				const more = await ask(0);
				const seen = new Set(updates.map((u) => u.update_id));
				const arrived = more.filter((u) => !seen.has(u.update_id));
				return { updates: [...updates, ...arrived].sort((a, b) => a.update_id - b.update_id), askedAgain: true, arrived };
			}),
		},
		{
			name: 'пропуск не ищется вовсе — «ничего не найдено» выдаётся за хороший ответ',
			problems: missProblems(() => []),
		},
		{
			name: 'запись отметки затирает пояснение (переписывает файл целиком)',
			problems: stateProblems(readState, (file, state) =>
				writeFileSync(file, `export const telegramFeed = ${JSON.stringify(state, null, '\t')};\n`, 'utf8'),
			),
		},
		{
			name: 'дописывание не смотрит на «Черновик» — правит опубликованный пост',
			problems: appendProblems((file, srcs, ids) => {
				const raw = readFileSync(file, 'utf8');
				const cut = raw.indexOf('\n---\n', 4);
				const head = raw.slice(4, cut);
				const body = raw.slice(cut + 5).trim();
				void ids;
				writeFileSync(file, `---\n${head}\n---\n\n${body}\n\n${srcs.map((s) => `::image{src="${s}" alt="" width="column"}`).join('\n')}\n`, 'utf8');
				return { added: srcs.length };
			}),
		},
		{
			name: 'отсчёт молчания начинается с первого ПОСТА — у бота, молчавшего всегда, он не начнётся',
			problems: silenceProblems((previous, got, now) => (got ? now : previous)),
		},
		{
			name: 'отметка молчания сдвигается каждым заходом — молчание обнуляется само',
			problems: silenceProblems((previous, got, now) => now),
		},
		{
			name: 'токен печатается в ошибке как есть',
			problems: tokenProblems((text) => text),
		},
		{
			name: 'адрес со страницы раскодирован один раз — в ссылке остаётся &amp;',
			problems: hrefProblems(decodeOnce),
		},
		{
			name: 'адрес раскодирован трижды — амперсанд, написанный словами, съеден',
			problems: hrefProblems((text) => decodeOnce(decodeOnce(decodeOnce(text)))),
		},
	];

	if (messages) {
		traps.push({
			name: 'переходник склеивает соседние куски одного типа (как было до круговой проверки)',
			problems: roundtripProblems(messages, (text, entities) => {
				const pieces = flattenEntities(text, entities);
				const out = [];
				for (const piece of pieces) {
					const prev = out.at(-1);
					if (prev && prev.type === piece.type && prev.href === piece.href) prev.text += piece.text;
					else out.push({ ...piece });
				}
				return out;
			}).problems,
		});
		traps.push({
			name: 'дата считается по Москве, а архив записан по Берлину',
			problems: roundtripProblems(messages, flattenEntities, (unix) =>
				new Intl.DateTimeFormat('sv-SE', {
					timeZone: 'Europe/Moscow',
					year: 'numeric',
					month: '2-digit',
					day: '2-digit',
					hour: '2-digit',
					minute: '2-digit',
					second: '2-digit',
					hour12: false,
				})
					.format(new Date(unix * 1000))
					.replace(' ', 'T'),
			).problems,
		});
	}

	if (messages && pages.length) {
		const exportPosts = groupAlbums(messages);
		const reparse = (change) => {
			const out = [];
			const seen = new Set();
			for (const html of pages) {
				for (const post of parseChannelPage(change(html), { channel: CHANNEL })) {
					if (seen.has(post.id)) continue;
					seen.add(post.id);
					out.push(post);
				}
			}
			return out;
		};
		traps.push({
			name: 'у постов-ответов берётся первый попавшийся текст — а он чужой',
			problems: webProblems(reparse((html) => html.replace(/js-message_reply_text/g, 'js-message_text')), exportPosts).problems,
		});
		traps.push({
			name: 'известное отличие вычеркнуто из списка — проверка обязана его увидеть',
			problems: webProblems(webPosts, exportPosts, buildPost, []).problems,
		});
		traps.push({
			// Обёртку `<i class="emoji">` заменяем на простую `<i>` — ровно так
			// страница выглядела бы для разбора, который о ней не знает.
			// Внутри обёртки лежит `<b>`, и заголовком стал бы один значок.
			name: 'обёртка эмодзи на странице читается разметкой (заголовком становится значок)',
			problems: webProblems(reparse((html) => html.replace(/<i class="emoji"[^>]*>/g, '<i>')), exportPosts).problems,
		});
	}

	let blind = 0;
	for (const trap of traps) {
		const caught = trap.problems.length > 0;
		if (!caught) blind += 1;
		console.log(`  ${caught ? 'поймано   ' : 'ПРОСМОТРЕНО'} — ${trap.name}`);
	}

	console.log(blind === 0 ? `\nВсе ${traps.length} подлогов пойманы: проверки живы.` : `\nПРОВЕРКИ СЛЕПЫ В ${blind} СЛУЧАЯХ — им нельзя верить.`);
	process.exit(blind === 0 ? 0 : 1);
}

await main();

// Чтобы связь с разбором была явной: обе функции зовутся из проверок выше.
void plainOf;
void renderPost;
void botMessageToExport;
