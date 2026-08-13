#!/usr/bin/env node
// Сборка поста «Обзор всех аниме осени 2022» из одиннадцати постов канала.
// Разбор — статус/задача-18-sbornik-oseni.md.
//
// ЧЕМ ЭТОТ СБОРНИК ОТЛИЧАЕТСЯ ОТ ЗИМНЕГО И ЛЕТНЕГО. У тех первоисточник —
// статьи на DTF, и сверять их есть с чем: api.dtf.ru отвечает тем же текстом.
// Осеннего марафона на DTF нет вовсе, он выходил только в телеграме. Значит
// первоисточник тут — САМИ ПОСТЫ САЙТА, привезённые импортом из канала,
// и берутся они из git по закреплённому коммиту: сами посты снесены как дубли
// (то же решение, что с зимними хвостами «Медленная петля» и «Руководство
// гениального принца»).
//
// ТЕКСТ НЕ ПЕРЕПИСАН СЮДА РУКАМИ ни одной строкой, кроме подводки: переписанная
// копия разъехалась бы с оригиналом, и заметить это было бы некому.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { postPath } from '../dtf/source.mjs';
import { shortStudio } from '../dtf/captions.mjs';
import { writeGuarded } from '../dtf/guard.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SLUG = 'obzor-vseh-anime-oseni-2022';

// Коммит, в котором одиннадцать исходных постов ещё лежат на месте. Закреплён
// именно потому, что после склейки они снесены: ветка уедет вперёд, а этот
// коммит останется, и пересборка через год возьмёт ровно тот же текст.
export const SOURCE_COMMIT = '00f3b5cc';

// Одиннадцать постов канала. ПОРЯДОК ЗДЕСЬ НИЧЕГО НЕ РЕШАЕТ — сборник
// выстраивается по дате выхода в канале, а её сборщик читает из самих постов.
// Картинка у каждого своя: в постах канала их нет вовсе, все одиннадцать
// принёс заказчик (раскладка по тайтлам — в images.mjs).
export const PARTS = [
	{ file: 'obzor-vseh-novyh-anime-oseni-sdelay-eto-sam', img: '/images/uploads/osen-2022-01.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-o-moyom-pererozhdenii-v-mech', img: '/images/uploads/osen-2022-02.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-ya-stala-zlodeykoy-poetomu-mne-nuzhno-zaarkanit-poslednego-bossa', img: '/images/uploads/osen-2022-03.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-rok-tihonya', img: '/images/uploads/osen-2022-04.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-sinyaya-tyurma', img: '/images/uploads/osen-2022-05.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-bolshe-chem-para-menshe-chem-lyubovniki', img: '/images/uploads/osen-2022-06.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-vremya-nindzya', img: '/images/uploads/osen-2022-07.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-universitet-sumasshedshih-lyudey', img: '/images/uploads/osen-2022-08.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-zhiloy-kompleks-s', img: '/images/uploads/osen-2022-09.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-lyubovnye-neudachi', img: '/images/uploads/osen-2022-10.webp' },
	{ file: 'obzor-vseh-novyh-anime-oseni-legenda-o-svyatom-meche-legenda-many', img: '/images/uploads/osen-2022-11.webp' },
];

// ОБЛОЖКА — ТОТ ЖЕ ФАЙЛ, ЧТО КАДР «РОК-ТИХОНИ», а не его копия под другим
// именем. Решение заказчика: своей обложки у осеннего марафона нет, и он
// выбрал единственный тайтл, которому поставил «смотреть обязательно».
// Цена названа вслух: кадр появляется на странице ДВАЖДЫ — сверху и у своего
// тайтла. Ровно так же ведёт себя зимний сборник, но там под это завели второй
// файл, и 0,3 МБ тех же байтов легли в историю git навсегда.
export const COVER = '/images/uploads/osen-2022-04.webp';

