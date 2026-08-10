#!/usr/bin/env node
// Импорт постов из экспорта телеграма в черновики сайта (тз/07, задача 7.1).
//
// УСТРОЙСТВО ТАКОЕ ЖЕ, КАК У ДВУХ ДРУГИХ РАЗОВЫХ СКРИПТОВ ПРОЕКТА
// (timecodes-from-body.mjs, cover-cutout.mjs): без ключей — разведка и отчёт,
// в репозиторий не пишется ничего; запись включается отдельным ключом и
// отдельным запуском. Причина простая: разбор угадывает — категорию, границы
// альбома, наличие заголовка, — и угаданное человек обязан увидеть раньше,
// чем оно ляжет в сто файлов.
//
//   --export=<папка>   папка ChatExport_… с result.json и photos/ (обязателен)
//   --last=100         сколько ПОСЛЕДНИХ постов взять (по умолчанию 100)
//   --write            записать черновики в src/content/posts/
//   --photos=4013,…    забрать картинки только у этих постов (номера сообщений)
//   --out=<папка>      куда писать посты (по умолчанию src/content/posts)
//
// ЧЕГО ЭТОТ СКРИПТ НЕ ДЕЛАЕТ И НЕ ДОЛЖЕН. Не публикует (у всех `draft: true`),
// не размечает тайтлы в тексте (только подсказка в `animeSuggested`), не трогает
// уже существующие посты ни при каких условиях и не тащит картинки всего архива.
//
// ПОВТОРЯЕМОСТЬ ДЕРЖИТСЯ НА НОМЕРЕ ИСХОДНОГО СООБЩЕНИЯ, а не на заголовке
// и не на тексте: заголовок заказчик перепишет, текст поправит, а номер
// не меняется никогда. Второй прогон обязан не создать ни одного дубля —
// это проверяется запуском, а не рассуждением (см. telegram-import.test.mjs).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../src/lib/slug.mjs';
import { buildAnimeMatcher, findMentions } from '../src/lib/animeMentions.mjs';
import { manualTelegramPosts } from '../src/data/telegramImported.mjs';
// Общие адреса площадок поддержки. Нужны затем, чтобы НЕ вписывать их в пост:
// поле `bonusLinks` хранит только своё, а пустая строка означает «взять отсюда».
import { platformsOfKind } from '../src/data/platforms.js';
// Имена файлов и раскладка картинок вокруг текста — общие с роботом подгрузки
// (scripts/telegram-photos.mjs, задача 7.2). Второй копии этого правила быть
// не должно: посты, привезённые сразу с картинками, и посты, догруженные
// позже, обязаны выглядеть одинаково.
import { photoFileName, photoSrc, withPhotos, savePhoto } from '../src/lib/telegramPhotos.mjs';

// ——— Настройки разбора ———

const CHANNEL = 'podcastbaka';

// Пост со ссылкой на площадку — это АНОНС уже существующего материала, а не
// самостоятельный материал: «вышел выпуск, слушайте там-то». Импортировать его
// значило бы завести на сайте вторую запись о том, что на сайте уже есть.
// Решение заказчика; каждый такой пост всё равно называется в отчёте.
//
// Список ЭКСПОРТИРУЕТСЯ, потому что его меряет разведка задачи 7.4
// (scripts/telegram-announce-audit.mjs). Своей копии у неё быть не должно:
// копия разъехалась бы, и замер отвечал бы про правило, которого нет.
//
// ДВЕ СТРОКИ ЭТОГО СПИСКА ИСПРАВЛЕНЫ ПО ЗАМЕРУ АРХИВА (задача 7.4).
//
// Было `mave.digital` — на Mave живёт не только наш подкаст, и строка забирала
// походы в гости в ЧУЖИЕ подкасты: «Эффект Эмметта Брауна» и «2D Деды».
// Стало `baka.mave.digital` — наш и только наш.
//
// Было `open.spotify` — на Spotify лежит не только подкаст, и строка забирала
// заметки о музыке («Музыка мечты» про саундтрек «Фрирен», дважды).
// Замер всех ссылок архива: `/show/` — 7 раз (это мы), `/album/` и `/playlist/`
// — 3 раза (это музыка). Порог виден сам, стало `open.spotify.com/show/`.
// Цена: один пост 2022 года со ссылкой на ПЛЕЙЛИСТ выпусков (№26) приедет
// лишним черновиком. Это дешёвая сторона ошибки, и она выбрана нарочно.
//
// `music.yandex` и `podcasts.apple` не тронуты: замер не нашёл ни одного поста,
// потерянного из-за них. Сужать строку без доказанной ошибки незачем.
export const ANNOUNCE_HOSTS = [
	'bakapodcast.com',
	'baka.mave.digital',
	'music.yandex',
	'podcasts.apple',
	'open.spotify.com/show/',
	'vk.com/podcast',
];

