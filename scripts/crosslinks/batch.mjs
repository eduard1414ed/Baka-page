// ПЕРЕЛИНКОВКА, КАНАЛ «ТЕМЫ» — ПАЧКИ ДЛЯ РАЗМЕТЧИКА (сессия 1б).
//
//   node scripts/crosslinks/batch.mjs --ids <файл> --out <папка> [--size 8] [--strip-existing]
//
// --ids   JSON: массив id или объект с полем posts: [{ id }] (как выборка.json).
//         Без --ids — все опубликованные посты со своей страницей.
// --size  постов в пачке (по умолчанию 8).
// --strip-existing  вопросы смыслового фильтра задаются так, будто вставок
//         в постах нет (как в проверке на 71): иначе пары, которые Эд уже
//         поставил, поисковик не предлагает и спросить про них нельзя.
//
// Пишет <папка>/пачка-NN.md — самодостаточный текст для одного помощника —
// и <папка>/пачки.json — какие посты в какой пачке и какие вопросы им заданы
// (по нему cards-check.mjs сверяет ответы). В репозиторий не пишет ничего.
//
// Существующие вставки `::material` в текст пачки НЕ попадают вовсе (номер
// блока пропускается): разметчик не должен видеть, куда Эд уже поставил ссылку.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadCorpus, classifyAnime, animeName } from './lib.mjs';
import { findTitleCandidates } from './finder.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const outDir = opt('--out', null);
if (!outDir) throw new Error('Нужен --out <папка>');
const size = Number(opt('--size', 8));
const strip = args.includes('--strip-existing');

const { posts: all, anime } = await loadCorpus();
const posts = all.filter((p) => p.published);
const byId = new Map(posts.map((p) => [p.id, p]));

let ids;
const idsFile = opt('--ids', null);
if (idsFile) {
	const raw = JSON.parse(await readFile(idsFile, 'utf8'));
	ids = (Array.isArray(raw) ? raw : raw.posts).map((x) => (typeof x === 'string' ? x : x.id));
} else {
	ids = posts.filter((p) => p.ownPage).map((p) => p.id);
}
for (const id of ids) if (!byId.has(id)) throw new Error(`Нет опубликованного поста ${id}`);

// Вопросы смыслового фильтра: средние и слабые кандидаты канала «тайтлы»
// (основные и запасные), по одному вопросу на пару «тайтл + абзац».
const { candidates } = findTitleCandidates({ posts, anime, stripExisting: strip });
const questions = new Map(); // источник → [{ q, anime, block, targets[] }]
for (const c of candidates) {
	if (!['средний', 'слабый'].includes(c.confidence)) continue;
	if (!['основной', 'запасной'].includes(c.status) || !c.place) continue;
	const r = c.reasons.find((x) => x.channel === 'titles');
	const aid = r.sourceAnime;
	// Без вставок поисковик перенумеровал блоки; текст пачки — в исходных номерах.
	const src = byId.get(c.source);
	const place = strip ? src.blocks.filter((b) => b.kind !== 'material')[c.place.anchorBlock].n : c.place.anchorBlock;
	// Спрашиваем про блок, где тайтл НАЗВАН, — ближайший до места вставки
	// (место бывает сдвинуто правилами: «не раньше 2-го абзаца», двоеточие).
	const named = src.blocks.filter((b) => b.anime?.[aid]).map((b) => b.n);
	const block = named.filter((n) => n <= place).pop() ?? named[0] ?? null;
	const list = questions.get(c.source) ?? [];
	let q = list.find((x) => x.anime === aid && x.block === block);
	if (!q) {
		q = { q: `Ф${list.length + 1}`, anime: aid, block, place, targets: [] };
		list.push(q);
	}
	q.targets.push({ target: c.target, title: c.targetTitle, level: c.confidence, status: c.status });
	questions.set(c.source, list);
}

