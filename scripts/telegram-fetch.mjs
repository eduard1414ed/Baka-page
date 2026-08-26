#!/usr/bin/env node
// РЕГУЛЯРНЫЙ ИМПОРТ НОВЫХ ПОСТОВ КАНАЛА (тз/тз-7.6-регулярный-импорт.md).
//
// Вышел пост в канале — через несколько часов он лежит в черновиках на сайте.
// Сам на сайт не попадает: публикует заказчик.
//
//   --write            записать черновики; без него — разведка и отчёт
//   --token=…          токен бота (или переменная окружения TG_BOT_TOKEN)
//   --notify=<файл>    текст письма, если что-то требует внимания
//   --posts=<папка>    где посты (по умолчанию src/content/posts)
//   --uploads=<папка>  куда картинки (по умолчанию public/images/uploads)
//   --state=<файл>     отметка о забранном (по умолчанию src/data/telegramFeed.mjs)
//   --no-bot           не спрашивать бота (только страница канала)
//   --no-web           не сверяться со страницей канала
//   --updates=<файл>   ответ бота из файла — для проверок, вместо сети
//   --page=<файл>      страница канала из файла — для проверок, вместо сети
//
// ДВА ИСТОЧНИКА, ОСНОВНОЙ И ЗАПАСНОЙ.
//
// Бот — основной. Он добавлен администратором в канал и получает каждый новый
// пост со всей разметкой и с ПРИЗНАКОМ АЛЬБОМА: телеграм сам говорит, какие
// снимки принадлежат одному посту. Склейка-догадка, из-за которой в задаче 7.5
// оторвались 95 фотографий у 28 альбомов, здесь не нужна вовсе.
//
// Страница канала — запасной. Телеграм держит невыданное боту около суток,
// а робот ходит раз в шесть часов: запас четырёхкратный. Но пропусти робот
// двое суток подряд — для бота посты потеряны навсегда, и тогда добирать их
// приходится со страницы. Поэтому страница спрашивается КАЖДЫЙ РАЗ, даже когда
// бот отработал: «ничего не найдено» — это подозрительный ответ, а не хороший.
//
// РАЗБОР — ТЕМ ЖЕ КОДОМ, ЧТО У АРХИВА. Здесь нет ни одного правила о том, что
// такое заголовок, что такое анонс, какая у поста категория и куда встают
// картинки: всё это берётся из scripts/telegram-import.mjs, которым привезены
// полторы тысячи постов. Оба источника приводятся к форме выгрузки Telegram
// Desktop переходниками (src/lib/telegramBotUpdate.mjs, telegramWebPost.mjs),
// и дальше разница между ними кончается. Вторая копия правил разъехалась бы
// молча, и новые посты стали бы отличаться от привезённых.
//
// ТОКЕН НЕ ПОПАДАЕТ НИ В ОДНУ СТРОКУ ВЫВОДА. Он стоит в самом адресе запроса
// (`api.telegram.org/bot<токен>/…`), поэтому любая ошибка сети норовит напечатать
// его в журнал сборки, а журнал виден всем, у кого есть ссылка. Всё, что уходит
// в вывод, проходит через `hideToken`.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
	buildPost,
	knownIds,
	renderPost,
	frontmatterProblems,
	skipReason,
	photosOf,
	plainOf,
} from './telegram-import.mjs';
import { splitFrontmatter, field, setField, unquote } from './telegram-photos.mjs';
import { botMessageToExport } from '../src/lib/telegramBotUpdate.mjs';
import { parseChannelPage } from '../src/lib/telegramWebPost.mjs';
import { photoFileName, photoSrc, withPhotos, savePhoto } from '../src/lib/telegramPhotos.mjs';
import { buildAnimeMatcher } from '../src/lib/animeMentions.mjs';
import { сроком } from './retry.mjs';
// Числительное — один код на весь проект: «1 пост», «4 поста», «5 постов».
// Своё «пост / постов» на две формы врало ровно там, где робот и говорит:
// на четырёх постах, добранных со страницы.
import { withCount } from '../src/lib/plural.mjs';

const CHANNEL = 'podcastbaka';
const API = 'https://api.telegram.org';

// За один заход берём не больше сотни обновлений и НЕ ЛИСТАЕМ дальше.
// Листать пришлось бы с подтверждением каждой страницы, то есть подтверждая
// то, что ещё не записано, — ровно тот размен, ради которого отметка вообще
// лежит в репозитории. Сотня обновлений это десяток постов с альбомами;
// при заходе раз в шесть часов такого не бывает, а если вдруг случится —
// остаток приедет следующим заходом, и робот об этом скажет.
const BATCH = 100;

// Альбом, чей последний снимок пришёл только что, может быть ещё не целым:
// телеграм выдаёт снимки по одному, и заход мог попасть в середину отправки.
// Такую пачку придерживаем до следующего раза — она никуда не денется, потому
// что подтверждение очереди останавливается перед ней.
//
// Две минуты — с огромным запасом: снимки одного альбома расходятся во времени
// не больше чем на две секунды (замер архива, задача 7.1).
const HOLD_SECONDS = 120;

// Молчание дольше этого срока — повод сказать вслух, даже если постов правда
// не было. За проект проверки врали в сторону «всё хорошо» шесть раз.
const SILENCE_DAYS = 7;

