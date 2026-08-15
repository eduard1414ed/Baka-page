// ПРАВКА 5 ЗАДАЧИ 19: ГОЛЫЙ АДРЕС Т—Ж И КИНОПОИСКА → ПОСТ-ССЫЛКА.
//
// Образец — опубликованный `10-samyh-ozhidaemyh-anime-leta-2026-goda`:
// категория «Статья», заполнено поле «Внешняя ссылка», адреса в теле нет.
//
// ЧТО ЭТО МЕНЯЕТ ПО СУЩЕСТВУ: у поста с заполненной «Внешней ссылкой»
// СВОЕЙ СТРАНИЦЫ НЕ СОЗДАЁТСЯ ВОВСЕ, карточка в ленте ведёт наружу
// (`src/lib/externalPost.mjs`). Это не вёрстка, а решение о материале,
// и принято оно заказчиком 13 августа 2026.
//
// ПОЛЕ «ПЛОЩАДКА» НЕ ЗАПОЛНЯЕМ. Сайт выводит название сам по домену —
// `SOURCE_BY_HOST` в `externalPost.mjs` знает и `t-j.ru`, и `kinopoisk.ru`.
// Вписать его руками значило бы завести вторую копию факта, у которого
// уже есть хозяин, — и она разъехалась бы при первом переименовании.
//
// АДРЕС ПЕРЕПИСЫВАЕТСЯ НА НОВЫЙ ДОМЕН Т—Ж. Решение заказчика: старый
// `journal.tinkoff.ru` не отвечает (проверено — не открывается даже корень),
// а тот же путь на `t-j.ru` отдаёт 200 во ВСЕХ 42 случаях. У поста-ссылки
// своей страницы нет, поэтому мёртвый адрес означал бы карточку в никуда.
//
// Запуск:
//   node scripts/archive-external-posts.mjs             — показать
//   node scripts/archive-external-posts.mjs --write     — записать
//   node scripts/archive-external-posts.mjs --selftest  — подлоги

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, parseBody } from './archive-clean-lib.mjs';
import { бедыШапки } from './frontmatter-guard.mjs';
import { сроком } from './retry.mjs';

const UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Площадки, чьи адреса превращаются в пост-ссылку. Список ЯВНЫЙ. */
const EXTERNAL_HOST = /^https?:\/\/(www\.)?(t-j\.ru|journal\.tinkoff\.ru|kinopoisk\.ru|hd\.kinopoisk\.ru)\//i;

/** Только Т—Ж отдаёт разметку роботу; Кинопоиск закрыт и обложки не даёт. */
const HAS_OG = /^https?:\/\/(www\.)?t-j\.ru\//i;

const txtOf = (n) =>
	n.type === 'text' || n.type === 'inlineCode' ? (n.value ?? '') : (n.children ?? []).map(txtOf).join('');

/** Старый домен Т—Ж → новый, путь тот же. */
export function modernUrl(url) {
	return String(url ?? '').replace(/^https?:\/\/(www\.)?journal\.tinkoff\.ru/i, 'https://t-j.ru');
}

/**
 * Абзац — голый адрес внешней площадки?
 * Именно ГОЛЫЙ: ссылка с подписью внутри рассказа это часть текста,
 * и превращать пост в ссылку из-за неё нельзя.
 */
function bareExternal(block) {
	if (block.type !== 'paragraph') return null;
	const t = txtOf(block).trim();
	if (!/^https?:\/\/\S+$/.test(t)) return null;
	return EXTERNAL_HOST.test(t) ? t : null;
}

