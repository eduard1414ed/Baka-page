// ОБЩЕЕ ДЛЯ ВСЕЙ ВЕБ-АНАЛИТИКИ: ключи, походы в Метрику и Google, кэш.
//
// ГДЕ ЧТО ЛЕЖИТ И ПОЧЕМУ ИМЕННО ТАМ:
//   • код (этот файл и соседи)      — в репозитории, секретов внутри нет;
//   • ключи                         — в .env, он закрыт .gitignore строкой .env*;
//   • файл-ключ Google и все данные — В ПАПКЕ РЯДОМ С РЕПОЗИТОРИЕМ, а не внутри.
//
// Папка снаружи выбрана нарочно, а не для красоты: правило проекта «ключи
// и отчёты в репозиторий не кладём никогда» тогда не зависит от .gitignore
// вовсе. Файла, лежащего вне рабочей копии, git не увидит ни при какой
// ошибке в правилах игнорирования — а 26 августа 2026 такая ошибка уже
// случилась: резервная копия .env под прежние две строки не попала.
//
// КЭШ ОБЯЗАТЕЛЕН, И ВОТ ПОЧЕМУ. У обоих сервисов есть предел числа обращений
// (см. ниже), а вопрос «сколько было в июле» задают по многу раз. Ответ
// на завершившийся период не меняется никогда, поэтому он кладётся на диск
// и второй раз в сеть не ходит. Незавершённый период (в него входит сегодня)
// НЕ КЭШИРУЕТСЯ ВОВСЕ — иначе утренний ответ жил бы до вечера.
//
// ПРЕДЕЛЫ ОБРАЩЕНИЙ (по документации сервисов, август 2026):
//   Метрика — 5000 запросов в сутки на аккаунт, 200 к отчётам за 5 минут,
//             30 в секунду с одного адреса, 3 одновременных. Превышение — 420.
//   Google  — 200 000 «токенов» в сутки на ресурс, 40 000 в час,
//             10 одновременных. Цену каждого запроса Google возвращает сам,
//             и мы её печатаем: гадать не нужно.

import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const КОРЕНЬ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ── КЛЮЧИ ──────────────────────────────────────────────────────────────────
//
// Свой разбор .env, а не готовая библиотека: файл читают четыре программы
// проекта, и лишняя зависимость тут дороже двадцати строк. Кавычки вокруг
// значения снимаются — в GA_KEY_FILE они стоят из-за пробела в пути
// («Аналитика Баки»), и без снятия путь не открылся бы.
export function ключи() {
	const текст = readFileSync(join(КОРЕНЬ, '.env'), 'utf8');
	const карта = {};
	for (const строка of текст.split('\n')) {
		const m = строка.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!m) continue;
		let значение = m[2].trim();
		if (/^".*"$/.test(значение) || /^'.*'$/.test(значение)) значение = значение.slice(1, -1);
		карта[m[1]] = значение;
	}
	return карта;
}

const К = ключи();

/**
 * ПАПКА С ДАННЫМИ И ОТЧЁТАМИ — ВНЕ РЕПОЗИТОРИЯ.
 * Адрес берётся из .env (ANALYTICS_DIR), потому что путь содержит русские
 * буквы и пробел: вычислять его от расположения скрипта значило бы городить
 * ещё одно место, где эти буквы могут разъехаться.
 */
export const ПАПКА = К.ANALYTICS_DIR;
if (!ПАПКА) throw new Error('в .env нет ANALYTICS_DIR — некуда складывать данные');

export const ПАПКА_ДАННЫХ = join(ПАПКА, 'данные');
export const ПАПКА_ОТЧЁТОВ = join(ПАПКА, 'отчёты');

// ── КЭШ ────────────────────────────────────────────────────────────────────

