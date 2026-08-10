#!/usr/bin/env node
// Подгрузка картинок в черновик по требованию (тз/07, задача 7.2).
//
// ЗАЧЕМ ЭТО НЕ КНОПКА. Sveltia CMS целиком выполняется в браузере и умеет
// только править файлы через GitHub: сходить на Hetzner за картинкой, уменьшить
// её и положить в репозиторий она не может. Настоящая кнопка потребовала бы
// третьего воркера вдобавок к cms-auth и publish-cron. Цена названа, вариант
// отвергнут заказчиком — вместо кнопки галочка «Забрать картинки с сервера»
// у поста и робот, который срабатывает на коммит админки.
//
// ЗАЧЕМ ВООБЩЕ ПО ТРЕБОВАНИЮ, А НЕ ВСЁ СРАЗУ. Весь архив — это ≈234 МБ,
// которые останутся в истории git НАВСЕГДА, включая картинки постов, которые
// никогда не будут опубликованы. В репозиторий попадает только то, с чем
// заказчик реально работает.
//
//   --export=<папка>    локальная папка ChatExport_… (для ручного прогона)
//   --remote=<логин@адрес:/папка>  забрать по sftp (так работает робот)
//   --key=<файл>        закрытый ключ для sftp
//   --write             записать; без него — разведка и отчёт
//   --notify=<файл>     написать текст письма, если что-то не вышло
//   --posts=<папка>     где посты (по умолчанию src/content/posts)
//   --uploads=<папка>   куда картинки (по умолчанию public/images/uploads)
//
// ЧЕГО ЭТОТ СКРИПТ НЕ ДЕЛАЕТ И НЕ ДОЛЖЕН:
//
//   • не трогает ОПУБЛИКОВАННЫЕ посты вовсе, даже если галочка стоит;
//   • не забирает картинку второй раз — признак наличие ФАЙЛА на диске,
//     а не запись в посте: запись правится руками, и удалённая руками
//     картинка не должна возвращаться назавтра;
//   • не снимает галочку, если картинок не привёз, — тихо снятая галочка
//     без картинок худший исход: заказчик решит, что картинок не было;
//   • не трогает галочку «Обложки нет намеренно» — она значит «фотографий
//     нет вовсе», а не «ещё не привезли», и путать их дорого;
//   • не публикует и не меняет ничего, кроме обложки, галочки и картинок
//     в тексте.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { groupAlbums, photosOf } from './telegram-import.mjs';
import { photoFileName, photoSrc, withPhotos, savePhoto } from '../src/lib/telegramPhotos.mjs';

/** Поле-галочка в посте. */
const FLAG = 'pullMedia';

// ——— Чтение и правка файла поста ———
//
// ПРАВИМ СТРОКАМИ, А НЕ ПЕРЕСОБИРАЕМ ФАЙЛ. Формат записи совпадает с тем, что
// пишет Sveltia, — это проверено в задаче 7.1 побайтно, сохранением поста без
// изменений. Пересобери мы файл своим кодом, расхождение хоть в пробеле дало бы
// правку на весь файл при первом же сохранении в админке.

function splitFrontmatter(raw) {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	return match ? { head: match[1], body: raw.slice(match[0].length) } : null;
}

const unquote = (value) => String(value ?? '').trim().replace(/^'([\s\S]*)'$/, '$1').replace(/^"([\s\S]*)"$/, '$1');

const field = (head, key) => head.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1] ?? null;

/** Заменить значение поля; поля нет — вписать перед «якорем» или в конец. */
function setField(head, key, value, anchor = 'noCover') {
	const line = new RegExp(`^${key}:.*$`, 'm');
	if (line.test(head)) return head.replace(line, `${key}: ${value}`);

	const before = new RegExp(`^${anchor}:.*$`, 'm');
	if (before.test(head)) return head.replace(before, (found) => `${key}: ${value}\n${found}`);
	return `${head}\n${key}: ${value}`;
}

