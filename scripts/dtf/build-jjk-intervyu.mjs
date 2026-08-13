// Пересборка поста «Интервью с создателями „Магической битвы“» (DTF 1383597).
//
// Устроено как «Долой безделье!»: вопросы ведущего — заголовок ПЯТОГО уровня
// (единственный из трёх мелких, что идёт обычным написанием, без капслока
// и без скобок), имена говорящих полужирным, как в первоисточнике.
// Разбор — статус/задача-17-перенос-с-dtf.md.
//
// ПОДПИСИ ЗДЕСЬ ПРИДУМАНЫ, А НЕ ПЕРЕНЕСЕНЫ: на DTF у всех пяти кадров подписи
// пустые, заказчик попросил их сочинить. Что на кадре — ОПОЗНАНО ГЛАЗАМИ,
// каждая картинка открыта и просмотрена. Гадать по соседнему абзацу нельзя:
// в подборках 2023 такая догадка ошиблась бы трижды из девяти (CLAUDE.md).
//
// ПЕРЕД ЗАПУСКОМ ПОПРОСИТЕ ЗАКРЫТЬ АДМИНКУ (см. README).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle, stripTags, blockToParagraphs, unwrapRedirect, postPath, frontmatter } from './source.mjs';
import { fetchImages } from './fetch-images.mjs';

const ID = 1383597;
const SLUG = 'intervyu-s-sozdatelyami-magicheskoy-bitvy';
const PREFIX = 'dtf-jjk-intervyu';

/**
 * Подписи под кадрами — по одной на картинку, в порядке статьи.
 *
 * Первая пустая НАРОЧНО: это обложка, а у обложки подписи нет ни в одном
 * из семи перенесённых постов — так решил заказчик 13 августа, и на это
 * стоит отдельная проверка. Остальные четыре называют, кто на кадре, и берут
 * один факт из того раздела, где кадр стоит.
 */
const CAPTIONS = [
	'',
	'Юдзи Итадори. Сэко виделся с Акутами всего два-три раза — вопросы по первоисточнику передавал редактор',
	'Сатору Годзё. Часть сцен сериала в манге отсутствует: их писали специально для аниме',
	'Маки Дзэнин. Второстепенным героям отдавали отдельные эпизоды, чтобы рассказать их истории подробнее',
	'Кугисаки, Фусигуро и Итадори в комедийной зарисовке. Такие сценки Акутами писал сам, а ставил их помощник режиссёра Умэмото',
];

// Хвост площадки — выброшен, как в подборках 2023 и «Голубом периоде».
// Первый абзац со ссылкой на Crunchyroll ОСТАЁТСЯ: это указание, чьё интервью,
// а не призыв подписаться.
const DROP = [
	{ why: 'реклама телеграм-канала', re: /^Читайте больше про аниме/ },
	// Три звёздочки — черта-разделитель перед послесловием, набранная на DTF
	// заголовком. Заголовки у нас — вопросы ведущего, и такое среди них
	// встало бы пустой строкой пятого уровня.
	{ why: 'черта-разделитель', re: /^\*+$/ },
];

// Ссылка на выпуск подкаста: на DTF её ТЕКСТ — сам адрес youtu.be, поэтому
// «текст ссылки не трогаем» и «ссылка ведёт на сайт» тут сталкиваются, и одно
// из двух приходится нарушить (CLAUDE.md). Выпуск на сайте есть и опубликован,
// поэтому ведём в него, а текстом ставим название выпуска: оставь мы адрес
// youtu.be словами — ссылка врала бы собственными словами.
const EPISODE = { from: 'https://youtu.be/TlZh4Kbalsk', to: '/posts/ep-47/', label: 'Магическая битва | Лучший ли это сёнен или просто копия других аниме?' };

