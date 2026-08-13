// Пересборка трёх подборок «Какое аниме стоит смотреть…» (зима, весна, лето 2023).
//
// Устроены иначе, чем обзоры-марафоны: заголовки — ТЕМЫ разделов, а не названия
// тайтлов, а в весенней и летней вместо картинок трейлеры с YouTube.
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКРЫТЬ АДМИНКУ (см. README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags, blockToParagraphs, splitIncut, postPath } from './source.mjs';
import { writeGuarded } from './guard.mjs';
import { captionFor } from './captions.mjs';
import { SEEN_2023 } from './titles-2023.mjs';

const { readAnimeCollection } = await import(new URL('../anime-cases-lib.mjs', import.meta.url).href);
const { buildAnimeMatcher, findMentions } = await import(new URL('../../src/lib/animeMentions.mjs', import.meta.url).href);

// Выброшено решением заказчика: комментарии — это DTF как площадка, а призывы
// подписаться на сайте дублируются блоком соцсетей под каждым материалом.
const DROP = [
	{ why: 'призыв к комментариям DTF', re: /Расскажите в комментариях/ },
	{ why: 'призыв подписаться', re: /не забывайте подписываться/i },
	{ why: 'врезка-реклама канала', re: /^Ещё больше интересных фактов|^Еще больше интересных фактов/ },
];

const JOBS = [
	{ id: 1546149, slug: 'zima23', out: 'kakoe-anime-stoit-smotret-etoy-zimoy-2023', incutLabel: 'другие продолжения' },
	{ id: 1696863, slug: 'vesna23', out: 'kakoe-anime-stoit-smotret-etoy-vesnoy-2023', incutLabel: 'другие продолжения' },
	{ id: 1922981, slug: 'leto23', out: 'kakoe-anime-stoit-smotret-etim-letom-2023', incutLabel: 'другие продолжения' },
];

const seenByFile = new Map(SEEN_2023.map((s) => [s.file, s]));

async function build() {
	const entries = await readAnimeCollection();
	const matcher = buildAnimeMatcher(entries.map((e) => ({ id: e.data.id, data: e.data })), { quotes: 'ignore' });
	const byId = new Map(entries.map((e) => [e.data.id, e.data]));
	const catalogFor = (name) => {
		const hit = findMentions(name, matcher).find((m) => m.start === 0 && m.end === name.length);
		return hit ? { id: hit.id, studio: byId.get(hit.id)?.studio ?? null } : null;
	};
	// Студия из авторского текста сильнее справочника — см. titles-2023.mjs.
	const captionOf = (seen) => {
		const studio = seen.studioInText ?? catalogFor(seen.title)?.studio ?? null;
		return studio ? `${seen.title}, студия ${studio}` : seen.title;
	};

	for (const job of JOBS) {
		const article = await fetchArticle(job.id);
		const lines = [];
		const anime = [];
		const dropped = [];
		const pending = [];
		let img = 0;
		let cover = null;

		const flush = (caption) => {
			for (const src of pending.splice(0))
				lines.push(caption ? `::image{src="${src}" alt="" caption="${caption}" width="column"}` : `::image{src="${src}" alt="" width="column"}`);
		};

		for (const block of article.blocks) {
			if (block.type === 'delimiter') continue;

			if (block.type === 'media') {
				for (const _ of block.data.items) {
					img++;
					const src = `/images/uploads/dtf-${job.slug}-${String(img).padStart(2, '0')}.webp`;
					if (!cover) cover = src;
					pending.push(src);
				}
				continue;
			}

			if (block.type === 'video') {
				// Трейлер с YouTube — штатный блок сайта (src/plugins/remark-video.mjs).
				flush(null);
				const id = block.data.video?.data?.external_service?.id;
				// Молчать нельзя: пропавший ролик заметить будет некому.
				if (!id) throw new Error('видеоблок без id ролика');
				lines.push(`::video{youtube="https://www.youtube.com/watch?v=${id}"}`);
				continue;
			}

			if (block.type === 'header') {
				flush(null);
				lines.push(`### ${stripTags(block.data.text)}`);
				continue;
			}

			if (block.type === 'incut') {
				// Врезку заменяет подпись блока — решение заказчика: своего блока
				// с рамкой на сайте нет. `<br>` внутри неё остаётся переносом
				// СТРОКИ, а не абзаца, иначе список рвётся на списки по пункту.
				const paragraphs = splitIncut(block.data.text);
				const head = paragraphs[0]?.replace(/\*\*/g, '').replace(/:\s*$/, '') ?? '';
				if (DROP.some((d) => d.re.test(head))) { dropped.push({ why: 'врезка-реклама канала', text: head.slice(0, 70) }); continue; }
				flush(null);
				lines.push(`::label{text="${job.incutLabel}"}`);
				for (const paragraph of paragraphs.slice(1)) lines.push(paragraph);
				continue;
			}

			if (block.type === 'text') {
				for (const paragraph of blockToParagraphs(block.data.text)) {
					const plain = paragraph.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*+/g, '');
					const rule = DROP.find((d) => d.re.test(plain));
					if (rule) { dropped.push({ why: rule.why, text: plain.slice(0, 70) }); continue; }
					if (pending.length) {
						const key = pending[0].match(/dtf-([a-z0-9]+-\d\d)\.webp$/)[1];
						const seen = seenByFile.get(key);
						flush(seen ? captionOf(seen) : null);
					}
					lines.push(paragraph);
				}
			}
		}
		flush(null);

		for (const seen of SEEN_2023) { const c = catalogFor(seen.title); if (c) anime.push(c.id); }

		const live = fs.readFileSync(postPath(job.out), 'utf8');
		const parts = live.split(/^---$/m);
		const frontmatter = ['---', parts[1].trim().replace(/^cover: .*$/m, `cover: ${cover}`), '---', ''].join('\n');
		const refs = parts.slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? [];

		// Заслон: пересборка не имеет права стереть правку заказчика (guard.mjs).
		writeGuarded(postPath(job.out), frontmatter + '\n' + [...lines, ...refs].join('\n\n') + '\n', { force: process.argv.includes('--force') });
		console.log(`\n=== ${job.out} ===`);
		console.log(`картинок: ${img} | роликов: ${lines.filter((l) => l.startsWith('::video')).length} | разделов: ${lines.filter((l) => l.startsWith('### ')).length}`);
		for (const d of dropped) console.log(`   выброшено (${d.why}): «${d.text}»`);
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await build();