// ——— Откуда берутся файлы экспорта ———
//
// ДВА ИСТОЧНИКА С ОДНИМ ЛИЦОМ: локальная папка (ручной прогон у меня на
// компьютере) и сервер по sftp (робот). Логика разбора не должна знать,
// откуда приехал файл.

function localSource(dir) {
	return {
		label: dir,
		json: (rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8')),
		fetch(list) {
			const got = new Map();
			for (const rel of list) if (existsSync(join(dir, rel))) got.set(rel, join(dir, rel));
			return got;
		},
	};
}

/**
 * Сервер по sftp.
 *
 * ИМЕННО SFTP, А НЕ SSH: жилец `tgexport` заперт в папке экспорта и командной
 * строки не имеет вовсе (`ForceCommand internal-sftp -R` в настройках сервера),
 * поэтому `ssh … cat` у него не выйдет — и это правильно. Ключ root в секреты
 * GitHub класть нельзя: у робота была бы вся машина, а ему нужно читать одну
 * папку.
 *
 * `-get`, а не `get`: минус велит sftp продолжать после ошибки. Без него первый
 * же ненайденный файл оборвал бы скачивание остальных, и вместо «нет одной
 * картинки» вышло бы «нет ни одной».
 */
function remoteSource(remote, key) {
	const cut = remote.lastIndexOf(':');
	if (cut === -1) throw new Error('--remote пишется как логин@адрес:/папка');
	const target = remote.slice(0, cut);
	const dir = remote.slice(cut + 1);
	const temp = mkdtempSync(join(tmpdir(), 'baka-tg-'));

	// Ответ sftp нам не нужен: файлы он кладёт на диск сам. Кодировку тут задавать
	// нельзя — она относилась бы и к вводу тоже.
	const run = (batch) => execFileSync('sftp', ['-q', ...(key ? ['-i', key] : []), '-b', '-', target], { input: batch, maxBuffer: 64 * 1024 * 1024 });

	return {
		label: remote,
		json(rel) {
			const to = join(temp, basename(rel));
			run(`get "${dir}/${rel}" "${to}"\n`);
			return JSON.parse(readFileSync(to, 'utf8'));
		},
		fetch(list) {
			if (!list.length) return new Map();
			const batch = list.map((rel) => `-get "${dir}/${rel}" "${join(temp, basename(rel))}"\n`).join('');
			run(batch);

			const got = new Map();
			for (const rel of list) {
				const to = join(temp, basename(rel));
				if (existsSync(to)) got.set(rel, to);
			}
			return got;
		},
	};
}

// ——— Разбор задания ———

/**
 * Посты, у которых стоит галочка.
 *
 * ОПУБЛИКОВАННЫЕ СЮДА НЕ ПОПАДАЮТ РАБОТОЙ, но попадают ОТЧЁТОМ: молча
 * пропустить пост с поставленной галочкой значило бы оставить заказчика ждать
 * картинок, которые никогда не приедут.
 */
export function postsWithFlag(postsDir) {
	const out = [];

	for (const name of readdirSync(postsDir).filter((n) => n.endsWith('.md'))) {
		const raw = readFileSync(join(postsDir, name), 'utf8');
		const parts = splitFrontmatter(raw);
		if (!parts) continue;
		if (unquote(field(parts.head, FLAG)) !== 'true') continue;

		out.push({
			slug: basename(name, '.md'),
			file: join(postsDir, name),
			raw,
			head: parts.head,
			body: parts.body,
			draft: unquote(field(parts.head, 'draft')) === 'true',
			tgId: Number(unquote(field(parts.head, 'tgId'))) || null,
			cover: unquote(field(parts.head, 'cover')),
			noCover: unquote(field(parts.head, 'noCover')) === 'true',
		});
	}

	return out;
}

/**
 * Что делать с каждым помеченным постом.
 *
 * `trouble` — причина, по которой галочку снимать НЕЛЬЗЯ. Она же уезжает
 * в задачу на GitHub, то есть письмом на почту.
 */
export function planWork(marked, byTgId) {
	return marked.map((post) => {
		if (!post.draft) return { post, trouble: 'пост опубликован — такие робот не трогает вовсе, даже с галочкой' };
		if (!post.tgId) return { post, trouble: 'у поста нет номера сообщения (поле «Номер поста в телеграме») — искать нечего' };

		const found = byTgId.get(post.tgId);
		if (!found) return { post, trouble: `сообщения №${post.tgId} в экспорте нет — возможно, экспорт старее этого поста` };

		const photos = photosOf(found);
		if (!photos.length) {
			return {
				post,
				trouble: `у сообщения №${post.tgId} в экспорте нет фотографий вовсе` +
					' — если их не было и в канале, снимите галочку руками',
			};
		}

		return { post, photos };
	});
}

// ——— Отчёт ———

function report(work, uploadsDir) {
	const lines = [];
	for (const item of work) {
		if (item.trouble) {
			lines.push(`  ✗ ${item.post.slug}\n      ${item.trouble}`);
			continue;
		}
		const fresh = item.photos.filter((p) => !existsSync(join(uploadsDir, photoFileName(p.id))));
		lines.push(
			`  • ${item.post.slug} (№${item.post.tgId})` +
				`\n      фотографий ${item.photos.length}: новых ${fresh.length}, уже на месте ${item.photos.length - fresh.length}`,
		);
	}
	return lines.join('\n');
}

// ——— Запуск ———

function arg(name, fallback = null) {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

async function main() {
	// fileURLToPath, а не .pathname: в пути к проекту русские буквы и пробел,
	// и .pathname отдаёт их закодированными — такой путь не открывается ничем,
	// а ошибка выглядит как «файла нет».
	const root = fileURLToPath(new URL('..', import.meta.url));
	const postsDir = arg('posts', join(root, 'src/content/posts'));
	const uploadsDir = arg('uploads', join(root, 'public/images/uploads'));
	const write = has('write');
	const notifyFile = arg('notify');

	const marked = postsWithFlag(postsDir);

	// РАННИЙ ВЫХОД ВАЖЕН. Робот срабатывает на КАЖДЫЙ коммит с постами — то есть
	// на каждое сохранение в админке. Без этой проверки он ходил бы на сервер
	// за восьмимегабайтным result.json по любому поводу.
	if (!marked.length) {
		console.log('Галочка «Забрать картинки с сервера» не стоит ни у одного поста. Делать нечего.');
		return;
	}

	const source = arg('remote') ? remoteSource(arg('remote'), arg('key')) : arg('export') ? localSource(arg('export')) : null;
	if (!source) {
		console.error('Нужен ключ --export=<папка> или --remote=<логин@адрес:/папка>');
		process.exit(1);
	}

	console.log(`Экспорт: ${source.label}`);
	console.log(`Галочка стоит у постов: ${marked.length}`);
	console.log(write ? '\nРЕЖИМ ЗАПИСИ.\n' : '\nРАЗВЕДКА: не пишется ничего.\n');

	const data = source.json('result.json');
	const byTgId = new Map(groupAlbums(data.messages).map((post) => [post.id, post]));
	const work = planWork(marked, byTgId);

	console.log(report(work, uploadsDir));

	if (!write) {
		console.log('\nНичего не записано. Чтобы записать — тот же запуск с ключом --write.');
		return;
	}

	// ——— Скачивание ———
	//
	// Одним заходом на сервер за все посты сразу: соединение стоит секунды,
	// а картинок у поста бывает десяток.
	const needed = [];
	for (const item of work) {
		if (item.trouble) continue;
		item.fresh = item.photos.filter((p) => !existsSync(join(uploadsDir, photoFileName(p.id))));
		for (const photo of item.fresh) needed.push(photo.file);
	}

	const got = needed.length ? source.fetch(needed) : new Map();
	if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

	// ——— Запись ———
	const troubles = [];
	let touched = 0;
	let saved = 0;

	for (const item of work) {
		if (item.trouble) {
			troubles.push([item.post.slug, item.trouble]);
			continue;
		}

		// ЧЕГО НЕТ НА СЕРВЕРЕ — ГРОМКАЯ ОШИБКА. Забранное при этом не выбрасываем:
		// оно уже уменьшено и полезно, а галочка останется стоять и напомнит.
		const missing = item.fresh.filter((photo) => !got.has(photo.file));

		const srcs = [];
		for (const photo of item.photos) {
			const target = join(uploadsDir, photoFileName(photo.id));
			if (existsSync(target)) continue; // уже привезена раньше — второй раз не берём
			const from = got.get(photo.file);
			if (!from) continue;
			await savePhoto(from, target);
			saved += 1;
			srcs.push(photoSrc(photo.id));
		}

		if (missing.length) {
			troubles.push([
				item.post.slug,
				`на сервере не нашлось ${missing.length} из ${item.photos.length} фотографий` +
					` (${missing.map((p) => p.file).join(', ')})` +
					(srcs.length ? `; остальные ${srcs.length} привезены и уже в посте` : ''),
			]);
		}

		if (item.post.noCover && srcs.length) {
			console.log(`  ! у ${item.post.slug} стоит «Обложки нет намеренно», а картинки приехали — галочку не трогаю, посмотрите сами`);
		}

		// ОБЛОЖКУ СТАВИМ, ТОЛЬКО ЕСЛИ ЕЁ НЕТ И ПЕРВАЯ КАРТИНКА ПОСТА ИМЕННО
		// СЕЙЧАС ПРИЕХАЛА. Своя обложка заказчика сильнее догадки робота,
		// а если первая фотография привезена раньше и убрана из текста руками,
		// возвращать её назад нельзя — это отменяло бы его решение.
		const intoCover = !item.post.cover && srcs.length > 0 && srcs[0] === photoSrc(item.photos[0].id);
		const { cover, text } = withPhotos(item.post.body.trim(), srcs, { intoCover });

		let head = item.post.head;
		if (cover) head = setField(head, 'cover', cover);
		// ГАЛОЧКА СНИМАЕТСЯ, ТОЛЬКО ЕСЛИ НЕ ОСТАЛОСЬ НЕПРИВЕЗЁННОГО.
		if (!missing.length) head = setField(head, FLAG, 'false');

		writeFileSync(item.post.file, `---\n${head}\n---\n\n${text}\n`, 'utf8');
		touched += 1;
	}

	console.log(`\nПостов тронуто: ${touched}, картинок привезено: ${saved}.`);

	if (troubles.length) {
		console.log(`\nНЕ ВЫШЛО У ПОСТОВ: ${troubles.length} — галочка у них осталась стоять.`);
		for (const [slug, why] of troubles) console.log(`  ✗ ${slug}: ${why}`);
	}

	// ПИСЬМО — ТОЛЬКО КОГДА ЧТО-ТО НЕ ВЫШЛО. Удачную работу заказчик и так
	// увидит в админке: картинки на месте, галочка снята. Письмо о том, что всё
	// хорошо, через неделю перестают читать, и вместе с ним перестают читать
	// письма о том, что плохо.
	if (notifyFile && troubles.length) {
		const body = [
			`Галочку «Забрать картинки с сервера» я оставил стоять у ${troubles.length} ${troubles.length === 1 ? 'поста' : 'постов'} — картинок для них не нашлось.`,
			'',
			...troubles.map(([slug, why]) => `- **${slug}** — ${why}`),
			'',
			'Снять галочку, не привезя картинок, нельзя: вы решили бы, что картинок',
			'у поста и не было. Пока она стоит, я буду напоминать об этом при каждом',
			'сохранении в админке. Если картинок у поста правда нет — снимите её сами,',
			'а если пост должен остаться в ленте без картинки, поставьте ему',
			'«Обложки нет намеренно».',
		].join('\n');

		writeFileSync(notifyFile, `Картинки из телеграма: не вышло у ${troubles.length}\n\n${body}\n`, 'utf8');
	}
}

// Сравнение ПУТЯМИ, а не строками адресов: `import.meta.url` кодирует русские
// буквы, а `process.argv[1]` — нет, и обычное сравнение не совпадает никогда.
// Скрипт при этом не падает — он молча ничего не делает и выходит с кодом 0,
// то есть врёт ровно в сторону «всё хорошо».
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
	await main();
}
