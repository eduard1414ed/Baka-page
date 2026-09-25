// ПЕРЕЛИНКОВКА — СТАТИЧНЫЙ МАКЕТ СТРАНИЦЫ РЕВЬЮ (сессия 2, шаг 1).
//
//   node scripts/crosslinks/review/mockup.mjs [id поста …]
//
// Собирает ОДИН html-файл без сервера: данные нескольких настоящих постов,
// стили, шрифты сайта и поведение вложены внутрь. Решения на нём не
// сохраняются. Пишет ~/baka-audit/crosslinks/review-макет.html — в репозиторий
// не пишет ничего. Код страницы тот же, что у рабочей версии (app.js,
// style.css): макет показывает ровно то, что потом будет работать.

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildReview, REPO } from './model.mjs';

const HERE = new URL('./', import.meta.url);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['detali-kotorye-nikto-ne-uvidit', 'spisok-pyati-tselebnyh-anime'];
const out = join(homedir(), 'baka-audit/crosslinks/review-макет.html');

const data = await buildReview({ only: ids });
for (const id of ids) if (!data.posts.some((p) => p.id === id)) throw new Error(`У поста ${id} нет основных кандидатов`);
data.posts.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
// В макете оба поста — одна «пачка», чтобы листались подряд.
for (const p of data.posts) p.batch = 1;

let css = await readFile(new URL('style.css', HERE), 'utf8');
for (const m of css.matchAll(/url\('fonts\/([^']+)'\)/g)) {
	const b64 = (await readFile(join(REPO, 'public/fonts', m[1]))).toString('base64');
	css = css.replace(m[0], `url(data:font/woff2;base64,${b64})`);
}
const js = await readFile(new URL('app.js', HERE), 'utf8');
const html = (await readFile(new URL('index.html', HERE), 'utf8'))
	.replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}</style>`)
	.replace('<script src="app.js"></script>', () => `<script>window.STATIC = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>\n<script>${js}</script>`)
	.replace('<title>Перелинковка — ревью</title>', '<title>Перелинковка — макет ревью</title>');
await writeFile(out, html);
console.log(`Макет: ${out} (${Math.round(html.length / 1024)} КБ, постов ${data.posts.length})`);