// ПОДВОДКУ НАПИСАЛ Я, А НЕ ЗАКАЗЧИК, и сказано это вслух и здесь, и в разборе
// задачи. У зимнего, весеннего и летнего марафонов своё вступление есть —
// автор писал его для статьи на DTF; осенний выходил в канале россыпью, и
// вступления у него нет ни одного. Заказчик попросил написать по образцу
// существующих. Числа в нём проверяемые: одиннадцать сериалов — это длина
// PARTS, порядок по мере выхода — это сортировка по дате.
const INTRO = [
	'Осенью я снова смотрел новинки сезона — по две-три серии каждой — и рассказывал, что стоит вашего времени, а что можно смело пропустить.',
	'Здесь одиннадцать сериалов, в том порядке, в котором они выходили. Ну что, поехали?',
];

/**
 * ДАТУ ИЗ ШАПКИ НАДО ПРИВЕСТИ К ВИДУ «2022-10-07», А НЕ БРАТЬ КАК ЕСТЬ.
 * `js-yaml` читает `date: 2022-10-07` не строкой, а объектом Date — тем же
 * разбором, что и сборка сайта, и это правильно. Но `String(new Date(…))`
 * даёт «Fri Oct 07 2022 …», и сортировка по такой строке идёт ПО НАЗВАНИЮ
 * ДНЯ НЕДЕЛИ: первый прогон выстроил сборник Fri, Mon, Sat, Sun, Wed и назвал
 * датой поста 19 октября вместо 19 ноября. Ошибки при этом не было никакой,
 * порядок выглядел просто странным.
 */
export const isoDate = (value) =>
	(value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

/** Название тайтла берётся из заголовка поста, а не переписано сюда руками. */
export function titleOf(head) {
	const match = /^Обзор аниме «(.+)»$/.exec(head.title);
	if (!match) throw new Error(`заголовок «${head.title}» не похож на «Обзор аниме «…»»`);
	return match[1];
}

/** Пост канала из закреплённого коммита: шапка разобрана, тело строкой. */
export function readPart(file, commit = SOURCE_COMMIT) {
	const raw = execSync(`git -C ${JSON.stringify(ROOT)} show ${commit}:src/content/posts/${file}.md`, {
		encoding: 'utf8',
		maxBuffer: 1 << 24,
	});
	const parts = raw.split(/^---$/m);
	return { head: yaml.load(parts[1]), body: parts.slice(2).join('---') };
}

/**
 * Подпись «Название, студия X» — формат образца заказчика (весенний обзор).
 * Студия берётся из КАРТОЧКИ САЙТА и больше ниоткуда: она показывается
 * в каталоге и правится заказчиком, разойдись подпись с карточкой — читатель
 * увидел бы у одного тайтла две разные студии на соседних страницах.
 */
export function captionFor(name, card) {
	if (!card?.studio) return name;
	return `${name}, студия ${shortStudio(card.studio)}`;
}

export async function assemble() {
	const { readAnimeCollection } = await import(new URL('../anime-cases-lib.mjs', import.meta.url).href);
	const { buildAnimeMatcher, findMentions } = await import(new URL('../../src/lib/animeMentions.mjs', import.meta.url).href);
	const entries = await readAnimeCollection();
	const cards = new Map(entries.map((e) => [e.data.id, e.data]));
	const matcher = buildAnimeMatcher(entries.map((e) => ({ id: e.data.id, data: e.data })), { quotes: 'ignore' });
	// Ссылку в каталог даёт СУЩЕСТВУЮЩИЙ матчер точным совпадением, а не свой
	// список названий: второй список — это вторая копия правила «по чему ищем».
	const catalogId = (name) => {
		const hit = findMentions(name, matcher).find((m) => m.start === 0 && m.end === name.length);
		return hit ? hit.id : null;
	};

	const read = PARTS.map((part) => ({ ...part, ...readPart(part.file) }));
	read.sort((a, b) => isoDate(a.head.date).localeCompare(isoDate(b.head.date)));

	const lines = [`::image{src="${COVER}" alt="" width="column"}`, ...INTRO];
	const anime = [];
	const noLink = [];
	const rows = [];

	for (const part of read) {
		const name = titleOf(part.head);
		const id = catalogId(name);
		if (id) { anime.push(id); lines.push(`#### [${name}](/anime/${id}/)`); }
		else { noLink.push(name); lines.push(`#### ${name}`); }
		lines.push(`::image{src="${part.img}" alt="" caption="${captionFor(name, cards.get(id))}" width="column"}`);
		for (const paragraph of part.body.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)) {
			if (paragraph.startsWith('::anime-ref')) continue;
			lines.push(paragraph);
		}
		rows.push({ name, id, date: isoDate(part.head.date), tgId: part.head.tgId });
	}

	return { lines, anime, noLink, rows, date: rows[rows.length - 1].date };
}