// СКОЛЬКО ЖДАТЬ, ПЕРЕСПРАШИВАЯ БОТА. Обычный вопрос задаётся без ожидания
// (`timeout: 0`): что лежит в очереди — то и отдай. Но 25 и 26 августа 2026
// подряд вышло так, что пост уже висел на странице канала, а в очереди бота
// его ещё не было: №4163 вышел в 07:01 и приехал боту только к 14:02, №4165
// вышел в 07:01 и в 08:02 очереди не достиг, зато лежал в ней в 09:30.
// Поэтому там, где страница показывает то, чего бот не принёс, вопрос
// повторяется с ожиданием: телеграм отвечает сразу, как только обновление
// появится, и молчит эти секунды, только если его правда нет.
//
// ДВАДЦАТЬ, А НЕ ТРИДЦАТЬ, — потому что срок одного похода в чужой сервис
// в проекте один и равен тридцати секундам (`ТАЙМАУТ` в retry.mjs): попроси
// мы у телеграма ждать столько же, ожидание и срок сошлись бы в одну точку,
// и обычное «новостей нет» изредка обрывалось бы по сроку, то есть выглядело
// сбоем связи. Десять секунд запаса эту встречу разводят.
//
// ЦЕНА. Вопрос задаётся не чаще раза за заход и только когда есть что искать,
// то есть добавляет не больше двадцати секунд четырежды в сутки. Считать это
// надо каждый раз, когда куда-то дописывается ожидание: в проекте уже было,
// что три верных починки сложились в «сборка идёт 346 минут».
const WAIT_SECONDS = 20;

// ——— Токен не должен попасть в вывод ———

export const hideToken = (text, token) => (token ? String(text).split(token).join('<токен>') : String(text));

// ——— Отметка о забранном ———

export function readState(file) {
	const empty = { offset: 0, lastSeenId: 0, lastPostAt: null, lastRunAt: null, albums: {} };
	if (!existsSync(file)) return empty;
	const raw = readFileSync(file, 'utf8');
	const match = raw.match(/export const telegramFeed = ([\s\S]*?);\s*$/);
	if (!match) throw new Error(`Не могу прочитать отметку ${file}: в файле нет «export const telegramFeed = {…}»`);
	return { ...empty, ...JSON.parse(match[1]) };
}

/**
 * Записать отметку, сохранив пояснение в начале файла.
 *
 * Пояснение занимает три десятка строк и стоит дороже самих данных: оно
 * отвечает на вопрос «почему очередь подтверждается только после записи»,
 * а ответ на него неочевиден и оплачен размышлением. Переписывать файл целиком
 * значило бы стирать его при каждом заходе робота.
 */
export function writeState(file, state) {
	const head = existsSync(file) ? readFileSync(file, 'utf8').split('export const telegramFeed =')[0] : '';
	writeFileSync(file, `${head}export const telegramFeed = ${JSON.stringify(state, null, '\t')};\n`, 'utf8');
}

// ——— Разговор с телеграмом ———

async function callApi(token, method, params = {}) {
	const url = `${API}/bot${token}/${method}`;
	let response;
	try {
		response = await fetch(url, сроком({
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(params),
		}));
	} catch (error) {
		throw new Error(`не удалось достучаться до телеграма (${method}): ${hideToken(error.message, token)}`);
	}

	const data = await response.json().catch(() => null);
	if (!data?.ok) {
		// 409 — у бота уже кто-то забирает обновления или ему назначено
		// постоянное соединение. Очередь одна на всех, и обновление выдаётся
		// ровно один раз: молча пропускать посты робот не имеет права.
		const why = data?.description ?? `ответ ${response.status}`;
		throw new Error(`телеграм отказал (${method}): ${hideToken(why, token)}`);
	}
	return data.result;
}

/**
 * Новые посты канала. Очередь НЕ подтверждается — это делает следующий заход.
 *
 * `wait` — сколько секунд телеграму держать вопрос, если отвечать пока нечем.
 * Ноль (обычный заход) значит «отдай что есть и не задерживай».
 */
async function getUpdates(token, offset, wait = 0) {
	return callApi(token, 'getUpdates', {
		offset,
		limit: BATCH,
		timeout: wait,
		allowed_updates: ['channel_post', 'edited_channel_post'],
	});
}

/** Скачать файл телеграма во временную папку. */
async function downloadBotFile(token, fileId, dir) {
	const info = await callApi(token, 'getFile', { file_id: fileId });
	const url = `${API}/file/bot${token}/${info.file_path}`;
	const response = await fetch(url, сроком());
	if (!response.ok) throw new Error(`файл не отдался (код ${response.status})`);
	const to = join(dir, basename(info.file_path));
	writeFileSync(to, Buffer.from(await response.arrayBuffer()));
	return to;
}

/** Скачать картинку со страницы канала (запасной путь). */
async function downloadWebFile(url, dir, index) {
	const response = await fetch(url, сроком());
	if (!response.ok) throw new Error(`файл не отдался (код ${response.status})`);
	const to = join(dir, `web-${index}.jpg`);
	writeFileSync(to, Buffer.from(await response.arrayBuffer()));
	return to;
}

// ——— Сообщения → посты ———

/**
 * Обновления бота → сообщения в форме выгрузки, плюс номера отредактированных.
 *
 * ПРАВКА ПОСТА, КОТОРЫЙ ЕЩЁ НЕ ЗАПИСАН, ПРИМЕНЯЕТСЯ МОЛЧА, а правка того, что
 * уже лежит на сайте, — только строчкой в письме. Автор чинит опечатку через
 * минуту после выхода поста, и обе версии приезжают одним заходом: применить
 * правку тут очевидно правильно. Но если пост уже неделю лежит черновиком,
 * заказчик мог править его в админке своими руками — накати мы поверх текст
 * из канала, его работа пропала бы, и узнать об этом было бы неоткуда.
 */