// АНОНС БОНУСНОГО ВЫПУСКА — НЕ АНОНС, А ЗАГОТОВКА МАТЕРИАЛА, И ВОТ ПОЧЕМУ.
//
// Правило площадок называлось «материал уже есть на сайте, второй записи
// не нужно». Замер архива (задача 7.4) показал, что 132 поста из 147 отнятых —
// это анонсы БОНУСНЫХ выпусков, которых на сайте нет и взяться им неоткуда:
// они лежат на Boosty и Patreon. При этом на сайте под них построена целая
// категория «Бонус» с плашкой подписки, а «Девушки-пони» заказчик сделал
// РУКАМИ ровно из такого поста.
//
// Поэтому Boosty и Patreon переехали из списка анонсов сюда: пост с такой
// ссылкой не выбрасывается, а приезжает черновиком категории «Бонус».
// Решение заказчика 10 августа 2026.
const BONUS_HOSTS = ['boosty.to', 'patreon.com'];

// Какая ссылка из поста в какую строку поля «Ссылки площадок» (`bonusLinks`).
// Ключи — те же `id`, что у площадок поддержки в src/data/platforms.js;
// третьей копии этого списка быть не должно.
//
// `t.me` берётся ТОЛЬКО у tribute: в бонусных постах попадаются и ссылки
// на сам канал, и на чужие каналы, и закрытой подпиской они не являются.
const BONUS_FIELDS = [
	['boosty', ['boosty.to']],
	['patreon', ['patreon.com']],
	['tgClosed', ['t.me/tribute']],
	['vkDonat', ['vk.com/', 'vk.ru/']],
];

// АНОНС ВИДЕОЭССЕ УЗНАЁТСЯ ПО ДВУМ ССЫЛКАМ СРАЗУ, а не по одной.
//
// Так устроен сам пост: «смотреть на ютюбе / во ВКонтакте / на других
// площадках», где последняя ведёт через pc.st. Одной ссылки на ютюб мало
// и она означает совсем другое — замер по последней сотне: ссылка на ютюб
// БЕЗ pc.st стоит у девяти постов, и все девять обычные заметки («Любуемся!»,
// «Новостной дайджест», разбор чужого ролика с канала Aniplex). Отсеивай
// по одному ютюбу — и вместе с четырьмя анонсами уехали бы эти девять.
export const VIDEOESSAY_ANNOUNCE = [
	['youtube.com', 'youtu.be'],
	['pc.st'],
];

// Альбом в экспорте НИЧЕМ НЕ ПОМЕЧЕН: telegram не пишет media_group_id вовсе.
// Восстанавливаем догадкой. Догадка, а не факт, поэтому все найденные группы
// печатаются списком — сверять их заказчик обязан глазами.
//
// ПОРОГИ ВЫВЕДЕНЫ ЗАМЕРОМ ПО ВСЕМУ АРХИВУ, А НЕ НАЗНАЧЕНЫ НА ГЛАЗ, и один
// из них пришлось исправить против ТЗ. В тз/тз-7.1 записано «та же секунда
// date_unixtime», и это неверно: телеграм ставит фотографиям одного альбома
// РАЗНОЕ время, если отправка перешагнула секунду. Замер 1694 фотографий-
// продолжений: разбег 0 сек — 1589 раз, 1 сек — 75, 2 сек — 1, дальше сразу
// 10, 24, 58 секунд и часы. Порог виден сам — между 2 и 10 настоящий разрыв.
// Правило «та же секунда» оторвало бы от своих постов 105 фотографий из 1694,
// и каждая всплыла бы отдельным «постом без текста»: молчаливая потеря данных,
// выглядящая как нормальная работа.
//
// Разбег по номеру замер подтвердил: 1 — 1689 раз, 2 — 4 раза, дальше 11.
const ALBUM_ID_GAP = 3;
const ALBUM_SECONDS_GAP = 2;

// Эмодзи, модификаторы тона кожи, флаги и склейки — всё, что не буква.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// ——— Мелкие помощники ———

const stripEmoji = (text) => text.replace(EMOJI, '');
const squeeze = (text) => text.replace(/[ \t ]+/g, ' ').trim();

/** Все куски текста сообщения одной строкой, без разметки. */
export const plainOf = (entities) => (entities ?? []).map((e) => e.text ?? '').join('');

/**
 * Адреса, на которые ведёт сообщение, КАК ОНИ НАПИСАНЫ: и ссылки словом,
 * и голые адреса.
 *
 * РЕГИСТР ЗДЕСЬ НЕ ТРОГАЕТСЯ НАРОЧНО. Адрес, который уедет в поле поста,
 * обязан совпадать с оригиналом побайтно: у Patreon в метке «поделиться»
 * стоит `copyLink`, и приведённый к нижнему регистру адрес — уже другой адрес.
 * Для СРАВНЕНИЯ регистр не нужен, и этим занимается `urlsOf` ниже.
 */
