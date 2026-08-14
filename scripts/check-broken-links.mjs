#!/usr/bin/env node
// ССЫЛКИ ВНУТРИ САЙТА, ВЕДУЩИЕ В НИКУДА.
//
// Зачем отдельно от `baka-post-links`. Плагин сборки смотрит ИСХОДНИКИ и знает
// один вид ссылки — на пост. Здесь спрашивается СОБРАННАЯ ПАПКА и любые
// внутренние адреса: на тайтл, на раздел, на страницу, на файл. Разница
// не теоретическая: снесёшь тайтл из каталога — плагин промолчит, а ссылка
// с любой страницы станет четырёхсоткой.
//
// ЧЕРНОВИКИ СЮДА НЕ ПОПАДАЮТ ВОВСЕ, и это правильно: страницы у них нет,
// читателю их ссылки не видны. По исходникам «страница есть» неотличимо
// от «страницы нет» — потому и смотрим сборку.
//
// ОТСЮДА ЖЕ СЛЕПОЕ ПЯТНО, И ОНО НЕ СЛУЧАЙНО. Тело поста-ссылки на чужой сайт
// не рендерится нигде — своей страницы у такого поста нет, — поэтому битую
// ссылку внутри него эта проверка не увидит НИКОГДА. Читатель её тоже
// не увидит, так что для вопроса «что видно на сайте» ответ верный. Про тела
// таких постов спрашивает плагин сборки `baka-post-links`: он смотрит
// исходники. 14 августа 2026 два замера разошлись ровно на эти два случая,
// и правы оказались оба — вопросы у них разные.
//
// ВНЕШНИЕ АДРЕСА (http, mailto, tel) НЕ ПРОВЕРЯЮТСЯ. Это другой класс: чужой
// сайт может лежать минуту, отвечать отказом роботу или требовать входа,
// и «беда» у такой проверки бывает ложной чаще, чем настоящей. Однажды она
// уже выдала «517 из 517 с бедой» из-за русских букв в заголовке запроса.
//
//   npm run build && node scripts/check-broken-links.mjs
//
// Гонять вместе с check-css.mjs, check-hidden.mjs и check-anime-links.mjs.
//
// Ключ --подлог: подложить заведомо битую ссылку в собранную страницу
// и убедиться, что проверка её ловит. «Пусто» ничего не значит, пока
// не показано, что она умеет находить.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const подлог = process.argv.includes('--подлог');

function всеФайлы(dir, out = []) {
	for (const item of readdirSync(dir, { withFileTypes: true })) {
		const путь = join(dir, item.name);
		if (item.isDirectory()) всеФайлы(путь, out);
		else out.push(путь);
	}
	return out;
}

/** Есть ли по такому адресу что-нибудь в собранной папке. */
function есть(адрес) {
	const чистый = decodeURIComponent(адрес.split('#')[0].split('?')[0]);
	if (чистый === '/') return existsSync(join(DIST, 'index.html'));
	const путь = join(DIST, чистый);
	if (existsSync(путь)) return statSync(путь).isDirectory() ? existsSync(join(путь, 'index.html')) : true;
	// Адрес без косой на конце тоже законен: /about → /about/index.html.
	return existsSync(join(DIST, чистый, 'index.html')) || existsSync(`${путь}.html`);
}

function main() {
	if (!existsSync(join(DIST, 'index.html'))) {
		console.error('Папки dist/ нет или она пустая. Сначала npm run build.');
		process.exitCode = 1;
		return;
	}

	const страницы = всеФайлы(DIST).filter((f) => f.endsWith('.html'));

	// ── Подлог: одна страница временно получает битую ссылку ─────────────────
	let подложено = null;
	if (подлог) {
		подложено = join(DIST, 'index.html');
		const было = readFileSync(подложено, 'utf8');
		writeFileSync(подложено, было.replace('</body>', '<a href="/takoy-stranicy-net-nikogda/">подлог</a></body>'));
		console.log('ПОДЛОГ: в /index.html вписана ссылка на несуществующую страницу.\n');
	}

	const битые = new Map();
	let всего = 0;

	for (const стр of страницы) {
		const html = readFileSync(стр, 'utf8');
		const где = '/' + relative(DIST, стр).replace(/index\.html$/, '');
		for (const m of html.matchAll(/href="([^"]+)"/g)) {
			const адрес = m[1];
			// Внутренние — те, что начинаются с одной косой. `//` это чужой домен.
			if (!адрес.startsWith('/') || адрес.startsWith('//')) continue;
			всего += 1;
			if (есть(адрес)) continue;
			if (!битые.has(адрес)) битые.set(адрес, new Set());
			битые.get(адрес).add(где);
		}
	}

	if (подложено) {
		const было = readFileSync(подложено, 'utf8');
		writeFileSync(подложено, было.replace('<a href="/takoy-stranicy-net-nikogda/">подлог</a>', ''));
	}

	console.log(`страниц просмотрено: ${страницы.length}, внутренних ссылок: ${всего}`);

	if (подлог) {
		const поймано = битые.has('/takoy-stranicy-net-nikogda/');
		console.log(поймано ? '✓ подлог пойман — проверка умеет находить' : '✗ ПОДЛОГ НЕ ПОЙМАН — проверка сломана');
		if (!поймано) process.exitCode = 1;
		return;
	}

	if (битые.size === 0) {
		console.log('✓ битых внутренних ссылок нет ни одной');
		return;
	}

	let мест = 0;
	for (const где of битые.values()) мест += где.size;
	console.log(`\n✗ БИТЫХ АДРЕСОВ: ${битые.size}, встречаются на ${мест} страницах\n`);

	for (const [адрес, где] of [...битые].sort((a, b) => b[1].size - a[1].size)) {
		console.log(`  ${адрес}`);
		console.log(`      со страниц: ${[...где].slice(0, 3).join(', ')}${где.size > 3 ? ` и ещё ${где.size - 3}` : ''}`);
	}

	process.exitCode = 1;
}

main();
