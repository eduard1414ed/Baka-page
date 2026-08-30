// СВЕРКА: РАЗМЕТКА И КАРТА САЙТА ГОВОРЯТ ОДНО И ТО ЖЕ.
//
//   node scripts/indexability-pages.test.mjs           — сверить собранный сайт
//   node scripts/indexability-pages.test.mjs --подлог  — убедиться, что краснеет
//
// Спрашивает не код, а ФАКТ: собранные страницы в dist/ и собранный
// sitemap.xml. Это единственная проверка, которая ловит разъезд от чего
// угодно — от разных наборов постов у двух потребителей, от кэша по длинам
// коллекций, от чужой правки в карте сайта.
//
// Почему это важнее, чем кажется. Страница, сказавшая «не индексируй меня»,
// и карта, зовущая на неё робота, — это два разных ответа на один вопрос.
// Задание называет такой исход худшим из возможных: поисковик получает
// противоречие и решает сам, а решает он не в нашу пользу.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const DIST = new URL('../dist/', import.meta.url);

/**
 * ПРАВИЛО СВЕРКИ, вынесено отдельной функцией РОВНО ЗАТЕМ, чтобы её можно
 * было уронить подлогом. Внутри проверки это было бы недостижимо.
 *
 * Требование — точная дополнительность: каждая страница тайтла либо закрыта
 * в разметке и отсутствует в карте, либо открыта и в карте есть. Третьего
 * не дано, и оба «третьих» — беда.
 *
 * @returns {string[]} беды
 */
export function расхождения(всеСлаги, закрытыеВРазметке, вКарте) {
	const беды = [];
	for (const слаг of всеСлаги) {
		const закрыта = закрытыеВРазметке.has(слаг);
		const вкарте = вКарте.has(слаг);
		if (закрыта && вкарте) {
			беды.push(`${слаг}: страница закрыта noindex, а карта сайта зовёт на неё робота`);
		} else if (!закрыта && !вкарте) {
			беды.push(`${слаг}: страница открыта для поисковиков, но в карте сайта её нет`);
		}
	}
	for (const слаг of вКарте) {
		if (!всеСлаги.has(слаг)) беды.push(`${слаг}: есть в карте сайта, а страницы такой не собрано`);
	}
	return беды;
}

async function собрать() {
	const каталог = new URL('anime/', DIST);
	const всеСлаги = new Set();
	const закрытые = new Set();

	for (const запись of await readdir(каталог, { withFileTypes: true })) {
		if (!запись.isDirectory()) continue;
		const файл = new URL(`${запись.name}/index.html`, каталог);
		if (!existsSync(fileURLToPath(файл))) continue;
		всеСлаги.add(запись.name);
		const html = await readFile(файл, 'utf8');
		// Спрашиваем ровно ту строку, которую рисует src/layouts/Layout.astro.
		if (html.includes('name="robots" content="noindex, follow"')) закрытые.add(запись.name);
	}

	const карта = await readFile(new URL('sitemap.xml', DIST), 'utf8');
	const вКарте = new Set();
	for (const m of карта.matchAll(/<loc>[^<]*\/anime\/([^/<]+)\/<\/loc>/g)) вКарте.add(m[1]);

	return { всеСлаги, закрытые, вКарте };
}

async function главная() {
	const подлог = process.argv.includes('--подлог') || process.argv.includes('--selftest');

	if (!existsSync(fileURLToPath(new URL('sitemap.xml', DIST)))) {
		console.error('⚑ Сайт не собран (нет dist/sitemap.xml) — сверять нечего. Сначала: npm run build');
		return 1;
	}

	const { всеСлаги, закрытые, вКарте } = await собрать();

	if (подлог) {
		// Разводим РОВНО ОДНУ страницу, как это и случится в жизни, если карта
		// перестанет спрашивать правило: берём закрытую в разметке и делаем
		// вид, что карта её всё-таки объявила.
		const жертва = [...закрытые][0];
		if (!жертва) {
			console.error('✗ ПОДЛОГ НЕ СОБРАН: в сборке нет ни одной закрытой страницы, разводить нечего.');
			return 1;
		}
		const беды = расхождения(всеСлаги, закрытые, new Set([...вКарте, жертва]));
		if (беды.length === 0) {
			console.error('✗ ПОДЛОГ НЕ ПОЙМАН: добавили в карту закрытую страницу, а сверка промолчала.');
			return 1;
		}
		console.log(`✓ Подлог пойман: ${беды[0]}`);
		// Вторая половина: на здоровой сборке та же сверка обязана промолчать.
		const чисто = расхождения(всеСлаги, закрытые, вКарте);
		if (чисто.length > 0) {
			console.error('✗ А на здоровой сборке сверка красная — значит она ловит себя, а не подлог:');
			for (const б of чисто.slice(0, 5)) console.error('   ' + б);
			return 1;
		}
		console.log('✓ На здоровой сборке сверка молчит. Умеет краснеть по делу.');
		return 0;
	}

	const беды = расхождения(всеСлаги, закрытые, вКарте);
	if (беды.length > 0) {
		console.error(`✗ Разметка и карта сайта разошлись в ${беды.length} случаях:`);
		for (const б of беды.slice(0, 20)) console.error('   ' + б);
		if (беды.length > 20) console.error(`   …и ещё ${беды.length - 20}`);
		return 1;
	}
	console.log(
		`ок      Разметка и карта сайта согласны: страниц тайтлов ${всеСлаги.size}, ` +
			`закрыто ${закрытые.size}, в карте ${вКарте.size}.`,
	);
	return 0;
}

// Русские буквы в пути: import.meta.url их кодирует, process.argv[1] — нет.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	process.exitCode = await главная();
}
