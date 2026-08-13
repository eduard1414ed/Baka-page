// Пересборка поста «Обзор всех аниме зимы 2022» из пяти статей DTF
// и двух постов телеграма. Разбор — статус/задача-17-перенос-с-dtf.md.
//
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКАЗЧИКА ЗАКРЫТЬ АДМИНКУ: открытая вкладка держит
// свою копию поста и при сохранении пишет её поверх целиком.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, fetchArticle, stripTags, blockToParagraphs, postPath } from './source.mjs';
import { writeGuarded } from './guard.mjs';
import { captionFor } from './captions.mjs';

const { readAnimeCollection } = await import(new URL('../anime-cases-lib.mjs', import.meta.url).href);
const { buildAnimeMatcher, findMentions } = await import(new URL('../../src/lib/animeMentions.mjs', import.meta.url).href);

const SLUG = 'obzor-vseh-anime-zimy-2022';
// Части в порядке выхода. Картинки частей 1–4 лежат под номерами 06…21,
// картинки части 5 — под 01…05: дать всей серии сквозную нумерацию значило бы
// положить в историю git ещё 0,69 МБ ровно тех же байтов под новыми именами.
const PARTS = [
	{ n: 1, id: 1149385, imgFrom: 6 },
	{ n: 2, id: 1150944, imgFrom: 10 },
	{ n: 3, id: 1153300, imgFrom: 14 },
	{ n: 4, id: 1157405, imgFrom: 18 },
	{ n: 5, id: 1167923, imgFrom: 1 },
];
const COVER = '/images/uploads/dtf-zima-2022-cover.webp';

// ЧТО ВЫБРАСЫВАЕМ ПРИ СКЛЕЙКЕ — правилами по содержимому, а не по номерам
// блоков: номер сдвинется от любой правки статьи на DTF, а формулировка нет.
const DROP = [
	{ why: 'подводка части (повторяется у всех пяти)', re: /^Я решил устроить себе марафон/ },
	{ why: 'правила марафона (повторяются)', re: /^(Кратко правила|Правила такие):/ },
	{ why: 'навигация между частями', re: /четверку аниме можно посмотреть/ },
	{ why: 'подпись-призыв площадки', re: /^Больше от подкаста/ },
];

// Два обзора, которых на DTF нет вовсе: вышли только в телеграме (посты 115
// и 116). Тексты берутся ИЗ GIT — сами посты снесены как дубли.
const TG_TAIL = [
	{ file: 'obzor-vseh-anime-zimy-115', name: 'Медленная петля', img: '/images/uploads/zima-2022-tg-115.webp' },
	{ file: 'obzor-vseh-anime-zimy-116', name: 'Руководство гениального принца по вызволению страны из долгов', img: '/images/uploads/zima-2022-tg-116.webp' },
];