/** Правка шапки: категория, внешняя ссылка, обложка. */
export function editHead(head, { url, cover }) {
	let lines = head.split('\n');

	// Категория «Заметка» → «Статья». Чужую категорию не трогаем.
	const cat = lines.findIndex((l) => /^category:\s*note\s*$/.test(l));
	if (cat !== -1) lines[cat] = 'category: article';

	// Внешняя ссылка: пустое поле заполняем, отсутствующее заводим.
	const extFilled = lines.findIndex((l) => /^externalUrl:\s*\S/.test(l) && !/^externalUrl:\s*(''|"")\s*$/.test(l));
	const extEmpty = lines.findIndex((l) => /^externalUrl:\s*(''|""|)\s*$/.test(l));
	if (extEmpty !== -1) {
		lines[extEmpty] = `externalUrl: ${url}`;
	} else if (extFilled !== -1) {
		// Уже заполнено — правим только домен, содержание оставляем автору.
		lines[extFilled] = `externalUrl: ${url}`;
	} else {
		const after = lines.findIndex((l) => /^category:\s*\S/.test(l));
		if (after === -1) return null;
		lines.splice(after + 1, 0, `externalUrl: ${url}`);
	}

	if (cover) {
		const covFilled = lines.findIndex((l) => /^cover:\s*\S/.test(l) && !/^cover:\s*(''|"")\s*$/.test(l));
		if (covFilled === -1) {
			const covEmpty = lines.findIndex((l) => /^cover:\s*(''|""|)\s*$/.test(l));
			if (covEmpty !== -1) lines[covEmpty] = `cover: ${cover}`;
			else {
				const after = lines.findIndex((l) => /^category:\s*\S/.test(l));
				if (after !== -1) lines.splice(after + 1, 0, `cover: ${cover}`);
			}

			// ГАЛОЧКА «БЕЗ ОБЛОЖКИ» ПОБЕЖДАЕТ ОБЛОЖКУ, И БЕЗ ЭТОГО ШАГА КАРТИНКА
			// НЕ ПОЯВИТСЯ ВОВСЕ. `postCardMedia.mjs`: `if (noCover) return null`.
			// У всех тридцати восьми она стоит — её ставил импорт из телеграма,
			// потому что в исходном посте картинки не было. Теперь картинка есть,
			// и решением заказчика 13 августа галочка снимается.
			//
			// ПИШЕМ `false`, А НЕ УДАЛЯЕМ СТРОКУ: именно так поле выглядит после
			// сохранения в админке, и расхождение дало бы разницу на весь файл
			// при первом же её сохранении.
			const nc = lines.findIndex((l) => /^noCover:\s*true\s*$/.test(l));
			if (nc !== -1) lines[nc] = 'noCover: false';
		}
	}

	return lines.join('\n');
}

/** Тело без голого адреса. */
export function stripUrl(body, url) {
	const blocks = parseBody(body).children ?? [];
	const target = blocks.find((b) => bareExternal(b) === url);
	if (!target) return null;
	const start = target.position.start.offset;
	let end = target.position.end.offset;
	while (end < body.length && /\s/.test(body[end])) end++;
	return (body.slice(0, start) + body.slice(end)).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
}

/** Кадр статьи со страницы Т—Ж. */
async function fetchOgImage(url) {
	try {
		const r = await fetch(url, сроком({ headers: { 'User-Agent': UA }, redirect: 'follow' }));
		if (!r.ok) return null;
		const html = await r.text();
		const m =
			html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)/i) ??
			html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
		if (!m) return null;
		const img = await fetch(m[1].replace(/^http:/, 'https:'), сроком({ headers: { 'User-Agent': UA } }));
		if (!img.ok) return null;
		const raw = Buffer.from(await img.arrayBuffer());
		// Заглушка весит копейки; настоящая обложка — десятки килобайт.
		if (raw.length < 10 * 1024) return null;

		// ПЕРЕЖИМАЕМ. Т—Ж отдаёт кадр 1080×573 в PNG по 600 КБ в среднем;
		// тридцать восемь таких — почти 23 МБ, и в git они лягут НАВСЕГДА
		// (удаление файла историю не уменьшает). Фотографии в PNG не хранят:
		// тот же кадр в JPEG весит впятеро меньше и на глаз не отличается.
		//
		// ФОРМАТ СПРАШИВАЕМ У БАЙТОВ, А НЕ У АДРЕСА. Первая версия брала
		// расширение из ссылки, и один файл уехал названный `.jpg`, будучи
		// PNG внутри: сборка делает копии по имени, и такая пара склеивается
		// с чужой (хвост №33 проекта).
		const sharp = (await import('sharp')).default;
		const buf = await sharp(raw)
			.resize({ width: 1200, withoutEnlargement: true })
			.jpeg({ quality: 82, mozjpeg: true })
			.toBuffer();
		return { buf, ext: 'jpg', src: m[1], wasBytes: raw.length };
	} catch {
		return null;
	}
}

