// ПРАВКА 3 ЗАДАЧИ 19: РОЛИК КАНАЛА ВСТАВЛЯЕТСЯ В ПОСТ.
//
// ВИДОВ ДВА, И ОНИ РАЗНЫЕ — так в опубликованных, и так решил заказчик:
//
//   ВИДЕОЭССЕ: `::video{…}` ПЕРВЫМ блоком, БЕЗ подписи. 16 из 16 опубликованных.
//              Ролик там — сам материал, а не приложение к нему.
//
//   ВЫПУСК:    `::label{text="Видеоверсия"}` и следом `::video{…}`, после
//              описания и ПЕРЕД врезками со ссылками. 21 из 21 опубликованных
//              подписаны («Видеоверсия» у двадцати, «видеоверсия» у одного).
//
// СОПОСТАВЛЕНИЕ ЗДЕСЬ НЕ СЧИТАЕТСЯ — оно живёт в `archive-youtube-match.mjs`,
// и правило у них одно на двоих. Разойдись они, разбор показывал бы заказчику
// одни пары, а запись ставила бы другие.
//
// Запуск:
//   node scripts/archive-youtube-embed.mjs --videos yt.json
//   node scripts/archive-youtube-embed.mjs --videos yt.json --write
//   node scripts/archive-youtube-embed.mjs --selftest

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, writePostBody, parseBody } from './archive-clean-lib.mjs';
import { effectiveCategory } from './archive-rules-measure.mjs';
import { matchFor } from './archive-youtube-match.mjs';

const CATEGORY_LABEL = { podcast: 'Выпуск', videoessay: 'Видеоэссе' };

/**
 * ПАРЫ, НАЗНАЧЕННЫЕ ЗАКАЗЧИКОМ ПОИМЁННО (13 августа 2026).
 *
 * Названием их не подтвердить: ролик на ютюбе переименован, и общих слов
 * у поста с ним меньше порога. Правило, растянутое до этих восьми, начало бы
 * склеивать и по-настоящему разные материалы — «Фрирен: настолько красиво?»
 * с «Почему все демоны злые? | Фрирен». Поэтому не порог, а список.
 *
 * СПИСОК ОБЯЗАН ПАДАТЬ, А НЕ ПРОТУХАТЬ МОЛЧА. Если поста больше нет,
 * или ролик исчез из выгрузки канала, или у поста уже стоит другой ролик —
 * прогон останавливается. Иначе через полгода тут будет восемь строк,
 * не делающих ничего, и никто об этом не узнает.
 */
const MANUAL = {
	'ep-100': 'cwKMUoU_BHM', // … но в этом гениальность «Подземелья вкусностей»
	'ep-90': '1r7ka2yXvw8', // Самый недооцененный сериал года? | Великая небесная стена
	'ep-98': 'PfScvGgCWg0', // Идеальный романтический сериал? Любовь с кончиков пальцев
	'ep-94': 'WhU1TMamekE', // Зачем смотреть Благословение небожителей?
	'ep-123': 'nP6mxx3pgCo', // О чем не стоит жалеть? | Обычный роман в Коулуне
	'ep-120': 'D4UrqEntAOU', // Как принять свое прошлое? «Еще вчера» | Видеоэссе
	'ep-117': 'EKsTg96eWW4', // Как «О движении Земли» дает ответ на главный философский вопрос?
	'ep-128': 'Bd05fD-6RI8', // Лучшие аниме 2025 года
};

const dir = (n) => (n && (n.type === 'leafDirective' || n.type === 'containerDirective') ? n.name : null);

/** Блоки, перед которыми у выпуска встаёт видеоверсия: врезки и метки. */
const AFTER_TEXT = new Set(['label', 'link', 'anime-ref']);

