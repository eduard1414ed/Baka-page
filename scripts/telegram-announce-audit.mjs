#!/usr/bin/env node
// Разведка задачи 7.4: перемер правила анонсов на раннем архиве.
//
// НИЧЕГО НЕ ПИШЕТ ВОВСЕ — ни постов, ни файлов, ни на диск, ни в репозиторий.
// Ключа `--write` у этого скрипта нет и быть не должно: он существует затем,
// чтобы человек ПОСМОТРЕЛ ГЛАЗАМИ на то, что правило выбрасывает, и решил.
//
// ЗАЧЕМ. Правило «есть ссылка на площадку → это анонс уже существующего
// материала, не импортируем» выведено из последней сотни постов, то есть
// из 2026 года. На всём архиве оно выбрасывает 385 постов из 1715, а в 2022-м
// канал вёлся иначе. Ошибка здесь НЕСИММЕТРИЧНА: лишний черновик заказчик
// увидит и удалит, а молча выброшенный пост не появится нигде и узнать
// о нём будет неоткуда. Поэтому перемер идёт ДО импорта, а не после.
//
// СПИСОК ПЛОЩАДОК И ЧТЕНИЕ ССЫЛОК БЕРУТСЯ ИЗ САМОГО РАЗБОРА
// (telegram-import.mjs), своей копии здесь нет ни одной. Копия разъехалась бы
// молча, и замер отвечал бы про правило, которого в коде нет.
//
//   --export=<папка>   папка ChatExport_… с result.json (обязателен)
//   --year=2022        год для подробного списка (можно через запятую)
//   --selftest         подложить нарушения и проверить, что замер их находит
//
// Слова-приметы анонса (`ANNOUNCE_WORDS`) — МОЯ догадка, а не правило проекта.
// Они ничего не отсеивают: ими только помечаются строки в отчёте, чтобы
// заказчику было с чего начать смотреть. Список печатается в отчёте целиком.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	groupAlbums,
	skipReason,
	extractTitle,
	guessCategory,
	bonusLinksOf,
	isBonus,
	plainOf,
	urlsOf,
	ANNOUNCE_HOSTS,
	VIDEOESSAY_ANNOUNCE,
} from './telegram-import.mjs';

// Приметы анонса: «вышло — идите слушать/смотреть туда-то». Нарочно короткие
// корни, без окончаний. Ничего не решают, только подсвечивают строки.
const ANNOUNCE_WORDS = [
	'новый выпуск',
	'новый эпизод',
	'новая серия',
	'слушайт',
	'слушать',
	'послушат',
	'смотрет',
	'смотрит',
	'вышел',
	'вышла',
	'вышло',
	'площадк',
	'ссылка ниже',
	'ссылки ниже',
	'по ссылке',
	'таймкод',
	'подписывайт',
	'уже доступ',
	'доступен',
	'премьер',
];

const squeeze = (text) => text.replace(/\s+/gu, ' ').trim();

const hasAnnounceWord = (text) => {
	const low = text.toLowerCase();
	return ANNOUNCE_WORDS.filter((w) => low.includes(w));
};

