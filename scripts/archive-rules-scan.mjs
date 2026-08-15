// РАЗВЕДКА ВЁРСТКИ АРХИВА (задача 19, этап 1). НИЧЕГО НЕ ПИШЕТ.
//
// Задача: не придумать правила вёрстки, а НАЙТИ их в опубликованных постах
// и померить числом — в скольких постах категории правило выполняется
// и в скольких нарушается.
//
// РАЗБОР ТОТ ЖЕ, ЧТО У СБОРКИ (`archive-clean-lib.mjs`): где заголовок, где
// картинка, где ссылка и где код — знает дерево markdown, а не список знаков.
// Считать решётки по строкам нельзя: решётка живёт и внутри кода, и внутри
// адреса, и разъедется с жизнью на первом же непредвиденном случае.
//
// ЧИСЛА СЧИТАЮТСЯ ПО ГОДАМ ОТДЕЛЬНО. Опубликованное — срез по времени
// (заказчик публиковал подряд по дате), и правило, выполняющееся в 2022-м
// и не выполняющееся в 2025-м, — это не правило, а привычка периода.
//
// Запуск: node scripts/archive-rules-scan.mjs [--json путь]

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, parseBody } from './archive-clean-lib.mjs';

// ── общее ─────────────────────────────────────────────────────────────────

const CATEGORY_LABEL = {
	podcast: 'Выпуск',
	videoessay: 'Видеоэссе',
	note: 'Заметка',
	article: 'Статья',
	interview: 'Интервью',
	bonus: 'Бонус',
	'(нет)': '(категория не указана)',
};

/** Год из поля `date`. Дата у постов бывает и датой, и строкой. */
function yearOf(front) {
	const d = front.date;
	if (!d) return '(нет даты)';
	if (d instanceof Date) return String(d.getUTCFullYear());
	const m = String(d).match(/^(\d{4})/);
	return m ? m[1] : '(нет даты)';
}

/** Прямые дети корня дерева — «блоки» тела в том порядке, как они стоят. */
function blocksOf(tree) {
	return tree.children ?? [];
}

/** Имя нашего блока-директивы: `::image`, `::link`, `::label`, `::video`… */
function directiveName(node) {
	if (node.type === 'leafDirective' || node.type === 'containerDirective' || node.type === 'textDirective') {
		return node.name;
	}
	return null;
}

/** Плоский список всех узлов дерева (свой обход: нужны и директивы). */
function allNodes(tree) {
	const out = [];
	const walk = (n) => {
		out.push(n);
		if (Array.isArray(n.children)) n.children.forEach(walk);
	};
	walk(tree);
	return out;
}

/** Голый текст узла — для замера длины абзацев и заголовков. */
function plainText(node) {
	if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
	if (!Array.isArray(node.children)) return '';
	return node.children.map(plainText).join('');
}

// ── разбор одного поста ───────────────────────────────────────────────────

/**
 * Признаки одного поста: всё, о чём потом спрашивают правила.
 * Здесь только ФАКТЫ, без оценок «правильно/неправильно».
 */