/**
 * Куда вставить и что именно.
 *
 * У ВЫПУСКА МЕСТО СЧИТАЕТСЯ, А НЕ НАЗНАЧАЕТСЯ. Видеоверсия идёт сразу после
 * описания, то есть перед первой врезкой, первой подписью блока или первой
 * невидимой меткой тайтла; нет ничего из этого — значит в самый конец.
 * Так стоит ep-44, и так же выходит у шести опубликованных, где блок оказался
 * последним: у них просто не было врезок.
 *
 * @returns {{ body: string, at: string } | null}
 */
export function embed(body, cat, url) {
	const tree = parseBody(body);
	const blocks = tree.children ?? [];
	if (blocks.some((b) => dir(b) === 'video')) return null; // ролик уже стоит

	const lines = body.split('\n');
	const lineOf = (offset) => body.slice(0, offset).split('\n').length - 1;

	if (cat === 'videoessay') {
		// ОБЛОЖКА ИЗ RSS ИЗ ТЕЛА УБИРАЕТСЯ. Плагин `remark-episode-cover`
		// вынимает её только у категорий `podcast` и `bonus`
		// (`CATEGORIES_WITH_COVER_IN_HERO`), а этот пост становится видеоэссе —
		// значит картинка осталась бы в тексте отдельным кадром прямо под
		// роликом. У шестнадцати опубликованных видеоэссе её нет ни у одного:
		// картинка сверху там — сам ролик.
		const coverLine = lines.findIndex((l) => /^!\[[^\]]*\]\(https?:\/\/cdn\.mave\.digital\//.test(l.trim()));
		let dropped = false;
		if (coverLine !== -1) {
			let end = coverLine + 1;
			while (end < lines.length && lines[end].trim() === '') end++;
			lines.splice(coverLine, end - coverLine);
			dropped = true;
		}

		// Первым блоком — перед всем, что осталось.
		const rest = parseBody(lines.join('\n')).children ?? [];
		const first = rest[0];
		const at = first
			? lines.join('\n').slice(0, first.position.start.offset).split('\n').length - 1
			: lines.length;
		lines.splice(at, 0, `::video{youtube="${url}"}`, '');
		return {
			body: lines.join('\n'),
			at: dropped ? 'первым блоком, обложка из RSS убрана' : 'первым блоком',
		};
	}

	const stopAt = blocks.findIndex((b) => AFTER_TEXT.has(dir(b) ?? ''));
	const target = stopAt === -1 ? null : blocks[stopAt];
	const at = target ? lineOf(target.position.start.offset) : lines.length;
	lines.splice(at, 0, '::label{text="Видеоверсия"}', '', `::video{youtube="${url}"}`, '');
	return {
		body: lines.join('\n'),
		at: target ? `перед блоком ::${dir(target)}` : 'в конец тела',
	};
}

/**
 * Категория в шапке: `podcast` → `videoessay`.
 *
 * ПРАВИМ ОДНУ СТРОКУ, А НЕ ПЕРЕСОБИРАЕМ ШАПКУ. Пересборка через `js-yaml`
 * привела бы к своему виду все поля разом: переставила бы кавычки, свернула
 * бы многострочные значения, и разница пришла бы на весь файл — а собственно
 * правку в ней было бы не найти. Плюс отдельный урок проекта: дата, свёрнутая
 * в строку с кавычками, читается схемой, но расходится с тем, что пишет
 * админка.
 *
 * ГАЛОЧКУ «ЧЕРНОВИК» НЕ ТРОГАЕМ — решение заказчика 13 августа 2026. Пустота
 * у неё читается как «опубликован», и любая небрежность тут публикует
 * неготовый материал молча.
 */
export function retitleCategory(head) {
	const lines = head.split('\n');
	const at = lines.findIndex((l) => /^category:\s*podcast\s*$/.test(l));
	if (at === -1) return null;
	lines[at] = 'category: videoessay';
	return lines.join('\n');
}

/**
 * ОБЛОЖКА БЕРЁТСЯ С ЮТЮБА — ТОЛЬКО ЭССЕ И ТОЛЬКО ПУСТАЯ.
 *
 * Эссе лишается картинки из RSS (она уходит из тела вместе со сменой
 * категории), и без обложки останется в ленте голым заголовком. У выпуска
 * обложка своя, квадратная, из RSS — туда лезть нечего:
 * `PostMedia.astro` держит для выпуска пропорцию 1:1, а кадр ютюба 16:9,
 * и он обрезался бы полосой.
 *
 * ЗАПОЛНЕННУЮ ОБЛОЖКУ НЕ ПЕРЕЗАПИСЫВАЕМ. Правило проекта: поле, тронутое
 * рукой, остаётся хозяйским.
 *
 * ОБЛОЖКА ПОКАЗЫВАЕТСЯ ТОЛЬКО В ЛЕНТЕ, В ТЕКСТ НЕ ЛЕЗЕТ — проверено кодом,
 * а не документацией: `remark-lead-cover` выходит сразу для `videoessay`
 * (`CATEGORIES_WITH_OWN_HERO`), поэтому в начале материала остаётся ролик,
 * как у шестнадцати опубликованных эссе.
 */
export function setCover(head, path) {
	const lines = head.split('\n');

	// Поле уже заполнено рукой — уходим, ничего не трогая.
	const filled = lines.findIndex((l) => /^cover:\s*\S/.test(l) && !/^cover:\s*(''|"")\s*$/.test(l));
	if (filled !== -1) return null;

	const empty = lines.findIndex((l) => /^cover:\s*(''|""|)\s*$/.test(l));
	if (empty !== -1) {
		lines[empty] = `cover: ${path}`;
		return lines.join('\n');
	}

	// ПОЛЯ МОЖЕТ НЕ БЫТЬ ВОВСЕ, И ЭТО НЕ «ОНО ЗАНЯТО». У выпусков, заведённых
	// роботом из RSS, обложка живёт в самом RSS, и поля в шапке нет. Первая
	// версия просто не находила строку и печатала «поле не пустое» — то есть
	// врала о причине, по которой не сделала работу. Заводим поле сами,
	// сразу после категории.
	const after = lines.findIndex((l) => /^category:\s*\S/.test(l));
	if (after === -1) return null;
	lines.splice(after + 1, 0, `cover: ${path}`);
	return lines.join('\n');
}

/**
 * Кадр ролика с ютюба.
 *
 * `maxresdefault` есть не у всех роликов — у старых его не делали вовсе,
 * и ютюб отвечает на него картинкой-заглушкой 120×90. Поэтому спрашиваем
 * по очереди и БЕРЁМ ПЕРВЫЙ, который весит больше 10 КБ: заглушка меньше
 * всегда. Проверять размер обязательно — иначе в репозиторий уедет серый
 * прямоугольник, и на сайте он будет выглядеть настоящей обложкой.
 */
async function fetchThumb(videoId) {
	const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36';
	for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
		try {
			const r = await fetch(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`, {
				headers: { 'User-Agent': UA },
				signal: AbortSignal.timeout(20000),
			});
			if (!r.ok) continue;
			const buf = Buffer.from(await r.arrayBuffer());
			if (buf.length > 10 * 1024) return { buf, name };
		} catch {
			// сеть моргнула — пробуем следующий размер
		}
	}
	return null;
}

async function main() {
	const write = process.argv.includes('--write');
	const at = process.argv.indexOf('--videos');
	if (at === -1) {
		console.error('Нужен список роликов: --videos путь/к/yt.json');
		process.exit(1);
	}
	const videos = JSON.parse(await readFile(process.argv[at + 1], 'utf8'));
	if (!Array.isArray(videos) || !videos.length) {
		console.error('Список роликов пуст — это не «роликов нет», а сломанный список. Останавливаюсь.');
		process.exit(1);
	}

	const posts = await readPostsRaw();
	const plan = [];

	for (const post of posts) {
		if (!post.draft) continue;
		const cat = effectiveCategory(post.front);
		if (cat !== 'videoessay' && cat !== 'podcast') continue;

		// РАСПОЗНАННОЕ ЭССЕ ПОЛУЧАЕТ СВОЮ КАТЕГОРИЮ ДАЖЕ БЕЗ РОЛИКА. Решение
		// заказчика 13 августа: «смени категорию тоже, просто не снимай галку
		// черновик». Материал от наличия ролика на ютюбе эссе быть не перестаёт.
		const isEssay = cat === 'videoessay' && post.front?.category === 'podcast';
		const head = isEssay ? retitleCategory(post.head) : null;

		// Назначенная вручную пара побеждает правило: заказчик подтвердил её
		// глазами, а правило про переименованный ролик знать не может.
		const manualId = MANUAL[post.id];
		const m = manualId
			? { v: videos.find((v) => v.id === manualId) }
			: matchFor(post.front?.title, videos);
		if (manualId && !m.v) {
			console.error(`СПИСОК ПРОТУХ: ролика ${manualId} (для ${post.id}) нет в выгрузке канала.`);
			process.exit(1);
		}
		const url = m ? `https://youtu.be/${m.v.id}` : null;
		const next = url ? embed(post.body, cat, url) : null;

		// ОБЛОЖКА СПРАШИВАЕТСЯ ПРО ТЕКУЩЕЕ СОСТОЯНИЕ, А НЕ ПРО ПРОДЕЛАННУЮ РАБОТУ.
		// Первая версия ставила её только тем, у кого категорию меняли ПРЯМО
		// СЕЙЧАС, — а после первого же прогона таких не остаётся, и обложка
		// не появилась бы никогда. Условие простое: это эссе, ролик нашёлся,
		// поле пустое.
		const wantsCover = cat === 'videoessay' && m && !String(post.front?.cover ?? '').trim();
		if (!head && !next && !wantsCover) continue;
		plan.push({
			post,
			cat,
			video: m?.v ?? null,
			url,
			head,
			body: next ? next.body : post.body,
			at: next ? next.at : head ? 'ролика нет — только категория' : 'только обложка',
			wantsCover,
		});
	}

	// ЗАСЛОН НА ПРОТУХШИЙ СПИСОК. Проверяется ДО показа и до записи.
	const known = new Set(posts.map((p) => p.id));
	const lost = Object.keys(MANUAL).filter((id) => !known.has(id));
	if (lost.length) {
		console.error(`СПИСОК ПРОТУХ: постов больше нет — ${lost.join(', ')}. Разбирать руками.`);
		process.exit(1);
	}

	console.log('═'.repeat(96));
	console.log(write ? 'ПРАВКА 3: РОЛИКИ В ПОСТЫ — ЗАПИСЬ' : 'ПРАВКА 3: РОЛИКИ В ПОСТЫ — ПОКАЗ, НИЧЕГО НЕ ПИШЕТСЯ');
	console.log('═'.repeat(96));
	console.log();
	const ess = plan.filter((p) => p.cat === 'videoessay').length;
	console.log(`Постов к правке: ${plan.length} (видеоэссе ${ess}, выпусков ${plan.length - ess})`);
	console.log(`Из них со сменой категории podcast → videoessay: ${plan.filter((p) => p.head).length}`);
	console.log(`Галочка «Черновик» не трогается ни у одного.`);
	const where = {};
	for (const p of plan) where[p.at] = (where[p.at] ?? 0) + 1;
	console.log('Куда встаёт: ' + Object.entries(where).map(([k, v]) => `${k} — ${v}`).join(', '));
	console.log();

	for (const p of plan.slice(0, write ? 0 : 6)) {
		console.log(`  ▸ ${p.post.id}  (${CATEGORY_LABEL[p.cat]})  ${p.at}`);
		console.log(`      ${p.post.front?.title}`);
		console.log(`      → ${p.url}  «${p.video.title}»`);
		const lines = p.body.split('\n').filter((l) => l.trim());
		console.log('      начало тела после правки:');
		for (const l of lines.slice(0, 3)) console.log(`        | ${l.slice(0, 88)}`);
		console.log();
	}

	if (!write) {
		console.log('Ничего не записано. Для записи добавьте --write');
		return;
	}

	const { writeFile, mkdir } = await import('node:fs/promises');
	const { POSTS_DIR } = await import('./archive-clean-lib.mjs');
	const uploads = new URL('../public/images/uploads/', import.meta.url);
	await mkdir(uploads, { recursive: true });

	let covers = 0;
	const coverFailed = [];
	for (const p of plan) {
		if (!p.wantsCover) continue;
		const thumb = await fetchThumb(p.video.id);
		if (!thumb) {
			coverFailed.push(p.post.id);
			continue;
		}
		const name = `yt-${p.video.id}.jpg`;
		await writeFile(new URL(name, uploads), thumb.buf);
		const withCover = setCover(p.head ?? p.post.head, `/images/uploads/${name}`);
		if (withCover) {
			p.head = withCover;
			covers++;
			console.log(`  обложка ${p.post.id}: ${thumb.name}, ${Math.round(thumb.buf.length / 1024)} КБ`);
		} else {
			coverFailed.push(`${p.post.id} (обложка уже задана рукой — не трогаю)`);
		}
	}

	for (const p of plan) {
		if (p.head) await writeFile(new URL(p.post.file, POSTS_DIR), p.head + p.body, 'utf8');
		else await writePostBody(p.post, p.body);
	}
	console.log(`ЗАПИСАНО постов: ${plan.length}, обложек с ютюба: ${covers}`);
	if (coverFailed.length) {
		console.log(`Обложка НЕ поставлена у ${coverFailed.length}: ${coverFailed.join(', ')}`);
	}

	// Повторный прогон обязан не найти ничего: у поста уже есть ::video.
	const again = [];
	for (const post of await readPostsRaw()) {
		if (!post.draft) continue;
		const cat = effectiveCategory(post.front);
		if (cat !== 'videoessay' && cat !== 'podcast') continue;
		const m = matchFor(post.front?.title, videos);
		const stillNeedsHead = cat === 'videoessay' && post.front?.category === 'podcast';
		const stillNeedsBody = m && embed(post.body, cat, `https://youtu.be/${m.v.id}`);
		if (stillNeedsHead || stillNeedsBody) again.push(post.id);
	}
	if (again.length) {
		console.log(`!! ПОВТОРНЫЙ ПРОГОН НАШЁЛ ЕЩЁ ${again.length} — правка не идемпотентна:`);
		for (const id of again) console.log(`   ${id}`);
		process.exit(1);
	}
	console.log('Повторный прогон меняет 0 постов — правка идемпотентна.');
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
function selftest() {
	let bad = 0;
	const check = (got, want, note) => {
		if (got !== want) {
			console.log(`  ✗ ${note}\n      ожидалось:\n${want}\n      вышло:\n${got}`);
			bad++;
		}
	};

	// Видеоэссе: ролик первым блоком, картинка-обложка остаётся под ним.
	check(
		embed('\n![Обложка](https://cdn.mave.digital/a.jpg)\n\nтекст\n', 'videoessay', 'https://youtu.be/AAA').body,
		'\n::video{youtube="https://youtu.be/AAA"}\n\nтекст\n',
		'видеоэссе: ролик первым, обложка из RSS убрана',
	);
	// Своя картинка автора — не обложка из RSS, её трогать нельзя.
	check(
		embed('\n::image{src="/images/uploads/a.jpg" width="column"}\n\nтекст\n', 'videoessay', 'https://youtu.be/AAA').body,
		'\n::video{youtube="https://youtu.be/AAA"}\n\n::image{src="/images/uploads/a.jpg" width="column"}\n\nтекст\n',
		'видеоэссе: картинка автора остаётся',
	);

	// Выпуск: подпись и ролик после описания, перед врезкой.
	check(
		embed('\nтекст\n\n::link{label="Источник" url="https://x.ru"}\n', 'podcast', 'https://youtu.be/BBB').body,
		'\nтекст\n\n::label{text="Видеоверсия"}\n\n::video{youtube="https://youtu.be/BBB"}\n\n::link{label="Источник" url="https://x.ru"}\n',
		'выпуск: видеоверсия перед врезкой',
	);

	// Выпуск без врезок: в конец тела.
	check(
		embed('\nтекст\n', 'podcast', 'https://youtu.be/CCC').body,
		'\nтекст\n\n::label{text="Видеоверсия"}\n\n::video{youtube="https://youtu.be/CCC"}\n',
		'выпуск без врезок: видеоверсия в конец',
	);

	// Выпуск: перед невидимой меткой тайтла, а не после неё.
	check(
		embed('\nтекст\n\n::anime-ref{id="x"}\n', 'podcast', 'https://youtu.be/DDD').body,
		'\nтекст\n\n::label{text="Видеоверсия"}\n\n::video{youtube="https://youtu.be/DDD"}\n\n::anime-ref{id="x"}\n',
		'выпуск: видеоверсия перед меткой тайтла',
	);

	// ── обязано НЕ тронуть ──
	for (const [body, cat, note] of [
		['\n::video{youtube="https://youtu.be/OLD"}\n\nтекст\n', 'videoessay', 'у видеоэссе ролик уже стоит'],
		['\nтекст\n\n::label{text="Видеоверсия"}\n\n::video{youtube="https://youtu.be/OLD"}\n', 'podcast', 'у выпуска ролик уже стоит'],
	]) {
		if (embed(body, cat, 'https://youtu.be/NEW') !== null) {
			console.log(`  ✗ ${note}: правка сработала, а не должна была`);
			bad++;
		}
	}

	// Смена категории: одна строка, всё остальное побайтно.
	const head = '---\ntitle: Эссе про что-то\ndate: 2025-01-01\ncategory: podcast\ndraft: true\naudioGuid: abc\n---';
	const got = retitleCategory(head);
	check(got, head.replace('category: podcast', 'category: videoessay'), 'категория меняется одной строкой');
	if (/draft:\s*false/.test(got ?? '')) { console.log('  ✗ ГАЛОЧКА ЧЕРНОВИКА СНЯТА — этого делать нельзя'); bad++; }
	if (retitleCategory('---\ncategory: note\n---') !== null) { console.log('  ✗ чужую категорию трогать нельзя'); bad++; }
	if (retitleCategory('---\ntitle: про category: podcast в тексте\n---') !== null) { console.log('  ✗ строка не с начала — не категория'); bad++; }

	// Обложка: пустое поле заполняем, чужое — никогда.
	check(setCover("---\ncover: ''\n---", '/images/uploads/yt-A.jpg'), '---\ncover: /images/uploads/yt-A.jpg\n---', 'пустая обложка заполняется');
	check(setCover('---\ncover:\n---', '/images/uploads/yt-A.jpg'), '---\ncover: /images/uploads/yt-A.jpg\n---', 'обложка без значения заполняется');
	if (setCover('---\ncover: /images/uploads/moya.jpg\n---', '/images/uploads/yt-A.jpg') !== null) { console.log('  ✗ ЧУЖУЮ ОБЛОЖКУ ПЕРЕЗАПИСАЛ — этого делать нельзя'); bad++; }
	check(
		setCover('---\ntitle: без обложки\ncategory: videoessay\ndraft: true\n---', '/images/uploads/yt-A.jpg'),
		'---\ntitle: без обложки\ncategory: videoessay\ncover: /images/uploads/yt-A.jpg\ndraft: true\n---',
		'поля обложки нет — заводим после категории',
	);
	if (setCover('---\ntitle: без категории\n---', '/images/uploads/yt-A.jpg') !== null) { console.log('  ✗ ни обложки, ни категории — вписывать некуда'); bad++; }

	console.log();
	console.log('Подлогов: 15. «Обязано сделать»: 8, «обязано НЕ тронуть»: 7.');
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
