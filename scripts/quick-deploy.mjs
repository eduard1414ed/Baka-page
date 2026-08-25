#!/usr/bin/env node
// БЫСТРАЯ ВЫКЛАДКА С МАШИНЫ ЗАКАЗЧИКА (задача 21).
//
// Запуск: npm run deploy
//
// ЗАЧЕМ ОНА, ЕСЛИ ЕСТЬ СЕРВЕР. Сервер собирает 5 мин 36 с и просыпается раз
// в десять минут — от правки до сайта выходит до четверти часа. Когда вы
// правите через локалку, сборка у вас уже сделана (вы её смотрели), и выложить
// можно за полминуты.
//
// ЧЕМ ЭТО ОПАСНО И КАК ЗАКРЫТО. Выкладок становится две, и побеждает поздняя, —
// это старая грабля проекта, из-за которой правки «сами пропадали». Здесь она
// закрыта тремя заслонами:
//
//   1. НЕ ВЫКЛАДЫВАЕМ НЕЗАКОММИЧЕННОЕ. Иначе сервер потом соберёт из
//      репозитория и затрёт то, чего в репозитории нет.
//   2. НЕ ВЫКЛАДЫВАЕМ НЕЗАПУШЕННОЕ. Сервер работает от GitHub: не увидев
//      коммита, он соберёт прежнее состояние поверх свежего.
//   3. ЗЕРКАЛО ЗАЛИВАЕТСЯ ТУТ ЖЕ. Обновить одну копию и уйти — значит развести
//      сайт и зеркало, а падают они порознь и молча.
//
// И последним делом скрипт говорит серверу: этот коммит уже выложен, —
// чтобы тот не пересобирал его заново шесть минут впустую.

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = 'root@167.233.251.252';
const SSH_KEY = `${process.env.HOME}/.ssh/hetzner_baki`;
const STATE_ON_SERVER = '/root/baka-state/last-deployed-commit';

const say = (text) => console.log(text);
const die = (text) => {
	console.error(`\n✗ ${text}\n`);
	process.exit(1);
};

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const step = (title, command) => {
	say(`\n── ${title}`);
	const started = Date.now();
	try {
		execSync(command, { cwd: ROOT, stdio: 'inherit', env: process.env });
	} catch {
		die(`шаг «${title}» не прошёл. Ничего не выложено дальше этого места.`);
	}
	say(`   готово за ${Math.round((Date.now() - started) / 1000)} с`);
};

say('=== БЫСТРАЯ ВЫКЛАДКА ===');

// ── заслон 1: всё ли закоммичено ───────────────────────────────────────────
const dirty = git(['status', '--porcelain']);
if (dirty) {
	console.error('\n✗ В рабочей копии есть незакоммиченное:\n');
	console.error(dirty.split('\n').slice(0, 15).map((l) => `    ${l}`).join('\n'));
	die('Сначала закоммитьте и запушьте. Иначе сервер соберёт из репозитория\n  и затрёт то, чего в репозитории нет, — правка «пропадёт сама».');
}

// ── заслон 2: всё ли запушено ──────────────────────────────────────────────
execFileSync('git', ['fetch', '--quiet'], { cwd: ROOT });
const local = git(['rev-parse', 'HEAD']);
const remote = git(['rev-parse', 'origin/main']);
if (local !== remote) {
	const ahead = git(['rev-list', '--count', 'origin/main..HEAD']);
	const behind = git(['rev-list', '--count', 'HEAD..origin/main']);
	if (Number(ahead) > 0) die(`Есть ${ahead} незапушенных коммитов. Сначала «git push».`);
	if (Number(behind) > 0) die(`Вы отстали от GitHub на ${behind} коммитов. Сначала «git pull».`);
}
say(`  всё закоммичено и запушено, выкладываем ${local.slice(0, 8)}`);

// ── ключи зеркала ──────────────────────────────────────────────────────────
const envFile = resolve(ROOT, '.env');
if (!existsSync(envFile)) die('Нет файла .env с ключами зеркала — без него зеркало не зальётся.');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
	const match = line.match(/^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)=(.*)$/);
	if (match) process.env[match[1]] = match[2].trim();
}
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
	die('В .env нет ключей зеркала (AWS_ACCESS_KEY_ID и AWS_SECRET_ACCESS_KEY).');
}

// ── работа ─────────────────────────────────────────────────────────────────
step('собираю сайт', 'npm run build');
step('выкладываю на bakapodcast.com', 'npx wrangler deploy');
step('заливаю зеркало ru.bakapodcast.com', 'node scripts/mirror-sync.mjs');

// ── говорим серверу, что этот коммит уже выложен ───────────────────────────
//
// Без этого сервер через десять минут увидит «новый» коммит и пересоберёт его
// заново — шесть минут работы впустую, да ещё и поверх нашей выкладки.
say('\n── говорю серверу, что коммит уже выложен');
try {
	execFileSync('ssh', ['-i', SSH_KEY, '-o', 'ConnectTimeout=15', '-o', 'BatchMode=yes',
		SERVER, `printf '%s' '${local}' > ${STATE_ON_SERVER}`], { stdio: 'pipe' });
	say('   сервер предупреждён, повторной сборки не будет');
} catch {
	// НЕ РОНЯЕМ ВЫКЛАДКУ ИЗ-ЗА ЭТОГО: сайт уже выложен, и это главное.
	// Но и молчать нельзя — иначе через десять минут сервер сделает лишнюю
	// сборку, а человек будет гадать, почему сайт «пересобирается сам».
	say('   ⚠ не достучался до сервера. Сайт выложен, но сервер об этом не знает');
	say('     и минут через десять пересоберёт тот же коммит. Не страшно, просто дольше.');
}

say(`\n✓ ГОТОВО. Выложен ${local.slice(0, 8)} на оба адреса.`);
say('  bakapodcast.com и ru.bakapodcast.com');
