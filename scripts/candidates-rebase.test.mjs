// РАЗВЕДКА КАНДИДАТОВ БЕРЁТ СВЕЖУЮ ВЕТКУ: ВОСПРОИЗВЕДЕНИЕ 12 АВГУСТА.
//
//   node scripts/candidates-rebase.test.mjs
//   node scripts/candidates-rebase.test.mjs --selftest
//
// ЧТО СЛУЧИЛОСЬ 12 АВГУСТА 2026. Заказчик сохранял посты пачкой, и прогоны
// «Кандидатов» встали в очередь своей группы. Очередь отработала правильно:
// прогон 31579508502 начал работу в 08:42:12, через девять секунд после того,
// как предыдущий записал свой список в 08:42:03. А вот РАБОЧУЮ КОПИЮ он взял
// не свежую: `actions/checkout` по умолчанию берёт снимок того коммита, который
// разбудил робота (0038d093), то есть состояние ДО чужой записи. Робот разобрал
// устаревший список, переписал файл целиком и на `git pull --rebase` встал
// столкновением ровно на нём. Шаг упал, работа прогона пропала.
//
// ПОЧЕМУ ЭТО КАСАЕТСЯ ТОЛЬКО ЭТОГО РОБОТА. По сохранению постов просыпаются
// трое, но `src/data/animeCandidates.json` — единственный ОДИН ОБЩИЙ файл,
// который робот переписывает целиком на каждом заходе. У соседей (тайтлы,
// картинки постов) файлы разные, и за 60 прогонов у них ноль падений.
//
// ЧЕМ ЭТО ПРОВЕРЯЕТСЯ. Из воркфлоу вынимается НАСТОЯЩИЙ текст шага
// «Закоммитить, если что-то изменилось» — не его пересказ — и НАСТОЯЩЕЕ
// значение `ref` у шага чекаута. Оба гоняются в песочнице из двух git-
// репозиториев: голый «GitHub» с уже приехавшей чужой записью и клон робота.
//
// ПОЧЕМУ ЭТО НЕ «ВЕЧНОЗЕЛЁНАЯ» ПРОВЕРКА. Ключ `--selftest` подкладывает роботу
// ПРЕЖНИЙ способ чекаута — снимок разбудившего коммита, — и проверка обязана
// покраснеть столкновением. Не краснеет — значит песочница не воспроизводит
// поломку и её «ок» ничего не значит.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStepScript } from './candidates-save.test.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKFLOW = join(ROOT, '.github/workflows/anime-candidates.yml');
const STEP = 'Закоммитить, если что-то изменилось';
const FILE = 'src/data/animeCandidates.json';

/**
 * Какую ветку берёт шаг чекаута. Спрашиваем САМ воркфлоу, а не память: правка
 * ровно в этой строке, и переписывать её тут значило бы проверять свою копию.
 */
export function readCheckoutRef(text) {
	const lines = text.split('\n');
	const at = lines.findIndex((line) => /^\s+- uses: actions\/checkout/.test(line));
	if (at < 0) throw new Error('в воркфлоу нет шага actions/checkout — проверка смотрит не туда');
	// Смотрим только внутрь этого шага: до следующего `- ` того же отступа.
	const indent = lines[at].match(/^\s*/)[0].length;
	for (let i = at + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === '') continue;
		const width = line.match(/^\s*/)[0].length;
		if (width <= indent && line.trim().startsWith('- ')) break;
		if (width <= indent && /^\s*\w+:/.test(line)) break;
		const ref = line.match(/^\s*ref:\s*(\S+)\s*$/);
		if (ref) return ref[1];
	}
	return null;
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const писать = (dir, path, text) => {
	mkdirSync(join(dir, path, '..'), { recursive: true });
	writeFileSync(join(dir, path), text, 'utf8');
};

/** Список кандидатов — так, как его пишет робот: фразы построчно. */
const список = (фразы) =>
	JSON.stringify({ builtAt: 'время прогона', items: фразы.map((p) => ({ phrase: p, status: 'ждёт решения' })) }, null, '\t') + '\n';

const ДО = ['Провожающая в последний путь Фрирен', 'Баки!'];
const ЧУЖОЙ = [...ДО, 'Апокалипсис: Отель'];
const СВОЙ = [...ДО, 'Стальной алхимик'];

/**
 * Песочница: голый «GitHub» с историей, где чужая запись УЖЕ приехала,
 * и клон робота, взявший рабочую копию тем способом, который просят.
 *
 * @param {'main'|'событие'} способ — что чекаутит робот.
 * @returns {{ упало: boolean, причина: string, наГитхабе: string[] }}
 */
