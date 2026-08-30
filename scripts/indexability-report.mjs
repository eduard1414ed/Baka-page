// ОТЧЁТ ОБ ИНДЕКСИРУЕМОСТИ СТРАНИЦ ТАЙТЛОВ.
//
//   npm run indexability:report
//
// Ничего никуда не отправляет и ничего не считает заново: читает последний
// лог сборки (build-logs/indexability-*.json). Пересчёт стоил бы 12 секунд
// и, что хуже, завёл бы ВТОРОЙ код, считающий то же самое, — а он однажды
// разошёлся бы с первым.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ПОРОГ } from '../src/lib/animeIndexability.mjs';

const ЛОГИ = new URL('../build-logs/', import.meta.url);
const АНИМЕ = new URL('../src/content/anime/', import.meta.url);

const ПРИЧИНЫ = {
	'сила': 'набрала счёт',
	'мало': 'не набрала счёт',
	'поглощена': 'всё её содержание есть у старшего тайтла франшизы',
	'вручную-в': 'открыта вручную',
	'вручную-из': 'закрыта вручную',
};

async function главная() {
	if (!existsSync(fileURLToPath(ЛОГИ))) {
		console.error('Логов ещё нет. Сначала соберите сайт: npm run build');
		return 1;
	}
	const имена = (await readdir(ЛОГИ)).filter((f) => /^indexability-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
	if (имена.length === 0) {
		console.error('Логов ещё нет. Сначала соберите сайт: npm run build');
		return 1;
	}
	const лог = JSON.parse(await readFile(new URL(имена.at(-1), ЛОГИ), 'utf8'));
	const стр = лог.pages;

	console.log(`ИНДЕКСИРУЕМОСТЬ СТРАНИЦ ТАЙТЛОВ — сборка от ${лог.builtAt?.slice(0, 16).replace('T', ' ')}`);
	console.log('');
	console.log(`  всего страниц:  ${лог.total}`);
	console.log(`  в индексе:      ${лог.indexed}`);
	console.log(`  закрыто:        ${лог.excluded}`);
	console.log('');

	const поПричине = {};
	for (const p of стр) поПричине[p.причина] = (поПричине[p.причина] ?? 0) + 1;
	console.log('  почему:');
	for (const [причина, сколько] of Object.entries(поПричине).sort((a, b) => b[1] - a[1])) {
		console.log(`    ${String(сколько).padStart(4)}  ${ПРИЧИНЫ[причина] ?? причина}`);
	}
	console.log('');

	console.log('  распределение счёта:');
	const счета = Object.entries(лог.scoreDistribution).map(([с, n]) => [Number(с), n]).sort((a, b) => a[0] - b[0]);
	for (const [с, n] of счета) {
		if (с > 12) continue;
		console.log(`    счёт ${String(с).padStart(2)}: ${String(n).padStart(4)}${с >= ПОРОГ ? '  ← в индексе' : ''}`);
	}
	const хвост = счета.filter(([с]) => с > 12).reduce((a, [, n]) => a + n, 0);
	if (хвост) console.log(`    счёт 13+: ${String(хвост).padStart(3)}  ← в индексе`);
	console.log('');

	// ГРАНИЦА. Ровно эти страницы решает порог: по ним и видно, адекватна ли
	// формула. Показываем поровну с обеих сторон — иначе не с чем сравнивать.
	const внутри = стр.filter((p) => p.счёт === ПОРОГ && p.index).slice(0, 10);
	const снаружи = стр.filter((p) => p.счёт === ПОРОГ - 1).slice(0, 10);
	const состав = (p) => `своих ${p.свои}, выпусков ${p.подкаст}, таймкоды ${p.таймкоды ? 'есть' : 'нет'}`;
	console.log(`  У ГРАНИЦЫ, счёт ${ПОРОГ} — входят (всего ${стр.filter((p) => p.счёт === ПОРОГ && p.index).length}):`);
	for (const p of внутри) console.log(`    ${p.id.padEnd(46)} ${состав(p)}`);
	console.log('');
	console.log(`  У ГРАНИЦЫ, счёт ${ПОРОГ - 1} — не входят (всего ${снаружи.length ? стр.filter((p) => p.счёт === ПОРОГ - 1).length : 0}):`);
	for (const p of снаружи) console.log(`    ${p.id.padEnd(46)} ${состав(p)}`);
	console.log('');

	// ПОГЛОЩЁННЫЕ ПОКАЗЫВАЮТСЯ ВСЕГДА И ЦЕЛИКОМ. Это единственная часть
	// правила, которую нельзя проверить машиной: франшиза приходит от чужого
	// сервера, и Shikimori кладёт в неё в том числе кроссоверы и сборники.
	// Не печатай мы этот список — ложное поглощение стало бы невидимым.
	const поглощены = стр.filter((p) => p.причина === 'поглощена');
	console.log(`  ПОГЛОЩЕНЫ СТАРШИМ ТАЙТЛОМ ФРАНШИЗЫ — ${поглощены.length}. Просмотрите глазами:`);
	for (const p of поглощены) {
		console.log(`    ${p.id.padEnd(50)} → ${p.поглотитель}   (своих ${p.свои}, франшиза ${p.франшиза})`);
	}
	console.log('');

	const вручную = стр.filter((p) => p.force !== null && p.force !== undefined);
	console.log(`  ПЕРЕОПРЕДЕЛЕНО ВРУЧНУЮ — ${вручную.length}:`);
	for (const p of вручную) console.log(`    ${p.id.padEnd(50)} ${p.force ? 'всегда в индексе' : 'всегда закрыта'}`);
	if (вручную.length === 0) console.log('    (ни одного — правило работает само)');
	console.log('');

	// Сколько карточек ещё не спрошено про франшизу: без неё поглощение
	// такую страницу не тронет вовсе, и знать это надо.
	const файлы = (await readdir(АНИМЕ)).filter((f) => f.endsWith('.json'));
	let безПоля = 0;
	for (const имя of файлы) {
		const к = JSON.parse(await readFile(new URL(имя, АНИМЕ), 'utf8'));
		if (!('franchise' in к)) безПоля++;
	}
	console.log(`  Карточек без поля franchise: ${безПоля} из ${файлы.length}.`);
	if (безПоля > 0) console.log('    Их поглощение не касается вовсе. Добрать: node scripts/anime-franchise.mjs');
	return 0;
}

// Русские буквы в пути: import.meta.url их кодирует, process.argv[1] — нет.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exitCode = await главная();
}
