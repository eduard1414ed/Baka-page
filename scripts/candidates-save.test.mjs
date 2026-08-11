// ЗАПИСЬ РОБОТА В РЕПОЗИТОРИЙ: ВОСПРОИЗВЕДЕНИЕ 11 АВГУСТА В ПЕСОЧНИЦЕ.
//
//   node scripts/candidates-save.test.mjs
//   node scripts/candidates-save.test.mjs --selftest
//
// ЧТО СЛУЧИЛОСЬ 11 АВГУСТА 2026. Робот применения завёл тайтл «Человек-бензопила»
// с обложками, дописал фразу в стоп-лист, отправил письмо «Применено: 2» — и не
// сохранил НИЧЕГО: пока он работал свои полторы минуты, вкладка заказчика
// дописала в тот же файл решений ещё три строки, и `git pull --rebase origin main`
// встал столкновением. Шаг упал, машина погасла, работа пропала вместе с ней.
// В репозитории не осталось ни карточки, ни обложек, ни строчки в стоп-листе,
// а письмо выглядело точно так же, как письмо об удачном походе.
//
// ЧЕМ ЭТО ПРОВЕРЯЕТСЯ ТЕПЕРЬ. Из воркфлоу вынимается НАСТОЯЩИЙ текст шага
// «Закоммитить сделанное» — не его пересказ, — и гоняется в песочнице из трёх
// git-репозиториев: голый «GitHub», клон робота и клон вкладки. Вкладка пишет
// свои три решения ровно в ту минуту, когда робот собирается сохраняться.
//
// ПОЧЕМУ ЭТО НЕ «ВЕЧНОЗЕЛЁНАЯ» ПРОВЕРКА. Ключ `--selftest` подкладывает шагу
// ПРЕЖНИЙ текст (`git pull --rebase origin main` и `git push`) — тот, который
// лёг, — и проверка обязана покраснеть. Не краснеет — значит она ничего
// не проверяет.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WORKFLOW = join(ROOT, '.github/workflows/anime-candidates-apply.yml');
const MERGE_SCRIPT = join(ROOT, 'scripts/anime-candidates-decisions-merge.mjs');

const STEP = 'Закоммитить сделанное';

/** Текст шага из воркфлоу — как есть, чтобы проверялся тот код, который работает. */
export function readStepScript(text, stepName = STEP) {
	const lines = text.split('\n');
	const at = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
	if (at < 0) throw new Error(`в воркфлоу нет шага «${stepName}» — проверка смотрит не туда`);

	const runAt = lines.findIndex((line, i) => i > at && /^\s+run: \|\s*$/.test(line));
	if (runAt < 0) throw new Error(`у шага «${stepName}» нет блока run: | — проверка смотрит не туда`);

	const indent = lines[runAt].match(/^\s*/)[0].length + 2;
	const out = [];
	for (let i = runAt + 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === '') {
			out.push('');
			continue;
		}
		if (line.match(/^\s*/)[0].length < indent) break;
		out.push(line.slice(indent));
	}
	if (out.length < 5) throw new Error(`шаг «${stepName}» подозрительно короткий — проверка смотрит не туда`);
	return out.join('\n');
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const DECISIONS = 'src/data/animeCandidateDecisions.json';
const писать = (dir, path, text) => {
	mkdirSync(join(dir, path, '..'), { recursive: true });
	writeFileSync(join(dir, path), text, 'utf8');
};

const РЕШЕНИЯ_ДВА = [
	{ id: 'cand:34443', what: 'stop', phrases: ['Баки!', 'Баки'] },
	{ id: 'cand:44511', what: 'create', slug: 'chainsaw-man', sourceId: 44511 },
];
const РЕШЕНИЯ_ЕЩЁ_ТРИ = [
	{ id: 'cand:57334', what: 'create', slug: 'dandadan', sourceId: 57334 },
	{ id: 'cand:50265', what: 'create', slug: 'spy-x-family', sourceId: 50265 },
	{ id: 'cand:42897', what: 'create', slug: 'horimiya', sourceId: 42897 },
];
const json = (value) => JSON.stringify(value, null, '\t') + '\n';

/**
 * Разыграть 11 августа целиком и вернуть, чем кончилось.
 * `script` — текст шага записи; подменяется только в самопроверке.
 */
