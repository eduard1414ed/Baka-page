// ЗАЛИВКА СОБРАННОГО САЙТА НА ЗЕРКАЛО ДЛЯ РОССИИ (задача 13).
//
// Берёт готовую папку `dist/` и приводит бакет Yandex Object Storage к тому же
// виду: чего нет — кладёт, что изменилось — перезаписывает, чего быть не должно —
// стирает. Зовётся роботом `.github/workflows/mirror-sync.yml`.
//
// ПОЧЕМУ СВОЙ КОД, А НЕ ГОТОВАЯ КОМАНДА `aws s3 sync`. Она сравнивает файлы
// ПО ВРЕМЕНИ ИЗМЕНЕНИЯ, а сборка перезаписывает все 1200 файлов заново, и время
// у них всегда новое. То есть «синхронизация» заливала бы весь сайт целиком
// каждый раз — а бесплатных операций записи 10 000 в месяц, и при опубликованном
// архиве это 11 000 файлов на одну выкладку. Сравнивать надо по СОДЕРЖИМОМУ:
// у объекта в хранилище есть отпечаток (ETag), у файла на диске он считается
// за миллисекунду. Ключ `--size-only` у той же команды сравнивал бы по размеру
// и пропустил бы правку, не изменившую длину файла.
//
// ПОЧЕМУ ПУТЬ, А НЕ ПОДДОМЕН. Имя бакета с точками (`ru.bakapodcast.com`)
// в поддоменном обращении даёт `ru.bakapodcast.com.storage.yandexcloud.net`,
// и сертификат хранилища на такое имя не выписан. Поэтому адрес строится
// как `https://storage.yandexcloud.net/<бакет>/<ключ>`.
//
// ОСТОРОЖНО: ЭТОТ СКРИПТ УДАЛЯЕТ ИЗ БАКЕТА ВСЁ, ЧЕГО НЕТ В `dist/`. Так и надо —
// иначе на зеркале навсегда осталась бы админка, случайно залитая один раз.
// Но это значит, что положить в тот же бакет что-то РУКАМИ (например, видео)
// нельзя: ближайшая выкладка это сотрёт. Заведёте такое — либо отдельный бакет,
// либо здесь появится список неприкосновенных путей.
//
// Ключи берутся из окружения (секреты репозитория) и в коде не лежат никогда.

import { createHash, createHmac } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { сПовторами } from './retry.mjs';

export const BUCKET = 'ru.bakapodcast.com';
export const ENDPOINT = 'https://storage.yandexcloud.net';
export const REGION = 'ru-central1';

// Путь к папке проекта достаётся `fileURLToPath`, а не `.pathname`: в пути есть
// русские буквы, и `.pathname` вернул бы их процентами — «файла нет» про файл,
// который есть.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');

// Одновременных запросов к хранилищу. Восемь — компромисс: заливка 20 МБ одним
// файлом заняла в пробе 3,75 с, то есть узкое место не канал, а накладные
// расходы на каждый запрос.
const ПАРАЛЛЕЛЬНО = 8;

// Паузы перед повторными заходами. Короче, чем у походов к Shikimori: запросов
// здесь больше тысячи, и человек ждёт у экрана выкладки.
const ПАУЗЫ = [2000, 6000, 18000];

// ЧТО НА ЗЕРКАЛО НЕ ЕДЕТ (задача 13, пункт 4).
//
// Админка: вход в неё держит воркер на Cloudflare, и на зеркале он работать
// не будет — страница открылась бы и не пустила внутрь, то есть выглядела бы
// сломанной. Служебные куски данных рядом с ней нужны только ей самой.
// `publish-queue.json` читает воркер отложенной публикации — он тоже живёт
// на Cloudflare и ходит на основной адрес.
//
// ЭТО НЕ ТО ЖЕ, ЧТО СПИСОК В `public/robots.txt`, и списки нарочно разные.
// Там ответ на вопрос «что не показывать поисковику» — туда входит `/pagefind/`,
// без которого на зеркале не работал бы поиск по сайту. Здесь ответ на вопрос
// «чего на зеркале не должно быть вовсе».
export const НЕ_ЕДЕТ_ПРЕФИКСЫ = ['admin/', 'admin-data/'];
export const НЕ_ЕДЕТ_ФАЙЛЫ = [
	'admin-posts.json',
	'anime-fields.json',
	'anime-alias-hints.json',
	'anime-index.json',
	'publish-queue.json',
];