function featuresOf(post) {
	const tree = parseBody(post.body);
	const blocks = blocksOf(tree);
	const nodes = allNodes(tree);
	const front = post.front ?? {};

	const headings = blocks.filter((b) => b.type === 'heading');
	const directives = nodes.map(directiveName).filter(Boolean);

	// Первый и последний ЗНАЧАЩИЙ блок тела.
	const first = blocks[0] ?? null;
	const last = blocks[blocks.length - 1] ?? null;

	const images = nodes.filter((n) => directiveName(n) === 'image');
	const captions = images.filter((n) => {
		const a = n.attributes ?? {};
		return typeof a.caption === 'string' && a.caption.trim() !== '';
	});

	const links = nodes.filter((n) => n.type === 'link');
	const externalLinks = links.filter((n) => /^https?:/i.test(n.url ?? ''));
	const bareUrlParas = blocks.filter(
		(b) => b.type === 'paragraph' && /^https?:\/\/\S+$/.test(plainText(b).trim()),
	);

	return {
		id: post.id,
		file: post.file,
		draft: post.draft,
		category: front.category ?? '(нет)',
		year: yearOf(front),
		title: front.title ?? '',

		// шапка
		hasCover: typeof front.cover === 'string' && front.cover.trim() !== '',
		noCover: front.noCover === true,
		hasDescription: typeof front.description === 'string' && front.description.trim() !== '',
		hasYoutube: typeof front.youtube === 'string' && front.youtube.trim() !== '',
		hasVideo: typeof front.video === 'string' && front.video.trim() !== '',
		hasButtons: Array.isArray(front.buttons) && front.buttons.length > 0,
		hasBonusLinks: Array.isArray(front.bonusLinks) && front.bonusLinks.length > 0,
		hasAdLabel: typeof front.adLabel === 'string' && front.adLabel.trim() !== '',
		hasExternalUrl: typeof front.externalUrl === 'string' && front.externalUrl.trim() !== '',
		hasTranscript: typeof front.transcript === 'string' && front.transcript.trim() !== '',
		hasTimecodes: Array.isArray(front.timecodes) && front.timecodes.length > 0,
		fromTelegram: front.tgId != null,

		// тело: общая форма
		blockCount: blocks.length,
		bodyLength: post.body.trim().length,
		empty: post.body.trim() === '',

		// заголовки
		headingDepths: headings.map((h) => h.depth),
		headingCount: headings.length,
		headingTexts: headings.map((h) => plainText(h)),
		hasH1: headings.some((h) => h.depth === 1),
		hasH2: headings.some((h) => h.depth === 2),
		hasH3: headings.some((h) => h.depth === 3),
		hasH4plus: headings.some((h) => h.depth >= 4),

		// чем начинается и чем кончается
		firstBlockType: first ? (directiveName(first) ? `::${directiveName(first)}` : first.type) : '(пусто)',
		lastBlockType: last ? (directiveName(last) ? `::${directiveName(last)}` : last.type) : '(пусто)',
		firstIsHeading: first?.type === 'heading',
		firstIsImage: directiveName(first) === 'image',
		firstIsParagraph: first?.type === 'paragraph',
		lastIsBareUrl: last?.type === 'paragraph' && /^https?:\/\/\S+$/.test(plainText(last).trim()),
		lastIsImage: directiveName(last) === 'image',

		// картинки
		imageCount: images.length,
		captionCount: captions.length,
		imagesAllCaptioned: images.length > 0 && captions.length === images.length,
		imagesNoneCaptioned: images.length > 0 && captions.length === 0,

		// наши блоки
		directives: directives,
		hasLinkInset: directives.includes('link'),
		hasLabel: directives.includes('label'),
		hasAnimeRef: directives.includes('anime-ref'),
		hasVideoBlock: directives.includes('video'),
		hasSpoiler: directives.some((d) => d.startsWith('spoiler')),

		// выделения, списки, цитаты
		boldCount: nodes.filter((n) => n.type === 'strong').length,
		italicCount: nodes.filter((n) => n.type === 'emphasis').length,
		listCount: blocks.filter((b) => b.type === 'list').length,
		orderedListCount: blocks.filter((b) => b.type === 'list' && b.ordered).length,
		quoteCount: blocks.filter((b) => b.type === 'blockquote').length,
		hrCount: blocks.filter((b) => b.type === 'thematicBreak').length,
		codeCount: blocks.filter((b) => b.type === 'code').length,
		htmlCount: blocks.filter((b) => b.type === 'html').length,
		tableCount: blocks.filter((b) => b.type === 'table').length,

		// абзац целиком жирный — след «подзаголовка, набранного жирным»
		boldOnlyParas: blocks.filter(
			(b) =>
				b.type === 'paragraph' &&
				b.children?.length === 1 &&
				b.children[0].type === 'strong' &&
				plainText(b).trim() !== '',
		).length,

		// ссылки
		linkCount: links.length,
		externalLinkCount: externalLinks.length,
		bareUrlParaCount: bareUrlParas.length,
	};
}

// ── свод ──────────────────────────────────────────────────────────────────