/**
 * Шапка. При ПОВТОРНОЙ сборке берётся у живого файла целиком, кроме обложки:
 * заголовок, «Тайтлы поста» и метки `::anime-ref` принадлежат заказчику,
 * и пересборка не имеет права их стирать. Обложка — предмет правки и обязана
 * совпадать с картинкой первого блока тела.
 */
function frontmatter(anime, date) {
	const file = postPath(SLUG);
	if (fs.existsSync(file)) {
		const live = fs.readFileSync(file, 'utf8').split(/^---$/m);
		return {
			head: ['---', live[1].trim().replace(/^cover: .*$/m, `cover: ${COVER}`), '---', ''].join('\n'),
			refs: live.slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? [],
		};
	}
	// Первая сборка: полей ровно столько же и в том же порядке, что у летнего
	// сборника, — он записан самой админкой, и совпадение проверяется тем, что
	// сохранение без изменений даёт пустой коммит.
	const head = [
		'---',
		'title: Обзор всех аниме осени 2022 — что стоит посмотреть?',
		`date: ${date}`,
		'category: article',
		'draft: true',
		"description: ''",
		`cover: ${COVER}`,
		'noCover: false',
		"externalUrl: ''",
		"externalSource: ''",
		"adLabel: ''",
		'animeSuggested: []',
		"mentionsHidden: ''",
		"speakers: ''",
		"corrections: ''",
		"script: ''",
		"timecodes: ''",
		'bonusLinks: null',
		'pullMedia: false',
		'tgId: null',
		"tgUrl: ''",
		'anime:',
		...[...new Set(anime)].map((id) => `  - ${id}`),
		'---',
		'',
	].join('\n');
	return { head, refs: [] };
}

/**
 * Собрать пост. `write: false` — только вернуть текст, ничего не трогая:
 * этим сверка спрашивает сборщик «а что бы ты собрал сейчас?», чтобы отличить
 * правку заказчика от поломки.
 */
export async function build({ write = true, force = false } = {}) {
	const { lines, anime, noLink, rows, date } = await assemble();
	const { head, refs } = frontmatter(anime, date);
	const text = head + '\n' + [...lines, ...refs].join('\n\n') + '\n';

	if (write) {
		const missing = [COVER, ...PARTS.map((p) => p.img)].filter((src) => !fs.existsSync(path.join(ROOT, 'public', src)));
		if (missing.length) throw new Error(`нет файлов картинок (${missing.length}):\n   ${missing.join('\n   ')}`);
		writeGuarded(postPath(SLUG), text, { force });
	}
	return { text, rows, anime, noLink, date, images: lines.filter((l) => l.startsWith('::image')).length };
}

async function main() {
	const { rows, anime, noLink, date, images } = await build({ force: process.argv.includes('--force') });
	console.log(`тайтлов: ${rows.length} | со ссылкой в каталог: ${new Set(anime).size} | без ссылки: ${noLink.length}`);
	console.log(`картинок: ${images} | дата поста: ${date}`);
	console.log('\nПОРЯДОК (по дате выхода в канале):');
	for (const row of rows) console.log(`   ${row.date}  tg ${String(row.tgId).padEnd(4)}  ${row.name}`);
	if (noLink.length) { console.log('\nБЕЗ ССЫЛКИ (нет в справочнике):'); noLink.forEach((n) => console.log('   ', n)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) await main();
