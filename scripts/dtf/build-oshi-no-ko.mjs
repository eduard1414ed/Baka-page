// Пересборка поста «Как Oshi no Ko вдохновляется трагедиями» (DTF 1853775).
//
// ЗАГОЛОВКИ — ИМЕНА РЕАЛЬНЫХ ЛЮДЕЙ, и уровень им ЧЕТВЁРТЫЙ. Лестница уровней
// в проекте такая: третий — тема раздела, четвёртый — то, ЧЕМУ раздел посвящён,
// пятый — вопрос интервью. Здесь каждый раздел посвящён одной истории, и назван
// он именем человека: это ровно четвёртый уровень, как названия тайтлов
// в обзорах-марафонах и опенингах. Третий не годится ещё и видом: он рисует
// вокруг заголовка скобки `[ … ]`, и «[ МАЮ ТОМИТА ]» читалось бы служебной
// меткой, а не именем.
//
// ПОДПИСЕЙ ПОД КАДРАМИ ТУТ НЕТ, И ЭТО РЕШЕНИЕ, А НЕ ЗАБЫВЧИВОСТЬ. На DTF они
// пустые. Сочинить их, как в «Магической битве», значило бы НАЗВАТЬ ПО ИМЕНИ
// реальных людей на фотографиях: пережившую нападение, погибшую и ребёнка.
// Проверить, что на снимке именно тот человек, нечем — а ошибка тут не «чужая
// обложка», а ложное опознание живого человека в связи с преступлением
// и смертью. Правило проекта «чужая обложка хуже отсутствующей» здесь
// действует во много раз сильнее. Захочет заказчик подписи — он знает
// источники снимков и подпишет сам.
//
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКРЫТЬ АДМИНКУ (см. README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags, blockToParagraphs, postPath, frontmatter } from './source.mjs';
import { fetchImages } from './fetch-images.mjs';
import { writeGuarded } from './guard.mjs';

const ID = 1853775;
const SLUG = 'kak-oshi-no-ko-vdohnovlyaetsya-tragediyami';
const PREFIX = 'dtf-oshi-no-ko';

// Хвост площадки — выброшен, как в подборках 2023 и остальных переносах.
const DROP = [{ why: 'реклама телеграм-канала', re: /^Ещё больше интересных фактов|^Еще больше интересных фактов/ }];

export async function build({ write = true } = {}) {
	const article = await fetchArticle(ID);
	const images = await fetchImages(ID, PREFIX);

	const lines = [];
	const dropped = [];
	let img = 0;

	for (const block of article.blocks) {
		if (block.type === 'delimiter') continue;

		if (block.type === 'media') {
			for (const _item of block.data.items) lines.push(`::image{src="${images[img++].src}" alt="" width="column"}`);
			continue;
		}

		if (block.type === 'header') {
			lines.push(`#### ${stripTags(block.data.text)}`);
			continue;
		}

		if (block.type === 'text' || block.type === 'incut') {
			for (const paragraph of blockToParagraphs(block.data.text)) {
				const plain = paragraph.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]+/g, '');
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
	const ours = fieldOf('cover') === cover;

	// ЗДЕСЬ АНОНСА ПОД АДРЕСОМ НЕТ — впервые за четыре последних переноса.
	// Похожий пост из телеграма в архиве есть («Вдохновленное трагедиями»,
	// сообщение 1270), но адрес у него свой, и он не анонс этой статьи,
	// а более ранний пост, чей текст статья потом вобрала одним из трёх
	// разделов. Трогать его не наше дело: это решение заказчика.
	const head = ours
		? ['---', liveHead.replace(/^cover: .*$/m, `cover: ${cover}`), '---', ''].join('\n')
		: frontmatter({
			title: fieldOf('title') ?? article.title,
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
	console.log(`разделов: ${lines.filter((l) => l.startsWith('#### ')).length} | картинок: ${images.length} (подписей нет — см. шапку скрипта)`);
	console.log(`абзацев: ${lines.filter((l) => !l.startsWith('#') && !l.startsWith('::')).length}`);
	for (const d of dropped) console.log(`   выброшено (${d.why}): «${d.text}»`);
}
