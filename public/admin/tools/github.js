// РАЗГОВОР С GITHUB ДЛЯ СЛУЖЕБНЫХ СТРАНИЦ — ОДИН ФАЙЛ НА ВСЕ.
//
// Пользуются двое: `/admin/tools/` (кнопки роботов) и
// `/admin/tools/candidates/` (разбор кандидатов в тайтлы). Вторая копия входа
// и разбора ответов разъехалась бы молча: на одной странице вход бы жил,
// на другой протух, и выглядело бы это как «кнопка не работает».
//
// ПОЧЕМУ ЗДЕСЬ НЕТ НИ ОДНОГО ПАРОЛЯ И НИ ОДНОГО КЛЮЧА. Право нажатия проверяет
// сам GitHub: страница просит у него токен ровно тем же путём, каким это делает
// админка (воркер baki-cms-auth), и дальше просто передаёт его в запрос.
// У кого нет права писать в репозиторий, тот получит от GitHub отказ — что бы
// он ни открыл в браузере.
//
// Репозиторий и воркер входа — те же, что у админки (`public/admin/config.yml`,
// поля `repo` и `base_url`). МЕНЯЕТЕ ТАМ — ПОПРАВЬТЕ И ЗДЕСЬ: эти страницы живут
// вне сборки и `config.yml` не читают.

export const OWNER = 'eduard1414ed';
export const REPO = 'Baka-page';
export const AUTH_ORIGIN = 'https://baki-cms-auth.eduard1414ed.workers.dev';

// Токен держим в памяти вкладки: закрыли — забылся. В localStorage не кладём,
// это ключ от репозитория.
let token = sessionStorage.getItem('baka-gh-token') ?? '';

export const hasToken = () => Boolean(token);