export function rawUrlsOf(entities) {
	const out = [];
	for (const e of entities ?? []) {
		if (e.type === 'text_link' && e.href) out.push(e.href);
		if (e.type === 'link') out.push(e.text ?? '');
	}
	return out;
}

/** Те же адреса в нижнем регистре — для поиска площадок в них. */
export const urlsOf = (entities) => rawUrlsOf(entities).map((u) => u.toLowerCase());

// ——— Склейка альбомов ———

const hasMedia = (message) => Boolean(message.photo || message.media_type || message.file);
const hasText = (message) => Boolean(plainOf(message.text_entities).trim());

/**
 * Сообщения → посты. Продолжение альбома прирастает к предыдущему посту.
 *
 * ГЛАВНЫЙ ПРИЗНАК ЗДЕСЬ — ОТСУТСТВИЕ СВОЕГО ТЕКСТА, а не время. У альбома
 * подпись ровно одна, и стоит она у первого сообщения; всё, что идёт следом
 * без единого слова, но с вложением, — это его же фотографии. Время и номер
 * работают ограничителями: без них к посту прирос бы одинокий снимок,
 * отправленный часом позже.
 *
 * ВЛОЖЕНИЕ, А НЕ ТОЛЬКО ФОТО, — намеренно. Альбом бывает смешанный, и видео
 * внутри него обязано попасть в тот же пост: иначе пост уехал бы в черновики
 * как обычный, а видео всплыло бы отдельной строчкой отсева, и связь между
 * ними увидеть было бы нельзя.
 *
 * @param {object[]} messages
 * @returns {{ id: number, members: object[], caption: object }[]}
 */
export function groupAlbums(messages) {
	const posts = [];

	for (const message of messages) {
		const last = posts.at(-1);
		const prev = last?.members.at(-1);
		const near =
			prev &&
			message.id > prev.id &&
			message.id - prev.id <= ALBUM_ID_GAP &&
			Number(message.date_unixtime) - Number(prev.date_unixtime) <= ALBUM_SECONDS_GAP;

		if (near && !hasText(message) && hasMedia(message) && message.type === 'message') {
			last.members.push(message);
			continue;
		}

		posts.push({ id: message.id, members: [message], caption: message });
	}

	return posts;
}

// ——— Заголовок ———

/**
 * Заголовок — ЖИРНЫЙ КУСОК В НАЧАЛЕ ПЕРВОЙ СТРОКИ. Перед ним допускаются
 * только эмодзи, пробелы и пунктуация; любая буква или цифра перед жирным
 * означает, что заголовка нет.
 *
 * ЗАГОЛОВКА НЕТ — НЕ ВЫДУМЫВАЕМ. Резать первое предложение по точке запрещено:
 * получится не заголовок, а огрызок фразы, и отличить его от настоящего
 * заголовка потом будет нельзя. Пост уходит в отчёт отдельным списком.
 *
 * @returns {{ title: string, tail: number } | null}
 *   tail — номер последней сущности, входящей в строку заголовка.
 */
export function extractTitle(entities) {
	const list = entities ?? [];
	const firstBold = list.findIndex((e) => e.type === 'bold');
	if (firstBold === -1) return null;
	if (!(list[firstBold].text ?? '').trim()) return null;

	// Всё до жирного: буква, цифра или перевод строки — заголовка нет.
	for (let i = 0; i < firstBold; i += 1) {
		const text = list[i].text ?? '';
		if (text.includes('\n')) return null;
		if (LETTER_OR_DIGIT.test(stripEmoji(text))) return null;
	}

	// Докуда тянется строка заголовка: до последнего жирного куска ДО перевода
	// строки. «**Город** | **Комедия на миллион**» — один заголовок, а не два.
	let last = firstBold;
	for (let i = firstBold; i < list.length; i += 1) {
		const text = list[i].text ?? '';
		if (list[i].type === 'bold') last = i;
		if (text.includes('\n')) break;
	}

	const raw = list
		.slice(0, last + 1)
		.map((e) => e.text ?? '')
		.join('')
		.split('\n')[0];

	const title = squeeze(stripEmoji(raw));
	return title ? { title, tail: last } : null;
}

// ——— Тело ———

