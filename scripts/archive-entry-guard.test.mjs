// ЗАСЛОН «МЕНЯ ЗАПУСТИЛИ НАПРЯМУЮ ИЛИ ПОДКЛЮЧИЛИ» — ПРОВЕРКА ПО ВСЕМ СКРИПТАМ.
//
//   node scripts/archive-entry-guard.test.mjs             — спросить живые файлы
//   node scripts/archive-entry-guard.test.mjs --selftest  — плюс подлог
//
// ЗАЧЕМ. Двенадцать скриптов `archive-*` пишут во ВСЕ посты архива. У восьми
// заслон стоял, у четырёх — нет (доревизия задачи 15, находка 25), и подключи
// их завтрашняя сессия ради одной функции, скрипт прогнал бы правку по всему
// архиву. Хуже того, ключ `--write` достался бы подключённому: он смотрит
// на ОБЩУЮ командную строку, а не на свою.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ПРОЦЕССОМ, А НЕ `await import(...)` ЗДЕСЬ ЖЕ. Скрипт,
// у которого заслона нет, при подключении не просто печатает — он может
// начать ПИСАТЬ. Ронять на этом свою же проверку нельзя, поэтому подключение
// живёт в отдельном процессе, и ему нарочно даётся пустая командная строка:
// без `--write` худшее, что случится, — лишний отчёт.
//
// ПОЧЕМУ «ТИШИНА» — ЭТО ПРАВИЛЬНЫЙ ВОПРОС. Прогон любого из этих скриптов
// начинается с печати шапки отчёта. Значит молчание при подключении и есть
// признак того, что развилка сработала, а первая же строчка — что нет.
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ЗДЕСЬ = dirname(fileURLToPath(import.meta.url));

/** Все скрипты, которые обязаны молчать при подключении. */
const СКРИПТЫ = [
	'archive-anime-links.mjs',
	'archive-dedupe-apply.mjs',
	'archive-duplicates.mjs',
	'archive-external-posts.mjs',
	'archive-hashtags.mjs',
	'archive-headings.mjs',
	'archive-own-links.mjs',
	'archive-rules-measure.mjs',
	'archive-rules-scan.mjs',
	'archive-season-titles.mjs',
	'archive-source-insets.mjs',
	'archive-subheads.mjs',
	'archive-youtube-embed.mjs',
	'archive-youtube-match.mjs',
	// Не `archive-*`, но живёт по тому же правилу и попалось на нём же:
	// проверка сборки зовётся из `heading-bold.test.mjs`, и без развилки
	// принимала её ключ `--selftest` за свой.
	'check-heading-bold.mjs',
	'check-players.mjs',
];

/**
 * Подключить файл из чужого процесса и вернуть всё, что он напечатал.
 *
 * Путь уезжает в `import()` строкой, а в пути к проекту русские буквы —
 * поэтому берём `pathToFileURL`, а не склейку строк.
 */
function подключить(файл) {
	return new Promise((готово) => {
		const адрес = new URL(`file://${encodeURI(resolve(ЗДЕСЬ, файл).replaceAll('\\', '/'))}`).href;
		const дитя = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(адрес)});`], {
			cwd: resolve(ЗДЕСЬ, '..'),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let вывод = '';
		дитя.stdout.on('data', (кусок) => (вывод += кусок));
		дитя.stderr.on('data', (кусок) => (вывод += кусок));
		дитя.on('close', (код) => готово({ вывод: вывод.trim(), код }));
	});
}

let плохо = 0;

console.log('ЗАСЛОН «ЗАПУСТИЛИ НАПРЯМУЮ?» — подключаю каждый скрипт и требую тишины.');
console.log(`Скриптов на проверке: ${СКРИПТЫ.length}`);
console.log();

for (const файл of СКРИПТЫ) {
	const { вывод, код } = await подключить(файл);
	const тихо = вывод === '' && код === 0;
	if (!тихо) плохо++;
	console.log(`${тихо ? '  ок  ' : ' ПЛОХО'}  ${файл}`);
	if (!тихо) {
		console.log(`          код возврата ${код}`);
		console.log(`          напечатал: ${JSON.stringify(вывод.slice(0, 300))}`);
	}
}

// ── ПОДЛОГ ────────────────────────────────────────────────────────────────
// «Пусто» ничего не значит, пока не показано, что проверка умеет находить.
// Подлог СОЗДАЁТ то, что ищут: рядом кладётся копия настоящего скрипта
// с вырезанной развилкой — ровно тот вид, какой у этих четырёх был до правки.
// Общий на все копии подлог тут не годился бы: он не создаёт расхождения.
if (process.argv.includes('--selftest')) {
	console.log();
	console.log('── ПОДЛОГ: копия скрипта БЕЗ развилки обязана заговорить ──');

	const образец = join(ЗДЕСЬ, 'archive-headings.mjs');
	const подделка = join(ЗДЕСЬ, 'archive-headings.ПОДЛОГ.mjs');
	const текст = await readFile(образец, 'utf8');

	// Снимаем ровно развилку: `if (calledDirectly) {` → `if (true) {`.
	const сломанный = текст.replace('if (calledDirectly) {', 'if (true) {');
	if (сломанный === текст) {
		console.log('  ПЛОХО  подлог ничего не заменил — проверка обвиняет чужой код в своей ошибке');
		плохо++;
	} else {
		await writeFile(подделка, сломанный, 'utf8');
		try {
			const { вывод } = await подключить('archive-headings.ПОДЛОГ.mjs');
			const поймано = вывод !== '';
			if (!поймано) плохо++;
			console.log(`${поймано ? '  ок  ' : ' ПЛОХО'}  копия без развилки заговорила при подключении`);
			if (поймано) console.log(`          первая строка: ${JSON.stringify(вывод.split('\n')[0].slice(0, 120))}`);
		} finally {
			await unlink(подделка);
		}
	}

	// И ВТОРАЯ ПОЛОВИНА: проверка обязана МОЛЧАТЬ на здоровом. Без неё «поймал»
	// неотличимо от «ругается на всё подряд».
	const { вывод } = await подключить('archive-headings.mjs');
	const молчит = вывод === '';
	if (!молчит) плохо++;
	console.log(`${молчит ? '  ок  ' : ' ПЛОХО'}  настоящий скрипт при подключении молчит`);
}

console.log();
if (плохо) {
	console.log(`ПРОВАЛОВ: ${плохо}`);
	process.exit(1);
}
console.log('Все скрипты молчат при подключении.');
