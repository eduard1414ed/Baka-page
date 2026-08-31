// НАЗВАНИЕ, ОПИСАНИЕ И ДАТА ВЫХОДА ВСТРОЕННЫХ РОЛИКОВ — ОДИН РАЗ И В РЕПОЗИТОРИЙ
// (TASK-markup, пункт 1.2; решение заказчика 31 августа 2026 «спрашивать
// у YouTube»).
//
// ЧЕГО НЕТ В ТЕКСТЕ ПОСТА. Ролик стоит блоком `::video{youtube="…"}`, и всё,
// что о нём известно сайту, — адрес. Разметке `VideoObject` нужны ещё три
// поля, и взять их можно только у самого YouTube.
//
// ПОЧЕМУ НЕ ПРИ КАЖДОЙ СБОРКЕ. Роботу на Hetzner сборка положена до четырёх
// раз в час. Сто тридцать пять роликов — это 270 обращений и около 190 МБ
// на каждый заход, причём за одним и тем же ответом: у вышедшего ролика
// название и дата не меняются. Поэтому спрашиваем один раз, кладём ответ
// в репозиторий, и сборка читает уже готовое, не выходя в сеть ни разу.
// Та же схема, что у справочника тайтлов: ходит скрипт, сборка читает кэш.
//
// ДВА ИСТОЧНИКА, И ЭТО НЕ ПЕРЕСТРАХОВКА:
//   oEmbed (2 КБ)        — официальный ответ YouTube, отдаёт НАЗВАНИЕ;
//   страница ролика (1,4 МБ) — оттуда дата выхода и полное описание, которых
//                          в oEmbed нет вовсе (проверено запросом, а не
//                          документацией).
// Чужая страница размечена для показа, а не для чтения, и разметка её однажды
// поменяется. Тогда отвалятся дата с описанием, а название останется:
// за него отвечает настоящий API.
//
//   node scripts/fetch-youtube-meta.mjs          — добрать недостающее
//   node scripts/fetch-youtube-meta.mjs --force  — перечитать всё заново
//
// ПОВТОРНЫЙ ЗАПУСК БЕСПЛАТЕН: нечего добирать — ни одного обращения в сеть.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { youtubeEmbedsInBody } from '../src/lib/youtube.mjs';
import { сПовторами, сроком } from './retry.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ФАЙЛ = join(ROOT, 'src/data/youtubeMeta.mjs');
const ПОСТЫ = join(ROOT, 'src/content/posts');

const force = process.argv.includes('--force');

/** Сколько роликов спрашиваем разом. Больше — невежливо к чужому серверу. */
const РАЗОМ = 4;

/** Паузы перед повторным заходом. Как у всех походов проекта. */
const ПАУЗЫ = [2000, 6000, 18000];

async function прежнее() {
	try {
		const модуль = await import(ФАЙЛ);
		return { ...modOrEmpty(модуль) };
	} catch {
		return {};
	}
}

const modOrEmpty = (модуль) => модуль?.youtubeMeta ?? {};

/** Название ролика — у официального oEmbed. */
async function название(id) {
	const ответ = await fetch(
		`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
		сроком(),
	);
	// 401/404 у oEmbed означают «ролик закрыт или удалён» — это ОТВЕТ,
	// а не сбой, и повторять его незачем.
	if (!ответ.ok) return { нет: ответ.status };
	const данные = await ответ.json();
	return { name: данные.title || null };
}

/** Дата выхода и описание — со страницы ролика. */
async function изСтраницы(id) {
	const ответ = await fetch(`https://www.youtube.com/watch?v=${id}`, {
		...сроком(),
		headers: { 'Accept-Language': 'ru' },
	});
	if (!ответ.ok) return {};
	const html = await ответ.text();

	const дата = html.match(/"uploadDate":"([^"]+)"/)?.[1] ?? null;
	const сырое = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1] ?? null;

	let описание = null;
	if (сырое) {
		// Внутри страницы описание лежит строкой JSON — со всеми `\n` и `&`.
		// Разбираем его разбором JSON, а не заменами руками: замены однажды
		// разойдутся с тем, как это на самом деле записано.
		try {
			описание = JSON.parse(`"${сырое}"`);
		} catch {
			описание = null;
		}
	}

	return { uploadDate: дата, description: описание };
}