// Знаки, которые в markdown значат разметку. Экранируются, иначе звёздочка
// внутри фразы съест кусок текста курсивом, а квадратная скобка превратится
// в поломанную ссылку. Список нарочно короткий: экранировать «-» и «1.»
// в начале строки не надо — автор писал именно список, и списком он и должен
// стать.
const escapeText = (text) =>
	text
		.replace(/\\/g, '\\\\')
		.replace(/([*_`[\]])/g, '\\$1')
		// Решётка и «больше» в начале строки — заголовок и цитата markdown.
		.replace(/^([ \t]*)([#>])/gm, '$1\\$2');

/**
 * Разметка телеграма → markdown. Соответствие взято из тз/тз-7.1.
 *
 * СПОЙЛЕР ТЕЛЕГРАМА СТАНОВИТСЯ ОБЫЧНЫМ ТЕКСТОМ НАМЕРЕННО. На сайте спойлер —
 * это другая природа (`remark-spoiler.mjs`: содержимое лежит в `<template>`
 * и не попадает ни роботу, ни в поиск). Подменять одно другим нельзя: автор
 * прятал шутку от глаза, а не текст от поисковика.
 */
export function entitiesToMarkdown(entities) {
	let out = '';

	for (const entity of entities ?? []) {
		const text = entity.text ?? '';
		const inner = escapeText(text);

		switch (entity.type) {
			case 'bold':
				out += text.trim() ? `**${inner.trim()}**` : text;
				break;
			case 'italic':
				out += text.trim() ? `*${inner.trim()}*` : text;
				break;
			case 'strikethrough':
				out += text.trim() ? `~~${inner.trim()}~~` : text;
				break;
			case 'underline':
				// Подчёркивания в markdown нет; курсив — ближайшее по смыслу.
				out += text.trim() ? `*${inner.trim()}*` : text;
				break;
			case 'code':
				out += '`' + text.replace(/`/g, '') + '`';
				break;
			case 'pre':
				out += '\n```\n' + text + '\n```\n';
				break;
			case 'blockquote':
				out +=
					'\n' +
					text
						.split('\n')
						.map((line) => '> ' + escapeText(line))
						.join('\n') +
					'\n';
				break;
			case 'text_link':
				out += `[${inner}](${entity.href})`;
				break;
			case 'link':
			case 'mention':
			case 'hashtag':
			case 'phone':
			case 'email':
			case 'bot_command':
				// Адреса, упоминания каналов и теги остаются как есть: экранировать
				// внутри них нечего, а ломать адрес обратным слэшем — вредно.
				out += text;
				break;
			case 'custom_emoji':
				out += text;
				break;
			case 'spoiler':
			case 'plain':
			default:
				out += inner;
		}
	}

	return out
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Сущности тела: строка заголовка отброшена.
 *
 * ОТБРАСЫВАЕТСЯ РОВНО ЗАГОЛОВОК, А НЕ ВСЯ СТРОКА. Если после жирного куска
 * на той же строке остался обычный текст, он остаётся в теле: выкинуть строку
 * целиком значило бы молча потерять авторские слова. Сколько таких постов —
 * говорится в отчёте, чтобы заказчик посмотрел на них глазами.
 */
export function bodyEntities(entities, title) {
	const list = entities ?? [];
	if (!title) return list;

	const rest = [];
	const tailText = list[title.tail].text ?? '';
	const cut = tailText.indexOf('\n');
	if (cut !== -1) rest.push({ type: 'plain', text: tailText.slice(cut) });

	return [...rest, ...list.slice(title.tail + 1)];
}

/** Что осталось на строке заголовка после него самого. Пусто — строка ушла целиком. */
export function titleLineTail(entities, title) {
	if (!title) return '';

	let out = '';
	for (const entity of bodyEntities(entities, title)) {
		const text = entity.text ?? '';
		const cut = text.indexOf('\n');
		out += cut === -1 ? text : text.slice(0, cut);
		if (cut !== -1) break;
	}
	return out.trim();
}

// ——— Отсев ———

/** Анонс бонусного выпуска: ссылка на Boosty или Patreon. */
export function isBonus(entities) {
	const urls = urlsOf(entities);
	return BONUS_HOSTS.some((host) => urls.some((url) => url.includes(host)));
}

/** Причина, по которой пост не импортируется. `null` — импортируется. */
export function skipReason(post) {
	for (const m of post.members) {
		if (m.type !== 'message') return 'служебное сообщение канала';
		if (m.forwarded_from) return `репост чужого канала («${m.forwarded_from}»)`;
		if (m.poll) return 'опрос';
		if (m.media_type) return `вложение «${m.media_type}» — файл в экспорт не выгружен`;
	}

	const entities = post.caption.text_entities ?? [];
	if (!plainOf(entities).trim()) return 'сообщение без текста';

	// БОНУС ПРОВЕРЯЕТСЯ РАНЬШЕ ОБОИХ ПРАВИЛ АНОНСА — иначе пост с ссылкой
	// и на Boosty, и на площадку подкаста ушёл бы в отсев, хотя это заготовка
	// материала. Замер архива: постов, где бонус спорит с правилом видеоэссе,
	// ноль, но порядок всё равно назван явно — данные меняются, порядок нет.
	if (isBonus(entities)) return null;

	const urls = urlsOf(entities);
	const hit = ANNOUNCE_HOSTS.find((host) => urls.some((url) => url.includes(host)));
	if (hit) return `анонс уже существующего материала (ссылка на ${hit})`;

	const videoessay = VIDEOESSAY_ANNOUNCE.every((hosts) => hosts.some((host) => urls.some((url) => url.includes(host))));
	if (videoessay) return 'анонс видеоэссе (ссылки и на ютюб, и на pc.st)';

	return null;
}

/**
 * Категория привезённого поста: «Бонус» или «Заметка».
 *
 * ЭТО НЕ ДОГАДКА, А ПРИЗНАК. Прежняя догадка про видеоэссе смотрела на ссылку
 * на ютюб и промахивалась в девяти случаях из девяти — её убрали 10 августа
 * 2026 вместе с полем «угадал робот». Здесь другое: ссылка на Boosty или
 * Patreon стоит в посте потому, что выпуск лежит ТАМ, а бонус — это ровно
 * «выпуск за подпиской». Замер архива: из 132 постов с такой ссылкой анонсами
 * бонусов оказались все, кроме пяти служебных («Скидки!», «Новый подкаст!»),
 * и те пять заказчик увидит черновиками.
 *
 * Что человек категорию ещё не подтвердил, по-прежнему говорит галочка
 * «Черновик»: она стоит у всех привезённых постов без исключения.
 */
export function guessCategory(entities) {
	return isBonus(entities) ? 'bonus' : 'note';
}

/**
 * Адреса для поля «Ссылки площадок» бонусного поста (`bonusLinks`).
 *
 * ПИШЕТСЯ ТОЛЬКО ТО, ЧТО ОТЛИЧАЕТСЯ ОТ ОБЩЕГО АДРЕСА ПЛОЩАДКИ. Так устроено
 * само поле (`bonusSupportLinks` в src/data/platforms.js): пустая строка
 * значит «взять адрес оттуда». Впиши сюда общий адрес — и в 130 постах
 * заведётся копия, которая замёрзнет навсегда и отстанет при первой же смене
 * ссылки. Это то же правило, по которому у выпусков не хранится длительность.
 *
 * ПРОВЕРЕНО НЕ РАССУЖДЕНИЕМ, А ВАШЕЙ РУКОЙ: пост «Девушки-пони» вы собрали
 * из телеграм-поста №4142 сами — и вписали адреса Boosty, Patreon и VK,
 * а «Закрытый TG-канал» оставили пустым, потому что ссылка на tribute
 * в посте общая. Разбор повторяет это решение, а не своё.
 */
export function bonusLinksOf(entities) {
	const urls = rawUrlsOf(entities);
	const defaults = new Map(platformsOfKind('support').map((p) => [p.id, normalizeLink(p.url)]));
	const links = {};

	for (const [id, hosts] of BONUS_FIELDS) {
		const own = urls.find(
			(url) => hosts.some((host) => url.toLowerCase().includes(host)) && normalizeLink(url) !== defaults.get(id),
		);
		links[id] = own ?? '';
	}

	return links;
}

/**
 * Адрес без того, что не меняет, куда он ведёт.
 *
 * Нужен ровно для одного вопроса: «это общий адрес площадки или свой?».
 * `http://patreon.com/bakapodcast` и `https://www.patreon.com/bakapodcast` —
 * одно и то же место, а метки «поделиться» (`?share=`, `utm_*`, `si=`)
 * у каждой копии ссылки свои. Не приведи их к одному виду — и общий адрес
 * из старого поста уехал бы в поле как «свой».
 */
function normalizeLink(url) {
	return String(url)
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/[?&](share|si|dl_branch|utm_[a-z_]+)=[^&]*/g, '')
		.replace(/[?&]$/, '')
		.replace(/\/+$/, '');
}

/** Сколько ссылок ведёт внутрь самого канала (задача 7.3, здесь только счёт). */
export function innerLinks(entities) {
	return urlsOf(entities).filter((url) => url.includes(`t.me/${CHANNEL}/`)).length;
}

// ——— Сборка поста ———

const yamlString = (value) => {
	const text = String(value ?? '');
	const needsQuotes = text === '' || /^[\s>|*&!%@`#-]|[:#]\s|\s$|['"]/.test(text);
	return needsQuotes ? `'${text.replace(/'/g, "''")}'` : text;
};

function frontmatter(fields) {
	const lines = [];
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) {
			if (!value.length) continue;
			lines.push(`${key}:`);
			for (const item of value) lines.push(`  - ${item}`);
		} else if (value && typeof value === 'object') {
			// Вложенный блок — сейчас это только `bonusLinks`. Пишется ЦЕЛИКОМ,
			// со всеми четырьмя строками, в том числе пустыми: ровно так его
			// пишет админка (сверено с постом «Девушки-пони»), и расхождение
			// хоть в одной строке дало бы правку на весь файл при первом же
			// сохранении.
			lines.push(`${key}:`);
			for (const [name, item] of Object.entries(value)) lines.push(`  ${name}: ${yamlString(item)}`);
		} else if (typeof value === 'boolean' || typeof value === 'number') {
			lines.push(`${key}: ${value}`);
		} else {
			lines.push(`${key}: ${yamlString(value)}`);
		}
	}
	return `---\n${lines.join('\n')}\n---\n`;
}

