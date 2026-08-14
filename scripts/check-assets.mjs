#!/usr/bin/env node
// ФАЙЛЫ СТИЛЕЙ И СКРИПТОВ: ССЫЛКИ ЦЕЛЫ, И НИЧТО НИЧЕГО НЕ ЗАТЁРЛО.
//
// Зачем эта проверка появилась. 14 августа 2026 у файлов стилей убрали хеш
// из имени: он менялся от любой правки и переписывал ссылку в 1398 страницах
// из 1403, а заливка зеркала стоила 1405 операций записи вместо девяти.
//
// ЧЕМ ЭТО ОПАСНО. Имя бандла сборщик берёт у исходного файла, и таких имён
// по несколько: `index` есть у главной и у каталога, `[slug]` — у страницы
// поста и у страницы тайтла. Сними хеш неаккуратно — два разных файла
// получат одно имя, второй затрёт первый, и половина сайта останется
// без стилей. Сборка при этом пройдёт молча: ошибки нет, файл на месте,
// ссылка ведёт куда надо — просто внутри чужие правила.
//
// Поэтому проверок здесь две:
//   1. Каждая ссылка на `/_astro/…` из собранных страниц ведёт в живой файл.
//   2. В файлах стилей на месте приметы КАЖДОГО раздела сайта. Затри один
//      бандл другим — примета пропадёт, и это единственный способ увидеть
//      подмену: по именам и размерам она не видна.
//
//   npm run build && node scripts/check-assets.mjs
//
// Ключ --подлог: затереть один файл стилей другим и убедиться, что поймано.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const подлог = process.argv.includes('--подлог');

// Примета раздела — правило, которое есть ТОЛЬКО в его файле стилей.
// Пропала примета — значит бандл затёрт чужим.
const ПРИМЕТЫ = [
	{ файл: 'Layout.css', примета: '.main-nav', что: 'общая обвязка: шапка и подвал' },
	{ файл: 'index.css', примета: '.article-column', что: 'главная: колонка второго ряда' },
	{ файл: 'anime-index.css', примета: '.cat-stamp', что: 'каталог тайтлов' },
	{ файл: 'anime-slug.css', примета: '.mentions-grid', что: 'страница тайтла' },
	{ файл: 'posts-slug.css', примета: '.tr-block', что: 'страница материала: расшифровка' },
	{ файл: 'about.css', примета: '.host-photo', что: 'о проекте' },
	{ файл: 'search.css', примета: '.material-result', что: 'поиск' },
];

function всеФайлы(dir, out = []) {
	for (const item of readdirSync(dir, { withFileTypes: true })) {
		const путь = join(dir, item.name);
		if (item.isDirectory()) всеФайлы(путь, out);
		else out.push(путь);
	}
	return out;
}

function main() {
	if (!existsSync(join(DIST, 'index.html'))) {
		console.error('Папки dist/ нет или она пустая. Сначала npm run build.');
		process.exitCode = 1;
		return;
	}

	const страницы = всеФайлы(DIST).filter((f) => f.endsWith('.html'));
	let бед = 0;

	// ── Подлог: один файл стилей затирается другим ───────────────────────────
	let подложено = null;
	if (подлог) {
		const жертва = join(DIST, '_astro', 'index.css');
		const чужой = join(DIST, '_astro', 'about.css');
		if (!existsSync(жертва) || !existsSync(чужой)) {
			console.error('Подлог невозможен: нужных файлов стилей нет.');
			process.exitCode = 1;
			return;
		}
		подложено = { путь: жертва, было: readFileSync(жертва) };
		writeFileSync(жертва, readFileSync(чужой));
		console.log('ПОДЛОГ: index.css затёрт содержимым about.css.\n');
	}

	// ── 1. Ссылки на ресурсы ведут в живые файлы ─────────────────────────────
	const битые = new Map();
	let ссылок = 0;
	for (const стр of страницы) {
		const html = readFileSync(стр, 'utf8');
		for (const m of html.matchAll(/(?:href|src)="(\/_astro\/[^"]+)"/g)) {
			ссылок += 1;
			const путь = join(DIST, decodeURIComponent(m[1]));
			if (existsSync(путь) && statSync(путь).isFile()) continue;
			if (!битые.has(m[1])) битые.set(m[1], new Set());
			битые.get(m[1]).add('/' + relative(DIST, стр).replace(/index\.html$/, ''));
		}
	}
	console.log(`ссылок на /_astro/ просмотрено: ${ссылок} на ${страницы.length} страницах`);
	if (битые.size) {
		бед += 1;
		console.log(`✗ ССЫЛОК В НИКУДА: ${битые.size}`);
		for (const [адрес, где] of [...битые].slice(0, 5)) console.log(`    ${адрес} — например со страницы ${[...где][0]}`);
	} else {
		console.log('ок      все ссылки на файлы стилей и скриптов ведут в живые файлы');
	}

	// ── 2. Приметы разделов на месте ─────────────────────────────────────────
	for (const { файл, примета, что, проверять } of ПРИМЕТЫ) {
		if (проверять === false) continue;
		const путь = join(DIST, '_astro', файл);
		if (!existsSync(путь)) {
			бед += 1;
			console.log(`✗ файла нет вовсе: _astro/${файл} (${что})`);
			continue;
		}
		const есть = readFileSync(путь, 'utf8').includes(примета);
		if (!есть) бед += 1;
		console.log(`${есть ? 'ок     ' : '✗ ЗАТЁРТ'} _astro/${файл} — ${что}${есть ? '' : `: правила ${примета} в нём нет`}`);
	}

	if (подложено) writeFileSync(подложено.путь, подложено.было);

	if (подлог) {
		console.log(бед > 0 ? '\n✓ подлог пойман — проверка умеет находить' : '\n✗ ПОДЛОГ НЕ ПОЙМАН — проверка сломана');
		process.exitCode = бед > 0 ? 0 : 1;
		return;
	}

	console.log(бед === 0 ? '\n✓ файлы стилей и скриптов целы' : `\n✗ БЕД: ${бед}`);
	if (бед) process.exitCode = 1;
}

main();