function tally(list, pick) {
	const map = new Map();
	for (const item of list) {
		const key = pick(item);
		map.set(key, (map.get(key) ?? 0) + 1);
	}
	return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function pad(s, n) {
	s = String(s);
	return s + ' '.repeat(Math.max(0, n - [...s].length));
}

function padLeft(s, n) {
	s = String(s);
	return ' '.repeat(Math.max(0, n - [...s].length)) + s;
}

async function main() {
	const posts = await readPostsRaw();
	const feats = [];
	const broken = [];

	for (const post of posts) {
		try {
			feats.push(featuresOf(post));
		} catch (err) {
			// Разбор упал — это НЕ «пост без особенностей». Молчать нельзя.
			broken.push({ id: post.id, error: String(err?.message ?? err) });
		}
	}

	const pub = feats.filter((f) => !f.draft);
	const dra = feats.filter((f) => f.draft);

	console.log('═'.repeat(78));
	console.log('РАЗВЕДКА ВЁРСТКИ АРХИВА — этап 1. Ничего не правится.');
	console.log('═'.repeat(78));
	console.log();
	console.log(`Всего постов в репозитории: ${feats.length}`);
	console.log(`  опубликовано: ${pub.length}`);
	console.log(`  черновиков:   ${dra.length}`);
	if (broken.length) {
		console.log();
		console.log(`!! РАЗБОР УПАЛ на ${broken.length} постах — они НЕ вошли ни в один счёт:`);
		for (const b of broken) console.log(`   ${b.id}: ${b.error}`);
	}
	console.log();

	// 1.1. Категории
	console.log('─'.repeat(78));
	console.log('1.1. КАТЕГОРИИ');
	console.log('─'.repeat(78));
	const cats = [...new Set(feats.map((f) => f.category))].sort();
	console.log(`${pad('категория', 22)}${padLeft('опубл.', 8)}${padLeft('черн.', 8)}${padLeft('всего', 8)}`);
	for (const c of cats) {
		const p = pub.filter((f) => f.category === c).length;
		const d = dra.filter((f) => f.category === c).length;
		console.log(`${pad(CATEGORY_LABEL[c] ?? c, 22)}${padLeft(p, 8)}${padLeft(d, 8)}${padLeft(p + d, 8)}`);
	}
	console.log();

	// 1.4. Годы
	console.log('─'.repeat(78));
	console.log('1.4. ГОДЫ');
	console.log('─'.repeat(78));
	const years = [...new Set(feats.map((f) => f.year))].sort();
	console.log(`${pad('год', 14)}${padLeft('опубл.', 8)}${padLeft('черн.', 8)}${padLeft('всего', 8)}   доля опубл.`);
	for (const y of years) {
		const p = pub.filter((f) => f.year === y).length;
		const d = dra.filter((f) => f.year === y).length;
		const share = p + d > 0 ? Math.round((p / (p + d)) * 100) : 0;
		const bar = '█'.repeat(Math.round(share / 5));
		console.log(`${pad(y, 14)}${padLeft(p, 8)}${padLeft(d, 8)}${padLeft(p + d, 8)}   ${padLeft(share + '%', 5)} ${bar}`);
	}
	console.log();

	// Категория × год у опубликованных
	console.log('Опубликованные: категория × год');
	console.log(`${pad('категория', 22)}${years.map((y) => padLeft(y.slice(2), 6)).join('')}`);
	for (const c of cats) {
		const row = years.map((y) => padLeft(pub.filter((f) => f.category === c && f.year === y).length || '·', 6)).join('');
		console.log(`${pad(CATEGORY_LABEL[c] ?? c, 22)}${row}`);
	}
	console.log();
	console.log('Черновики: категория × год');
	console.log(`${pad('категория', 22)}${years.map((y) => padLeft(y.slice(2), 6)).join('')}`);
	for (const c of cats) {
		const row = years.map((y) => padLeft(dra.filter((f) => f.category === c && f.year === y).length || '·', 6)).join('');
		console.log(`${pad(CATEGORY_LABEL[c] ?? c, 22)}${row}`);
	}
	console.log();

	// Сырые распределения признаков по опубликованным, по категориям
	console.log('─'.repeat(78));
	console.log('1.2. ЧТО ЛЕЖИТ В ОПУБЛИКОВАННЫХ — СЫРЫЕ РАСПРЕДЕЛЕНИЯ');
	console.log('─'.repeat(78));

	for (const c of cats) {
		const set = pub.filter((f) => f.category === c);
		if (!set.length) continue;
		console.log();
		console.log(`### ${CATEGORY_LABEL[c] ?? c} — ${set.length} опубликованных`);
		console.log();
		const show = (label, rows, limit = 8) => {
			console.log(`  ${label}:`);
			for (const [k, v] of rows.slice(0, limit)) {
				console.log(`    ${pad(k, 34)}${padLeft(v, 5)}  (${Math.round((v / set.length) * 100)}%)`);
			}
		};
		show('чем начинается тело', tally(set, (f) => f.firstBlockType));
		show('чем кончается тело', tally(set, (f) => f.lastBlockType));
		show('набор уровней заголовков', tally(set, (f) => (f.headingDepths.length ? [...new Set(f.headingDepths)].sort().join(',') : '(заголовков нет)')));
		show('сколько картинок ::image', tally(set, (f) => (f.imageCount > 5 ? '6 и больше' : String(f.imageCount))));
		show('подписи у картинок', tally(set, (f) => (f.imageCount === 0 ? '(картинок нет)' : f.imagesAllCaptioned ? 'у всех' : f.imagesNoneCaptioned ? 'ни у одной' : 'у части')));
		show('обложка в шапке', tally(set, (f) => (f.hasCover ? 'есть' : f.noCover ? 'намеренно нет' : 'пусто')));
		show('описание в шапке', tally(set, (f) => (f.hasDescription ? 'есть' : 'нет')));
		show('списки', tally(set, (f) => (f.listCount === 0 ? 'нет' : f.orderedListCount > 0 ? 'нумерованные есть' : 'только маркированные')));
		show('цитаты', tally(set, (f) => (f.quoteCount === 0 ? 'нет' : String(f.quoteCount))));
		show('жирный в теле', tally(set, (f) => (f.boldCount === 0 ? 'нет' : f.boldCount <= 3 ? '1–3' : '4 и больше')));
		show('курсив в теле', tally(set, (f) => (f.italicCount === 0 ? 'нет' : f.italicCount <= 3 ? '1–3' : '4 и больше')));
		show('наши блоки', tally(set, (f) => {
			const b = [];
			if (f.hasLinkInset) b.push('::link');
			if (f.hasLabel) b.push('::label');
			if (f.hasVideoBlock) b.push('::video');
			if (f.hasSpoiler) b.push('::spoiler');
			if (f.hasAnimeRef) b.push('::anime-ref');
			return b.length ? b.join(' ') : '(никаких)';
		}));
		show('абзацы целиком жирные', tally(set, (f) => (f.boldOnlyParas === 0 ? 'нет' : String(f.boldOnlyParas))));
		show('горизонтальная черта ---', tally(set, (f) => (f.hrCount === 0 ? 'нет' : String(f.hrCount))));
		show('голая ссылка отдельным абзацем', tally(set, (f) => (f.bareUrlParaCount === 0 ? 'нет' : String(f.bareUrlParaCount))));
		show('таблица / код / сырой HTML', tally(set, (f) => {
			const b = [];
			if (f.tableCount) b.push('таблица');
			if (f.codeCount) b.push('код');
			if (f.htmlCount) b.push('HTML');
			return b.length ? b.join(' ') : 'ничего из этого';
		}));
	}

	console.log();
	console.log('─'.repeat(78));
	console.log('ТО ЖЕ ПО ЧЕРНОВИКАМ — чтобы видеть, где расхождение');
	console.log('─'.repeat(78));
	for (const c of cats) {
		const set = dra.filter((f) => f.category === c);
		if (!set.length) continue;
		console.log();
		console.log(`### ${CATEGORY_LABEL[c] ?? c} — ${set.length} черновиков`);
		const show = (label, rows, limit = 6) => {
			console.log(`  ${label}:`);
			for (const [k, v] of rows.slice(0, limit)) {
				console.log(`    ${pad(k, 34)}${padLeft(v, 5)}  (${Math.round((v / set.length) * 100)}%)`);
			}
		};
		show('чем начинается тело', tally(set, (f) => f.firstBlockType));
		show('чем кончается тело', tally(set, (f) => f.lastBlockType));
		show('набор уровней заголовков', tally(set, (f) => (f.headingDepths.length ? [...new Set(f.headingDepths)].sort().join(',') : '(заголовков нет)')));
		show('подписи у картинок', tally(set, (f) => (f.imageCount === 0 ? '(картинок нет)' : f.imagesAllCaptioned ? 'у всех' : f.imagesNoneCaptioned ? 'ни у одной' : 'у части')));
		show('обложка в шапке', tally(set, (f) => (f.hasCover ? 'есть' : f.noCover ? 'намеренно нет' : 'пусто')));
		show('описание в шапке', tally(set, (f) => (f.hasDescription ? 'есть' : 'нет')));
		show('голая ссылка отдельным абзацем', tally(set, (f) => (f.bareUrlParaCount === 0 ? 'нет' : String(f.bareUrlParaCount))));
	}

	// Выгрузка признаков — чтобы мерить правила отдельным проходом.
	const jsonAt = process.argv.indexOf('--json');
	if (jsonAt !== -1 && process.argv[jsonAt + 1]) {
		const { writeFile } = await import('node:fs/promises');
		await writeFile(process.argv[jsonAt + 1], JSON.stringify(feats, null, '\t'), 'utf8');
		console.log();
		console.log(`Признаки всех ${feats.length} постов выгружены: ${process.argv[jsonAt + 1]}`);
	}
}

// ЗАПУСКАЕМСЯ ТОЛЬКО ТОГДА, КОГДА НАС ПОЗВАЛИ НАПРЯМУЮ. Этот скрипт ничего
// не пишет, но без развилки простой `import` отсюда прогонял бы всю разведку
// и печатал её отчёт посреди чужого замера — ровно то, на чём наступили
// с `archive-anime-links.mjs`.
//
// Сравниваем ПУТЯМИ, а не строками: в пути к проекту русские буквы, и
// `import.meta.url` кодирует их (`%D0%A0%D0%B0…`), а `process.argv[1]` нет
// (CLAUDE.md, урок про русские буквы в пути).
const calledDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');

if (calledDirectly) {
	main().catch((err) => {
		console.error('РАЗВЕДКА УПАЛА:', err);
		process.exit(1);
	});
}