/** Сегодняшняя дата строкой ГГГГ-ММ-ДД по местному времени. */
export function сегодня() {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Можно ли класть ответ в кэш. Нельзя, если период ещё не кончился:
 * данные за сегодня и за будущее меняются весь день.
 */
function периодЗакрыт(date2) {
	return date2 < сегодня();
}

function путьКэша(ключ) {
	// Имя файла из ключа: всё, что не буква и не цифра, — в дефис.
	// Длинные ключи режутся, иначе имя файла упрётся в предел файловой системы.
	const имя = ключ.replace(/[^A-Za-z0-9А-Яа-яЁё]+/g, '-').slice(0, 150);
	return join(ПАПКА_ДАННЫХ, `${имя}.json`);
}

/**
 * Спросить кэш, а если пусто — сходить в сеть и запомнить.
 *
 * ПИШЕТСЯ ЦЕЛИКОМ ИЛИ НИКАК: сначала во временный файл рядом, потом
 * переименование. Прямая запись поверх сначала обрезает файл, и обрыв ровно
 * в этот миг оставил бы огрызок, который не читается (урок проекта про
 * журнал платежей).
 */
export async function изКэша(ключ, date2, добыть) {
	const годен = периодЗакрыт(date2);
	const путь = путьКэша(ключ);
	if (годен && existsSync(путь)) {
		return { данные: JSON.parse(readFileSync(путь, 'utf8')), изСети: false };
	}
	const данные = await добыть();
	if (годен) {
		mkdirSync(ПАПКА_ДАННЫХ, { recursive: true });
		const врем = `${путь}.часть`;
		writeFileSync(врем, JSON.stringify(данные), 'utf8');
		renameSync(врем, путь);
	}
	return { данные, изСети: true };
}

// ── ЯНДЕКС.МЕТРИКА ─────────────────────────────────────────────────────────

export const СЧЁТЧИК = К.YM_COUNTER_ID;
let ymЗапросов = 0;
export const ymСчёт = () => ymЗапросов;

/**
 * Отчёт Метрики. Возвращает разобранный ответ.
 *
 * ПОВТОРЯЕМ ТОЛЬКО СЕТЕВОЕ И ТОЛЬКО ОТКАЗ ПО ПРЕДЕЛУ (420). Честный отказ
 * («нет такого поля») повтором не лечится: три захода с паузами превратят
 * мгновенный ответ в минуту молчания и спрячут ошибку в запросе.
 */
export async function метрика(params, { попыток = 3 } = {}) {
	const u = new URL('https://api-metrika.yandex.net/stat/v1/data');
	u.searchParams.set('ids', СЧЁТЧИК);
	u.searchParams.set('accuracy', 'full');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));

	for (let попытка = 1; ; попытка++) {
		let ответ;
		try {
			ответ = await fetch(u, { headers: { Authorization: `OAuth ${К.YM_OAUTH_TOKEN}` } });
		} catch (e) {
			if (попытка >= попыток) throw new Error(`Метрика недоступна: ${e.message}`);
			await пауза(1000 * попытка);
			continue;
		}
		ymЗапросов++;
		const j = await ответ.json();
		if (ответ.ok) return j;
		if (ответ.status === 420 && попытка < попыток) {
			await пауза(5000 * попытка);
			continue;
		}
		throw new Error(`Метрика ответила ${ответ.status}: ${JSON.stringify(j.errors ?? j).slice(0, 300)}`);
	}
}

/** Управление счётчиком: цели и настройки. Отдельно от отчётов — другой предел. */
export async function метрикаУправление(путь, { method = 'GET', тело } = {}) {
	const ответ = await fetch(`https://api-metrika.yandex.net/management/v1${путь}`, {
		method,
		headers: {
			Authorization: `OAuth ${К.YM_OAUTH_TOKEN}`,
			...(тело ? { 'Content-Type': 'application/json' } : {}),
		},
		...(тело ? { body: JSON.stringify(тело) } : {}),
	});
	const j = await ответ.json().catch(() => ({}));
	if (!ответ.ok) {
		throw new Error(`Метрика (управление) ответила ${ответ.status}: ${JSON.stringify(j.errors ?? j).slice(0, 300)}`);
	}
	return j;
}

// ── GOOGLE ANALYTICS ───────────────────────────────────────────────────────

export const РЕСУРС = К.GA_PROPERTY_ID;
let gaЗапросов = 0;
let gaКвота = null;
export const gaСчёт = () => gaЗапросов;
export const gaКвотаПоследняя = () => gaКвота;

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

let пропускКэш = null;

/**
 * Обменять файл-ключ на пропуск. Пропуск живёт час, поэтому держим его
 * в памяти прогона: за один отчёт запросов десяток, и просить пропуск
 * на каждый — впустую тратить и время, и чужую квоту.
 */
export async function googleПропуск(scope = 'https://www.googleapis.com/auth/analytics.readonly') {
	if (пропускКэш && пропускКэш.scope === scope && пропускКэш.до > Date.now()) return пропускКэш.token;
	const key = JSON.parse(readFileSync(К.GA_KEY_FILE, 'utf8'));
	const now = Math.floor(Date.now() / 1000);
	const head = b64({ alg: 'RS256', typ: 'JWT' });
	const body = b64({ iss: key.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
	const подпись = createSign('RSA-SHA256');
	подпись.update(`${head}.${body}`);
	const assertion = `${head}.${body}.${подпись.sign(key.private_key, 'base64url')}`;

	const r = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
	});
	const j = await r.json();
	if (!r.ok) throw new Error(`Google не принял ключ: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
	пропускКэш = { scope, token: j.access_token, до: Date.now() + 50 * 60 * 1000 };
	return j.access_token;
}

/** Отчёт Google Analytics. Квоту он возвращает сам — запоминаем и показываем. */
export async function ga(тело) {
	const token = await googleПропуск();
	const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${РЕСУРС}:runReport`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ returnPropertyQuota: true, ...тело }),
	});
	gaЗапросов++;
	const j = await r.json();
	if (!r.ok) throw new Error(`Google ответил ${r.status}: ${JSON.stringify(j.error?.message ?? j.error).slice(0, 300)}`);
	if (j.propertyQuota) gaКвота = j.propertyQuota;
	return j;
}

export const пауза = (мс) => new Promise((r) => setTimeout(r, мс));