/** Едет ли этот файл сборки на зеркало. Ключ — путь внутри `dist/` через косые. */
export function едетНаЗеркало(key) {
	if (НЕ_ЕДЕТ_ФАЙЛЫ.includes(key)) return false;
	return !НЕ_ЕДЕТ_ПРЕФИКСЫ.some((prefix) => key.startsWith(prefix));
}

const ТИПЫ = new Map(
	Object.entries({
		html: 'text/html; charset=utf-8',
		css: 'text/css; charset=utf-8',
		js: 'text/javascript; charset=utf-8',
		mjs: 'text/javascript; charset=utf-8',
		json: 'application/json; charset=utf-8',
		webmanifest: 'application/manifest+json; charset=utf-8',
		xml: 'application/xml; charset=utf-8',
		txt: 'text/plain; charset=utf-8',
		yml: 'text/yaml; charset=utf-8',
		svg: 'image/svg+xml',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		webp: 'image/webp',
		gif: 'image/gif',
		ico: 'image/x-icon',
		woff2: 'font/woff2',
		woff: 'font/woff',
		mp4: 'video/mp4',
	}),
);

/**
 * Тип файла по расширению. Неизвестное — «просто байты»: так приезжают куски
 * поискового индекса (`.pf_fragment`, `.pf_index`, `.pf_meta`, `.pf_filter`,
 * `.pagefind`), которые движок читает сам и о типе не спрашивает.
 */
export function типФайла(key) {
	const имя = key.slice(key.lastIndexOf('/') + 1);
	const ext = имя.includes('.') ? имя.slice(имя.lastIndexOf('.') + 1).toLowerCase() : '';
	return ТИПЫ.get(ext) ?? 'application/octet-stream';
}

// Заголовок кэша ОДИН НА ВСЁ, и он списан с основного сайта, а не выдуман:
// живой bakapodcast.com отдаёт ровно это и на страницах, и на файлах стилей.
// Копия обязана вести себя как оригинал; браузер каждый раз переспрашивает,
// а хранилище отвечает «не менялось» по отпечатку — это дёшево.
const КЭШ = 'public, max-age=0, must-revalidate';

// ── Подпись запроса (AWS Signature V4) ──────────────────────────────────────

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/**
 * Часть адреса кодируется ПОСЕГМЕНТНО: косые остаются косыми, всё остальное
 * превращается в проценты. В сборке есть файлы с русскими буквами в имени
 * (`cutout/Пони-png-640w.webp`), и на них наивная подпись разошлась бы
 * с настоящим адресом — хранилище ответило бы отказом, а выглядело бы это
 * как «не те ключи».
 *
 * Пустой ключ — это сам бакет (перечисление), и адрес у него без косой на конце.
 */
export function путьВАдресе(key) {
	const части = key === '' ? [BUCKET] : [BUCKET, ...key.split('/')];
	return `/${части.map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')}`;
}