export async function api(path, options = {}) {
	return await fetch(`https://api.github.com${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			...(options.headers ?? {}),
		},
	});
}

// ── Вход ────────────────────────────────────────────────────────────────────
//
// Тот же разговор, что ведёт Sveltia с воркером baki-cms-auth: окошко присылает
// «authorizing:github», мы отвечаем тем же словом, и в ответ приходит токен.
// Разобрано по коду воркера (cms-auth/src/index.js), а не по документации.

export function login({ onDone, onFail }) {
	const url = `${AUTH_ORIGIN}/auth?provider=github&site_id=${encodeURIComponent(location.hostname)}`;
	const popup = window.open(url, 'baka-auth', 'width=760,height=720');
	if (!popup) {
		onFail('Браузер не дал открыть окно входа. Разрешите всплывающие окна для этого сайта.');
		return;
	}

	const onMessage = (event) => {
		if (event.origin !== AUTH_ORIGIN) return;

		if (event.data === 'authorizing:github') {
			popup.postMessage('authorizing:github', AUTH_ORIGIN);
			return;
		}

		const match = /^authorization:github:(success|error):(.*)$/s.exec(String(event.data ?? ''));
		if (!match) return;

		window.removeEventListener('message', onMessage);
		let payload = {};
		try {
			payload = JSON.parse(match[2]);
		} catch {
			onFail('GitHub ответил чем-то непонятным. Попробуйте ещё раз.');
			return;
		}

		if (match[1] === 'error' || !payload.token) {
			onFail(`GitHub не пустил: ${payload.error ?? 'неизвестно почему'}`);
			return;
		}

		token = payload.token;
		sessionStorage.setItem('baka-gh-token', token);
		onDone();
	};

	window.addEventListener('message', onMessage);
}

export function forgetToken() {
	token = '';
	sessionStorage.removeItem('baka-gh-token');
}

/**
 * Проверить, что этим токеном вообще можно что-то делать.
 *
 * Спрашиваем не «кто вы», а «есть ли право писать в репозиторий»: именно его
 * требуют и запуск робота, и запись решения. Отдельный вопрос — чего хватило
 * токену по правам приложения: GitHub перечисляет их в заголовке ответа,
 * и если действие потом откажет, причина будет видна сразу, а не в виде
 * молчащей кнопки.
 */
export async function checkRights() {
	const response = await api(`/repos/${OWNER}/${REPO}`);
	if (!response.ok) {
		throw new Error(
			response.status === 401
				? 'Вход просрочен — войдите заново.'
				: `GitHub не отдал репозиторий (код ${response.status}).`,
		);
	}

	const repo = await response.json();
	if (!repo.permissions?.push) {
		throw new Error('У этой учётной записи нет права писать в репозиторий — она тут ничего не может.');
	}
	return { login: repo.owner?.login, scopes: response.headers.get('x-oauth-scopes') ?? '' };
}

/**
 * Общая обвязка входа: кнопка, строчка «вход выполнен», строчка ошибки.
 * Обе страницы показывают одно и то же и одними словами.
 */
export function setupAuth({ loginButton, whoSpan, errorEl, onReady }) {
	const fail = (text) => {
		errorEl.textContent = text;
		errorEl.hidden = false;
	};

	const start = async () => {
		try {
			const { login: who } = await checkRights();
			whoSpan.textContent = `вход выполнен: ${who ?? 'GitHub'}`;
			errorEl.hidden = true;
			loginButton.textContent = 'Войти заново';
			await onReady();
		} catch (error) {
			forgetToken();
			fail(error.message);
		}
	};

	loginButton.addEventListener('click', () => login({ onDone: start, onFail: fail }));
	if (hasToken()) start();
}

// ── Запуски воркфлоу ────────────────────────────────────────────────────────

export async function fetchRuns(workflow, perPage = 5) {
	const response = await api(`/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/runs?per_page=${perPage}`);
	if (!response.ok) return [];
	const data = await response.json();
	return data.workflow_runs ?? [];
}

export async function fetchIssues() {
	const response = await api(`/repos/${OWNER}/${REPO}/issues?state=all&per_page=5`);
	if (!response.ok) return [];
	const data = await response.json();
	// В этой же ручке GitHub отдаёт и запросы на слияние — они нам не письма робота.
	return data.filter((item) => !item.pull_request).slice(0, 3);
}

/** Позвать воркфлоу. 204 — принято, всё остальное — отказ. */
export async function dispatch(workflow, inputs) {
	return await api(`/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/dispatches`, {
		method: 'POST',
		body: JSON.stringify({ ref: 'main', ...(inputs ? { inputs } : {}) }),
	});
}

export const RU = new Intl.DateTimeFormat('ru-RU', {
	day: '2-digit',
	month: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
});

export const isRunning = (run) => run.status !== 'completed';

export function howLong(run) {
	const from = new Date(run.run_started_at ?? run.created_at).getTime();
	const to = isRunning(run) ? Date.now() : new Date(run.updated_at).getTime();
	const seconds = Math.max(0, Math.round((to - from) / 1000));
	return seconds < 60 ? `${seconds} с` : `${Math.floor(seconds / 60)} мин ${seconds % 60} с`;
}

export function outcome(run) {
	if (isRunning(run)) return 'идёт прямо сейчас';
	return (
		{ success: 'прошёл без сбоев', failure: 'закончился сбоем', cancelled: 'остановлен' }[run.conclusion] ??
		run.conclusion
	);
}

// ── Коммиты ─────────────────────────────────────────────────────────────────
//
// Нужны, чтобы сказать вслух, ЧЕМ кончился поход робота. «Прошёл без сбоев»
// не отвечает на вопрос «и что привёз»: робот пишет письмо только когда что-то
// не так, и удачный заход с тремя новыми постами выглядел бы ровно так же,
// как заход, не нашедший ничего.

/** Коммиты, тронувшие путь, за промежуток времени. Пусто — значит не было. */
export async function fetchCommits(path, sinceIso, untilIso) {
	const query = new URLSearchParams({ path, since: sinceIso, until: untilIso, per_page: '10' });
	const response = await api(`/repos/${OWNER}/${REPO}/commits?${query}`);
	if (!response.ok) return [];
	return await response.json();
}

/**
 * Файлы одного коммита. GitHub отдаёт не больше 300 штук за раз, поэтому
 * читающий обязан смотреть на длину: 300 — это, скорее всего, «и ещё сколько-то».
 */
export async function fetchCommitFiles(sha) {
	const response = await api(`/repos/${OWNER}/${REPO}/commits/${sha}`);
	if (!response.ok) return [];
	const data = await response.json();
	return data.files ?? [];
}

// ── Файлы репозитория ───────────────────────────────────────────────────────

const fromBase64 = (base64) => {
	const binary = atob(String(base64).replace(/\s/g, ''));
	return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
};

const toBase64 = (text) => {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
};

/**
 * Файл из репозитория. Просим СЫРОЕ содержимое: обычный ответ этой ручки —
 * base64 внутри JSON, и он ограничен мегабайтом, а список кандидатов уже
 * под восемьсот килобайт и будет расти.
 */
export async function readRepoFile(path) {
	const response = await api(`/repos/${OWNER}/${REPO}/contents/${path}?ref=main`, {
		headers: { Accept: 'application/vnd.github.raw' },
		cache: 'no-store',
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`GitHub не отдал ${path} (код ${response.status})`);
	return await response.text();
}

/** Тот же файл, но с отпечатком версии: без него его не перезаписать. */
export async function readRepoFileMeta(path) {
	const response = await api(`/repos/${OWNER}/${REPO}/contents/${path}?ref=main`, { cache: 'no-store' });
	if (response.status === 404) return { text: null, sha: null };
	if (!response.ok) throw new Error(`GitHub не отдал ${path} (код ${response.status})`);
	const data = await response.json();
	return { text: fromBase64(data.content ?? ''), sha: data.sha };
}

export async function writeRepoFile(path, text, sha, message) {
	return await api(`/repos/${OWNER}/${REPO}/contents/${path}`, {
		method: 'PUT',
		body: JSON.stringify({ message, content: toBase64(text), branch: 'main', ...(sha ? { sha } : {}) }),
	});
}

// ── Мелочи, общие обеим страницам ───────────────────────────────────────────

export function plural(n, one, few, many) {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return one;
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
	return many;
}
