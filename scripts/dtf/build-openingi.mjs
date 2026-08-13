// Пересборка поста «Самые важные опенинги в истории» (DTF 1589685).
//
// ЗАГОЛОВКИ ТУТ — НАЗВАНИЯ ТАЙТЛОВ, значит ЧЕТВЁРТЫЙ уровень, как в обзорах-
// марафонах. Не пятый (там вопросы интервью) и не третий (там ТЕМЫ разделов
// в подборках 2023: «Ожидаемые продолжения», «Трэш сезона»). Правило простое
// и уже записанное: тема раздела — третий, название тайтла — четвёртый.
//
// ССЫЛКУ В КАТАЛОГ ЗАГОЛОВКАМ СТАВИМ НЕ МЫ. Названия остаются обычным текстом,
// а решает `remark-anime` при сборке — тем же матчером, которым размечен весь
// сайт. Вписать ссылки руками значило бы завести вторую копию правила «по чему
// ищем», а такие копии разъезжаются молча (CLAUDE.md).
//
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКРЫТЬ АДМИНКУ (см. README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags, blockToParagraphs, postPath, frontmatter } from './source.mjs';
import { fetchImages } from './fetch-images.mjs';
import { writeGuarded } from './guard.mjs';

const ID = 1589685;
const SLUG = 'samye-vazhnye-openingi-v-istorii';
const PREFIX = 'dtf-openingi';

// Хвост площадки — выброшен, как в подборках 2023: комментариев на сайте нет
// вовсе, и призыв «делитесь в комментариях» читался бы обращением в пустоту.
const DROP = [{ why: 'призыв в комментарии', re: /делитесь в комментариях/i }];

export async function build({ write = true } = {}) {
	const article = await fetchArticle(ID);
	const images = await fetchImages(ID, PREFIX);

	const lines = [];
	const dropped = [];
	let img = 0;

	for (const block of article.blocks) {
		// Черта-разделитель опущена: начало блока отмечает заголовок (§5 дизайна).
		if (block.type === 'delimiter') continue;

		if (block.type === 'media') {
			for (const _item of block.data.items) {
				// Картинка тут одна — обложка, и подписи у неё нет ни в одном
				// из перенесённых постов.
				lines.push(`::image{src="${images[img++].src}" alt="" width="column"}`);
			}
			continue;
		}

		if (block.type === 'video') {
			// РОЛИКИ ОСТАЮТСЯ РОЛИКАМИ, ВКЛЮЧАЯ ПОСЛЕДНИЙ. Он — выпуск подкаста
			// «Врата аниме №9», и выпуск этот на сайте ЕСТЬ (`ep-67`), то есть
			// напрашивалось увести читателя туда, как сделано со ссылкой
			// на `ep-47` в «Магической битве». Но `ep-67` — ЧЕРНОВИК: ссылка
			// вела бы в никуда, и опубликуй заказчик эту статью — читатель
			// упёрся бы в 404. Опубликует выпуск — поменяем одной строкой.
			lines.push(`::video{youtube="https://www.youtube.com/watch?v=${block.data.video.data.external_service.id}"}`);
			continue;
		}

		if (block.type === 'header') {
			lines.push(`#### ${stripTags(block.data.text)}`);
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

	const cover = images[0].src;
	const file = postPath(SLUG);
	const live = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
	const liveHead = live ? live.split(/^---$/m)[1].trim() : '';
	const fieldOf = (name) => liveHead.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? null;

	// Третий раз подряд под адресом лежит привезённый из телеграма АНОНС
	// (сообщение 967). Свой пост узнаётся по обложке.
	const ours = fieldOf('cover') === cover;

	const head = ours
		? ['---', liveHead.replace(/^cover: .*$/m, `cover: ${cover}`), '---', ''].join('\n')
		: frontmatter({
			title: fieldOf('title') ?? article.title,
			// Тут анонс и статья вышли В ОДИН ДЕНЬ, и развилки с датой,
			// как у «Магической битвы», нет вовсе.
			date: new Date(article.date * 1000).toISOString().slice(0, 10),
			cover,
			category: 'article',
			extra: ['tgId', 'tgUrl'].flatMap((name) => (fieldOf(name) === null ? [] : [`${name}: ${fieldOf(name)}`])),
		});

	const refs = live ? (live.split(/^---$/m).slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? []) : [];
	const text = head + '\n' + [...lines, ...refs].join('\n\n') + '\n';
	// Заслон: пересборка не имеет права стереть правку заказчика (guard.mjs).
	if (write) writeGuarded(file, text, { force: process.argv.includes('--force') });

	return { text, lines, dropped, images, article };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	const { lines, dropped, images } = await build();
	console.log(`заголовков тайтлов: ${lines.filter((l) => l.startsWith('#### ')).length}`);
	console.log(`роликов: ${lines.filter((l) => l.startsWith('::video')).length} | картинок: ${images.length}`);
	console.log(`абзацев: ${lines.filter((l) => !l.startsWith('#') && !l.startsWith('::')).length}`);
	for (const d of dropped) console.log(`   выброшено (${d.why}): «${d.text}»`);
}