function подписать({ method, key, query = {}, body = '', contentType }) {
	const accessKey = process.env.AWS_ACCESS_KEY_ID;
	const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
	if (!accessKey || !secretKey) {
		throw new Error('нет ключей доступа: AWS_ACCESS_KEY_ID и AWS_SECRET_ACCESS_KEY пусты');
	}

	const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	const date = amzDate.slice(0, 8);
	const scope = `${date}/${REGION}/s3/aws4_request`;
	const payloadHash = sha256(body);

	const headers = {
		host: new URL(ENDPOINT).host,
		'x-amz-content-sha256': payloadHash,
		'x-amz-date': amzDate,
	};
	if (contentType) headers['content-type'] = contentType;

	const signedNames = Object.keys(headers).sort();
	const canonicalHeaders = signedNames.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
	const canonicalQuery = Object.keys(query)
		.sort()
		.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
		.join('&');

	const canonicalRequest = [
		method,
		путьВАдресе(key),
		canonicalQuery,
		canonicalHeaders,
		signedNames.join(';'),
		payloadHash,
	].join('\n');

	const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
	let signing = hmac(`AWS4${secretKey}`, date);
	for (const part of [REGION, 's3', 'aws4_request']) signing = hmac(signing, part);
	const signature = createHmac('sha256', signing).update(stringToSign).digest('hex');

	return {
		url: `${ENDPOINT}${путьВАдресе(key)}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
		headers: {
			...headers,
			authorization:
				`AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, ` +
				`SignedHeaders=${signedNames.join(';')}, Signature=${signature}`,
		},
	};
}

async function запрос({ method, key, query, body = '', contentType, extraHeaders = {} }) {
	const { url, headers } = подписать({ method, key, query, body, contentType });
	const response = await fetch(url, {
		method,
		headers: { ...extraHeaders, ...headers },
		body: method === 'PUT' ? body : undefined,
	});
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		const error = new Error(`${method} ${key || '(бакет)'} → ${response.status} ${text.slice(0, 300)}`);
		// Код 5xx и 429 — временные. Помечаем их так же, как сетевые сбои,
		// чтобы их ловил повтор; отказ по правам (403) повтором не лечится
		// и обязан падать сразу.
		if (response.status >= 500 || response.status === 429) error.cause = new Error('временный отказ хранилища');
		throw error;
	}
	return response;
}

const сеть = (что, назвать) => сПовторами(что, { паузы: ПАУЗЫ, назвать });

// ── Что лежит в бакете ──────────────────────────────────────────────────────

export const изXML = (s) =>
	s
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

/**
 * ОТПЕЧАТОК ВЫНИМАЕТСЯ ПОИСКОМ ШЕСТНАДЦАТИРИЧНОГО ЧИСЛА, А НЕ СНЯТИЕМ КАВЫЧЕК.
 *
 * Наступили в первый же прогон. Кавычки вокруг отпечатка хранилище пишет
 * числовой записью (`&#34;`), а не именной (`&quot;`), и снятие именных
 * оставляло `&#34;13ee…&#34;` — то есть не совпадало НИ С ЧЕМ. Робот честно
 * доложил «изменилось 1227 файлов из 1274» и перезалил бы весь сайт целиком
 * при каждой сборке: 1274 операции записи вместо десятка, а бесплатных 10 000
 * в месяц. Поломка при этом выглядела как обычная работа.
 *
 * Отпечаток многочастной загрузки (`abc…-3`) с обычным MD5 не сравним — такой
 * объект считаем изменившимся и перезаливаем. Своих многочастных загрузок
 * мы не делаем, случиться это может только с чужой.
 */
export function отпечатокИзXML(etag) {
	return изXML(etag ?? '')
		.match(/[0-9a-f]{32}(?:-\d+)?/i)?.[0]
		.toLowerCase() ?? '';
}

/** Разобрать один ответ перечисления. Чистая функция — её можно спросить подлогом. */
export function разобратьПеречисление(xml) {
	const объекты = new Map();
	for (const block of xml.split('<Contents>').slice(1)) {
		const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
		if (key === undefined) continue;
		объекты.set(изXML(key), отпечатокИзXML(block.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1]));
	}
	const дальше = /<IsTruncated>true<\/IsTruncated>/.test(xml)
		? изXML(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '')
		: undefined;
	return { объекты, дальше };
}

/** Перечислить бакет целиком. Возвращает карту «ключ → отпечаток». */
export async function перечислитьБакет() {
	const объекты = new Map();
	let token;
	let запросов = 0;
	do {
		const query = { 'list-type': '2', 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) };
		const response = await сеть(() => запрос({ method: 'GET', key: '', query }), 'перечисление бакета');
		запросов++;
		const { объекты: порция, дальше } = разобратьПеречисление(await response.text());
		for (const [key, отпечаток] of порция) объекты.set(key, отпечаток);
		token = дальше;
	} while (token);
	return { объекты, запросов };
}