export function readUpdates(updates) {
	const fresh = new Map();
	const edited = [];

	for (const update of updates) {
		const message = update.channel_post ?? update.edited_channel_post ?? null;
		if (!message) continue;
		// Правка поста, приехавшего этим же заходом, побеждает первую версию.
		if (update.edited_channel_post && !fresh.has(message.message_id)) {
			edited.push(message.message_id);
			continue;
		}
		fresh.set(message.message_id, botMessageToExport(message));
	}

	return { messages: [...fresh.values()].sort((a, b) => a.id - b.id), edited };
}

const hasText = (message) => Boolean(plainOf(message.text_entities).trim());

/**
 * Посты из сообщений бота.
 *
 * ЗДЕСЬ НЕТ НИКАКОЙ ДОГАДКИ, и в этом вся разница с архивом. В выгрузке альбом
 * ничем не помечен, и границы пачки приходится восстанавливать по времени
 * и номеру (`groupAlbums` в telegram-import.mjs, пороги выведены замером).
 * Бот присылает `media_group_id` — телеграм сам говорит, какие снимки одного
 * поста. Сверять эти два ответа стоит: если догадка когда-нибудь разойдётся
 * с истиной на живом посте, узнать об этом лучше здесь, чем на архиве.
 *
 * Номер поста — номер сообщения С ПОДПИСЬЮ, как и в архиве после задачи 7.5.
 * Подпись у альбома ровно одна, и лежать она может не на первом снимке.
 */
export function groupByMediaGroup(messages) {
	const posts = [];
	const byGroup = new Map();

	for (const message of messages) {
		const group = message.media_group_id ?? null;
		const known = group ? byGroup.get(group) : null;

		if (known) {
			known.members.push(message);
			if (!hasText(known.caption) && hasText(message)) {
				known.caption = message;
				known.id = message.id;
			}
			continue;
		}

		const post = { id: message.id, members: [message], caption: message, mediaGroupId: group };
		posts.push(post);
		if (group) byGroup.set(group, post);
	}

	for (const post of posts) post.members.sort((a, b) => a.id - b.id);
	return posts;
}

/**
 * Пачка, которая может быть ещё не целой.
 *
 * Признак — у альбома есть снимок, отправленный меньше двух минут назад:
 * значит заход мог попасть в середину отправки, и остаток придёт следом.
 * Пост из половины альбома хуже поста, приехавшего на шесть часов позже:
 * половина выглядит целой, и заметить пропажу некому.
 */
export function isUnsettled(post, nowUnix) {
	if (post.members.length < 2 && !post.mediaGroupId) return false;
	const newest = Math.max(...post.members.map((m) => Number(m.date_unixtime)));
	return nowUnix - newest < HOLD_SECONDS;
}

// ——— Решения робота ———
//
// Всё, что робот РЕШАЕТ, вынесено сюда отдельными функциями, и вынесено
// нарочно. Пока такое решение сидит внутри `main`, спросить его можно только
// полным прогоном — с сетью, токеном и записью файлов, — а значит уронить его
// подлогом нельзя, и «проверок нет» становится незаметно. Урок задачи 7.3:
// правило, вынесенное из хука отдельной функцией, спрашивается пятью
// выдуманными случаями за миллисекунду.

/**
 * Что делать с каждым постом: пропустить, узнать своим, дописать в альбом
 * или разобрать.
 *
 * ПОРЯДОК ВОПРОСОВ ЗДЕСЬ ВАЖЕН, и первый из них — не отсев. Снимки, чья пачка
 * уже завелась постом раньше, приходят БЕЗ ПОДПИСИ: спроси мы сначала правила
 * отсева, они вылетели бы как «сообщение без текста», и половина альбома
 * пропала бы молча, а пост выглядел бы целым.
 */
export function classify(posts, { known, albums, matcher = [] }) {
	const skipped = [];
	const already = [];
	const addToAlbum = [];
	const ready = [];

	for (const { post, from } of posts) {
		const home = post.mediaGroupId ? albums[post.mediaGroupId] : null;
		if (home && !hasText(post.caption)) {
			addToAlbum.push({ post, home, from });
			continue;
		}

		const reason = skipReason(post);
		if (reason) {
			skipped.push({
				id: post.id,
				from,
				reason,
				text: plainOf(post.caption.text_entities).replace(/\s+/g, ' ').trim().slice(0, 60),
			});
			continue;
		}
		if (known.has(post.id)) {
			already.push({ id: post.id, slug: known.get(post.id) });
			continue;
		}
		ready.push({ post, from, built: buildPost(post, { matcher }) });
	}

	return { skipped, already, addToAlbum, ready };
}

/**
 * Посты со страницы канала, которые бот пропустил.
 *
 * ВОПРОС ЗДЕСЬ РОВНО ОДИН: есть ли на странице сообщение новее всего, что робот
 * когда-либо видел, и которого бот в этот раз не принёс. Сравнивать с тем, что
 * ИМПОРТИРОВАНО, нельзя: по правилам не импортируется примерно четверть постов
 * канала (анонсы, репосты, видео), и такая сверка ругалась бы каждый заход,
 * то есть перестала бы значить что-либо через две недели.
 */
export function missedOnPage(webPosts, { lastSeenId, botSeen, known }) {
	return webPosts.filter(
		(post) =>
			post.members.some((m) => m.id > lastSeenId) && !post.members.some((m) => botSeen.has(m.id)) && !known.has(post.id),
	);
}

