// Пересборка поста «Реальные картины в манге „Голубой период“» (DTF 1247167).
//
// Две особенности, названные заказчиком:
//   1. абзац «Работа: …» становится ПОДПИСЬЮ картинок, которые стоят выше;
//   2. галереи (две картинки рядом) сохраняются галереями.
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКРЫТЬ АДМИНКУ (см. README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags, blockToParagraphs, postPath } from './source.mjs';
import { writeGuarded } from './guard.mjs';

const SLUG = 'realnye-kartiny-v-mange-goluboy-period';

// Хвост площадки — выброшен, как в подборках 2023 (решение заказчика).
const DROP = [{ why: 'призыв подписаться', re: /^Больше интересного и полезного в нашем телеграм/ }];
// «Глава XI» и подобные абзацы становятся заголовками наравне с «Глава I. …»
// (решение заказчика): на DTF вторая десятка осталась текстом, потому что
// у неё нет названий, а на сайте заголовки идут в оглавление для диктора.
const CHAPTER_TEXT = /^Глава [IVXL]+$/;
const WORK = /^Работа:\s*/;

async function build() {
	const article = await fetchArticle(1247167);

	// РАЗБИВАЕМ НА ГЛАВЫ ЗАРАНЕЕ, а не пишем в один проход: подпись «Работа: …»
	// стоит НИЖЕ своих картинок, иногда через абзац описания, и узнать её
	// на месте картинки нельзя — её ещё не встретили.
	const chapters = [{ head: null, blocks: [] }];
	for (const block of article.blocks) {
		if (block.type === 'delimiter') continue;
		const isChapterText = block.type === 'text'
			&& blockToParagraphs(block.data.text).length === 1
			&& CHAPTER_TEXT.test(stripTags(block.data.text));
		if (block.type === 'header' || isChapterText) { chapters.push({ head: stripTags(block.data.text), blocks: [] }); continue; }
		chapters[chapters.length - 1].blocks.push(block);
	}

	const lines = [];
	const dropped = [];
	let img = 0;
	let cover = null;

	for (const chapter of chapters) {
		if (chapter.head) lines.push(`### ${chapter.head}`);

		let caption = null;
		for (const block of chapter.blocks) {
			if (block.type !== 'text') continue;
			for (const paragraph of blockToParagraphs(block.data.text)) if (WORK.test(paragraph)) { caption = paragraph; break; }
			if (caption) break;
		}

		for (const block of chapter.blocks) {
			if (block.type === 'media') {
				// ГАЛЕРЕЯ СОБИРАЕТСЯ САМА: два `::image` подряд без текста между ними
				// склеивает remark-image-figure. Подпись у галереи ОДНА и ставится
				// первой картинке — дай её обеим, и плагин ругнётся в сборку.
				const group = block.data.items.length;
				for (let k = 0; k < group; k++) {
					img++;
					const src = `/images/uploads/dtf-blue-period-${String(img).padStart(2, '0')}.webp`;
					if (!cover) cover = src;
					const own = k === 0 && caption ? caption : null;
					lines.push(own ? `::image{src="${src}" alt="" caption="${own}" width="column"}` : `::image{src="${src}" alt="" width="column"}`);
				}
				if (caption) caption = null;
				continue;
			}

			if (block.type === 'incut') { for (const paragraph of blockToParagraphs(block.data.text)) lines.push(paragraph); continue; }

			if (block.type === 'text') {
				for (const paragraph of blockToParagraphs(block.data.text)) {
					const plain = paragraph.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*+/g, '');
					const rule = DROP.find((d) => d.re.test(plain));
					if (rule) { dropped.push({ why: rule.why, text: plain.slice(0, 70) }); continue; }
					// Абзац «Работа: …» уехал в подпись — вторым разом в тексте не нужен.
					if (WORK.test(paragraph)) continue;
					lines.push(paragraph);
				}
			}
		}
	}

	const live = fs.readFileSync(postPath(SLUG), 'utf8');
	const parts = live.split(/^---$/m);
	const frontmatter = ['---', parts[1].trim().replace(/^cover: .*$/m, `cover: ${cover}`), '---', ''].join('\n');
	const refs = parts.slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? [];

	// Заслон: пересборка не имеет права стереть правку заказчика (guard.mjs).
	writeGuarded(postPath(SLUG), frontmatter + '\n' + [...lines, ...refs].join('\n\n') + '\n', { force: process.argv.includes('--force') });

	const galleries = article.blocks.filter((b) => b.type === 'media' && b.data.items.length > 1).length;
	console.log(`картинок: ${img} | галерей: ${galleries} | глав: ${lines.filter((l) => l.startsWith('### ')).length}`);
	console.log(`подписей «Работа: …»: ${lines.filter((l) => l.includes('caption="Работа:')).length}`);
	for (const d of dropped) console.log(`   выброшено (${d.why}): «${d.text}»`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await build();