function прогон(способ) {
	const box = mkdtempSync(join(tmpdir(), 'baka-rebase-'));
	try {
		const bare = join(box, 'github.git');
		const seed = join(box, 'seed');
		mkdirSync(seed, { recursive: true });
		git(seed, 'init', '--initial-branch=main');
		git(seed, 'config', 'user.name', 'заказчик');
		git(seed, 'config', 'user.email', 'owner@example.com');

		// Коммит A — список кандидатов и первый пост.
		писать(seed, FILE, список(ДО));
		писать(seed, 'src/content/posts/один.md', 'черновик один\n');
		git(seed, 'add', '-A');
		git(seed, 'commit', '-m', 'Пост один');

		// Коммит B — второе сохранение заказчика. ИМЕННО ОН будит робота,
		// и именно его снимок брал прежний чекаут.
		писать(seed, 'src/content/posts/два.md', 'черновик два\n');
		git(seed, 'add', '-A');
		git(seed, 'commit', '-m', 'Пост два');
		const событие = git(seed, 'rev-parse', 'HEAD').trim();

		// Коммит C — предыдущий прогон робота успел записать свой список.
		писать(seed, FILE, список(ЧУЖОЙ));
		git(seed, 'add', '-A');
		git(seed, 'commit', '-m', 'Кандидаты в тайтлы: разобраны новые фразы из черновиков');

		git(box, 'clone', '--bare', seed, bare);

		// Робот берёт рабочую копию.
		const robot = join(box, 'robot');
		git(box, 'clone', bare, robot);
		if (способ === 'main') git(robot, 'checkout', 'main');
		else git(robot, 'checkout', '--detach', событие);

		// Прогон разбора: робот переписывает файл ЦЕЛИКОМ — так и работает
		// `anime-candidates.mjs --write`. Что он положит, зависит от того,
		// какой список он застал: свежий вбирает чужую запись, устаревший нет.
		const застал = readFileSync(join(robot, FILE), 'utf8');
		const прежние = JSON.parse(застал).items.map((i) => i.phrase);
		писать(robot, FILE, список([...new Set([...прежние, ...СВОЙ])]));

		// Шаг — НАСТОЯЩИЙ, вынутый из воркфлоу.
		const шаг = readStepScript(readFileSync(WORKFLOW, 'utf8'), STEP);
		let упало = false;
		let причина = '';
		try {
			execFileSync('bash', ['-e', '-c', шаг], { cwd: robot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
		} catch (err) {
			упало = true;
			причина = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim().split('\n').slice(-3).join(' / ');
		}

		const наГитхабе = упало ? [] : JSON.parse(git(bare, 'show', `main:${FILE}`)).items.map((i) => i.phrase);
		return { упало, причина, наГитхабе };
	} finally {
		rmSync(box, { recursive: true, force: true });
	}
}

// ─── Прогон ────────────────────────────────────────────────────────────────

const selftest = process.argv.includes('--selftest');
const беды = [];
const ок = (строка) => console.log(`  ✓ ${строка}`);
const плохо = (строка) => {
	беды.push(строка);
	console.log(`  ✗ ${строка}`);
};

if (selftest) {
	console.log('=== ПОДЛОГ: роботу возвращён ПРЕЖНИЙ способ — снимок разбудившего коммита ===\n');
	const r = прогон('событие');
	if (r.упало) ок(`шаг лёг столкновением, как 12 августа: ${r.причина}`);
	else плохо('шаг ПРОШЁЛ на устаревшей копии — песочница не воспроизводит поломку, её «ок» ничего не значит');
} else {
	console.log('=== ЗАПИСЬ РАЗВЕДКИ КАНДИДАТОВ ===\n');

	const ref = readCheckoutRef(readFileSync(WORKFLOW, 'utf8'));
	if (ref === 'main') ок('чекаут берёт свежую ветку main, а не снимок разбудившего коммита');
	else плохо(`чекаут берёт ${ref === null ? 'снимок разбудившего коммита (ref не задан)' : `ветку «${ref}»`} — вернулась мина 12 августа`);

	const r = прогон(ref === 'main' ? 'main' : 'событие');
	if (r.упало) плохо(`шаг записи лёг: ${r.причина}`);
	else ок('шаг записи прошёл, столкновения нет');

	// Мало не упасть: чужая запись обязана уцелеть, а своя — доехать.
	if (!r.упало) {
		if (r.наГитхабе.includes('Апокалипсис: Отель')) ок('чужая запись предыдущего прогона на месте');
		else плохо('чужая запись предыдущего прогона ПОТЕРЯНА — робот затёр соседа');
		if (r.наГитхабе.includes('Стальной алхимик')) ок('своя работа доехала до репозитория');
		else плохо('своей работы в репозитории нет');
	}
}

console.log('');
if (беды.length) {
	console.log(`ПРОВЕРКА НЕ ПРОШЛА: ${беды.length}.`);
	process.exit(1);
}
console.log('Всё сошлось.');