async function спросить(id) {
	const имя = await сПовторами(() => название(id), { паузы: ПАУЗЫ, назвать: `название ${id}` });
	if (имя.нет) return { недоступен: имя.нет };

	const остальное = await сПовторами(() => изСтраницы(id), { паузы: ПАУЗЫ, назвать: `страница ${id}` });

	const запись = { ...имя, ...остальное };
	// Поля, которых не дали, в файл не кладём: пустая строка в разметке хуже
	// отсутствующего поля, а «не спрашивали» обязано отличаться от «нет».
	for (const ключ of Object.keys(запись)) if (запись[ключ] == null) delete запись[ключ];
	return запись;
}

// ── что вообще есть на сайте ───────────────────────────────────────────────

const файлы = (await readdir(ПОСТЫ)).filter((f) => f.endsWith('.md'));
const все = new Set();
for (const f of файлы) {
	for (const embed of youtubeEmbedsInBody(await readFile(join(ПОСТЫ, f), 'utf8'))) {
		все.add(embed.split('/').pop());
	}
}

const было = force ? {} : await прежнее();
const надо = [...все].filter((id) => !Object.hasOwn(было, id));

console.log(`Роликов в текстах: ${все.size}. Уже знаем: ${все.size - надо.length}. Спросить: ${надо.length}.`);

if (надо.length === 0) {
	console.log('ок      Про все ролики всё известно — в сеть не ходил.');
	process.exit(0);
}

const итог = { ...было };
const беды = [];

for (let i = 0; i < надо.length; i += РАЗОМ) {
	const пачка = надо.slice(i, i + РАЗОМ);
	const ответы = await Promise.all(
		пачка.map(async (id) => {
			try {
				return [id, await спросить(id)];
			} catch (error) {
				return [id, { сбой: String(error?.message ?? error) }];
			}
		}),
	);

	for (const [id, запись] of ответы) {
		if (запись.сбой) {
			// НЕ ЗАПИСЫВАЕМ: сбой сети — это «не спросили», а не «нечего дать».
			// Запиши мы его — следующий заход счёл бы ролик уже разобранным.
			беды.push(`${id}: ${запись.сбой}`);
			continue;
		}
		итог[id] = запись;
		const что = запись.недоступен ? `недоступен (${запись.недоступен})` : (запись.name ?? '').slice(0, 60);
		console.log(`  ${id} — ${что}`);
	}
}

// Пишем ЦЕЛИКОМ и в порядке имён: так разница между двумя прогонами читается
// глазами, а не выглядит перетасовкой файла.
const тело = Object.keys(итог)
	.sort()
	.map((id) => `\t${JSON.stringify(id)}: ${JSON.stringify(итог[id], null, '\t').replaceAll('\n', '\n\t')},`)
	.join('\n');

await writeFile(
	ФАЙЛ,
	`// Что YouTube рассказал о роликах, встроенных в тексты материалов.
// ФАЙЛ ПИШЕТ scripts/fetch-youtube-meta.mjs — руками не правьте, перезапишется.
//
// Читает его src/lib/schema.mjs: отсюда берутся name, description и uploadDate
// для VideoObject. Чего здесь нет — того нет и в разметке: пустое поле хуже
// отсутствующего, а выдуманное хуже пустого.
//
// \`недоступен\` — ролик закрыт или удалён, YouTube ответил таким кодом.
// Запись нужна, чтобы не спрашивать про него при каждом добавлении нового.
export const youtubeMeta = {
${тело}
};
`,
	'utf8',
);

console.log(`Записано роликов: ${Object.keys(итог).length} → src/data/youtubeMeta.mjs`);

if (беды.length > 0) {
	console.error(`✗ Не смог спросить про ${беды.length} роликов (сеть). Они не записаны — запустите ещё раз:`);
	for (const б of беды) console.error('   ' + б);
	process.exit(1);
}
