#!/usr/bin/env node
// Поставить галочку «Забрать картинки с сервера» сразу многим постам
// (тз/07, задача 7.5).
//
// ЗАЧЕМ ЭТО ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ВТОРОЙ РОБОТ. Забирает картинки
// по-прежнему `telegram-photos.mjs` — он один знает, куда их класть, как
// уменьшать, когда ставить обложку и когда галочку снимать нельзя. Этот скрипт
// не умеет ничего из перечисленного и не должен: он только ставит галочку,
// то есть делает руками заказчика то же, что тот делает мышью в админке.
// Вторая копия правил разъехалась бы молча — у поста, отмеченного пачкой,
// картинки встали бы иначе, чем у отмеченного вручную.
//
// ЗАЧЕМ НЕ «ЗАБРАТЬ ВСЁ». Весь архив картинок — около 258 МБ, и они остались бы
// в истории git НАВСЕГДА, включая посты, которые никогда не будут опубликованы.
// Ровно этого избегали в задаче 7.2. Поэтому пачка всегда ограничена, а сколько
// мегабайт приедет, говорится ДО того, как что-то произойдёт.
//
//   --export=<папка>       локальная папка ChatExport_… с result.json
//   --remote=<логин@адрес:/папка>  или взять result.json с сервера по sftp
//   --key=<файл>           закрытый ключ для sftp
//   --year=2022            пачка: посты этого года
//   --month=2022-05        пачка: посты этого месяца
//   --ids=356,563          пачка: эти номера сообщений
//   --write                поставить галочку; без него — разведка и вес
//   --posts=<папка>        где посты (по умолчанию src/content/posts)
//   --uploads=<папка>      где уже лежащие картинки
//
// Дальше картинки забирает обычный прогон робота:
//   node scripts/telegram-photos.mjs --remote=… --key=… --write

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupAlbums, photosOf } from './telegram-import.mjs';
import { localSource, remoteSource, setField, splitFrontmatter, field, unquote } from './telegram-photos.mjs';
import { photoFileName } from '../src/lib/telegramPhotos.mjs';

/**
 * Во сколько раз уменьшение до 1000 px облегчает картинку.
 *
 * СЧИТАЕТСЯ ПО УЖЕ ПРИВЕЗЁННЫМ, а не берётся из головы: у каждого файла
 * в загрузках известен вес, а вес его оригинала лежит в самом экспорте
 * (`photo_file_size`). Чем больше картинок привезено, тем точнее ответ,
 * и устареть он не может.
 *
 * Пока не привезено ничего, берётся 0.8 — доля, замеренная 10 августа 2026
 * на первых тридцати файлах. Число названо здесь, а не спрятано в формуле.
 */
export function shrinkRatio(uploadsDir, sizeById) {
	let before = 0;
	let after = 0;

	if (existsSync(uploadsDir)) {
		for (const name of readdirSync(uploadsDir)) {
			const id = Number(name.match(/^tg-(\d+)\.jpg$/)?.[1]);
			const original = sizeById.get(id);
			if (!id || !original) continue;
			before += original;
			after += readFileSync(join(uploadsDir, name)).length;
		}
	}

	return before ? { ratio: after / before, measured: true } : { ratio: 0.8, measured: false };
}

/** Посты-черновики с номером сообщения. */
export function draftsWithTgId(postsDir) {
	const out = [];
	for (const name of readdirSync(postsDir).filter((n) => n.endsWith('.md'))) {
		const raw = readFileSync(join(postsDir, name), 'utf8');
		const parts = splitFrontmatter(raw);
		if (!parts) continue;
		const tgId = Number(unquote(field(parts.head, 'tgId')));
		if (!tgId) continue;

		out.push({
			slug: basename(name, '.md'),
			file: join(postsDir, name),
			raw,
			head: parts.head,
			body: parts.body,
			tgId,
			date: unquote(field(parts.head, 'date')),
			draft: unquote(field(parts.head, 'draft')) === 'true',
			flagged: unquote(field(parts.head, 'pullMedia')) === 'true',
		});
	}
	return out;
}

/**
 * Кто попадает в пачку.
 *
 * УМОЛЧАНИЯ НЕТ: не назвал пачку — ничего не получил. Это та же мина, что
 * у порций импорта: человек забыл ключ, скрипт молча взял «всё», и 258 МБ
 * уехали в историю git навсегда.
 */
