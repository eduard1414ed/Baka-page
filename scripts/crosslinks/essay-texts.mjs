// ПЕРЕЛИНКОВКА — ТЕКСТЫ ВИДЕОЭССЕ ДЛЯ ВЫЖИМОК (сессия 1в, вариант Г).
//
//   node scripts/crosslinks/essay-texts.mjs [--out <папка>]
//
// Для каждого опубликованного видеоэссе берёт расшифровку тем же правилом, что
// сайт (src/lib/animeMentionIndex.mjs: поле `transcript`, иначе `audioGuid`),
// склеивает реплики в текст и пишет <папка>/<id поста>.txt (по умолчанию
// ~/baka-audit/crosslinks/1v/эссе-тексты/). Печатает, у кого расшифровки нет.
// Выжимки по этим текстам пишут помощники в статус/перелинковка/эссе/<id>.md.
// В репозиторий не пишет ничего.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readPostsRaw } from '../archive-clean-lib.mjs';
import { normalizeFrontmatter } from '../../src/lib/frontmatter.mjs';
import { isPublished } from '../../src/lib/publishing.mjs';

const TRANSCRIPTS = new URL('../../src/content/transcripts/', import.meta.url);
const args = process.argv.slice(2);
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(homedir(), 'baka-audit/crosslinks/1v/эссе-тексты');

const now = new Date();
const essays = (await readPostsRaw())
	.map((r) => ({ id: r.id, data: normalizeFrontmatter(r.front) }))
	.filter((p) => p.data.category === 'videoessay' && isPublished({ draft: p.data.draft, publishAt: p.data.publishAt }, now));

await mkdir(outDir, { recursive: true });
let total = 0;
const missing = [];
const rows = [];
for (const p of essays) {
	const tid = p.data.transcript ?? p.data.audioGuid ?? null;
	const file = tid ? new URL(`${tid}.json`, TRANSCRIPTS) : null;
	if (!file || !existsSync(file)) {
		missing.push(`${p.id} (${tid ?? 'нет ни transcript, ни audioGuid'})`);
		continue;
	}
	const t = JSON.parse(await readFile(file, 'utf8'));
	const text = (t.replicas ?? []).map((r) => r.text).join(' ').replace(/\s+/gu, ' ').trim();
	await writeFile(join(outDir, `${p.id}.txt`), `${p.data.title}\n\n${text}\n`);
	total += text.length;
	rows.push([p.id, text.length]);
}
rows.sort((a, b) => a[1] - b[1]);
console.log(`Эссе опубликовано: ${essays.length}, с расшифровкой: ${rows.length}, знаков всего: ${total}`);
console.log(`Самые короткие: ${rows.slice(0, 3).map(([id, n]) => `${id} ${n}`).join(', ')}; самые длинные: ${rows.slice(-3).map(([id, n]) => `${id} ${n}`).join(', ')}`);
if (missing.length) console.log(`БЕЗ РАСШИФРОВКИ (${missing.length}):\n  ${missing.join('\n  ')}`);
console.log(`Записано в ${outDir}`);