// ── Что лежит в сборке ──────────────────────────────────────────────────────

async function собратьФайлы(dir = DIST, prefix = '') {
	const файлы = [];
	for (const item of await readdir(dir, { withFileTypes: true })) {
		const key = `${prefix}${item.name}`;
		if (item.isDirectory()) файлы.push(...(await собратьФайлы(join(dir, item.name), `${key}/`)));
		else if (item.isFile()) файлы.push(key);
	}
	return файлы;
}

const наДиске = (key) => join(DIST, ...key.split('/'));

// ── Решение, что делать ─────────────────────────────────────────────────────

/**
 * Сравнить сборку с бакетом. Чистая функция: ни сети, ни диска — поэтому
 * её можно спросить подлогами (`scripts/mirror-sync.test.mjs`).
 *
 * @param {Map<string,string>} местные  — ключ → отпечаток файла в `dist/`
 * @param {Map<string,string>} вБакете  — ключ → отпечаток объекта в бакете
 */
export function решить(местные, вБакете) {
	const залить = [];
	const стереть = [];
	let совпало = 0;
	for (const [key, отпечаток] of местные) {
		const было = вБакете.get(key);
		if (было === отпечаток) совпало++;
		else залить.push({ key, новый: было === undefined });
	}
	for (const key of вБакете.keys()) if (!местные.has(key)) стереть.push(key);
	return { залить, стереть, совпало };
}

/**
 * ЗАСЛОН ПРОТИВ ПУСТОЙ СБОРКИ. Сломайся сборка так, что `dist/` окажется
 * почти пустой, — обычная синхронизация честно стёрла бы зеркало целиком,
 * и выглядело бы это как успешная выкладка. Поэтому массовое удаление
 * требует явного разрешения.
 *
 * Порог двойной, и это важно: на ПЕРВОЙ выкладке в бакете лежат две заглушки,
 * и одну из них (`error.html`) сборка не делает — то есть стирается половина
 * бакета, а беды нет никакой. Одна доля тут заперла бы работу сразу.
 */
export function удалениеПодозрительно(сколькоСтираем, сколькоВБакете) {
	return сколькоСтираем > 20 && сколькоСтираем > сколькоВБакете * 0.25;
}

/**
 * ЗАСЛОН ПРОТИВ СЛОМАННОГО СРАВНЕНИЯ. Полный бакет, в котором не совпал
 * НИ ОДИН файл, — это почти наверняка не «изменилось всё», а сломанное
 * сравнение: так себя повело снятие кавычек с отпечатка в первый же прогон.
 * Отличить это от настоящей работы по отчёту нельзя — робот пишет бодрые
 * строчки и тратит тысячу операций записи вместо десятка, месяц за месяцем.
 *
 * Порог по размеру бакета, а не по доле: на первой выкладке бакет пуст,
 * и «не совпало ничего» там — норма.
 */
export function сравнениеПодозрительно(совпало, сколькоВБакете) {
	return сколькоВБакете > 100 && совпало === 0;
}

// ── Работа ──────────────────────────────────────────────────────────────────

async function параллельно(items, worker, сколько = ПАРАЛЛЕЛЬНО) {
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(сколько, items.length) }, async () => {
			while (i < items.length) await worker(items[i++]);
		}),
	);
}