/**
 * Фотографии поста по порядку: первая — обложка, остальные — галерея.
 *
 * Экспортируется, потому что тем же способом их ищет робот подгрузки
 * (scripts/telegram-photos.mjs): пост он находит по номеру, а какие снимки
 * к нему относятся — вопрос склейки альбома, и ответ на него должен быть один.
 */
export const photosOf = (post) => post.members.filter((m) => m.photo).map((m) => ({ id: m.id, file: m.photo }));

export function buildPost(post, { matcher = [] } = {}) {
	const entities = post.caption.text_entities ?? [];
	const title = extractTitle(entities);
	const body = entitiesToMarkdown(bodyEntities(entities, title));
	const date = post.caption.date.slice(0, 10);

	const slug = title ? slugify(title.title) : `tg-${date}-${post.id}`;
	const suggested = matcher.length ? [...new Set(findMentions(`${title?.title ?? ''}\n${body}`, matcher).map((m) => m.id))] : [];

	return {
		id: post.id,
		date,
		slug,
		title: title?.title ?? '',
		body,
		category: guessCategory(entities),
		bonusLinks: isBonus(entities) ? bonusLinksOf(entities) : null,
		photos: photosOf(post),
		suggested,
		innerLinks: innerLinks(entities),
		// Заголовок кончился, а строка — нет. Такой текст НЕ выбрасывается,
		// а остаётся началом тела; в отчёт идёт, чтобы заказчик глянул глазами.
		lineTail: titleLineTail(entities, title),
	};
}