export function pick(posts, { year = null, month = null, ids = null } = {}) {
	if (ids?.length) {
		const want = new Set(ids);
		return posts.filter((p) => want.has(p.tgId));
	}
	if (month) return posts.filter((p) => p.date.startsWith(month));
	if (year) return posts.filter((p) => p.date.startsWith(String(year)));
	return null;
}

// ——— Запуск ———

function arg(name, fallback = null) {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

async function main() {
	const root = fileURLToPath(new URL('..', import.meta.url));
	const postsDir = arg('posts', join(root, 'src/content/posts'));
	const uploadsDir = arg('uploads', join(root, 'public/images/uploads'));
	const write = has('write');

	const source = arg('remote') ? remoteSource(arg('remote'), arg('key')) : arg('export') ? localSource(arg('export')) : null;
	if (!source) {
		console.error('Нужен ключ --export=<папка> или --remote=<логин@адрес:/папка>');
		process.exit(1);
	}

	const chosen = pick(draftsWithTgId(postsDir), {
		year: arg('year'),
		month: arg('month'),
		ids: (arg('ids', '') || '').split(',').filter(Boolean).map(Number),
	});

	if (!chosen) {
		console.error('Не названа пачка. Нужен один из ключей: --year=2022, --month=2022-05 или --ids=356,563.');
		process.exit(1);
	}

	const data = source.json('result.json');
	const byTgId = new Map(groupAlbums(data.messages).map((post) => [post.id, post]));
	const sizeById = new Map(data.messages.filter((m) => m.photo).map((m) => [m.id, m.photo_file_size ?? 0]));

	// ——— Что именно приедет ———
	const work = [];
	let bytes = 0;
	let already = 0;
	let published = 0;
	let noPhotos = 0;

	for (const post of chosen) {
		if (!post.draft) {
			published += 1;
			continue;
		}
		const found = byTgId.get(post.tgId);
		const photos = found ? photosOf(found) : [];
		if (!photos.length) {
			noPhotos += 1;
			continue;
		}
		const fresh = photos.filter((p) => !existsSync(join(uploadsDir, photoFileName(p.id))));
		already += photos.length - fresh.length;
		if (!fresh.length) continue;

		for (const photo of fresh) bytes += sizeById.get(photo.id) ?? 0;
		work.push({ post, fresh });
	}

	const shrink = shrinkRatio(uploadsDir, sizeById);

	console.log(`Постов в пачке: ${chosen.length}`);
	console.log(`  опубликованных пропущено: ${published} (их робот не трогает вовсе)`);
	console.log(`  без фотографий в экспорте: ${noPhotos}`);
	console.log(`  картинок уже лежит: ${already}`);
	console.log(`\nПРИЕДЕТ: постов ${work.length}, картинок ${work.reduce((s, w) => s + w.fresh.length, 0)}`);
	console.log(`  оригиналы весят ${mb(bytes)} МБ`);
	console.log(
		`  в репозиторий ляжет ≈${mb(bytes * shrink.ratio)} МБ после уменьшения до 1000 px` +
			(shrink.measured ? ` (доля ${shrink.ratio.toFixed(2)} замерена по уже привезённым)` : ' (доля 0.8 — замер 10 августа на тридцати файлах)'),
	);
	console.log('  И ЭТО НАВСЕГДА: попавшее в git остаётся в его истории.');

	const flagged = work.filter((w) => w.post.flagged).length;
	if (flagged) console.log(`\n  у ${flagged} из них галочка уже стоит — им ничего не меняется`);

	if (!write) {
		console.log('\nНичего не помечено. Чтобы поставить галочку — тот же запуск с ключом --write.');
		console.log('Потом картинки заберёт обычный прогон робота:');
		console.log('  node scripts/telegram-photos.mjs --remote=… --key=… --write');
		return;
	}

	let marked = 0;
	for (const { post } of work) {
		if (post.flagged) continue;
		// Галочка вписывается ТОЙ ЖЕ функцией, которой её снимает робот: формат
		// шапки сверен с админкой побайтно, и пересобирать файл своим кодом нельзя.
		const head = setField(post.head, 'pullMedia', 'true');
		writeFileSync(post.file, `---\n${head}\n---\n${post.body}`, 'utf8');
		marked += 1;
	}

	console.log(`\nГалочка поставлена у ${marked} постов.`);
	console.log('Теперь заберите картинки:');
	console.log('  node scripts/telegram-photos.mjs --remote=… --key=… --write');
}

// Сравнение ПУТЯМИ, а не строками адресов: в пути к проекту русские буквы,
// и `import.meta.url` кодирует их, а `process.argv[1]` — нет.
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
	await main();
}