function разыграть(script) {
	const box = mkdtempSync(join(tmpdir(), 'baka-save-'));
	try {
		const origin = join(box, 'origin.git');
		const bot = join(box, 'bot');
		const tab = join(box, 'tab');

		// «GitHub»
		mkdirSync(origin, { recursive: true });
		git(origin, 'init', '--bare', '--initial-branch=main', '.');

		// Первый коммит: два решения ждут применения.
		const seed = join(box, 'seed');
		mkdirSync(seed, { recursive: true });
		git(seed, 'init', '--initial-branch=main', '.');
		git(seed, 'config', 'user.email', 'seed@example.com');
		git(seed, 'config', 'user.name', 'seed');
		писать(seed, DECISIONS, json(РЕШЕНИЯ_ДВА));
		писать(seed, 'src/content/anime-stoplist.json', json([]));
		писать(seed, 'src/data/animeCandidates.json', json({ candidates: [] }));
		писать(seed, 'src/content/anime/.keep', '');
		писать(seed, 'public/anime/.keep', '');
		git(seed, 'add', '-A');
		git(seed, 'commit', '-m', 'начало');
		git(seed, 'remote', 'add', 'origin', origin);
		git(seed, 'push', 'origin', 'main');

		// Робот забрал репозиторий и ушёл работать на полторы минуты.
		git(box, 'clone', origin, 'bot');
		git(bot, 'config', 'user.email', 'bot@example.com');
		git(bot, 'config', 'user.name', 'bot');

		// ВКЛАДКА ЗАКАЗЧИКА ПИШЕТ, ПОКА РОБОТ РАБОТАЕТ. Ровно это и случилось.
		git(box, 'clone', origin, 'tab');
		git(tab, 'config', 'user.email', 'tab@example.com');
		git(tab, 'config', 'user.name', 'tab');
		писать(tab, DECISIONS, json([...РЕШЕНИЯ_ДВА, ...РЕШЕНИЯ_ЕЩЁ_ТРИ]));
		git(tab, 'add', '-A');
		git(tab, 'commit', '-m', 'Решения по кандидатам в тайтлы: 5');
		git(tab, 'push', 'origin', 'main');

		// Робот доработал: тайтл заведён, обложки скачаны, стоп-лист дописан,
		// свои два решения помечены применёнными.
		писать(
			bot,
			DECISIONS,
			json(РЕШЕНИЯ_ДВА.map((item) => ({ ...item, applied: '2026-08-11T09:38:20Z', result: 'сделано' }))),
		);
		писать(bot, 'src/content/anime/chainsaw-man.json', json({ id: 'chainsaw-man' }));
		писать(bot, 'public/anime/chainsaw-man-320w.webp', 'подложенная обложка');
		писать(bot, 'src/content/anime-stoplist.json', json(['Баки!', 'Баки']));
		писать(bot, 'src/data/animeCandidates.json', json({ candidates: [], пересобрано: true }));

		// Скрипт слияния должен быть под рукой ровно там, где его зовёт шаг.
		писать(bot, 'scripts/anime-candidates-decisions-merge.mjs', readFileSync(MERGE_SCRIPT, 'utf8'));
		писать(bot, 'report.txt', 'Применено: 2. Не вышло: 0.\n');

		const outputs = join(box, 'github-output');
		writeFileSync(outputs, '');
		writeFileSync(join(box, 'save.sh'), script, 'utf8');

		let код = 0;
		let вывод = '';
		try {
			вывод = execFileSync('bash', ['-e', join(box, 'save.sh')], {
				cwd: bot,
				encoding: 'utf8',
				env: { ...process.env, GITHUB_OUTPUT: outputs, GIT_TERMINAL_PROMPT: '0' },
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (error) {
			код = error.status ?? 1;
			вывод = `${error.stdout ?? ''}${error.stderr ?? ''}`;
		}

		// Что в итоге лежит на «GitHub».
		const check = join(box, 'check');
		git(box, 'clone', origin, 'check');
		const карточка = existsSync(join(check, 'src/content/anime/chainsaw-man.json'));
		const обложка = existsSync(join(check, 'public/anime/chainsaw-man-320w.webp'));
		const стоплист = JSON.parse(readFileSync(join(check, 'src/content/anime-stoplist.json'), 'utf8'));
		const решения = JSON.parse(readFileSync(join(check, DECISIONS), 'utf8'));
		const отчёт = readFileSync(join(bot, 'report.txt'), 'utf8');
		const пометка = readFileSync(outputs, 'utf8');

		return { код, вывод, карточка, обложка, стоплист, решения, отчёт, пометка };
	} finally {
		rmSync(box, { recursive: true, force: true });
	}
}

// ── Проверки ────────────────────────────────────────────────────────────────

function проверить(итог) {
	const cases = [];
	const say = (name, ok, detail) => {
		cases.push({ name, ok });
		console.log(`  ${ok ? 'ок  ' : 'СБОЙ'}  ${name}${detail ? `\n        ${detail}` : ''}`);
	};

	say('шаг записи прошёл без сбоя', итог.код === 0, `код возврата ${итог.код}`);
	say('карточка тайтла доехала до репозитория', итог.карточка);
	say('обложка доехала до репозитория', итог.обложка);
	say('стоп-лист доехал', итог.стоплист.length === 2, `в стоп-листе ${итог.стоплист.length} фраз, ждали 2`);
	say(
		'решения, дописанные вкладкой, не потерялись',
		итог.решения.length === 5,
		`в файле ${итог.решения.length} решений, ждали 5`,
	);
	say(
		'применённое помечено — второй раз делаться не будет',
		итог.решения.filter((item) => item.applied).length === 2,
		`помечено ${итог.решения.filter((item) => item.applied).length}, ждали 2`,
	);
	say(
		'дописанное вкладкой помеченным НЕ стало',
		итог.решения.filter((item) => item.applied).every((item) => ['cand:34443', 'cand:44511'].includes(item.id)),
	);
	say('отчёт говорит, что записалось', итог.отчёт.includes('✓ ЗАПИСАНО В РЕПОЗИТОРИЙ'));
	say('письмо получит заголовок удачи', итог.пометка.includes('saved=yes'));

	return cases.filter((item) => !item.ok).length;
}

const ПРЕЖНИЙ_ШАГ = `git config user.name "baka-anime-bot"
git config user.email "actions@users.noreply.github.com"
git add src/content/anime public/anime src/content/anime-stoplist.json src/data/animeCandidates.json src/data/animeCandidateDecisions.json
if git diff --cached --quiet; then
  echo "Ничего не изменилось."
else
  git commit -m "Применить решения по кандидатам в тайтлы"
  git pull --rebase origin main
  git push
fi
`;

async function main() {
	const script = readStepScript(readFileSync(WORKFLOW, 'utf8'));
	console.log('=== ЗАПИСЬ РОБОТА: РАЗЫГРЫВАЮ 11 АВГУСТА В ПЕСОЧНИЦЕ ===\n');
	const итог = разыграть(script);
	const bad = проверить(итог);
	if (bad > 0) {
		console.log('\n--- что напечатал шаг ---\n' + итог.вывод.slice(-2500));
	}
	console.log(bad === 0 ? '\nВсе проверки прошли.' : `\nНЕ ПРОШЛО: ${bad}.`);
	return bad;
}

async function selftest() {
	console.log('=== САМОПРОВЕРКА: ПОДЛОЖЕН ПРЕЖНИЙ ШАГ, ТОТ САМЫЙ ===\n');
	const итог = разыграть(ПРЕЖНИЙ_ШАГ);

	console.log(`  код возврата шага: ${итог.код} (11 августа было 1)`);
	console.log(`  карточка на «GitHub»: ${итог.карточка ? 'есть' : 'НЕТ'} (11 августа не было)`);
	console.log(`  обложка на «GitHub»: ${итог.обложка ? 'есть' : 'НЕТ'}`);
	console.log(`  строчек в стоп-листе: ${итог.стоплист.length} (11 августа было 0)`);

	const поймано = итог.код !== 0 && !итог.карточка;
	console.log(
		поймано
			? '\n  ок    ПЕСОЧНИЦА ВОСПРОИЗВЕЛА 11 АВГУСТА В ТОЧНОСТИ — значит она умеет находить.'
			: '\n  СБОЙ  прежний шаг в песочнице НЕ ЛЁГ. Песочница не воспроизводит поломку и ничего не значит.',
	);
	return поймано ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	const bad = process.argv.includes('--selftest') ? await selftest() : await main();
	process.exit(bad === 0 ? 0 : 1);
}