/**
 * Текст файла поста.
 *
 * «ОБЛОЖКИ НЕТ НАМЕРЕННО» СТАВИТСЯ ТОЛЬКО ТОМУ, У КОГО КАРТИНОК НЕТ ВОВСЕ.
 * Пустое поле обложки значит «подбери сам», галочка — «картинки быть не должно»,
 * и путать их нельзя (CLAUDE.md). У поста, чьи фотографии в этом прогоне просто
 * не забирали, картинки ЕСТЬ — они лежат в экспорте и приедут задачей 7.2.
 * Поставь ему галочку — и он навсегда останется в ленте голым заголовком,
 * хотя к нему приложено шесть снимков.
 */
export function renderPost(built, { files = [] } = {}) {
	// РАСКЛАДКА АЛЬБОМА живёт в общем `withPhotos` (src/lib/telegramPhotos.mjs):
	// первая картинка идёт И в обложку, И первой строкой текста, остальные
	// встают ПОСЛЕ текста одним блоком. Решение заказчика 10 августа 2026 —
	// так он выкладывает посты руками. То же правило применяет робот подгрузки
	// картинок, и второй копии у него быть не должно.
	const { cover, text } = withPhotos(built.body, files);

	return (
		frontmatter({
			title: built.title,
			date: built.date,
			category: built.category,
			// Признака «категорию угадал робот» здесь больше нет: он был заведён
			// под догадку, а догадки не осталось (см. guessCategory). Что человек
			// категорию ещё не подтвердил, говорит галочка «Черновик» — она стоит
			// у всех без исключения, и на сайт такой пост не попадёт.
			draft: true,
			description: '',
			cover,
			noCover: built.photos.length === 0,
			tgId: built.id,
			tgUrl: `https://t.me/${CHANNEL}/${built.id}`,
			// Только у бонусов: у заметки этого поля быть не должно вовсе,
			// иначе оно врало бы про устройство поста.
			...(built.bonusLinks ? { bonusLinks: built.bonusLinks } : {}),
			animeSuggested: built.suggested,
		}) +
		'\n' +
		text +
		'\n'
	);
}

// ——— Что уже импортировано ———

/**
 * Номера сообщений, которые на сайте уже есть.
 *
 * ДВА ИСТОЧНИКА, И ВТОРОЙ НЕИЗБЕЖЕН. Первый — поле `tgId` в самих постах:
 * так узнаются все посты, заведённые этим скриптом. Второй — журнал
 * `src/data/telegramImported.mjs`: посты, которые заказчик перенёс из телеграма
 * РУКАМИ, номера в себе не носят и носить не могут — дописать поле в уже
 * опубликованный пост запрещено правилом «опубликованное не трогать».
 */
