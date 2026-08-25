// ОБРАБОТЧИК КНОПОК /admin/tools/ (задача 21).
//
// Кнопки раньше звали GitHub Actions. Actions выключены пометкой «спам»,
// роботы переехали на Hetzner — значит и звать надо сервер.
//
// СЛУШАЕТ ТОЛЬКО 127.0.0.1. Наружу его выставляет Caddy по адресу /robot/*,
// он же даёт HTTPS. Сам обработчик снаружи недоступен.
//
// ЗАПУСКАЕТ ТОЛЬКО ТО, ЧТО ПЕРЕЧИСЛЕНО НИЖЕ. Имя службы никогда не берётся
// из запроса: пришедшее слово ищется в списке, не нашлось — отказ. Иначе
// первый же любопытный запустил бы на сервере что угодно.
//
// ПРАВО НАЖАТИЯ — секрет из /root/baka-secrets/robot-api.env. Заказчик вводит
// его в админке один раз, дальше он живёт в памяти вкладки. Проверка сравнения
// идёт по длине и посимвольно за постоянное время: обычное === на секретах
// подсказывает злоумышленнику, сколько знаков он угадал.

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';

const PORT = 8099;
const HOST = '127.0.0.1';

// Белый список: слово из запроса → служба systemd. Больше ничего запустить нельзя.
const ROBOTS = {
	episodes: 'baka-episodes.service',
	telegram: 'baka-telegram.service',
	posts: 'baka-posts.service',
	deploy: 'baka-deploy.service',
	'cases-dry': 'baka-cases@dry.service',
	'cases-write': 'baka-cases@write.service',
	apply: 'baka-apply.service',
};

// Откуда пускаем нажатия: админка на сайте и она же, поднятая на машине
// заказчика (локальный режим Sveltia — сейчас единственный рабочий).
const ALLOWED_ORIGINS = new Set([
	'https://bakapodcast.com',
	'https://www.bakapodcast.com',
]);

// Локальная админка живёт на localhost, но НЕ ВСЕГДА на 4321: Astro берёт
// следующий свободный порт, если этот занят, — и тогда страница открыта
// с localhost:4322, а сервер такого адреса не знает. Браузер режет ответ
// молча, и выглядит это как «кнопка ничего не делает». Поэтому localhost
// разрешаем с любым портом: это машина заказчика, а не чужой сайт.
const isLocal = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? '');
const allowed = (origin) => Boolean(origin) && (ALLOWED_ORIGINS.has(origin) || isLocal(origin));

const SECRET = (() => {
	const raw = readFileSync('/root/baka-secrets/robot-api.env', 'utf8');
	const line = raw.split('\n').find((l) => l.startsWith('ROBOT_API_SECRET='));
	if (!line) throw new Error('в robot-api.env нет ROBOT_API_SECRET');
	return line.slice('ROBOT_API_SECRET='.length).trim();
})();

const sameSecret = (given) => {
	const a = Buffer.from(given ?? '', 'utf8');
	const b = Buffer.from(SECRET, 'utf8');
	// Разная длина — timingSafeEqual бросит; сравниваем только равные.
	return a.length === b.length && timingSafeEqual(a, b);
};

const run = (args) =>
	new Promise((resolve) => {
		execFile('/usr/bin/systemctl', args, { timeout: 15000 }, (error, stdout, stderr) =>
			resolve({ code: error?.code ?? 0, out: String(stdout || stderr || '').trim() }),
		);
	});

const json = (res, status, body, origin) => {
	const headers = { 'Content-Type': 'application/json; charset=utf-8' };
	if (allowed(origin)) {
		headers['Access-Control-Allow-Origin'] = origin;
		headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
		headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
		headers['Vary'] = 'Origin';
	}
	res.writeHead(status, headers);
	res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
	const origin = req.headers.origin;
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');

	if (req.method === 'OPTIONS') return json(res, 204, {}, origin);

	// Кто есть кто: список роботов отдаём без секрета — имён достаточно,
	// чтобы страница нарисовала кнопки, а запустить по ним ничего нельзя.
	if (req.method === 'GET' && parts[0] === 'robots') {
		return json(res, 200, { robots: Object.keys(ROBOTS) }, origin);
	}

	if (!sameSecret((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''))) {
		return json(res, 401, { error: 'Нужен правильный ключ запуска' }, origin);
	}

	const name = parts[1];
	const unit = ROBOTS[name];
	if (!unit) return json(res, 404, { error: `Такого робота нет: ${name ?? '—'}` }, origin);

	if (req.method === 'POST' && parts[0] === 'run') {
		const active = await run(['is-active', unit]);
		if (active.out === 'activating') {
			return json(res, 409, { error: 'Этот робот уже работает', state: 'activating' }, origin);
		}
		// --no-block: запуск возвращается сразу, иначе страница ждала бы
		// все шесть минут сборки и отвалилась бы по таймауту.
		const started = await run(['start', '--no-block', unit]);
		return json(res, started.code === 0 ? 202 : 500,
			started.code === 0 ? { started: name } : { error: started.out }, origin);
	}

	if (req.method === 'GET' && parts[0] === 'status') {
		const active = await run(['is-active', unit]);
		const props = await run(['show', unit, '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'InactiveEnterTimestamp']);
		const map = Object.fromEntries(
			props.out.split('\n').map((l) => l.split('=')).map(([k, ...v]) => [k, v.join('=')]),
		);
		return json(res, 200, {
			robot: name,
			state: active.out,                       // activating | active | inactive | failed
			result: map.Result ?? '',                // success | exit-code | timeout …
			exitCode: map.ExecMainStatus ?? '',
			finishedAt: map.InactiveEnterTimestamp ?? '',
		}, origin);
	}

	return json(res, 405, { error: 'Так нельзя' }, origin);
}).listen(PORT, HOST, () => {
	console.log(`обработчик кнопок слушает ${HOST}:${PORT}, роботов в списке: ${Object.keys(ROBOTS).length}`);
});