/**
 * ПЕРЕСПРОСИТЬ БОТА, КОГДА СТРАНИЦА ПОКАЗЫВАЕТ ТО, ЧЕГО ОН НЕ ПРИНЁС.
 *
 * ЗАЧЕМ. Запасной путь работает и без этого — со страницы пост заберётся
 * и разберётся тем же кодом. Но картинки со страницы берутся в том размере,
 * в каком их показывает страница, а бот отдаёт исходник. Двадцать секунд
 * ожидания дешевле, чем пост с картинкой похуже, и гораздо дешевле, чем
 * письмо о пропаже, из-за которого идут искать поломку (25 и 26 августа 2026
 * такое письмо приходило дважды, а виноват был не робот и не бот).
 *
 * СПРАШИВАЕМ РОВНО ТОГДА, КОГДА ЕСТЬ ЧТО ИСКАТЬ. Не «всегда с ожиданием»:
 * при обычном заходе искать нечего, и ожидание стало бы четырьмя минутами
 * молчания в сутки ни за чем.
 *
 * ОТВЕТ СКЛЕИВАЕТСЯ ПО НОМЕРУ ОБНОВЛЕНИЯ, А НЕ ДОПИСЫВАЕТСЯ. Второй вопрос
 * задаётся с ТЕМ ЖЕ номером, с которого спрашивали в первый раз, — значит
 * телеграм отдаёт всё прежнее заново. Дописав ответ как есть, робот завёл бы
 * каждый пост дважды.
 *
 * @param {any[]} updates    — что принёс первый вопрос
 * @param {object} как
 * @param {any[]} как.missed — посты со страницы, которых у бота нет
 * @param {(wait: number) => Promise<any[]>} [как.ask] — как спросить ещё раз
 * @param {(text: string) => void} [как.say]
 */
export async function askAgainForMissed(updates, { missed, ask, say = console.log }) {
	if (!missed.length || !ask) return { updates, askedAgain: false, arrived: [] };

	say(
		`\nСтраница показывает ${withCount(missed.length, ['пост', 'поста', 'постов'])}, которых бот не принёс ` +
			`(${missed.map((p) => '№' + p.id).join(', ')}) — переспрашиваю бота с ожиданием ${WAIT_SECONDS} с.`,
	);

	const more = await ask(WAIT_SECONDS);
	const seen = new Set(updates.map((u) => u.update_id));
	const arrived = more.filter((u) => !seen.has(u.update_id));

	say(
		arrived.length
			? `Со второго вопроса бот отдал ${arrived.length}: беру у него, а не со страницы.`
			: 'Со второго вопроса бот не отдал ничего — добираю со страницы.',
	);

	return {
		updates: [...updates, ...arrived].sort((a, b) => a.update_id - b.update_id),
		askedAgain: true,
		arrived,
	};
}

/**
 * С какого мгновения считать молчание бота.
 *
 * ЗДЕСЬ БЫЛА ДЫРА, И РОВНО ТА, ОТ КОТОРОЙ ЗАЩИЩАЛО САМО ПРАВИЛО. Отметка
 * ставилась, только когда бот что-то принёс, — а значит у бота, который
 * не приносил НИ РАЗУ (выкинули из канала, не выдали прав, завели второго
 * читателя очереди), считать было не от чего, и предупреждение «молчит дольше
 * недели» не сработало бы никогда. То есть заслон против ответа «ничего
 * не найдено» сам молчал бы в самом плохом случае.
 *
 * Поэтому при первом же заходе отметка ставится всё равно: с этого мгновения
 * и пойдёт отсчёт.
 */
export function markLastPost(previous, gotMessages, nowISO) {
	if (gotMessages) return nowISO;
	return previous ?? nowISO;
}

/**
 * До какого обновления можно подтвердить очередь.
 *
 * Подтверждение необратимо: телеграм стирает подтверждённое. Поэтому оно
 * останавливается перед первым сообщением, с которым робот не доделал, —
 * придержанным альбомом или постом, чья картинка не приехала.
 */
export function confirmUpTo(updates, previous, pendingFrom) {
	let offset = previous;
	for (const update of updates) {
		const message = update.channel_post ?? update.edited_channel_post;
		if (message && message.message_id >= pendingFrom) break;
		offset = update.update_id + 1;
	}
	return offset;
}

/**
 * Новое значение «последнего виденного сообщения».
 *
 * ВТОРОЙ ЗАСЛОН, И ЕГО ЛЕГЧЕ ВСЕГО ЗАБЫТЬ. Мало не подтверждать очередь дальше
 * недоделанного — надо ещё не двигать за него эту отметку: по ней и только
 * по ней страница канала решает, что бот что-то пропустил. Сдвинь её вперёд —
 * и пост, потерянный по сети, не поймает уже никто.
 *
 * Обрезка сверху, а не отбрасывание: иначе отметка откатилась бы назад,
 * и запасной путь принялся бы разбирать заново весь экран канала.
 */
export function seenUpTo(previous, ids, pendingFrom) {
	const below = ids.filter((id) => Number.isFinite(id) && id < pendingFrom);
	return Math.min(Math.max(previous, 0, ...below), pendingFrom - 1);
}

// ——— Дособирание разорванного альбома ———

/**
 * Снимки, приехавшие к УЖЕ ЗАВЕДЁННОМУ посту, дописать в него.
 *
 * КОГДА ЭТО СРАБАТЫВАЕТ. Альбом может разорваться между заходами: часть снимков
 * телеграм выдал сейчас, часть — через шесть часов. Придерживание свежих пачек
 * закрывает обычный случай, но не всякий: обновления могли прийти двумя порциями
 * и без спешки. Тогда вторая половина приходит БЕЗ ПОДПИСИ, и без этой ветки
 * она вылетела бы в отсев как «сообщение без текста» — то есть снимки пропали бы
 * молча, а пост остался бы с половиной альбома и выглядел бы целым.
 *
 * ОПУБЛИКОВАННЫЙ ПОСТ НЕ ТРОГАЕТСЯ ВОВСЕ — правило проекта сильнее пользы.
 * Правка идёт СТРОКАМИ, тем же способом, что у робота 7.2: пересобери мы файл
 * своим кодом, расхождение хоть в пробеле дало бы правку на весь файл при первом
 * же сохранении в админке.
 */