async function main() {
	const args = process.argv.slice(2);
	const dry = args.includes('--dry');
	const force = args.includes('--force');
	const forceDelete = args.includes('--force-delete');
	const начало = Date.now();

	const все = await собратьФайлы();
	const ключи = все.filter(едетНаЗеркало).sort();
	console.log(
		`В сборке файлов: ${все.length}. На зеркало едет ${ключи.length}, ` +
			`не едет ${все.length - ключи.length} — админка и её служебные данные.`,
	);

	if (!ключи.includes('index.html')) {
		throw new Error('в сборке нет index.html — это не собранный сайт, заливать нечего');
	}

	const местные = new Map();
	let байт = 0;
	for (const key of ключи) {
		const body = await readFile(наДиске(key));
		местные.set(key, createHash('md5').update(body).digest('hex'));
		байт += body.length;
	}
	console.log(`Вес: ${(байт / 1024 / 1024).toFixed(1)} МБ.`);

	const { объекты: вБакете, запросов: перечислений } = await перечислитьБакет();
	console.log(`В бакете сейчас объектов: ${вБакете.size}, перечисление заняло запросов: ${перечислений}.`);

	const { залить: посчитано, стереть, совпало } = решить(местные, вБакете);
	const залить = force ? [...местные.keys()].map((key) => ({ key, новый: !вБакете.has(key) })) : посчитано;
	if (force) console.log('Ключ --force: перезаливаем всё, даже совпавшее.');

	if (сравнениеПодозрительно(совпало, вБакете.size) && !force) {
		throw new Error(
			`СТОП: в бакете ${вБакете.size} объектов, и не совпал НИ ОДИН. Так выглядит не выкладка, ` +
				'а сломанное сравнение отпечатков — оно тратило бы тысячу операций записи каждый раз. ' +
				'Если перезалить всё правда надо — ключ --force.',
		);
	}

	if (удалениеПодозрительно(стереть.length, вБакете.size) && !forceDelete) {
		throw new Error(
			`СТОП: под удаление попало ${стереть.length} объектов из ${вБакете.size}. ` +
				'Похоже на сломанную сборку, а не на выкладку. Если это правда нужно — ключ --force-delete.',
		);
	}

	const новых = залить.filter((x) => x.новый).length;
	console.log(
		`Решение: залить ${залить.length} (новых ${новых}, изменившихся ${залить.length - новых}), ` +
			`стереть ${стереть.length}, не трогать ${force ? 0 : совпало}.`,
	);

	if (dry) {
		console.log('\nКлюч --dry: НИЧЕГО НЕ ЗАПИСАНО, это только подсчёт.');
		итог({ залито: 0, стёрто: 0, перечислений, начало });
		return;
	}

	let залито = 0;
	await параллельно(залить, async ({ key }) => {
		const body = await readFile(наДиске(key));
		await сеть(
			() => запрос({ method: 'PUT', key, body, contentType: типФайла(key), extraHeaders: { 'cache-control': КЭШ } }),
			`заливка ${key}`,
		);
		залито++;
		if (залито % 100 === 0) console.log(`  залито ${залито} из ${залить.length}…`);
	});

	let стёрто = 0;
	await параллельно(стереть, async (key) => {
		await сеть(() => запрос({ method: 'DELETE', key }), `удаление ${key}`);
		стёрто++;
		console.log(`  стёрто лишнее: ${key}`);
	});

	итог({ залито, стёрто, перечислений, начало });
}

function итог({ залито, стёрто, перечислений, начало }) {
	const сек = ((Date.now() - начало) / 1000).toFixed(1);
	console.log('');
	console.log(`ОПЕРАЦИЙ ЗАПИСИ: ${залито + стёрто} (заливок ${залито}, удалений ${стёрто}).`);
	console.log(`Операций чтения (перечисление бакета): ${перечислений}.`);
	console.log(`Заняло: ${сек} с.`);
}

// Русские буквы в пути к проекту `import.meta.url` кодирует, а `process.argv[1]`
// нет — строчное сравнение не совпало бы НИКОГДА, и скрипт молча ничего
// не делал бы. Поэтому сравниваем путями.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().catch((error) => {
		console.error(`\n✗ ЗАЛИВКА НА ЗЕРКАЛО НЕ ВЫШЛА: ${error.message}`);
		process.exit(1);
	});
}