const roleRu = { main: 'главный по счётчику', section: 'заголовок раздела / длинное поле', passing: 'мимоходом по счётчику' };
const catRu = { note: 'заметка', article: 'статья', bonus: 'бонус', podcast: 'выпуск подкаста', videoessay: 'видеоэссе' };

function render(p) {
	const cls = classifyAnime(p);
	const out = [];
	out.push(`## ПОСТ ${p.id}`, '');
	out.push(`- заголовок: ${p.title}`);
	out.push(`- вид: ${catRu[p.category] ?? p.category}${p.external ? ' (статья на чужом сайте — у нас только анонс)' : ''}; дата: ${p.date}`);
	const ids = Object.keys(cls);
	if (ids.length) {
		out.push('- тайтлы, которые узнал счётчик (id — название — сколько раз в тексте — как счётчик его понял):');
		for (const id of ids) out.push(`  - \`${id}\` — ${animeName(anime, id)} — ×${cls[id].count} — ${roleRu[cls[id].role]}`);
	} else out.push('- тайтлы, которые узнал счётчик: нет');
	out.push('', '### Текст (номер блока в квадратных скобках)', '');
	for (const b of p.blocks) {
		if (b.kind === 'material') continue;
		if (b.kind === 'text') out.push(`[${b.n}] ${b.plain}`);
		else if (b.kind === 'heading') out.push(`[${b.n}] ЗАГОЛОВОК: ${b.plain}`);
		else if (b.kind === 'anime-ref') out.push(`[${b.n}] (карточка тайтла \`${b.animeId}\`)`);
		else out.push(`[${b.n}] (${b.kind === 'image' ? 'картинка' : b.kind === 'video' ? 'видео' : 'служебный блок'})`);
	}
	const qs = questions.get(p.id) ?? [];
	if (qs.length) {
		out.push('', '### Вопросы смыслового фильтра', '');
		for (const q of qs) {
			const where = q.block == null ? 'в тексте не назван (только в заголовке или поле тайтлов) — суди по посту целиком' : `назван в блоке [${q.block}]`;
			out.push(`- **${q.q}**: тайтл \`${q.anime}\` (${animeName(anime, q.anime)}), ${where}. Кандидаты: ${q.targets.slice(0, 5).map((t) => `«${t.title}»`).join('; ')}${q.targets.length > 5 ? ` и ещё ${q.targets.length - 5}` : ''}.`);
		}
	}
	out.push('');
	return { text: out.join('\n'), questions: qs.map(({ q, anime, block, place }) => ({ q, anime, block, place })), mainAnime: ids.filter((id) => cls[id].role === 'main') };
}

await mkdir(outDir, { recursive: true });
const manifest = { made: new Date().toISOString(), strip, size, batches: [] };
for (let i = 0; i * size < ids.length; i++) {
	const chunk = ids.slice(i * size, (i + 1) * size);
	const name = `пачка-${String(i + 1).padStart(2, '0')}`;
	const rendered = chunk.map((id) => ({ id, ...render(byId.get(id)) }));
	const head = [
		`# ${name}: ${chunk.length} постов`,
		'',
		`Разметь каждый пост по инструкции \`scripts/crosslinks/разметчик.md\` и словарю`,
		'`статус/перелинковка/словарь.md`. Ответ — JSON-массив карточек в том же порядке.',
		'',
		'---',
		'',
	];
	await writeFile(join(outDir, `${name}.md`), head.join('\n') + rendered.map((r) => r.text).join('\n---\n\n'));
	manifest.batches.push({ name, posts: rendered.map(({ id, questions, mainAnime }) => ({ id, questions, mainAnime })) });
}
await writeFile(join(outDir, 'пачки.json'), JSON.stringify(manifest, null, 1));
const nq = manifest.batches.flatMap((b) => b.posts).reduce((s, p) => s + p.questions.length, 0);
console.log(`Постов ${ids.length}, пачек ${manifest.batches.length} по ${size}, вопросов фильтра ${nq}. Записано в ${outDir}`);