/** Домен адреса, без `www.`. Пусто — адрес не разобрался. */
export function hostOf(url) {
	const match = String(url).match(/^(?:[a-z]+:\/\/)?([^/\s?#]+)/i);
	return match ? match[1].toLowerCase().replace(/^www\./, '') : '';
}

/** Площадки из списка, на которые ведёт этот пост. Порядок — как в списке. */
export function announceHostsHit(entities) {
	const urls = urlsOf(entities);
	return ANNOUNCE_HOSTS.filter((host) => urls.some((url) => url.includes(host)));
}

/**
 * Разбор одного поста для отчёта.
 *
 * ПРИЧИНА БЕРЁТСЯ У САМОГО РАЗБОРА, а не считается заново. `skipReason`
 * отдаёт ПЕРВУЮ подошедшую причину, и это здесь важно: строка «анонс…»
 * означает, что пост в остальном годный — не репост, не опрос, не видео,
 * с текстом. То есть ровно тот пост, который правило анонса ОТНИМАЕТ.
 */
export function look(post) {
	const entities = post.caption.text_entities ?? [];
	const reason = skipReason(post);
	const plain = squeeze(plainOf(entities));
	const urls = urlsOf(entities);
	const hosts = announceHostsHit(entities);

	return {
		id: post.id,
		date: post.caption.date.slice(0, 10),
		year: post.caption.date.slice(0, 4),
		title: extractTitle(entities)?.title ?? '',
		text: plain,
		length: plain.length,
		urls,
		domains: [...new Set(urls.map(hostOf).filter(Boolean))],
		hosts,
		// Теги автора (`#подкаст`, `#бонус`, `#заметки`). Ставит их человек
		// и ставит осознанно — это прямой признак, а не догадка по ссылке.
		tags: (entities ?? []).filter((e) => e.type === 'hashtag').map((e) => (e.text ?? '').toLowerCase()),
		members: post.members.length,
		photos: post.members.filter((m) => m.photo).length,
		reason,
		category: reason ? '' : guessCategory(entities),
		bonus: isBonus(entities),
		// Сколько строк поля «Ссылки площадок» заполнится своим адресом.
		// Ноль — не поломка: у старых анонсов ссылки общие, и пустая строка
		// означает «взять адрес с сайта».
		ownLinks: isBonus(entities) ? Object.values(bonusLinksOf(entities)).filter(Boolean).length : 0,
		// Отнят правилом анонса — то есть в остальном пост годный.
		lostToAnnounce: Boolean(reason?.startsWith('анонс уже существующего')),
		lostToVideoessay: Boolean(reason?.startsWith('анонс видеоэссе')),
		words: hasAnnounceWord(plain),
	};
}

// ——— Отчёт ———

const pad = (value, width) => String(value).padStart(width);
const median = (list) => {
	if (!list.length) return 0;
	const sorted = [...list].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

function tableByYear(looks) {
	const years = [...new Set(looks.map((l) => l.year))].sort();
	console.log('\n=== ПО ГОДАМ ===');
	console.log('  год   постов  отнято анонсом  из них видеоэссе  прочий отсев  осталось');
	for (const year of years) {
		const list = looks.filter((l) => l.year === year);
		const announce = list.filter((l) => l.lostToAnnounce).length;
		const videoessay = list.filter((l) => l.lostToVideoessay).length;
		const other = list.filter((l) => l.reason && !l.lostToAnnounce && !l.lostToVideoessay).length;
		const left = list.length - announce - videoessay - other;
		const share = list.length ? Math.round((announce / list.length) * 100) : 0;
		console.log(
			`  ${year}  ${pad(list.length, 6)}  ${pad(announce, 8)} (${pad(share, 2)}%)  ${pad(videoessay, 16)}  ${pad(other, 12)}  ${pad(left, 8)}`,
		);
	}
}

/**
 * Бонусы: сколько приедет и сколько ссылок у них своих.
 *
 * «Свои ссылки» здесь не оценка качества: у анонсов 2022 года ссылки на общие
 * страницы Boosty и Patreon, и это правильный ноль — плашка подписки возьмёт
 * адреса с сайта. Число нужно, чтобы видеть, где ссылка ведёт на КОНКРЕТНЫЙ
 * выпуск, а где на площадку вообще.
 */
function tableBonus(looks) {
	const years = [...new Set(looks.map((l) => l.year))].sort();
	console.log('\n=== БОНУСЫ: ЧТО ПРИЕДЕТ КАТЕГОРИЕЙ «БОНУС» ===');
	console.log('  год   бонусов  из них со своими ссылками на выпуск  всего своих ссылок');
	for (const year of years) {
		const list = looks.filter((l) => l.year === year && l.category === 'bonus');
		const own = list.filter((l) => l.ownLinks > 0);
		console.log(`  ${year}  ${pad(list.length, 7)}  ${pad(own.length, 34)}  ${pad(list.reduce((s, l) => s + l.ownLinks, 0), 18)}`);
	}
	const all = looks.filter((l) => l.category === 'bonus');
	console.log(`  итого ${all.length} бонусных черновиков`);
}

function tableByHost(looks) {
	const years = [...new Set(looks.map((l) => l.year))].sort();
	console.log('\n=== КАЖДАЯ ПЛОЩАДКА ПО ОТДЕЛЬНОСТИ ===');
	console.log('  «единственная» — снимите её из списка, и эти посты вернутся;');
	console.log('  «упомянута» — она стоит в посте, но там есть и другая площадка.\n');
	console.log(`  площадка          всего  единственная  ${years.map((y) => pad(y, 6)).join('')}   (единственная по годам)`);

	for (const host of ANNOUNCE_HOSTS) {
		const mentioned = looks.filter((l) => l.lostToAnnounce && l.hosts.includes(host));
		const only = mentioned.filter((l) => l.hosts.length === 1);
		const byYear = years.map((y) => pad(only.filter((l) => l.year === y).length, 6)).join('');
		console.log(`  ${host.padEnd(16)}  ${pad(mentioned.length, 5)}  ${pad(only.length, 12)}  ${byYear}`);
	}
}

function listLost(looks, years) {
	const list = looks.filter((l) => l.lostToAnnounce && years.includes(l.year));
	console.log(`\n=== ОТНЯТО ПРАВИЛОМ АНОНСА за ${years.join(', ')}: ${list.length} ===`);
	console.log('  «!» в начале строки — примет анонса в тексте НЕ нашлось, посмотрите внимательнее.\n');
	for (const l of list) {
		const mark = l.words.length ? ' ' : '!';
		console.log(
			`${mark} ${l.date}  №${pad(l.id, 5)}  ${pad(l.length, 5)} зн.  ссылка: ${l.hosts.join(', ')}`,
		);
		console.log(`    ${l.title ? '«' + l.title + '»' : '(без заголовка)'}`);
		console.log(`    ${l.text.slice(0, 150)}…`);
		console.log(`    адреса: ${l.domains.join(' ') || '—'}${l.words.length ? '   приметы: ' + l.words.join(', ') : ''}`);
	}
}

function listSuspicious(looks, years) {
	const list = looks
		.filter((l) => l.lostToAnnounce && years.includes(l.year) && !l.words.length)
		.sort((a, b) => b.length - a.length);

	console.log(`\n=== ССЫЛКА НА ПЛОЩАДКУ ЕСТЬ, А НА АНОНС НЕ ПОХОЖ: ${list.length} ===`);
	console.log('  Ни одной приметы анонса в тексте. Отсортировано от длинных к коротким:');
	console.log('  длинный текст без «слушайте» — скорее заметка, чем анонс.\n');
	for (const l of list) {
		console.log(`  ${l.date}  №${pad(l.id, 5)}  ${pad(l.length, 5)} зн.  ${l.hosts.join(', ')}`);
		console.log(`    ${l.title ? '«' + l.title + '»' : '(без заголовка)'}`);
		console.log(`    ${l.text.slice(0, 220)}…`);
	}
}

function listMissed(looks, years) {
	// Обратная сторона: правило НЕ сработало, а пост похож на анонс. Ошибка
	// в эту сторону дешёвая (лишний черновик), но знать про неё надо: если
	// в 2022-м выпуски анонсировались другой ссылкой, список площадок просто
	// не про тот год.
	const list = looks.filter(
		(l) => !l.reason && years.includes(l.year) && l.words.length >= 2 && l.urls.length > 0 && l.length < 600,
	);
	console.log(`\n=== ПОХОЖ НА АНОНС, А ПРАВИЛО ЕГО НЕ ЛОВИТ: ${list.length} ===`);
	console.log('  (короткий текст, ≥2 примет анонса, есть ссылка — но ни одной из списка площадок)\n');
	for (const l of list) {
		console.log(`  ${l.date}  №${pad(l.id, 5)}  ${pad(l.length, 5)} зн.  адреса: ${l.domains.join(' ') || '—'}`);
		console.log(`    ${l.title ? '«' + l.title + '»' : '(без заголовка)'}`);
		console.log(`    ${l.text.slice(0, 160)}…`);
	}
}

/**
 * Теги автора против правила ссылок.
 *
 * ЭТО САМЫЙ ПРЯМОЙ ПРИЗНАК ИЗ ВСЕХ, КАКИЕ ЕСТЬ В ДАННЫХ: `#подкаст`, `#бонус`,
 * `#заметки` расставлены человеком и означают ровно то, что написано. Правило
 * ссылок — догадка о том же самом, только через третьи руки. Считаем, где они
 * сходятся, а где нет: расхождение и есть цена правила.
 */
function tagsVsRule(looks) {
	const tags = new Map();
	for (const l of looks) {
		if (l.reason && !l.lostToAnnounce && !l.lostToVideoessay) continue;
		for (const tag of new Set(l.tags.length ? l.tags : ['(без тега)'])) {
			const row = tags.get(tag) ?? { lost: 0, videoessay: 0, kept: 0 };
			if (l.lostToAnnounce) row.lost += 1;
			else if (l.lostToVideoessay) row.videoessay += 1;
			else row.kept += 1;
			tags.set(tag, row);
		}
	}

	console.log('\n=== ТЕГИ АВТОРА ПРОТИВ ПРАВИЛА ССЫЛОК ===');
	console.log('  Тег ставит человек, правило ссылок его о теге не спрашивает.');
	console.log('  Считаются только посты, годные к импорту (не репосты, не видео).\n');
	// Тег годится в правило, только если его ставят ВСЕГДА. Год, в котором
	// теги перестали ставить, обесценивает признак целиком — поэтому доля
	// помеченных постов считается по годам, а не одним числом на архив.
	const years = [...new Set(looks.map((l) => l.year))].sort();
	console.log('  Как часто теги вообще ставятся:');
	for (const year of years) {
		const list = looks.filter((l) => l.year === year && (!l.reason || l.lostToAnnounce || l.lostToVideoessay));
		const tagged = list.filter((l) => l.tags.length).length;
		const bonus = list.filter((l) => l.tags.some((t) => t.includes('бонус'))).length;
		console.log(
			`    ${year}: с тегом ${pad(tagged, 4)} из ${pad(list.length, 4)} (${pad(Math.round((tagged / list.length) * 100), 3)}%),  с «#бонус» ${pad(bonus, 3)}`,
		);
	}

	console.log('\n  тег              отнято ссылкой  отнято видеоэссе  оставлено');
	const rows = [...tags.entries()].sort((a, b) => b[1].lost + b[1].videoessay + b[1].kept - (a[1].lost + a[1].videoessay + a[1].kept));
	for (const [tag, row] of rows.slice(0, 18)) {
		console.log(`  ${tag.padEnd(16)}  ${pad(row.lost, 14)}  ${pad(row.videoessay, 16)}  ${pad(row.kept, 9)}`);
	}
}

// Теги, которыми автор метит СВОЙ материал: выпуск, бонус, свои видеоцикл
// и спин-офф. Всё остальное — заметки, обзоры, новости, полезное.
const OWN_MATERIAL_TAGS = ['#подкаст', '#бонус', '#врата', '#вжик', '#эссе', '#видеоэссе'];

/**
 * Самое важное место отчёта: посты, которые правило отняло ВОПРЕКИ тегу автора.
 *
 * Тег `#заметки` поставлен рукой и означает «это моя заметка», а не «анонс».
 * Если правило такой пост забрало — это ошибка в дорогую сторону: пост
 * не появится нигде, и узнать о нём будет неоткуда.
 */
function listAgainstTags(looks) {
	const list = looks.filter(
		(l) => (l.lostToAnnounce || l.lostToVideoessay) && l.tags.length && !l.tags.some((t) => OWN_MATERIAL_TAGS.includes(t)),
	);
	console.log(`\n=== ОТНЯТО, ХОТЯ АВТОР ПОМЕТИЛ ЭТО НЕ СВОИМ МАТЕРИАЛОМ: ${list.length} ===`);
	console.log('  Теги «своего»: ' + OWN_MATERIAL_TAGS.join(', ') + '. Здесь их НЕТ ни одного,');
	console.log('  то есть автор пометил пост заметкой, обзором или новостью — а правило его забрало.\n');
	for (const l of list) {
		console.log(`  ${l.date}  №${pad(l.id, 5)}  ${pad(l.length, 5)} зн.  теги: ${l.tags.join(' ')}`);
		console.log(`    причина: ${l.reason}`);
		console.log(`    ${l.title ? '«' + l.title + '»' : '(без заголовка)'}`);
		console.log(`    ${l.text.slice(0, 200)}…`);
	}
}

function listVideoessay(looks, years) {
	// Правило видеоэссе выведено из той же сотни 2026 года, и мерить его надо
	// тем же способом: показать каждый пост, а не число.
	const list = looks.filter((l) => l.lostToVideoessay && years.includes(l.year));
	console.log(`\n=== ОТНЯТО ПРАВИЛОМ АНОНСА ВИДЕОЭССЕ (ютюб И pc.st) за ${years.join(', ')}: ${list.length} ===\n`);
	for (const l of list) {
		console.log(`  ${l.date}  №${pad(l.id, 5)}  ${pad(l.length, 5)} зн.`);
		console.log(`    ${l.title ? '«' + l.title + '»' : '(без заголовка)'}`);
		console.log(`    ${l.text.slice(0, 130)}…`);
	}
}

/**
 * Сверка с числами, записанными в тз/07 («385 постов из 1715»).
 *
 * Число из ТЗ считалось раньше и другим способом; воспроизвести его, не назвав
 * способ, нельзя. Печатаем сразу несколько счётов, чтобы было видно, какой
 * из них совпадает, — а не подгоняем свой под записанный.
 */
function reconcile(looks) {
	const anyHost = looks.filter((l) => l.hosts.length > 0);
	const candidates = looks.filter((l) => !l.reason || l.lostToAnnounce || l.lostToVideoessay);
	console.log('\n=== СВЕРКА С ЧИСЛАМИ ИЗ ТЗ («385 из 1715») ===');
	console.log(`  постов после склейки альбомов: ${looks.length}`);
	console.log(`  из них годных к импорту, если бы правил анонса не было: ${candidates.length}`);
	console.log(`  ссылка на площадку из списка стоит вообще у кого угодно: ${anyHost.length}`);
	console.log(`  ОТНЯТО правилом площадок (пост в остальном годный): ${looks.filter((l) => l.lostToAnnounce).length}`);
	console.log(`  ОТНЯТО правилом видеоэссе: ${looks.filter((l) => l.lostToVideoessay).length}`);
	console.log(`  осталось бы к импорту: ${looks.filter((l) => !l.reason).length}`);
	// Догадка, откуда взялось 385: число считалось ДО правки от 10 августа,
	// когда видеоэссе узнавалось по ОДНОЙ ссылке на ютюб, а не по двум сразу.
	const oldRule = candidates.filter(
		(l) => l.hosts.length || l.domains.some((d) => d.includes('youtu') || d.includes('pc.st')),
	);
	// ЧИСЛО СЧИТАЕТСЯ, А НЕ ВПИСЫВАЕТСЯ. В первой версии этой строки стояло
	// «ближе всех 413» словами — и после правки списка площадок оно стало 356,
	// а текст продолжал утверждать 413. Разъехавшийся факт в отчёте о фактах.
	console.log(`  по СТАРОМУ правилу (ютюб в одиночку тоже отсекал): ${oldRule.length}`);
	console.log(`  Ровно 385 не даёт ни один счёт; ближе всех старое правило (${oldRule.length}).`);
	console.log('  То есть число в ТЗ считалось ДО правок и сегодня неверно.');
}

function domainsByYear(looks, years) {
	console.log(`\n=== КАКИЕ ВООБЩЕ ДОМЕНЫ СТОЯТ В ТЕКСТАХ за ${years.join(', ')} ===`);
	console.log('  (сколько постов ведут на этот домен; «в списке» — площадка правила)\n');
	const count = new Map();
	for (const l of looks.filter((x) => years.includes(x.year) && !x.reason?.startsWith('репост'))) {
		for (const domain of l.domains) count.set(domain, (count.get(domain) ?? 0) + 1);
	}
	const sorted = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
	for (const [domain, n] of sorted) {
		const inList = ANNOUNCE_HOSTS.some((h) => domain.includes(h.split('/')[0]));
		console.log(`  ${pad(n, 5)}  ${domain}${inList ? '   ← в списке' : ''}`);
	}
}

function formatByYear(looks) {
	const years = [...new Set(looks.map((l) => l.year))].sort();
	console.log('\n=== НЕ ИЗМЕНИЛСЯ ЛИ ФОРМАТ ПОСТОВ ===');
	console.log('  Считается по постам, которые правила пропускают дальше (годным к импорту).\n');
	console.log('  год   годных  с жирным заголовком  медиана длины  с фото  альбомов  макс альбом');
	for (const year of years) {
		const list = looks.filter((l) => l.year === year && !l.reason);
		if (!list.length) continue;
		const titled = list.filter((l) => l.title).length;
		const share = Math.round((titled / list.length) * 100);
		const withPhoto = list.filter((l) => l.photos > 0).length;
		const albums = list.filter((l) => l.members > 1);
		const maxAlbum = albums.reduce((max, l) => Math.max(max, l.members), 0);
		console.log(
			`  ${year}  ${pad(list.length, 6)}  ${pad(titled, 9)} (${pad(share, 3)}%)  ${pad(median(list.map((l) => l.length)), 13)}  ${pad(withPhoto, 6)}  ${pad(albums.length, 8)}  ${pad(maxAlbum, 11)}`,
		);
	}

	console.log('\n  Ссылка на ютюб: один только ютюб (заметка) против «ютюб и pc.st» (анонс эссе)');
	console.log('  год   только ютюб  ютюб и pc.st');
	for (const year of years) {
		const list = looks.filter((l) => l.year === year);
		const yt = list.filter((l) => l.domains.some((d) => d.includes('youtu')));
		const both = yt.filter((l) => l.domains.some((d) => d.includes('pc.st')));
		console.log(`  ${year}  ${pad(yt.length - both.length, 11)}  ${pad(both.length, 12)}`);
	}
}

// ——— Самопроверка ———
//
// ПОДЛОГИ ПИШУТСЯ ТАК, КАК ПИШЕТ ТЕЛЕГРАМ, а не так, как удобно проверке:
// те же имена полей, те же типы сущностей (`plain`, `text_link`, `link`),
// ссылка словом отдельно от голого адреса. Подлог, повторяющий формулировку
// проверки, проверяет не проверку, а собственную аккуратность — за проект
// на этом попадались четырежды, и каждый раз в сторону «всё хорошо».

const msg = (id, date, entities, extra = {}) => ({
	id,
	type: 'message',
	date,
	date_unixtime: String(Math.floor(new Date(date + 'Z').getTime() / 1000)),
	from: 'Бака! Подкаст об аниме',
	text_entities: entities,
	...extra,
});
const plain = (text) => ({ type: 'plain', text });
const wordLink = (text, href) => ({ type: 'text_link', text, href });
const bareLink = (text) => ({ type: 'link', text });
const bold = (text) => ({ type: 'bold', text });

function selftest() {
	const cases = [];
	const check = (name, ok, got) => cases.push({ name, ok, got });

	// 1. Ссылка СЛОВОМ на бусти — это анонс БОНУСНОГО выпуска. Он не
	//    выбрасывается, а приезжает черновиком категории «Бонус», и ссылка
	//    на конкретный выпуск уезжает в поле плашки подписки.
	let post = groupAlbums([
		msg(1, '2022-06-01T12:00:00', [
			bold('Бонусный выпуск\n\n'),
			plain('Слушайте у нас на '),
			wordLink('Boosty', 'https://boosty.to/bakapodcast/posts/abcCase'),
		]),
	])[0];
	let seen = look(post);
	check('ссылка словом на boosty — пост НЕ выбрасывается', seen.reason === null, seen.reason);
	check('и категория у него «бонус»', seen.category === 'bonus', seen.category);
	let links = bonusLinksOf(post.caption.text_entities);
	check(
		'ссылка на конкретный выпуск уехала в поле, регистр сохранён',
		links.boosty === 'https://boosty.to/bakapodcast/posts/abcCase',
		links.boosty,
	);
	check('пустые строки остались пустыми', links.patreon === '' && links.tgClosed === '' && links.vkDonat === '', JSON.stringify(links));

	// 1б. ОБЩИЙ адрес площадки в поле НЕ пишется: пустая строка означает
	//     «взять адрес с сайта», а копия общего адреса замёрзла бы навсегда.
	//     Адрес взят точно такой, как в постах 2022 года, — без https и без www.
	post = groupAlbums([
		msg(2, '2022-06-01T12:00:00', [
			bold('Бонусный выпуск\n\n'),
			plain('Послушать можно '),
			wordLink('на патреоне', 'http://patreon.com/bakapodcast'),
			plain(' или в '),
			wordLink('закрытом канале', 'https://t.me/tribute/app?startapp=s26z'),
			plain(' а ещё у нас есть '),
			wordLink('канал', 'https://t.me/podcastbaka/123'),
		]),
	])[0];
	seen = look(post);
	links = bonusLinksOf(post.caption.text_entities);
	check('это тоже бонус', seen.category === 'bonus', seen.category);
	check('общий адрес патреона в поле НЕ вписан', links.patreon === '', links.patreon);
	check('общий адрес закрытого канала в поле НЕ вписан', links.tgClosed === '', links.tgClosed);
	check('ссылка на сам канал в «закрытый канал» не попала', links.tgClosed === '', links.tgClosed);

	// 2. Голый адрес (телеграм отдаёт его типом `link`, без href).
	post = groupAlbums([
		msg(2, '2022-06-02T12:00:00', [plain('Слушать тут: '), bareLink('https://music.yandex.ru/album/123')]),
	])[0];
	seen = look(post);
	check('голый адрес на Яндекс Музыку — отнято', seen.lostToAnnounce === true, seen.reason);

	// 3. Пост без ссылок вообще не должен трогаться.
	post = groupAlbums([msg(3, '2022-06-03T12:00:00', [bold('Заметка\n\n'), plain('Просто текст без ссылок.')])])[0];
	seen = look(post);
	check('пост без ссылок — не отнято', seen.lostToAnnounce === false && seen.reason === null, seen.reason);

	// 4. Ютюб И pc.st — анонс видеоэссе, и это ДРУГАЯ строка причины.
	post = groupAlbums([
		msg(4, '2022-06-04T12:00:00', [
			plain('Смотрите на '),
			wordLink('ютюбе', 'https://youtu.be/abc'),
			plain(' или на '),
			wordLink('других площадках', 'https://pc.st/e/xyz'),
		]),
	])[0];
	seen = look(post);
	check('ютюб и pc.st — анонс видеоэссе', seen.lostToVideoessay === true, seen.reason);
	check('и это НЕ считается отнятым списком площадок', seen.lostToAnnounce === false, seen.reason);

	// 5. Один только ютюб — обычная заметка, отнимать нельзя.
	post = groupAlbums([
		msg(5, '2022-06-05T12:00:00', [plain('Разбор ролика '), wordLink('вот тут', 'https://youtu.be/qqq')]),
	])[0];
	seen = look(post);
	check('один только ютюб — ничего не отнято', seen.reason === null, seen.reason);

	// 6. Ссылка на площадку ЕСТЬ, но пост выброшен раньше — по видео в альбоме.
	//    Такой пост правило анонса не отнимает: его отнял другой запрет.
	post = groupAlbums([
		msg(6, '2022-06-06T12:00:00', [plain('Смотрите на '), wordLink('бусти', 'https://boosty.to/x')], {
			media_type: 'video_file',
			file: 'video_files/x.mp4',
		}),
	])[0];
	seen = look(post);
	check('пост с видео и ссылкой — отнят вложением, а не анонсом', seen.lostToAnnounce === false && /вложение/.test(seen.reason ?? ''), seen.reason);

	// 7. Длинный текст без единой приметы анонса — обязан попасть в «не похож».
	const long = 'Про фестиваль анимации и его историю, разбор рисовки и фонов. '.repeat(8);
	post = groupAlbums([
		msg(7, '2022-06-07T12:00:00', [bold('Про фестиваль\n\n'), plain(long), plain(' Мы есть и '), wordLink('в ВК', 'https://vk.com/podcast.baka')]),
	])[0];
	seen = look(post);
	check('длинный текст без примет — примет ноль', seen.words.length === 0, seen.words.join());
	check('и он отнят правилом анонса (то есть попадёт в список)', seen.lostToAnnounce === true, seen.reason);

	// 8. Короткий настоящий анонс — приметы обязаны найтись, иначе список
	//    «не похож на анонс» распухнет от настоящих анонсов и станет бесполезен.
	post = groupAlbums([
		msg(8, '2022-06-08T12:00:00', [bold('Выпуск 12\n\n'), plain('Уже вышел! Слушайте в '), wordLink('ВК', 'https://vk.com/podcast.baka')]),
	])[0];
	seen = look(post);
	check('настоящий анонс — приметы найдены', seen.words.length > 0, seen.words.join());

	// 8б. ДВЕ ПОЧИНЕННЫЕ СТРОКИ СПИСКА. Обе проверяются парой «наше против
	//     чужого»: строка обязана ловить наше и пропускать чужое, а не просто
	//     что-нибудь ловить.
	const withLink = (id, href) => look(groupAlbums([msg(id, '2025-06-01T12:00:00', [plain('Вот тут: '), wordLink('ссылка', href)])])[0]);

	check('наш подкаст на Mave — отнято', withLink(20, 'https://baka.mave.digital/ep-116').lostToAnnounce === true, withLink(20, 'https://baka.mave.digital/ep-116').reason);
	check(
		'ЧУЖОЙ подкаст на Mave — не тронут',
		withLink(21, 'https://emmettbrowneffect.mave.digital/ep-44').reason === null,
		withLink(21, 'https://emmettbrowneffect.mave.digital/ep-44').reason,
	);
	check(
		'наш подкаст на Spotify (/show/) — отнято',
		withLink(22, 'https://open.spotify.com/show/23VyxCbBLw6hh8NcsWZy7N').lostToAnnounce === true,
		withLink(22, 'https://open.spotify.com/show/23VyxCbBLw6hh8NcsWZy7N').reason,
	);
	check(
		'музыкальный альбом на Spotify — не тронут',
		withLink(23, 'https://open.spotify.com/album/4FgJzhpKSyeOutddvPLXWs').reason === null,
		withLink(23, 'https://open.spotify.com/album/4FgJzhpKSyeOutddvPLXWs').reason,
	);

	// 8в. Бонус решается РАНЬШЕ правила видеоэссе. В живых данных такого поста
	//     нет ни одного, поэтому проверить это можно только подлогом — иначе
	//     порядок правил остался бы непроверенным до первого такого поста.
	post = groupAlbums([
		msg(24, '2025-06-02T12:00:00', [
			bold('Бонусный выпуск\n\n'),
			plain('Смотрите на '),
			wordLink('ютюбе', 'https://youtu.be/abc'),
			plain(', слушайте на '),
			wordLink('других площадках', 'https://pc.st/e/xyz'),
			plain(' или на '),
			wordLink('бусти', 'https://boosty.to/bakapodcast/posts/zzz'),
		]),
	])[0];
	seen = look(post);
	check('бонус сильнее правила видеоэссе', seen.reason === null && seen.category === 'bonus', `${seen.reason} / ${seen.category}`);

	// 9. Альбом склеивается в ОДИН пост: иначе счёт по годам врал бы,
	//    а фотографии-продолжения считались бы «постами без текста».
	const album = groupAlbums([
		msg(9, '2022-06-09T12:00:00', [bold('Любуемся\n\n'), plain('Кадры из аниме')], { photo: 'photos/a.jpg' }),
		msg(10, '2022-06-09T12:00:00', [], { photo: 'photos/b.jpg' }),
		msg(11, '2022-06-09T12:00:01', [], { photo: 'photos/c.jpg' }),
	]);
	check('альбом из трёх снимков — один пост', album.length === 1, `постов ${album.length}`);
	check('и все три снимка при нём', look(album[0]).photos === 3, `фото ${look(album[0]).photos}`);

	// 10. Домен вытаскивается из адреса, а не берётся целой строкой.
	check('домен из адреса со схемой и путём', hostOf('https://www.youtube.com/watch?v=1') === 'youtube.com', hostOf('https://www.youtube.com/watch?v=1'));
	check('домен из адреса без схемы', hostOf('t.me/podcastbaka/100') === 't.me', hostOf('t.me/podcastbaka/100'));

	// Проверки «год берётся у подписи, а не у последнего сообщения» здесь НЕТ
	// намеренно. Продолжение альбома отстоит от подписи не больше чем на две
	// секунды, поэтому год у них совпадает всегда — такая проверка не смогла бы
	// провалиться ни при какой поломке. Проверено подлогом: замер, которому
	// подменили источник года, остался зелёным. Вечнозелёная проверка — это
	// ложь в сторону «всё хорошо», и лучше её не иметь вовсе.

	console.log('=== САМОПРОВЕРКА ЗАМЕРА ===\n');
	let bad = 0;
	for (const c of cases) {
		console.log(`  ${c.ok ? 'ок  ' : 'МИМО'}  ${c.name}${c.ok ? '' : `   — получено: ${c.got}`}`);
		if (!c.ok) bad += 1;
	}
	console.log(`\n  проверок ${cases.length}, не сошлось ${bad}`);
	if (bad) process.exit(1);
}

// ——— Запуск ———

function arg(name, fallback = null) {
	const found = process.argv.find((a) => a.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

function main() {
	if (has('selftest')) {
		selftest();
		return;
	}

	const exportDir = arg('export');
	if (!exportDir) {
		console.error('Нужен ключ --export=<папка ChatExport_…>');
		process.exit(1);
	}

	const data = JSON.parse(readFileSync(join(exportDir, 'result.json'), 'utf8'));
	// Склейка альбомов идёт по ВСЕМУ архиву, а не по выбранному году: иначе
	// на границе года пост потерял бы свои фотографии.
	const posts = groupAlbums(data.messages);
	const looks = posts.map(look);

	// Разобрать конкретные посты целиком: спор о правиле всегда упирается
	// в два-три поста, и смотреть их надо не по огрызку в 150 знаков.
	const ids = new Set((arg('id', '') || '').split(',').filter(Boolean).map(Number));
	if (ids.size) {
		for (const l of looks.filter((x) => ids.has(x.id))) {
			console.log(`\n№${l.id}  ${l.date}  ${l.length} знаков  снимков ${l.photos}`);
			console.log(`заголовок: ${l.title || '— нет —'}`);
			console.log(`причина отсева: ${l.reason ?? 'нет, пост импортируется'}`);
			console.log(`площадки из списка: ${l.hosts.join(', ') || '—'}`);
			console.log(`все адреса:\n  ${l.urls.join('\n  ') || '—'}`);
			console.log(`текст:\n${l.text}`);
		}
		return;
	}

	const years = (arg('year', '2022') || '').split(',').filter(Boolean);

	console.log(`Экспорт: ${exportDir}`);
	console.log(`Сообщений ${data.messages.length}, постов после склейки альбомов ${posts.length}.`);
	console.log('РАЗВЕДКА: не пишется ничего, ключа записи у этого скрипта нет.');
	console.log(`\nСписок площадок правила (взят из самого разбора): ${ANNOUNCE_HOSTS.join(', ')}`);
	console.log(`Правило видеоэссе: ${VIDEOESSAY_ANNOUNCE.map((h) => h.join('/')).join('  И  ')}`);
	console.log(`Приметы анонса (только подсветка, ничего не решают): ${ANNOUNCE_WORDS.join(', ')}`);

	tableByYear(looks);
	tableBonus(looks);
	reconcile(looks);
	tableByHost(looks);
	tagsVsRule(looks);
	listAgainstTags(looks);
	formatByYear(looks);
	domainsByYear(looks, years);
	listSuspicious(looks, years);
	listMissed(looks, years);
	listVideoessay(looks, years);
	listLost(looks, years);
}

// Сравнение ПУТЯМИ, а не строками: в пути к проекту русские буквы и пробел,
// `import.meta.url` их кодирует, а `process.argv[1]` — нет. Строчное сравнение
// не совпало бы никогда, и скрипт молча вышел бы с кодом 0.
if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
	main();
}