async function main() {
	const write = process.argv.includes('--write');
	const posts = await readPostsRaw();
	const plan = [];

	for (const post of posts) {
		const blocks = parseBody(post.body).children ?? [];
		const hits = blocks.map(bareExternal).filter(Boolean);
		if (!hits.length) continue;
		const raw = hits[hits.length - 1];
		plan.push({
			post,
			raw,
			url: modernUrl(raw),
			changedHost: modernUrl(raw) !== raw,
			needsCover: HAS_OG.test(modernUrl(raw)) && !String(post.front?.cover ?? '').trim(),
			extra: hits.length > 1 ? hits.length - 1 : 0,
		});
	}

	console.log('═'.repeat(96));
	console.log(write ? 'ПРАВКА 5: ПОСТЫ-ССЫЛКИ — ЗАПИСЬ' : 'ПРАВКА 5: ПОСТЫ-ССЫЛКИ — ПОКАЗ, НИЧЕГО НЕ ПИШЕТСЯ');
	console.log('═'.repeat(96));
	console.log();

	const pub = plan.filter((p) => !p.post.draft);
	console.log(`Постов: ${plan.length} (черновиков ${plan.length - pub.length}, ОПУБЛИКОВАННЫХ ${pub.length})`);
	console.log(`Адрес переписывается на новый домен Т—Ж: ${plan.filter((p) => p.changedHost).length}`);
	console.log(`Обложку попробую взять со статьи: ${plan.filter((p) => p.needsCover).length}`);
	console.log(`Кинопоиск — обложки не отдаёт, останутся без неё: ${plan.filter((p) => !HAS_OG.test(p.url)).length}`);
	console.log('Поле «Площадка» не заполняется: сайт подставляет название по домену сам.');
	console.log();

	if (pub.length) {
		console.log('─'.repeat(96));
		console.log(`ОПУБЛИКОВАННЫЕ — ${pub.length}. ОНИ НА САЙТЕ.`);
		console.log('─'.repeat(96));
		for (const p of pub) console.log(`  ${p.post.id}: ${p.raw}\n      → ${p.url}`);
		console.log();
	}

	console.log('─'.repeat(96));
	console.log('КИНОПОИСК — ОБЛОЖКИ НЕ БУДЕТ');
	console.log('─'.repeat(96));
	for (const p of plan.filter((x) => !HAS_OG.test(x.url))) console.log(`  ${p.post.id}: ${p.url}`);
	console.log();

	for (const p of plan.slice(0, write ? 0 : 8)) {
		console.log(`  ▸ ${p.post.id}  (${p.post.front?.category} → article${p.post.draft ? '' : ', ОПУБЛИКОВАН'})`);
		console.log(`      ${p.post.front?.title}`);
		console.log(`      внешняя ссылка: ${p.url}${p.changedHost ? '   ← домен переписан' : ''}`);
		if (p.extra) console.log(`      !! в теле ещё ${p.extra} таких адреса — убираю только последний`);
	}
	console.log();

	if (!write) {
		console.log('Ничего не записано. Для записи добавьте --write');
		return;
	}

	const { writeFile, mkdir } = await import('node:fs/promises');
	const { POSTS_DIR } = await import('./archive-clean-lib.mjs');
	const uploads = new URL('../public/images/uploads/', import.meta.url);
	await mkdir(uploads, { recursive: true });

	let covers = 0;
	const noCover = [];
	// ЗАСЛОН ПЕРЕД ЗАПИСЬЮ СОБИРАЕТ ВСЮ ПОРЦИЮ В ПАМЯТИ, а пишет потом.
	// Кривая шапка роняет сборку ВСЕГО САЙТА, а не свой файл: Astro читает
	// коллекцию целиком и падает на первом же нечитаемом посте. Половина
	// записанной порции тут хуже всего — сайт лежит, а виноватого искать
	// среди сотен файлов (доревизия задачи 15, находка 31).
	//
	// Адрес приезжает из ТЕЛА поста и подставляется в строку как есть — то есть
	// это чужие данные, а не наши. Скачивание обложек при этом остаётся здесь,
	// в первом проходе: оно ничего не портит, кладёт только картинки.
	const порция = [];
	for (const p of plan) {
		let cover = null;
		if (p.needsCover) {
			// УЖЕ СКАЧАННОЕ НЕ КАЧАЕМ ЗАНОВО. Повторный прогон не должен ходить
			// в сеть 38 раз ради тех же байтов — и не должен зависеть от того,
			// что Т—Ж ответит сегодня.
			const name = `tj-${p.post.id}.jpg`;
			const { access } = await import('node:fs/promises');
			let cached = false;
			try { await access(new URL(name, uploads)); cached = true; } catch {}
			const og = cached ? { buf: null, wasBytes: 0, cachedName: name } : await fetchOgImage(p.url);
			if (og) {
				if (og.buf) await writeFile(new URL(name, uploads), og.buf);
				cover = `/images/uploads/${name}`;
				covers++;
				console.log(
					og.buf
						? `  обложка ${p.post.id}: было ${Math.round(og.wasBytes / 1024)} КБ → стало ${Math.round(og.buf.length / 1024)} КБ`
						: `  обложка ${p.post.id}: взята из уже скачанного`,
				);
			} else {
				noCover.push(p.post.id);
			}
		}
		const head = editHead(p.post.head, { url: p.url, cover });
		const body = stripUrl(p.post.body, p.raw);
		if (!head || body === null) {
			console.error(`!! ${p.post.id}: правка не собралась, пост не тронут`);
			continue;
		}
		порция.push({ p, cover, текст: head + body });
	}

	// Шапку читает тот же `js-yaml`, каким её будет читать сборка, и сверяется
	// не «разобралось без ошибки», а ЧТО разобралось: YAML умеет прочитать
	// строку числом или датой, не поругавшись ни на что.
	const беды = порция.flatMap(({ p, cover, текст }) =>
		бедыШапки(p.post.id, текст, cover ? { externalUrl: p.url, cover, noCover: false } : { externalUrl: p.url }),
	);
	if (беды.length > 0) {
		console.error('\n✗✗ ШАПКА НЕ ЧИТАЕТСЯ ОБРАТНО — НЕ ЗАПИСАНО НИЧЕГО:');
		for (const беда of беды) console.error(`   ${беда}`);
		process.exit(1);
	}

	for (const { p, текст } of порция) await writeFile(new URL(p.post.file, POSTS_DIR), текст, 'utf8');
	console.log(`ЗАПИСАНО постов: ${порция.length}, обложек со статей: ${covers}. Шапка каждого прочитана обратно до записи.`);
	if (noCover.length) console.log(`Обложка не далась у ${noCover.length}: ${noCover.join(', ')}`);

	const again = [];
	for (const post of await readPostsRaw()) {
		const blocks = parseBody(post.body).children ?? [];
		if (blocks.map(bareExternal).filter(Boolean).length) again.push(post.id);
	}
	if (again.length) {
		console.log(`!! ПОВТОРНЫЙ ПРОГОН НАШЁЛ ЕЩЁ ${again.length}: ${again.join(', ')}`);
		process.exit(1);
	}
	console.log('Повторный прогон меняет 0 постов — правка идемпотентна.');
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
function selftest() {
	let bad = 0;
	const check = (got, want, note) => {
		if (got !== want) {
			console.log(`  ✗ ${note}\n      ожидалось: ${JSON.stringify(want)}\n      вышло:     ${JSON.stringify(got)}`);
			bad++;
		}
	};

	check(modernUrl('https://journal.tinkoff.ru/list/x/'), 'https://t-j.ru/list/x/', 'старый домен → новый');
	check(modernUrl('https://t-j.ru/list/x/'), 'https://t-j.ru/list/x/', 'новый домен не трогаем');
	check(modernUrl('https://www.kinopoisk.ru/a/'), 'https://www.kinopoisk.ru/a/', 'чужой домен не трогаем');

	check(
		editHead("---\ncategory: note\nexternalUrl: ''\ncover: ''\ndraft: true\n---", { url: 'https://t-j.ru/a/', cover: '/i/c.jpg' }),
		'---\ncategory: article\nexternalUrl: https://t-j.ru/a/\ncover: /i/c.jpg\ndraft: true\n---',
		'категория, ссылка и обложка',
	);
	check(
		editHead("---\ncategory: note\ncover: /images/uploads/moya.jpg\ndraft: true\n---", { url: 'https://t-j.ru/a/', cover: '/i/c.jpg' }),
		'---\ncategory: article\nexternalUrl: https://t-j.ru/a/\ncover: /images/uploads/moya.jpg\ndraft: true\n---',
		'ЧУЖУЮ ОБЛОЖКУ НЕ ПЕРЕЗАПИСЫВАЕМ',
	);
	check(
		editHead("---\ncategory: note\ncover: ''\nnoCover: true\ndraft: true\n---", { url: 'https://t-j.ru/a/', cover: '/i/c.jpg' }),
		'---\ncategory: article\nexternalUrl: https://t-j.ru/a/\ncover: /i/c.jpg\nnoCover: false\ndraft: true\n---',
		'ставим обложку — снимаем галочку «Без обложки»',
	);
	check(
		editHead("---\ncategory: note\nnoCover: true\ndraft: true\n---", { url: 'https://t-j.ru/a/', cover: null }),
		'---\ncategory: article\nexternalUrl: https://t-j.ru/a/\nnoCover: true\ndraft: true\n---',
		'ОБЛОЖКИ НЕТ — ГАЛОЧКУ НЕ ТРОГАЕМ',
	);
	const kept = editHead('---\ncategory: note\ndraft: true\n---', { url: 'https://t-j.ru/a/', cover: null });
	if (/draft:\s*false/.test(kept)) {
		console.log('  ✗ ГАЛОЧКА ЧЕРНОВИКА СНЯТА');
		bad++;
	}

	// Тело: голый адрес уходит, ссылка в рассказе остаётся.
	check(
		stripUrl('\nтекст\n\nhttps://t-j.ru/a/\n', 'https://t-j.ru/a/'),
		'\nтекст\n',
		'голый адрес уходит',
	);
	check(
		stripUrl('\nтекст\n\nhttps://t-j.ru/a/\n\nP.S. хвост\n', 'https://t-j.ru/a/'),
		'\nтекст\n\nP.S. хвост\n',
		'текст после адреса остаётся',
	);
	if (stripUrl('\nчитайте [статью](https://t-j.ru/a/) тут\n', 'https://t-j.ru/a/') !== null) {
		console.log('  ✗ ссылку внутри рассказа трогать нельзя');
		bad++;
	}

	console.log();
	console.log('Подлогов: 11. Из них «обязано НЕ тронуть»: 5.');
	if (bad) {
		console.log(`ПОДЛОГИ ПРОВАЛЕНЫ: ${bad}`);
		process.exit(1);
	}
	console.log('Все подлоги сошлись.');
}

const runDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
if (runDirectly) {
	if (process.argv.includes('--selftest')) selftest();
	else
		main().catch((err) => {
			console.error('ПРАВКА УПАЛА:', err);
			process.exit(1);
		});
}
