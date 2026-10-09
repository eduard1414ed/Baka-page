// Разметка СТРОКИ из шапки файла — тем же набором плагинов, что тело поста
// (сессия «Тесты-3», 9 октября 2026).
//
// ЗАЧЕМ. У теста пояснения к вопросам и тексты результатов лежат в шапке
// файла (`test.kind.questions[].explanation`, `test.results[].text`), а не
// телом поста — тело занято вступлением. Тело Astro размечает сама, строки
// из шапки — нет. Разметь мы их своим маленьким разборщиком, ссылка на тайтл,
// врезка `::material` и неразрывные пробелы в пояснении вышли бы не такими,
// как в статье. Поэтому плагины те же самые и в том же порядке:
// src/plugins/markdown-plugins.mjs, его же читает astro.config.mjs.
//
// ПЛАГИНЫ ГРУЗЯТСЯ С ДИСКА, В ОБХОД СБОРЩИКА, И ЭТО НЕ ПРИЧУДА. Этот файл
// зовёт страница, а код страниц сборщик упаковывает в свой файл в другом
// месте — и `import.meta.url` внутри плагинов (по нему они находят папки
// постов, тайтлов и картинок) показывал бы в пустоту. Урок CLAUDE.md «в коде
// из src/lib/ не полагаться на import.meta.url и пути к файлам»: сборщик
// их меняет, проверка молча отвечает «нет». Загруженные по настоящему пути,
// плагины видят свои папки так же, как при сборке постов.
//
// Путь — от папки проекта: сборку и сервер разработки всегда запускают
// из неё (npm run …). `pathToFileURL`, а не склейка строки: в пути к проекту
// русские буквы, и адрес обязан быть закодирован правильно.
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Один обработчик на всю сборку: создавать его на каждую строку дорого. */
let processor = null;

async function getProcessor() {
	processor ??= (async () => {
		const url = pathToFileURL(join(process.cwd(), 'src', 'plugins', 'markdown-plugins.mjs')).href;
		const { remarkPlugins } = await import(/* @vite-ignore */ url);
		return createMarkdownProcessor({ remarkPlugins });
	})();
	return processor;
}

/**
 * Markdown → HTML. Пусто на входе — пусто на выходе, без обёртки.
 *
 * Шапка поста плагинам НЕ передаётся (пустой `frontmatter`), и это нарочно:
 * по ней плагины ставят обложку в начало текста и маркировку рекламы, а
 * у пояснения к вопросу ни того ни другого быть не может — они принадлежат
 * телу поста и там уже стоят.
 *
 * @param {string | undefined | null} markdown
 * @returns {Promise<string>}
 */
export async function renderMarkdownString(markdown) {
	const text = String(markdown ?? '').trim();
	if (!text) return '';
	const { code } = await (await getProcessor()).render(text, { frontmatter: {} });
	return code;
}