async function build() {
	const entries = await readAnimeCollection();
	const matcher = buildAnimeMatcher(entries.map((e) => ({ id: e.data.id, data: e.data })), { quotes: 'ignore' });
	const catalogId = (name) => {
		const hit = findMentions(name, matcher).find((m) => m.start === 0 && m.end === name.length);
		return hit ? hit.id : null;
	};

	// Обложка сверху отдельным блоком. Своей картинки-шапки у зимних частей нет
	// ни у одной: обложкой каждой служит иллюстрация внутри. Взята та, что DTF
	// считает обложкой ПЕРВОЙ части, — на странице она встречается дважды,
	// сверху и у «Девушек на линии фронта», ровно как на DTF.
	const lines = [`::image{src="${COVER}" alt="" width="column"}`];
	const anime = [];
	const dropped = [];
	const noLink = [];

	for (const part of PARTS) {
		const article = await fetchArticle(part.id);
		let img = part.imgFrom;
		const pending = [];

		for (const block of article.blocks) {
			if (block.type === 'delimiter') continue;

			// КАРТИНКА ИДЁТ ПОСЛЕ ЗАГОЛОВКА (правка заказчика 13 августа): на DTF
			// порядок обратный, и читатель первым делом видел картинку неизвестно
			// чего. Копим её и выкладываем на заголовке следующего тайтла; если
			// заголовка так и не встретилось — выкладываем как есть, чтобы
			// картинка не пропала молча.
			if (block.type === 'media') {
				for (const _ of block.data.items) pending.push(`/images/uploads/dtf-zima-2022-${String(img++).padStart(2, '0')}.webp`);
				continue;
			}

			if (block.type === 'header') {
				const name = stripTags(block.data.text);
				const id = catalogId(name);
				// Ссылки на AniList сняты по решению заказчика: заголовок либо ведёт
				// в наш каталог, либо остаётся текстом. Наружу не уводим.
				if (id) { anime.push(id); lines.push(`#### [${name}](/anime/${id}/)`); }
				else { noLink.push(name); lines.push(`#### ${name}`); }
				const caption = captionFor(name);
				for (const src of pending.splice(0)) lines.push(`::image{src="${src}" alt="" caption="${caption}" width="column"}`);
				continue;
			}

			if (block.type === 'text') {
				for (const paragraph of blockToParagraphs(block.data.text)) {
					if (pending.length) for (const src of pending.splice(0)) lines.push(`::image{src="${src}" alt="" width="column"}`);
					const plain = paragraph.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*+/g, '');
					const rule = DROP.find((d) => d.re.test(plain));
					// Подводка ПЕРВОЙ части — единственная, которая остаётся.
					if (rule && !(part.n === 1 && /^(Я решил устроить|Правила такие)/.test(plain))) {
						dropped.push({ part: part.n, why: rule.why, text: plain.slice(0, 80) });
						continue;
					}
					if (part.n === 1 && /^Правила такие:/.test(plain)) {
						// Решение заказчика: «Первые четыре тайтла:» в сборнике неправда.
						dropped.push({ part: 1, why: 'обрезано в подводке', text: 'Первые четыре тайтла:' });
						lines.push(paragraph.replace(/\s*Первые четыре тайтла:\s*$/, ''));
						continue;
					}
					lines.push(paragraph);
				}
			}
		}
		for (const src of pending.splice(0)) lines.push(`::image{src="${src}" alt="" width="column"}`);
	}

	// Хвост из телеграма. ТЕКСТ БЕРЁТСЯ ИЗ САМИХ ФАЙЛОВ, а не переписан сюда
	// руками: переписанная копия разъехалась бы с оригиналом.
	for (const tail of TG_TAIL) {
		const raw = execSync(`git -C ${JSON.stringify(ROOT)} show ee66b3fc:src/content/posts/${tail.file}.md`, { encoding: 'utf8' });
		const body = raw.split(/^---$/m).slice(2).join('---');
		const id = catalogId(tail.name);
		if (id) { anime.push(id); lines.push(`#### [${tail.name}](/anime/${id}/)`); }
		else { noLink.push(tail.name); lines.push(`#### ${tail.name}`); }
		lines.push(`::image{src="${tail.img}" alt="" caption="${captionFor(tail.name)}" width="column"}`);
		for (const paragraph of body.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)) {
			if (paragraph.startsWith('::anime-ref')) continue;
			// «Оценка» и «Смотреть дальше» стоят двумя строками в одном абзаце —
			// разводим по абзацам: markdown склеил бы их в одну строку.
			for (const line of paragraph.split(/\n/).map((s) => s.trim()).filter(Boolean)) lines.push(line);
		}
	}

	// ШАПКУ И СЛУЖЕБНЫЕ МЕТКИ БЕРЁМ ИЗ ЖИВОГО ФАЙЛА, А НЕ СОЧИНЯЕМ ЗАНОВО:
	// заголовок, поле «Тайтлы поста» и метки `::anime-ref` принадлежат
	// заказчику, и пересборка не имеет права их стирать. Обложка — единственное
	// поле, которое всё-таки правится: она предмет правки и обязана совпадать
	// с картинкой первого блока тела.
	const live = fs.readFileSync(postPath(SLUG), 'utf8');
	const parts = live.split(/^---$/m);
	const frontmatter = ['---', parts[1].trim().replace(/^cover: .*$/m, `cover: ${COVER}`), '---', ''].join('\n');
	const refs = parts.slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? [];

	// Заслон: пересборка не имеет права стереть правку заказчика (guard.mjs).
	writeGuarded(postPath(SLUG), frontmatter + '\n' + [...lines, ...refs].join('\n\n') + '\n', { force: process.argv.includes('--force') });

	console.log(`тайтлов: ${anime.length + noLink.length} | из справочника: ${new Set(anime).size} | без ссылки: ${noLink.length}`);
	console.log(`картинок: ${lines.filter((l) => l.startsWith('::image')).length} | служебных меток сохранено: ${refs.length}`);
	if (noLink.length) { console.log('\nБЕЗ ССЫЛКИ (нет в справочнике):'); noLink.forEach((n) => console.log('   ', n)); }
	console.log('\nВЫБРОШЕНО ПРИ СКЛЕЙКЕ:');
	for (const d of dropped) console.log(`   часть ${d.part}: ${d.why} — «${d.text}»`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await build();