export function appendPhotos(file, srcs, allPhotoIds) {
	const raw = readFileSync(file, 'utf8');
	const parts = splitFrontmatter(raw);
	if (!parts) return { trouble: 'файл поста не разбирается на шапку и тело' };
	if (unquote(field(parts.head, 'draft')) !== 'true') return { trouble: 'пост опубликован — такие не трогаем вовсе' };

	// Обложку ставим по тому же правилу, что робот 7.2: только если её нет
	// и приехал именно первый снимок пачки. Своя обложка сильнее догадки.
	const cover = unquote(field(parts.head, 'cover'));
	const intoCover = !cover && srcs.length > 0 && srcs[0] === photoSrc(allPhotoIds[0]);
	const built = withPhotos(parts.body.trim(), srcs, { intoCover });

	let head = parts.head;
	if (built.cover) head = setField(head, 'cover', built.cover);
	writeFileSync(file, `---\n${head}\n---\n\n${built.text}\n`, 'utf8');
	return { added: srcs.length };
}

// ——— Запуск ———

function arg(name, fallback = null) {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
	// fileURLToPath, а не .pathname: в пути к проекту русские буквы и пробел,
	// и .pathname отдаёт их закодированными — такой путь не открывается ничем,
	// а ошибка выглядит как «файла нет».
	const root = fileURLToPath(new URL('..', import.meta.url));
	const postsDir = arg('posts', join(root, 'src/content/posts'));
	const uploadsDir = arg('uploads', join(root, 'public/images/uploads'));
	const stateFile = arg('state', join(root, 'src/data/telegramFeed.mjs'));
	const notifyFile = arg('notify');
	const write = has('write');
	const token = arg('token', process.env.TG_BOT_TOKEN ?? '');

	const state = readState(stateFile);
	const nowUnix = Math.floor(Date.now() / 1000);
	// Что требует внимания заказчика. Пусто — письма не будет вовсе: письмо
	// «всё хорошо» через неделю перестают читать вместе с остальными.
	const attention = [];

	console.log(`Канал: t.me/${CHANNEL}`);
	console.log(`Отметка: подтверждено до обновления ${state.offset}, последнее виденное сообщение №${state.lastSeenId}`);
	console.log(write ? '\nРЕЖИМ ЗАПИСИ.\n' : '\nРАЗВЕДКА: не пишется ничего.\n');

	// ——— 1. Что принёс бот ———
	//
	// Вопрос вынесен отдельной функцией, потому что задавать его приходится
	// дважды: второй раз — с ожиданием, если страница канала покажет то, чего
	// бот не принёс. Ошибка ловится ЗДЕСЬ и превращается в пустой ответ:
	// молчащий бот не повод бросать заход, у запасного пути своя дорога.
	// В письмо она уходит один раз, сколько бы вопросов задано ни было.

	let botFailed = null;
	const askBot = async (wait) => {
		try {
			if (arg('updates')) return JSON.parse(readFileSync(arg('updates'), 'utf8'));
			if (!token) throw new Error('токена нет: нужен ключ --token= или переменная TG_BOT_TOKEN');
			return await getUpdates(token, state.offset, wait);
		} catch (error) {
			const why = hideToken(error.message, token);
			console.error(`БОТ НЕ ОТВЕТИЛ: ${why}`);
			if (!botFailed) attention.push(`**Бот не ответил.** ${why}`);
			botFailed = why;
			return [];
		}
	};

	let updates = has('no-bot') ? [] : await askBot(0);
	console.log(`Бот принёс обновлений: ${updates.length}`);

	// ——— 2. Страница канала: спрашиваем ВСЕГДА ———

	let webPosts = [];
	let webMax = 0;
	let webFailed = null;
	if (!has('no-web')) {
		try {
			const html = arg('page')
				? readFileSync(arg('page'), 'utf8')
				: await (async () => {
						const response = await fetch(`https://t.me/s/${CHANNEL}`, сроком());
						if (!response.ok) throw new Error(`страница канала ответила кодом ${response.status}`);
						return response.text();
					})();
			webPosts = parseChannelPage(html, { channel: CHANNEL });
			webMax = Math.max(0, ...webPosts.flatMap((p) => p.members.map((m) => m.id)));
			console.log(`Страница канала: постов ${webPosts.length}, самое новое сообщение №${webMax}`);
		} catch (error) {
			webFailed = String(error.message);
			console.error(`СТРАНИЦА КАНАЛА НЕ ПРОЧИТАЛАСЬ: ${webFailed}`);
			attention.push(`**Страница канала не прочиталась.** ${webFailed} Сверить, не пропустил ли бот посты, в этот раз не вышло.`);
		}
	}

	const known = knownIds(postsDir);

	// ——— 3. Чего бот не принёс — и второй вопрос с ожиданием ———
	//
	// Разбор ответа бота собран в одну функцию нарочно: после второго вопроса
	// его надо повторить ЦЕЛИКОМ. Пересчитай мы половину — придержанный альбом
	// или список отредактированных разъехались бы с остальным, и молча.

	const readBot = (list) => {
		const { messages, edited } = readUpdates(list);
		const all = groupByMediaGroup(messages);
		const held = all.filter((post) => isUnsettled(post, nowUnix));
		return {
			messages,
			edited,
			posts: all.filter((post) => !held.includes(post)),
			held,
			// Что бот принёс сам — включая придержанное: оно не потеряно,
			// а отложено, и запасным путём добирать его не надо.
			seen: new Set(all.flatMap((post) => post.members.map((m) => m.id))),
		};
	};

	let bot = readBot(updates);
	let missed = missedOnPage(webPosts, { lastSeenId: state.lastSeenId, botSeen: bot.seen, known });

	// Из файла (`--updates=`) второй вопрос вернул бы тот же файл, и спрашивать
	// его незачем; молчащего бота второй раз тоже не тревожим — он уже сказал.
	const again = await askAgainForMissed(updates, {
		missed,
		ask: has('no-bot') || botFailed || arg('updates') ? null : (wait) => askBot(wait),
	});
	if (again.arrived.length) {
		updates = again.updates;
		bot = readBot(updates);
		missed = missedOnPage(webPosts, { lastSeenId: state.lastSeenId, botSeen: bot.seen, known });
	}

	const { messages: botMessages, edited, posts: botPosts, held } = bot;
	console.log(
		`\nБот принёс всего обновлений: ${updates.length}, сообщений: ${botMessages.length}, ` +
			`постов после сборки альбомов: ${botPosts.length + held.length}`,
	);
	if (updates.length === BATCH) {
		const line = `Бот отдал ровно ${BATCH} обновлений — столько за раз и берём, остаток приедет следующим заходом.`;
		console.log(line);
		attention.push(`**${line}** Если такое повторится, значит робот отстаёт от канала.`);
	}
	if (held.length) {
		console.log(`Придержано до следующего захода (альбом может быть ещё не целым): ${held.map((p) => '№' + p.id).join(', ')}`);
	}

	if (missed.length) {
		console.log(`\nБОТ ПРОПУСТИЛ ${missed.length} — добираю со страницы канала: ${missed.map((p) => '№' + p.id).join(', ')}`);
		attention.push(
			`**Бот пропустил ${withCount(missed.length, ['пост', 'поста', 'постов'])}, ` +
				`${missed.length === 1 ? 'он добран' : 'они добраны'} со страницы канала:** ` +
				missed.map((p) => `[№${p.id}](https://t.me/${CHANNEL}/${p.id})`).join(', ') +
				'.\n\n' +
				(again.askedAgain ? `Бота я переспросил с ожиданием ${WAIT_SECONDS} с — он не отдал их и со второго раза. ` : '') +
				'Причины бывают три. Первая: телеграм отдал пост боту с опозданием — так было 25 и 26 августа 2026, ' +
				'пост выходил в 07:01, через час очередь бота была ещё пуста, а к обеду он в ней лежал; ' +
				'тогда всё уже в порядке, пост забран, и делать ничего не надо. Вторая: робот не ходил дольше суток ' +
				'(телеграм держит невыданное боту около суток). Третья: бота не было в канале, когда пост вышел — ' +
				'проверьте, стоит ли он в администраторах. Разметка со страницы разбирается тем же кодом, ' +
				'но картинки берутся в том размере, в каком их показывает страница, — посмотрите их глазами.',
		);
	}

	// ——— 4. «Ничего не найдено» — подозрительный ответ ———

	const silentDays = state.lastPostAt ? (Date.now() - Date.parse(state.lastPostAt)) / 86400000 : null;
	if (!botFailed && !botMessages.length && silentDays !== null && silentDays > SILENCE_DAYS) {
		const line = `Бот молчит ${Math.floor(silentDays)} ${Math.floor(silentDays) === 1 ? 'день' : 'дней'}.`;
		console.log(`\n${line}`);
		attention.push(
			`**${line}** На странице канала самое новое сообщение — №${webMax || '?'}, у меня отмечено №${state.lastSeenId}. ` +
				(webMax && webMax <= state.lastSeenId
					? 'Похоже, постов правда не было. Говорю об этом потому, что «ничего не найдено» — подозрительный ответ, а не хороший: ' +
						'так же выглядел бы бот, выкинутый из канала.'
					: 'Это уже не похоже на затишье — проверьте, стоит ли бот в администраторах канала.'),
		);
	}

	// ——— 5. Разбор ———

	const animeDir = join(root, 'src/content/anime');
	const matcher = buildAnimeMatcher(
		readdirSync(animeDir)
			.filter((n) => n.endsWith('.json'))
			.map((n) => ({ id: basename(n, '.json'), data: JSON.parse(readFileSync(join(animeDir, n), 'utf8')) })),
		// Тексты постов: галочка «только в кавычках» действует.
		{ quotes: 'apply', speech: false },
	);

	const all = [...botPosts.map((p) => ({ post: p, from: 'бот' })), ...missed.map((p) => ({ post: p, from: 'страница' }))];
	const { skipped, already, addToAlbum, ready } = classify(all, { known, albums: state.albums, matcher });

	console.log(`\n=== ПРОПУЩЕНО: ${skipped.length} ===`);
	for (const s of skipped) console.log(`  №${s.id} (${s.from})  ${s.reason}\n      «${s.text}…»`);

	console.log(`\n=== УЖЕ НА САЙТЕ: ${already.length} ===`);
	for (const a of already) console.log(`  №${a.id}  →  ${a.slug}`);

	console.log(`\n=== ДОПИСАТЬ В УЖЕ ЗАВЕДЁННЫЙ АЛЬБОМ: ${addToAlbum.length} ===`);
	for (const a of addToAlbum) console.log(`  №${a.post.id} (${a.from})  →  ${a.home.slug}`);

	// Столкновения адресов — то же правило, что у архива: дописать номер.
	const taken = new Set(readdirSync(postsDir).filter((n) => n.endsWith('.md')).map((n) => basename(n, '.md')));
	for (const item of ready) {
		if (taken.has(item.built.slug)) {
			item.clash = item.built.slug;
			item.built.slug = `${item.built.slug}-${item.built.id}`;
		}
		taken.add(item.built.slug);
	}

	console.log(`\n=== РАЗОБРАНО: ${ready.length} ===`);
	for (const item of ready) {
		console.log(
			`  №${item.built.id}  ${item.built.date}  ${item.from.padEnd(9)}  фото ${String(item.built.photos.length).padStart(2)}  ` +
				`${item.built.category.padEnd(6)}  ${item.built.title || '— БЕЗ ЗАГОЛОВКА —'}`,
		);
		if (item.clash) console.log(`      адрес был занят: ${item.clash} → ${item.built.slug}`);
	}

	// Правки постов, которые уже лежат на сайте, — только строкой, молча
	// накатывать нельзя.
	const editedKnown = edited.filter((id) => known.has(id));
	if (editedKnown.length) {
		console.log(`\n=== ОТРЕДАКТИРОВАНЫ В КАНАЛЕ, НА САЙТЕ ЛЕЖИТ ПРЕЖНИЙ ТЕКСТ: ${editedKnown.length} ===`);
		for (const id of editedKnown) console.log(`  №${id}  →  ${known.get(id)}`);
		attention.push(
			`**В канале отредактированы посты, которые уже лежат на сайте:** ` +
				editedKnown.map((id) => `[№${id}](https://t.me/${CHANNEL}/${id}) (\`${known.get(id)}\`)`).join(', ') +
				'.\n\nНа сайте у них прежний текст. Сам я его не подменяю: вы могли править этот черновик в админке, ' +
				'и правка робота затёрла бы вашу. Поправьте руками или скажите мне.',
		);
	}

	if (!write) {
		console.log('\nНичего не записано. Чтобы записать — тот же запуск с ключом --write.');
		return;
	}

	// ——— 6. Картинки ———

	const temp = mkdtempSync(join(tmpdir(), 'baka-tg-new-'));
	if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

	/**
	 * Скачать снимки поста и уменьшить. Возвращает пути в загрузках
	 * и список тех, что не приехали.
	 */
	async function fetchPhotos(post) {
		const srcs = [];
		const failed = [];
		for (const photo of photosOf(post)) {
			const target = join(uploadsDir, photoFileName(photo.id));
			// Признак «уже привезено» — сам ФАЙЛ, а не запись в посте: то же
			// правило, что у робота 7.2. Убранную руками картинку не возвращаем.
			if (existsSync(target)) {
				srcs.push(photoSrc(photo.id));
				continue;
			}
			try {
				const from = post.source === 'web' ? await downloadWebFile(photo.file, temp, photo.id) : await downloadBotFile(token, photo.file, temp);
				// УМЕНЬШЕНИЕ ДО КОММИТА: попавшее в git остаётся в его истории
				// навсегда, и «потом пережмём» не работает.
				await savePhoto(from, target);
				srcs.push(photoSrc(photo.id));
			} catch (error) {
				const why = hideToken(error.message, token);
				console.error(`  ! снимок №${photo.id} не приехал: ${why}`);
				failed.push(`№${photo.id}: ${why}`);
			}
		}
		return { srcs, failed };
	}

	// ——— 7. Заслон перед записью ———
	//
	// Вся порция собирается В ПАМЯТИ и проверяется настоящим разбором YAML,
	// и хоть одна нечитаемая шапка — не записывается НИЧЕГО. Кривая шапка роняет
	// сборку ВСЕГО САЙТА, а не один пост: Astro читает коллекцию целиком
	// и останавливается на первом нечитаемом файле. Наступили в задаче 7.5
	// на двоеточии в конце заголовка — 70 постов.

	// ПОСТ, У КОТОРОГО НЕ ПРИЕХАЛА ХОТЬ ОДНА КАРТИНКА, В ЭТОТ ЗАХОД НЕ ПИШЕТСЯ
	// ВОВСЕ, и отметка о нём не сдвигается — значит следующий заход возьмётся
	// за него заново.
	//
	// Соблазн записать «что есть, а картинки потом» силён и неправилен. Пост
	// с половиной альбома выглядит целым: заметить пропажу некому, а вернуться
	// к нему уже нельзя — по номеру он узнан как привезённый, и второй раз его
	// никто не разберёт. Пост, приехавший на шесть часов позже, но целиком,
	// дешевле поста, у которого молча не хватает трёх снимков. Уже скачанные
	// картинки при этом остаются в загрузках и во второй заход не качаются
	// заново — признак «уже привезено» это сам файл.
	const prepared = [];
	const broken = [];
	const stalled = [];
	for (const item of ready) {
		const { srcs, failed } = await fetchPhotos(item.post);
		if (failed.length) {
			stalled.push({ post: item.post, failed });
			attention.push(
				`**У поста [№${item.post.id}](https://t.me/${CHANNEL}/${item.post.id}) не приехало ${failed.length} ` +
					`${failed.length === 1 ? 'изображение' : 'изображений'}, поэтому пост не записан вовсе:**\n\n` +
					failed.map((line) => `  - ${line}`).join('\n') +
					'\n\nСледующий заход возьмётся за него заново — половина альбома выглядела бы целым постом, ' +
					'и пропажу заметить было бы некому.',
			);
			continue;
		}
		const text = renderPost(item.built, { files: srcs });
		broken.push(...frontmatterProblems(item.built, text));
		prepared.push({ ...item, text, files: srcs });
	}
	if (stalled.length) console.error(`\nНЕ ЗАПИСАНЫ ИЗ-ЗА НЕДОЕХАВШИХ КАРТИНОК: ${stalled.map((s) => '№' + s.post.id).join(', ')}`);

	if (broken.length) {
		console.error(`\nШАПКА НЕ ЧИТАЕТСЯ У ${broken.length} ПОСТОВ — НЕ ЗАПИСАНО НИЧЕГО.`);
		for (const line of broken) console.error(`  • ${line}`);
		attention.push(
			`**Шапка не читается у ${broken.length} новых постов, поэтому не записано ничего.**\n\n` +
				broken.map((line) => `- ${line}`).join('\n') +
				'\n\nТакой файл роняет сборку всего сайта, а не себя одного, поэтому порция пишется целиком или никак.',
		);
		if (notifyFile) writeNotify(notifyFile, attention);
		process.exit(1);
	}

	// ——— 8. Запись ———

	const albums = { ...state.albums };
	let written = 0;

	for (const item of prepared) {
		writeFileSync(join(postsDir, `${item.built.slug}.md`), item.text, 'utf8');
		written += 1;
		if (item.post.mediaGroupId) {
			albums[item.post.mediaGroupId] = {
				slug: item.built.slug,
				tgId: item.built.id,
				photoIds: item.built.photos.map((p) => p.id),
			};
		}
	}

	// Дописывание разорванного альбома.
	for (const { post, home } of addToAlbum) {
		const file = join(postsDir, `${home.slug}.md`);
		if (!existsSync(file)) {
			const why = `пост \`${home.slug}\` уже не лежит в репозитории`;
			console.error(`  ! №${post.id}: ${why}`);
			attention.push(`**Снимки поста [№${post.id}](https://t.me/${CHANNEL}/${post.id}) дописать некуда:** ${why}.`);
			continue;
		}
		const { srcs, failed } = await fetchPhotos(post);
		if (failed.length) {
			stalled.push({ post, failed });
			attention.push(
				`**Снимки поста [№${post.id}](https://t.me/${CHANNEL}/${post.id}) не дописаны в \`${home.slug}\`:** ` +
					`не приехало ${failed.length} из них (${failed.join('; ')}). Следующий заход попробует снова.`,
			);
			continue;
		}
		if (!srcs.length) continue;

		const allIds = [...new Set([...(home.photoIds ?? []), ...photosOf(post).map((p) => p.id)])].sort((a, b) => a - b);
		const result = appendPhotos(file, srcs, allIds);
		if (result.trouble) {
			console.error(`  ! ${home.slug}: ${result.trouble}`);
			attention.push(
				`**Снимки поста [№${post.id}](https://t.me/${CHANNEL}/${post.id}) не дописаны в \`${home.slug}\`:** ${result.trouble}.`,
			);
			continue;
		}
		console.log(`  дописано ${result.added} снимков в ${home.slug}`);
		albums[post.mediaGroupId] = { ...home, photoIds: allIds };
	}

	// Помним только последние полсотни пачек: альбом разрывается между
	// соседними заходами, а не между прошлогодними.
	const trimmed = Object.fromEntries(Object.entries(albums).slice(-50));

	// ——— 9. Отметка ———
	//
	// Записывается ПОСЛЕДНЕЙ и только теперь: до этой строки очередь у телеграма
	// не подтверждена, и сорвись робот раньше — следующий заход возьмёт те же
	// обновления заново. Дублей это не создаст: пост узнаётся по номеру.
	//
	// ОТМЕТКА НЕ ПЕРЕШАГИВАЕТ НЕДОДЕЛАННОЕ, И ЭТО ДВА РАЗНЫХ ЗАСЛОНА СРАЗУ.
	// Придержанный альбом и пост с недоехавшей картинкой обязаны приехать
	// следующим заходом, а для этого нельзя ни подтверждать очередь дальше них
	// (иначе телеграм их сотрёт), ни двигать «последнее виденное» за них (иначе
	// страница канала перестанет считать их пропущенными, и запасной путь
	// промолчит). Вторую половину легко забыть — и тогда пост, потерянный
	// по сети, не поймает уже никто.

	const pending = [...held, ...stalled.map((s) => s.post)];
	const pendingFrom = pending.length ? Math.min(...pending.flatMap((p) => p.members.map((m) => m.id))) : Infinity;
	const nextOffset = confirmUpTo(updates, state.offset, pendingFrom);
	const lastSeenId = seenUpTo(state.lastSeenId, [webMax, ...botMessages.map((m) => m.id)], pendingFrom);

	writeState(stateFile, {
		offset: nextOffset,
		lastSeenId,
		lastPostAt: markLastPost(state.lastPostAt, botMessages.length > 0, new Date().toISOString()),
		lastRunAt: new Date().toISOString(),
		albums: trimmed,
	});

	console.log(`\nЗаписано черновиков: ${written}. Все с галочкой «Черновик» — на сайте не появится ни один.`);
	console.log(`Отметка сдвинута: подтверждено до ${nextOffset}, последнее виденное сообщение №${lastSeenId}.`);
	if (pending.length) console.log(`Отложено до следующего захода: ${pending.map((p) => '№' + p.id).join(', ')}.`);

	if (notifyFile && attention.length) writeNotify(notifyFile, attention);
}

/**
 * Письмо заказчику — ТОЛЬКО когда что-то требует его внимания.
 *
 * Письма «всё хорошо» здесь нет намеренно: удачную работу видно в админке,
 * а письмо о том, что всё в порядке, через неделю перестают читать вместе
 * с письмами о том, что не в порядке.
 */
function writeNotify(file, attention) {
	const title = `Импорт из телеграма: ${attention.length} ${attention.length === 1 ? 'замечание' : 'замечаний'}`;
	writeFileSync(file, `${title}\n\n${attention.map((line) => `- ${line}`).join('\n\n')}\n`, 'utf8');
}

// Сравнение ПУТЯМИ, а не строками адресов: `import.meta.url` кодирует русские
// буквы, а `process.argv[1]` — нет, и обычное сравнение не совпадает никогда.
// Скрипт при этом не падает — он молча ничего не делает и выходит с кодом 0,
// то есть врёт ровно в сторону «всё хорошо».
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
	await main();
}