export async function build({ write = true } = {}) {
	const article = await fetchArticle(ID);
	const images = await fetchImages(ID, PREFIX);
	if (images.length !== CAPTIONS.length)
		throw new Error(`картинок ${images.length}, а подписей ${CAPTIONS.length} — список подписей отстал от статьи`);

	const lines = [];
	const dropped = [];
	let img = 0;

	for (const block of article.blocks) {
		if (block.type === 'delimiter') continue;

		if (block.type === 'media') {
			for (const _item of block.data.items) {
				const { src } = images[img];
				const caption = CAPTIONS[img++];
				lines.push(caption
					? `::image{src="${src}" alt="" caption="${caption}" width="column"}`
					: `::image{src="${src}" alt="" width="column"}`);
			}
			continue;
		}

		if (block.type === 'header') {
			const text = stripTags(block.data.text);
			const rule = DROP.find((d) => d.re.test(text));
			if (rule) { dropped.push({ why: rule.why, text }); continue; }
			lines.push(`##### ${text}`);
			continue;
		}

		if (block.type === 'text' || block.type === 'incut') {
			for (const paragraph of blockToParagraphs(block.data.text)) {
				const plain = paragraph.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*+/g, '');
				const rule = DROP.find((d) => d.re.test(plain));
				if (rule) { dropped.push({ why: rule.why, text: plain.slice(0, 70) }); continue; }
				lines.push(paragraph.replace(`[${EPISODE.from}](${EPISODE.from})`, `[${EPISODE.label}](${EPISODE.to})`));
			}
			continue;
		}

		throw new Error(`неизвестный тип блока «${block.type}» — разобрать его нечем`);
	}

	// ОБЛОЖКУ ПОДНИМАЕМ ПЕРВЫМ БЛОКОМ ТЕЛА. На DTF она стоит третьей, после двух
	// абзацев вступления, а у всех семи перенесённых постов — сверху: заказчик
	// назвал это первым из трёх своих замечаний 13 августа.
	const coverLine = lines.find((line) => line.startsWith(`::image{src="${images[0].src}"`));
	lines.splice(lines.indexOf(coverLine), 1);
	lines.unshift(coverLine);
	const cover = images[0].src;

	const file = postPath(SLUG);
	const live = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
	const liveHead = live ? live.split(/^---$/m)[1].trim() : '';
	const fieldOf = (name) => liveHead.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? null;

	// Тот же случай, что у «Долой безделье!»: под этим адресом лежал привезённый
	// из телеграма АНОНС этой статьи (сообщение 437). Свой пост узнаётся
	// по обложке — она наша, и другой у переноса быть не может.
	const ours = fieldOf('cover') === cover;

	const head = ours
		? ['---', liveHead.replace(/^cover: .*$/m, `cover: ${cover}`), '---', ''].join('\n')
		: frontmatter({
			title: fieldOf('title') ?? article.title,
			// Дата — день выхода НА DTF. У анонса стоит 10 августа, день поста
			// в канале со ссылкой на telegra.ph; на DTF статья вышла 6 октября,
			// и вступление у неё своё («К недавнему выходу digital-версии»).
			// Переносим текст DTF — значит и дата его.
			date: new Date(article.date * 1000).toISOString().slice(0, 10),
			cover,
			category: 'article',
			// `tgId` обязан уцелеть: по нему импорт знает, что сообщение 437
			// на сайте уже есть. Потеряй его — робот заведёт анонс заново.
			extra: ['tgId', 'tgUrl'].flatMap((name) => (fieldOf(name) === null ? [] : [`${name}: ${fieldOf(name)}`])),
		});

	const refs = live ? (live.split(/^---$/m).slice(2).join('---').match(/^::anime-ref\{[^}]*\}$/gm) ?? []) : [];
	const text = head + '\n' + [...lines, ...refs].join('\n\n') + '\n';
	if (write) fs.writeFileSync(file, text);

	return { text, lines, dropped, images, article };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	const { lines, dropped, images } = await build();
	console.log(`вопросов: ${lines.filter((l) => l.startsWith('##### ')).length}`);
	console.log(`картинок: ${images.length} | с подписью: ${lines.filter((l) => l.includes('caption=')).length} (обложка без подписи — так у всех семи постов)`);
	console.log(`абзацев: ${lines.filter((l) => !l.startsWith('#') && !l.startsWith('::')).length}`);
	for (const d of dropped) console.log(`   выброшено (${d.why}): «${d.text}»`);
	console.log(`ссылка на выпуск: ${EPISODE.from} → ${EPISODE.to}`);
}