export function knownIds(postsDir) {
	const known = new Map(Object.entries(manualTelegramPosts).map(([id, slug]) => [Number(id), slug]));

	for (const name of readdirSync(postsDir).filter((n) => n.endsWith('.md'))) {
		const head = readFileSync(join(postsDir, name), 'utf8').split('\n---')[0];
		const match = head.match(/^tgId:\s*(\d+)\s*$/m);
		if (match) known.set(Number(match[1]), basename(name, '.md'));
	}

	return known;
}

// ——— Картинки ———

async function fetchPhotos(built, exportDir, uploadsDir) {
	if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

	const written = [];
	for (const photo of built.photos) {
		const from = join(exportDir, photo.file);
		if (!existsSync(from)) {
			console.log(`  ! нет файла ${photo.file} — картинка пропущена`);
			continue;
		}
		// Имя файла и уменьшение до 1000 px — общие с роботом подгрузки
		// (src/lib/telegramPhotos.mjs). Разойдись имена, робот считал бы уже
		// привезённую картинку новой и тащил бы её заново каждое нажатие.
		await savePhoto(from, join(uploadsDir, photoFileName(photo.id)));
		written.push(photoSrc(photo.id));
	}
	return written;
}

// ——— Отчёт и запуск ———

function arg(name, fallback = null) {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
	const exportDir = arg('export');
	if (!exportDir) {
		console.error('Нужен ключ --export=<папка ChatExport_…>');
		process.exit(1);
	}

	// fileURLToPath, а не .pathname: в пути к проекту есть русские буквы
	// и пробел, и .pathname отдаёт их закодированными («%D0%A0%D0%B0…»).
	// Такой путь не открывается ничем, а ошибка выглядит как «файла нет».
	const root = fileURLToPath(new URL('..', import.meta.url));
	const postsDir = arg('out', join(root, 'src/content/posts'));
	const uploadsDir = join(root, 'public/images/uploads');
	const last = Number(arg('last', '100'));
	const write = has('write');
	const photoIds = new Set((arg('photos', '') || '').split(',').filter(Boolean).map(Number));

	const data = JSON.parse(readFileSync(join(exportDir, 'result.json'), 'utf8'));
	const allPosts = groupAlbums(data.messages);
	const posts = allPosts.slice(-last);

	// Справочник тайтлов — для подсказки `animeSuggested`. Разметку в тексте
	// импорт не делает: подтверждает тайтлы человек.
	const animeDir = join(root, 'src/content/anime');
	const entries = readdirSync(animeDir)
		.filter((n) => n.endsWith('.json'))
		.map((n) => ({ id: basename(n, '.json'), data: JSON.parse(readFileSync(join(animeDir, n), 'utf8')) }));
	const matcher = buildAnimeMatcher(entries);

	const known = knownIds(postsDir);

	console.log(`Экспорт: ${exportDir}`);
	console.log(`Сообщений ${data.messages.length}, постов после склейки альбомов ${allPosts.length}.`);
	console.log(`Взято последних постов: ${posts.length} (с ${posts[0].id} по ${posts.at(-1).id}).`);
	console.log(write ? '\nРЕЖИМ ЗАПИСИ: черновики будут созданы.\n' : '\nРАЗВЕДКА: не пишется ничего.\n');

	const skipped = [];
	const ready = [];
	const albums = [];

	for (const post of posts) {
		if (post.members.length > 1) albums.push(post);

		const reason = skipReason(post);
		if (reason) {
			skipped.push({ id: post.id, date: post.caption.date.slice(0, 10), reason, text: squeeze(plainOf(post.caption.text_entities)).slice(0, 60) });
			continue;
		}
		ready.push(buildPost(post, { matcher }));
	}

	// ——— Пропущенное: по строке на причину, молчаливый пропуск запрещён ———
	const byReason = new Map();
	for (const s of skipped) {
		const kind = s.reason.split(' («')[0].split(' — ')[0].split(' (ссылка')[0];
		byReason.set(kind, [...(byReason.get(kind) ?? []), s]);
	}

	console.log('=== ПРОПУЩЕНО: ' + skipped.length + ' ===');
	for (const [kind, list] of byReason) {
		console.log(`\n  ${kind} — ${list.length}`);
		for (const s of list) console.log(`    ${s.id}  ${s.date}  ${s.reason}\n        «${s.text}…»`);
	}

	// ——— Дубли ———
	const fresh = [];
	const already = [];
	for (const built of ready) {
		if (known.has(built.id)) already.push({ built, slug: known.get(built.id) });
		else fresh.push(built);
	}

	console.log(`\n=== УЖЕ НА САЙТЕ, ЗАВОДИТЬ ЗАНОВО НЕ БУДЕМ: ${already.length} ===`);
	for (const a of already) console.log(`  ${a.built.id}  →  ${a.slug}`);

	// ——— Столкновения адресов ———
	const taken = new Set(readdirSync(postsDir).filter((n) => n.endsWith('.md')).map((n) => basename(n, '.md')));
	for (const built of fresh) {
		if (taken.has(built.slug)) {
			const wanted = built.slug;
			built.slug = `${built.slug}-${built.id}`;
			built.slugClash = wanted;
		}
		taken.add(built.slug);
	}

	// ——— Таблица ———
	console.log(`\n=== РАЗОБРАНО: ${fresh.length} ===`);
	console.log('  дата        фото  категория   заголовок');
	for (const built of fresh) {
		console.log(
			`  ${built.date}  ${String(built.photos.length).padStart(4)}  ${built.category.padEnd(10)}  ${built.title || '— БЕЗ ЗАГОЛОВКА —'}`,
		);
	}

	const noTitle = fresh.filter((b) => !b.title);
	console.log(`\n=== БЕЗ ЗАГОЛОВКА: ${noTitle.length} ===`);
	for (const built of noTitle) console.log(`  ${built.id}  ${built.date}  ${built.slug}\n      «${squeeze(built.body).slice(0, 90)}…»`);

	const tails = fresh.filter((b) => b.lineTail);
	if (tails.length) {
		console.log(`\n=== ПОСЛЕ ЗАГОЛОВКА НА ТОЙ ЖЕ СТРОКЕ ОСТАЛСЯ ТЕКСТ: ${tails.length} ===`);
		console.log('  (не выброшен — стал началом тела; посмотрите, так ли это верно)');
		for (const b of tails) console.log(`  ${b.id}  «${b.title}» + «${b.lineTail.slice(0, 60)}»`);
	}

	console.log(`\n=== АЛЬБОМЫ (склеены догадкой — сверьте глазами): ${albums.length} ===`);
	for (const album of albums) {
		const reason = skipReason(album);
		console.log(
			`  ${album.caption.date.slice(0, 16).replace('T', ' ')}  №${album.id}  фото ${album.members.length}` +
				`  [${album.members.map((m) => m.id).join(',')}]${reason ? '  — пропущен: ' + reason.split(' (')[0] : ''}`,
		);
		console.log(`      «${squeeze(plainOf(album.caption.text_entities)).slice(0, 70)}…»`);
	}

	// Одинокое вложение без подписи — либо честный снимок без слов, либо
	// хвост альбома, который догадка не приросла. Второе — потеря данных,
	// поэтому такие называются отдельно, а не растворяются в общем отсеве.
	const lonely = posts.filter((p) => p.members.length === 1 && !plainOf(p.caption.text_entities).trim() && hasMedia(p.caption));
	if (lonely.length) {
		console.log(`\n=== ВЛОЖЕНИЕ БЕЗ ПОДПИСИ, НИ К КОМУ НЕ ПРИРОСШЕЕ: ${lonely.length} ===`);
		console.log('  (проверьте, не хвост ли это чужого альбома)');
		for (const p of lonely) console.log(`  ${p.id}  ${p.caption.date.slice(0, 16).replace('T', ' ')}`);
	}

	const clashes = fresh.filter((b) => b.slugClash);
	if (clashes.length) {
		console.log(`\n=== АДРЕС БЫЛ ЗАНЯТ, ДОПИСАН НОМЕР: ${clashes.length} ===`);
		for (const b of clashes) console.log(`  ${b.slugClash}  →  ${b.slug}`);
	}

	const inner = fresh.reduce((sum, b) => sum + b.innerLinks, 0);
	const photos = fresh.reduce((sum, b) => sum + b.photos.length, 0);
	console.log('\n=== ЦИФРЫ ===');
	console.log(`  разобрано постов: ${fresh.length}`);
	console.log(`  пропущено: ${skipped.length}`);
	console.log(`  уже на сайте: ${already.length}`);
	console.log(`  фотографий у разобранного: ${photos}`);
	console.log(`  ссылок внутрь канала: ${inner} (переписывать их — задача 7.3)`);
	console.log(`  подсказок по тайтлам: ${fresh.reduce((s, b) => s + b.suggested.length, 0)}`);

	if (!write) {
		console.log('\nНичего не записано. Чтобы записать — тот же запуск с ключом --write.');
		return;
	}

	// ——— Запись ———
	let written = 0;
	for (const built of fresh) {
		const files = photoIds.has(built.id) && built.photos.length ? await fetchPhotos(built, exportDir, uploadsDir) : [];

		writeFileSync(join(postsDir, `${built.slug}.md`), renderPost(built, { files }), 'utf8');
		written += 1;
	}

	console.log(`\nЗаписано черновиков: ${written}. Все с галочкой «Черновик» — на сайте не появится ни один.`);
}

// Сравнение ПУТЯМИ, а не строками адресов: `import.meta.url` кодирует русские
// буквы, а `process.argv[1]` — нет, и обычное сравнение строк не совпадает
// НИКОГДА. Скрипт при этом не падает: он молча ничего не делает и выходит
// с кодом 0 — то есть врёт ровно в сторону «всё хорошо».
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
	await main();
}
