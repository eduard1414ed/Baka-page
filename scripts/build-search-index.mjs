// Сборка поискового индекса (тз/10, задача 2).
//
// Раньше здесь была одна команда: `pagefind --site dist`. Она обходит собранные
// страницы в dist/ и делает индекс. Всё, что ей нужно, — страница; всё, чего
// у неё нет, — способ добавить то, у чего страницы не существует.
//
// А у постов-ссылок на чужие сайты страницы нет и не должно быть
// (см. src/lib/externalPost.mjs). Поэтому вместо команды здесь тот же Pagefind,
// но вызванный из кода: сначала он так же обходит dist/, а потом мы дописываем
// в индекс записи «без страницы» — заголовок, описание и адрес чужой статьи.
// Это штатная возможность Pagefind (index.addCustomRecord), а не обходной путь.
//
// Список внешних постов приходит из /search-external.json — его собирает сама
// сборка сайта теми же функциями, что рисуют страницы. Разбирать файлы постов
// здесь нельзя: скрипт не знает про черновики и отложенную публикацию,
// а черновиков у нас 138 против 8 опубликованных.
//
// ЗАПУСКАЕТСЯ САМ из `npm run build`, отдельно вызывать не нужно.

import { readFile, rm } from 'node:fs/promises';
import * as pagefind from 'pagefind';

const SITE_DIR = 'dist';
const OUTPUT_DIR = `${SITE_DIR}/pagefind`;
const EXTERNAL_LIST = `${SITE_DIR}/search-external.json`;

/**
 * Внешние посты, которые сборка отдала отдельным файлом.
 *
 * «ФАЙЛА НЕТ» И «ФАЙЛ ИСПОРЧЕН» — РАЗНЫЕ ОТВЕТЫ, И ПУТАТЬ ИХ НЕЛЬЗЯ.
 * Прежде здесь стоял общий `catch { return [] }`, и любая беда читалась как
 * «внешних постов просто нет»: испорченный файл молча уносил из поиска все
 * 70 чужих статей, а выглядело это как «поиск их не находит» (ревизия
 * задачи 15, находка 15). Причину искали бы в поиске, а она была бы тут.
 *
 * ЛОМАЕМСЯ ГРОМКО — ровно как соседний шаг ниже: сборка кончится ошибкой,
 * и на живом адресе останется прежняя версия, где статьи в поиске есть.
 * Молчаливая пропажа хуже несобранного сайта: несобранное видно сразу.
 *
 * @returns {Promise<Array<object>>}
 */
async function readExternalRecords() {
	let текст;
	try {
		текст = await readFile(EXTERNAL_LIST, 'utf8');
	} catch (ошибка) {
		// Файла нет — это законно ровно в одном случае: внешних постов
		// в архиве нет вовсе. Любая другая беда чтения (нет прав, оборвался
		// диск) — не наш случай и обязана падать.
		if (ошибка.code === 'ENOENT') {
			console.log('Внешних постов сборка не отдала (файла нет) — в индекс идут только страницы.');
			return [];
		}
		throw ошибка;
	}

	let разобрано;
	try {
		разобрано = JSON.parse(текст);
	} catch (ошибка) {
		console.error(`Список внешних постов ${EXTERNAL_LIST} не читается: ${String(ошибка.message).split('\n')[0]}`);
		console.error('Это НЕ «внешних постов нет» — это испорченный файл. Молча выбросить из поиска');
		console.error('десятки чужих статей нельзя: выглядело бы это как «поиск сломался».');
		process.exit(1);
	}

	if (!Array.isArray(разобрано)) {
		console.error(`Список внешних постов ${EXTERNAL_LIST} прочитался не списком, а ${typeof разобрано}.`);
		process.exit(1);
	}

	return разобрано;
}

// СПИСОК ЧИТАЕТСЯ ПЕРВЫМ ДЕЛОМ, ДО ОБХОДА СТРАНИЦ. Обход занимает минуту,
// и падать после него из-за файла, который можно было прочитать сразу, —
// это минута работы в никуда при каждой сборке со сломанным списком.
const external = await readExternalRecords();

const { index, errors: createErrors } = await pagefind.createIndex();
if (!index) {
	console.error('Не удалось запустить Pagefind:', createErrors);
	process.exit(1);
}

const { page_count: pageCount, errors: dirErrors } = await index.addDirectory({ path: SITE_DIR });
if (dirErrors.length > 0) {
	console.error('Ошибки при обходе страниц:', dirErrors);
	process.exit(1);
}

for (const record of external) {
	const { errors } = await index.addCustomRecord(record);
	// Ломаемся громко: молча не попавшая в индекс статья выглядит как «поиск
	// её не нашёл», и искать причину пришлось бы месяцами (CLAUDE.md).
	if (errors.length > 0) {
		console.error(`Не удалось добавить в индекс ${record.url}:`, errors);
		process.exit(1);
	}
}

const { errors: writeErrors } = await index.writeFiles({ outputPath: OUTPUT_DIR });
if (writeErrors.length > 0) {
	console.error('Ошибки при записи индекса:', writeErrors);
	process.exit(1);
}

await pagefind.close();

// Служебный список внешних постов на сайте не нужен — он был нужен ровно этому
// скрипту. Убираем: лишний файл в dist/ это лишний файл в лимите Cloudflare
// и лишний адрес, который однажды придётся закрывать в robots.txt.
await rm(EXTERNAL_LIST, { force: true });

console.log(`Поисковый индекс: ${pageCount} страниц + ${external.length} внешних постов.`);
