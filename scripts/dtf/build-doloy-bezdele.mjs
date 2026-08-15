// Пересборка поста «Долой безделье!» — интервью (DTF 1805563).
//
// ЧЕМ ОТЛИЧАЕТСЯ ОТ ОСТАЛЬНЫХ ПЯТИ. Это интервью, и устроено оно парами
// «вопрос — ответ»: заголовки статьи это ВОПРОСЫ ведущего, а абзацы под ними
// начинаются с имени говорящего полужирным («**Такамацу:** …») — так набрано
// в первоисточнике, и мы это сохраняем.
//
// ВОПРОСЫ СТАВИМ ПЯТЫМ УРОВНЕМ (`#####`), и вот почему именно им.
// На сайте мелких заголовков три, и все они 11 px моноширинного:
//   `###` — акцентный, КАПСОМ и в скобках `[ … ]`, которые рисует CSS;
//   `####` — чернилами и КАПСОМ;
//   `#####` — приглушённый, обычным написанием.
// Скобки вокруг вопроса — нелепость, а капслок на вопросе в 274 знака (самый
// длинный тут) читается криком. Пятый уровень в дизайн-системе заведён ровно
// под это: «самая мелкая ступень, ей достаётся обычная фраза, а не пометка
// из двух слов» (комментарий в global.css). Замер по метрикам самих шрифтов:
// все 16 вопросов занимают 24 строки в колонке 700 px, самый длинный — 4.
//
// ПОЧЕМУ НЕ ЖИРНЫЙ АБЗАЦ, что было бы обычным для интервью решением: жирным
// тут уже набраны ИМЕНА говорящих в начале ответов. Два полужирных подряд,
// означающих разное, — это не иерархия, а мельтешение.
//
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКРЫТЬ АДМИНКУ (см. README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags, blockToParagraphs, postPath, frontmatter } from './source.mjs';
import { fetchImages } from './fetch-images.mjs';
import { writeGuarded } from './guard.mjs';
import { escapeAttr } from '../../src/lib/directiveAttr.mjs';

const ID = 1805563;
const SLUG = 'doloy-bezdele-intervyu-s-rezhisserom-anime-i-avtorom-originalnoy-mangi';
const PREFIX = 'dtf-doloy-bezdele';

// Хвост площадки — выброшен, как в подборках 2023 и «Голубом периоде»
// (решение заказчика). Строка «Оригинал интервью — тут» ОСТАЁТСЯ: это указание
// на первоисточник, а не призыв подписаться.
const DROP = [{ why: 'теги площадки', re: /^#\S/ }];

export async function build({ write = true } = {}) {
	const article = await fetchArticle(ID);
	const images = await fetchImages(ID, PREFIX);

	const lines = [];
	const dropped = [];
	let img = 0;

	for (const block of article.blocks) {
		// Черта-разделитель опущена: начало блока отмечает заголовок, и отмечать
		// его дважды незачем (§5 дизайна, то же решение, что в обзорах).
		if (block.type === 'delimiter') continue;

		if (block.type === 'media') {
			for (const _item of block.data.items) {
				const { src, caption } = images[img++];
				lines.push(caption
					? `::image{src="${src}" alt="" caption="${escapeAttr(caption)}" width="column"}`
					: `::image{src="${src}" alt="" width="column"}`);
			}
			continue;
		}

		if (block.type === 'header') {
			lines.push(`##### ${stripTags(block.data.text)}`);
			continue;
		}

		if (block.type === 'text') {
			for (const paragraph of blockToParagraphs(block.data.text)) {
				const plain = paragraph.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*+/g, '');
				const rule = DROP.find((d) => d.re.test(plain));
				if (rule) { dropped.push({ why: rule.why, text: plain.slice(0, 70) }); continue; }
				lines.push(paragraph);
			}
			continue;
		}

		throw new Error(`неизвестный тип блока «${block.type}» — разобрать его нечем`);
	}

	// Обложка — первая картинка тела, как у остальных пяти постов.
	const cover = images[0].src;
	const file = postPath(SLUG);
	const live = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
	const liveHead = live ? live.split(/^---$/m)[1].trim() : '';
	const field = (name) => liveHead.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? null;

	// ПОД ЭТИМ АДРЕСОМ УЖЕ ЛЕЖАЛ ПОСТ, И ЭТО НЕ НАША РАБОТА. Регулярный импорт
	// привёз из телеграма анонс этой самой статьи (сообщение 1256): три абзаца
	// и ссылка на DTF, черновик. Заголовок у анонса тот же, значит и адрес тот
	// же — и первый прогон сборщика молча взял его шапку за свою, потому что
	// правило «шапку берём у живого файла» написано про ПОВТОРНУЮ сборку.
	//
	// Своим пост считается по обложке: она наша и другой у переноса быть
	// не может. Признак прямой — не номер блока, не дата, не число абзацев.
	const ours = field('cover') === cover;

	let head;
	if (ours) {
		// Шапка принадлежит заказчику: заголовок, «Тайтлы поста», метки.
		// Правим одну обложку — она предмет самой сборки (CLAUDE.md).
		head = ['---', liveHead.replace(/^cover: .*$/m, `cover: ${cover}`), '---', ''].join('\n');
	} else {
		// ПЕРЕЕЗД АНОНСА В СТАТЬЮ. Забираем себе ровно четыре поля, и каждое
		// названо с причиной:
		//   category — у анонса «Заметка», а это статья на 46 абзацев;
		//   date     — 11 мая это день анонса в канале, статья вышла 7-го,
		//              и правило проекта «дата настоящая, а не дата переноса»;
		//   cover    — у анонса её нет вовсе, теперь есть;
		//   noCover  — «обложки нет намеренно» перестало быть правдой.
		// ОСТАЛЬНОЕ ПЕРЕНОСИМ ИЗ ЖИВОГО ФАЙЛА, и `tgId` тут не мелочь: по нему
		// импорт узнаёт, что сообщение 1256 уже на сайте. Потеряй его — и робот
		// заведёт анонс ЗАНОВО, вторым файлом, рядом со статьёй.
		head = frontmatter({
			title: field('title') ?? article.title,
			date: new Date(article.date * 1000).toISOString().slice(0, 10),
			cover,
			category: 'article',
			extra: ['tgId', 'tgUrl'].flatMap((name) => (field(name) === null ? [] : [`${name}: ${field(name)}`])),
		});
	}

	// Метки `::anime-ref` принадлежат заказчику: по ним робот sync-anime
	// находит source/source-id. Пересборка не имеет права их стирать.
	const refs = live ? (live.split(/^---$/m).slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? []) : [];

	const text = head + '\n' + [...lines, ...refs].join('\n\n') + '\n';
	// Заслон: пересборка не имеет права стереть правку заказчика (guard.mjs).
	if (write) writeGuarded(file, text, { force: process.argv.includes('--force') });

	return { text, lines, dropped, images, article };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	const { lines, dropped, images } = await build();
	console.log(`вопросов: ${lines.filter((l) => l.startsWith('##### ')).length}`);
	console.log(`картинок: ${images.length} | с подписью: ${images.filter((i) => i.caption).length}`);
	console.log(`абзацев: ${lines.filter((l) => !l.startsWith('#') && !l.startsWith('::')).length}`);
	for (const d of dropped) console.log(`   выброшено (${d.why}): «${d.text}»`);
}
