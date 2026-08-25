// РАЗГОВОР С СЕРВЕРОМ HETZNER — ОДИН ФАЙЛ НА ВСЕ СЛУЖЕБНЫЕ СТРАНИЦЫ.
//
// Пришёл на смену походам в GitHub Actions: пометка «спам» выключила Actions,
// и роботы переехали на свой сервер (задача 21). Кнопки теперь зовут его.
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ПРЕЖНЕГО github.js. Там право нажатия проверял сам
// GitHub: страница брала токен тем же путём, что админка, и никаких своих
// паролей не заводила. Здесь так не выйдет — сервер про GitHub ничего не знает
// и проверить по нему право не может. Поэтому у запуска свой ключ.
//
// КЛЮЧ ЖИВЁТ В ПАМЯТИ ВКЛАДКИ (sessionStorage), как и токен GitHub раньше:
// закрыли вкладку — забылся. В localStorage не кладём.
//
// Сам обработчик слушает только 127.0.0.1 на сервере; наружу его выставляет
// Caddy по этому адресу, он же даёт HTTPS.

export const API = 'https://167-233-251-252.sslip.io/robot';

let secret = sessionStorage.getItem('baka-robot-key') ?? '';

export const hasKey = () => Boolean(secret);

export function saveKey(value) {
	secret = (value ?? '').trim();
	if (secret) sessionStorage.setItem('baka-robot-key', secret);
	else sessionStorage.removeItem('baka-robot-key');
}

export function forgetKey() {
	secret = '';
	sessionStorage.removeItem('baka-robot-key');
}

async function call(path, options = {}) {
	// СБОЙ ЗАПРОСА НАДО ПОЙМАТЬ ЗДЕСЬ, ИНАЧЕ КНОПКА МОЛЧИТ.
	// fetch бросает исключение, когда до сервера не достучались вовсе:
	// он выключен, нет сети, браузер зарубил запрос по CORS. Без этого
	// try исключение улетало наверх, и нажатие не давало НИКАКОГО ответа —
	// ни хорошего, ни плохого. Поймано заказчиком 25.08.2026 на первой же
	// попытке ввести ключ.
	let response;
	try {
		response = await fetch(`${API}${path}`, {
			...options,
			headers: { Authorization: `Bearer ${secret}`, ...(options.headers ?? {}) },
		});
	} catch (error) {
		return {
			ok: false,
			status: 0,
			body: {},
			offline: true,
			error:
				`Не достучался до сервера (${API}). Так бывает, если сервер выключен, ` +
				`нет интернета — или страница открыта с адреса, которому сервер не доверяет. ` +
				`Сейчас страница открыта с «${location.origin}». Подробности: ${error?.message ?? error}`,
		};
	}
	let body = {};
	try {
		body = await response.json();
	} catch {
		// Сервер мог ответить не-JSON (упал Caddy, вклинился прокси). Тело
		// оставляем пустым: ниже смотрим на код ответа, а не на текст.
	}
	return { ok: response.ok, status: response.status, body };
}

/** Ключ подходит? Спрашиваем состоянием любого робота — оно ничего не запускает. */
export async function checkKey() {
	const { ok, status, error } = await call('/status/deploy');
	if (ok) return { ok: true };
	if (error) return { ok: false, error };
	if (status === 401) return { ok: false, error: 'Ключ не подошёл. Проверьте, что скопировали его целиком — без слов «ROBOT_API_SECRET=» в начале.' };
	return { ok: false, error: `Сервер ответил ${status || 'молчанием'}. Возможно, он выключен.` };
}

/**
 * Позвать робота.
 *
 * Сервер отвечает СРАЗУ (202), не дожидаясь конца работы: сборка сайта идёт
 * почти шесть минут, и держать ради неё вкладку было бы издевательством.
 * Чем кончилось — смотрим потом через `status`.
 */
export async function runRobot(name) {
	const { ok, status, body, error } = await call(`/run/${name}`, { method: 'POST' });
	if (ok) return { ok: true };
	if (error) return { ok: false, error };
	if (status === 409) return { ok: false, busy: true, error: 'Этот робот уже работает — подождите, пока закончит.' };
	if (status === 401) return { ok: false, error: 'Ключ не подошёл.' };
	return { ok: false, error: body?.error || `Сервер ответил ${status || 'молчанием'}.` };
}

/**
 * Чем занят робот.
 *
 * `state` — activating (работает), inactive (закончил), failed (упал).
 * `result` — success или причина: exit-code, timeout…
 *
 * ВАЖНО ПРО «ЗАКОНЧИЛ». У oneshot-служб systemd inactive значит и «отработал
 * и вышел», и «никогда не запускался». Различать надо по `result` и по времени
 * окончания, а не по одному `state`: иначе никогда не запускавшийся робот
 * покажется успешно отработавшим.
 */
export async function robotStatus(name) {
	const { ok, body } = await call(`/status/${name}`);
	if (!ok) return null;
	return body;
}

/** Человеческим языком: что сейчас с роботом. */
export function describe(status) {
	if (!status) return { text: '', kind: '' };
	if (status.state === 'activating') return { text: 'работает прямо сейчас', kind: 'work' };
	if (status.state === 'failed' || (status.result && status.result !== 'success')) {
		return { text: `последний заход не удался (${status.result || 'без причины'})`, kind: 'bad' };
	}
	if (!status.finishedAt) return { text: 'ещё ни разу не запускался', kind: '' };
	return { text: `последний заход прошёл успешно`, kind: 'good' };
}

/** «5 минут назад» из отметки systemd вида «Tue 2026-08-25 09:14:18 UTC». */
export function howLong(stamp) {
	if (!stamp) return '';
	const when = Date.parse(stamp.replace(/^[A-Za-z]{3}\s+/, '').replace(' UTC', 'Z').replace(' ', 'T'));
	if (Number.isNaN(when)) return '';
	const mins = Math.round((Date.now() - when) / 60000);
	if (mins < 1) return 'только что';
	if (mins < 60) return `${mins} мин назад`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours} ч назад`;
	return `${Math.round(hours / 24)} дн назад`;
}
