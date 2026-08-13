// ЗАМЕР ПРАВИЛ ВЁРСТКИ ПО ОПУБЛИКОВАННЫМ ПОСТАМ (задача 19, этап 1.3–1.5).
// НИЧЕГО НЕ ПИШЕТ В ПОСТЫ.
//
// У КАЖДОГО ПРАВИЛА ДВА ВОПРОСА, А НЕ ОДИН: «применимо ли оно к этому посту»
// и «выполняется ли». Без первого вопроса числа врут: «подпись у картинки»
// нельзя спросить у поста без картинок, а посчитанный в знаменатель, он
// превратил бы правило в привычку.
//
// СЧИТАЕМ ОТДЕЛЬНО ПО ГОДАМ. Опубликованное — срез по времени: 205 постов
// из 263 это 2021–2022 годы. Правило, выполняющееся в 2022-м и не
// выполняющееся в 2026-м, — правило периода, и применять его ко всему архиву
// нельзя. Год, в котором постов меньше пяти, помечается «мало» и в вывод
// «правило устойчиво» не идёт.
//
// РАЗБОР ТОТ ЖЕ, ЧТО У СБОРКИ. Где заголовок, где картинка, где ссылка —
// спрашивается у дерева markdown (`archive-clean-lib.mjs`), а не у списка
// знаков.
//
// САМОПРОВЕРКА ПОДЛОГОМ: `--selftest`. У каждого правила есть случаи
// «обязано сказать НАРУШЕНО» и «обязано сказать ВЫПОЛНЕНО», примерно поровну.
// Проверка, которая не может провалиться, — это ложь в сторону «всё хорошо».
//
// Запуск:
//   node scripts/archive-rules-measure.mjs            — отчёт по архиву
//   node scripts/archive-rules-measure.mjs --selftest — подлоги
//   node scripts/archive-rules-measure.mjs --list ПРАВИЛО — имена постов-нарушителей

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, parseBody } from './archive-clean-lib.mjs';

// ── служебное ─────────────────────────────────────────────────────────────

const CATEGORY_LABEL = {
	podcast: 'Выпуск',
	videoessay: 'Видеоэссе',
	note: 'Заметка',
	article: 'Статья',
	bonus: 'Бонус',
};

/** Директивы, у которых на странице НЕТ видимого следа. */
const INVISIBLE = new Set(['anime-ref']);

/**
 * КАТЕГОРИЯ, КОТОРАЯ СТОИТ В ФАЙЛЕ, НЕ ВСЕГДА ГОВОРИТ, ЧТО ЭТО ЗА МАТЕРИАЛ.
 *
 * Робот забирает из RSS ВСЁ подряд и всему ставит `podcast` — так и задумано.
 * Видеоэссе среди них заказчик переводит в свою категорию РУКАМИ, и до его
 * руки такой пост лежит выпуском, которым не является. Считать его выпуском
 * значит мерить правила выпуска по чужому материалу.
 *
 * Признак — заголовок: «эссе», «мини-эссе», «врата аниме» (сказано заказчиком
 * 13 августа 2026).
 *
 * ПРАВИЛО-ДОГАДКА ПРОВЕРЕНО ПРИЗНАКОМ, КОТОРЫЙ ПОСТАВИЛ ЧЕЛОВЕК: среди
 * опубликованных выпусков, то есть уже прошедших через руки, под него
 * не подходит НИ ОДИН из 72 — все переведены. А в опубликованных видеоэссе
 * лежат «Врата аниме №1…№9». Ложных срабатываний нет.
 *
 * ОБРАТНОЕ НЕВЕРНО, И ЭТО ВАЖНО: видеоэссе 2026 года называются «Вся история
 * Харухи Судзумии» и «О чём на самом деле „Фрирен“?» — слова «эссе» в них нет
 * вовсе. Признак ловит не все видеоэссе, а только те, что сами себя называют.
 * Значит по нему можно ПЕРЕКЛАССИФИЦИРОВАТЬ найденное, но нельзя утверждать,
 * что остальные черновики-выпуски — точно выпуски.
 */
const ESSAY_IN_TITLE = /(^|[^а-яё])(мини-)?эссе([^а-яё]|$)|врата\s+аниме/i;

export function effectiveCategory(front) {
	const cat = front?.category ?? '(нет)';
	if (cat !== 'podcast') return cat;
	return ESSAY_IN_TITLE.test(String(front?.title ?? '')) ? 'videoessay' : cat;
}

function directiveName(node) {
	if (
		node.type === 'leafDirective' ||
		node.type === 'containerDirective' ||
		node.type === 'textDirective'
	) {
		return node.name;
	}
	return null;
}

function allNodes(tree) {
	const out = [];
	const walk = (n) => {
		out.push(n);
		if (Array.isArray(n.children)) n.children.forEach(walk);
	};
	walk(tree);
	return out;
}

function plainText(node) {
	if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
	if (!Array.isArray(node.children)) return '';
	return node.children.map(plainText).join('');
}

function yearOf(front) {
	const d = front.date;
	if (!d) return '?';
	if (d instanceof Date) return String(d.getUTCFullYear());
	const m = String(d).match(/^(\d{4})/);
	return m ? m[1] : '?';
}

/**
 * Абзац, состоящий ТОЛЬКО из markdown-картинки, — это картинка, а не текст.
 * Так лежит обложка выпуска, которую вставляет робот сверки с RSS.
 */
function paragraphIsLoneImage(node) {
	if (node.type !== 'paragraph') return false;
	const kids = (node.children ?? []).filter(
		(k) => !(k.type === 'text' && k.value.trim() === ''),
	);
	return kids.length === 1 && kids[0].type === 'image';
}

/** Тип видимого блока — то, что читатель на странице увидит на этом месте. */
function visibleBlockKind(node) {
	const dir = directiveName(node);
	if (dir) return INVISIBLE.has(dir) ? null : `::${dir}`;
	if (paragraphIsLoneImage(node)) return '![md-картинка]';
	return node.type;
}

// ── разбор поста ──────────────────────────────────────────────────────────

function viewOf(post) {
	const tree = parseBody(post.body);
	const blocks = tree.children ?? [];
	const nodes = allNodes(tree);
	const front = post.front ?? {};

	const visible = blocks.map((b) => ({ node: b, kind: visibleBlockKind(b) })).filter((b) => b.kind);

	const imageDirs = nodes.filter((n) => directiveName(n) === 'image');
	const mdImages = nodes.filter((n) => n.type === 'image');
	const headings = blocks.filter((b) => b.type === 'heading');

	return {
		post,
		front,
		id: post.id,
		draft: post.draft,
		category: effectiveCategory(front),
		categoryInFile: front.category ?? '(нет)',
		year: yearOf(front),
		tree,
		blocks,
		nodes,
		visible,
		imageDirs,
		mdImages,
		headings,
		cover: typeof front.cover === 'string' ? front.cover.trim() : '',
	};
}

// ── ПРАВИЛА ───────────────────────────────────────────────────────────────
//
// `applies` — про этот пост вопрос вообще имеет смысл?
// `holds`   — правило выполнено?
// `cats`    — к каким категориям правило относим (null = ко всем).

const RULES = [
	// ── заголовки ──
	{
		key: 'H-нет-h1h2',
		title: 'В теле нет заголовков первого и второго уровня',
		why: 'Первый уровень занят названием материала на странице; второй нигде не встречается.',
		applies: (v) => v.headings.length > 0,
		holds: (v) => v.headings.every((h) => h.depth >= 3),
	},
	{
		key: 'H-один-уровень',
		title: 'Все заголовки поста одного уровня — вложенности нет',
		why: 'Материал плоский: раздел и подраздел не различаются.',
		applies: (v) => v.headings.length > 1,
		holds: (v) => new Set(v.headings.map((h) => h.depth)).size === 1,
	},
	{
		key: 'H-не-первый',
		title: 'Тело не начинается с заголовка',
		why: 'Название материала уже стоит над текстом; заголовок сразу под ним читается дублем.',
		applies: () => true,
		holds: (v) => v.visible[0]?.kind !== 'heading',
	},
	{
		key: 'H-не-последний',
		title: 'Тело не кончается заголовком',
		why: 'Заголовок без текста под ним — обрубок.',
		applies: (v) => v.visible.length > 0,
		holds: (v) => v.visible[v.visible.length - 1]?.kind !== 'heading',
	},
	{
		key: 'H-без-жирного',
		title: 'Внутри заголовка нет жирного',
		why: 'Решение заказчика 12 августа: жирного внутри заголовка не бывает (правка 2 задачи 16).',
		applies: (v) => v.headings.length > 0,
		holds: (v) => !v.headings.some((h) => allNodes(h).some((n) => n.type === 'strong')),
	},
	{
		key: 'H-без-точки',
		title: 'Заголовок не кончается точкой',
		why: 'Точка в конце заголовка — след абзаца, из которого он сделан.',
		applies: (v) => v.headings.length > 0,
		holds: (v) => !v.headings.some((h) => /\.\s*$/.test(plainText(h))),
	},

	// ── начало и конец ──
	{
		key: 'НАЧ-выпуск-обложка',
		title: 'Выпуск начинается картинкой-обложкой с хостинга подкаста',
		why: 'Её ставит робот сверки с RSS; страница поднимает её в шапку и из текста убирает.',
		cats: ['podcast'],
		applies: () => true,
		holds: (v) => v.visible[0]?.kind === '![md-картинка]',
	},
	{
		key: 'НАЧ-видеоэссе-ролик',
		title: 'Видеоэссе начинается блоком ролика',
		why: 'Ролик — главное содержимое видеоэссе, текст идёт после него.',
		cats: ['videoessay'],
		applies: () => true,
		holds: (v) => v.visible[0]?.kind === '::video',
	},
	{
		key: 'НАЧ-картинка-дубль-обложки',
		title: 'Пост с обложкой начинается блоком ::image с ТОЙ ЖЕ картинкой',
		why: 'Так свёрстаны заметки, бонусы и статьи, привезённые из телеграма.',
		cats: ['note', 'bonus', 'article'],
		applies: (v) => v.cover !== '',
		holds: (v) => {
			const f = v.visible[0];
			if (f?.kind !== '::image') return false;
			const src = (f.node.attributes ?? {}).src ?? '';
			return src === v.cover;
		},
	},
	{
		key: 'КОН-не-голая-ссылка',
		title: 'Тело не кончается голым адресом отдельным абзацем',
		why: 'Голый адрес в конце — след копирования из телеграма.',
		applies: (v) => v.visible.length > 0,
		holds: (v) => {
			const last = v.visible[v.visible.length - 1];
			return !(last.kind === 'paragraph' && /^https?:\/\/\S+$/.test(plainText(last.node).trim()));
		},
	},

	// ── картинки ──
	{
		key: 'КАР-блоком',
		title: 'Картинка в тексте стоит блоком ::image, а не разметкой ![…]()',
		why: 'Блок даёт подпись, номер FIG и увеличение по нажатию; ![…]() ничего этого не даёт.',
		applies: (v) => v.imageDirs.length + v.mdImages.length > 0,
		// Обложка выпуска с хостинга подкаста — исключение: её ставит робот
		// и страница поднимает её в шапку, до вёрстки текста она не доживает.
		holds: (v) => v.mdImages.every((n) => /cdn\.mave\.digital/.test(n.url ?? '')),
	},
	{
		key: 'КАР-ширина-колонка',
		title: 'У картинки в тексте ширина «по колонке»',
		why: 'Единственная ширина, встречающаяся в архиве.',
		applies: (v) => v.imageDirs.length > 0,
		holds: (v) => v.imageDirs.every((n) => (n.attributes ?? {}).width === 'column'),
	},
	{
		key: 'КАР-подписи-всё-или-ничего',
		title: 'Подписи у картинок поста либо у всех, либо ни у одной',
		why: 'Часть подписана, часть нет — это недоделка, а не приём.',
		applies: (v) => v.imageDirs.length > 1,
		holds: (v) => {
			const cap = v.imageDirs.filter((n) => ((n.attributes ?? {}).caption ?? '').trim() !== '').length;
			return cap === 0 || cap === v.imageDirs.length;
		},
	},

	// ── выделения, списки, цитаты ──
	{
		key: 'ТЕК-нет-жирных-абзацев',
		title: 'Нет абзацев, целиком набранных жирным',
		why: 'Такой абзац — заголовок, набранный не тем средством (правка 2 задачи 16).',
		applies: () => true,
		holds: (v) =>
			!v.blocks.some(
				(b) =>
					b.type === 'paragraph' &&
					(b.children ?? []).length === 1 &&
					b.children[0].type === 'strong' &&
					plainText(b).trim() !== '',
			),
	},
	{
		key: 'ТЕК-нет-цитат',
		title: 'Цитат «>» в теле нет',
		why: '',
		applies: () => true,
		holds: (v) => !v.blocks.some((b) => b.type === 'blockquote'),
	},
	{
		key: 'ТЕК-нет-черты',
		title: 'Горизонтальной черты «---» в теле нет',
		why: 'Разделителем служат заголовок и воздух, а не линия.',
		applies: () => true,
		holds: (v) => !v.blocks.some((b) => b.type === 'thematicBreak'),
	},
	{
		key: 'ТЕК-нет-таблиц-кода-html',
		title: 'Таблиц, блоков кода и сырого HTML в теле нет',
		why: '',
		applies: () => true,
		holds: (v) => !v.blocks.some((b) => b.type === 'table' || b.type === 'code' || b.type === 'html'),
	},
	{
		key: 'ТЕК-нет-списков',
		title: 'Списков в теле нет',
		why: 'Перечисление ведётся абзацами и заголовками.',
		applies: () => true,
		holds: (v) => !v.blocks.some((b) => b.type === 'list'),
	},
	{
		key: 'ТЕК-нет-голых-адресов',
		title: 'Голого адреса отдельным абзацем нет нигде в теле',
		why: 'Адрес прячется в подпись ссылки либо уходит во врезку ::link.',
		applies: () => true,
		holds: (v) =>
			!v.blocks.some((b) => b.type === 'paragraph' && /^https?:\/\/\S+$/.test(plainText(b).trim())),
	},
	{
		key: 'ТЕК-ссылка-с-подписью',
		title: 'У ссылки в тексте подпись — слова, а не сам адрес',
		why: 'Адрес вместо подписи не читается и рвёт строку.',
		applies: (v) => v.nodes.some((n) => n.type === 'link'),
		holds: (v) =>
			!v.nodes.some((n) => n.type === 'link' && /^https?:\/\//.test(plainText(n).trim())),
	},

	// ── шапка ──
	{
		key: 'ШАП-описание-пусто',
		title: 'Поле «Описание» в шапке не заполняется',
		why: 'Описание для поисковика и превью строится из первого абзаца тела.',
		applies: () => true,
		holds: (v) => {
			const d = v.front.description;
			return !(typeof d === 'string' && d.trim() !== '');
		},
	},
	{
		key: 'ШАП-обложка-решена',
		title: 'Вопрос обложки решён: либо картинка, либо галочка «Без обложки»',
		why: 'Пустое поле без галочки значит «подбери сам» — то есть вопрос открыт.',
		cats: ['note', 'article', 'bonus'],
		applies: () => true,
		holds: (v) => v.cover !== '' || v.front.noCover === true,
	},
];

// ── замер ─────────────────────────────────────────────────────────────────

function measure(views, rule) {
	const set = rule.cats ? views.filter((v) => rule.cats.includes(v.category)) : views;
	const app = set.filter((v) => rule.applies(v));
	const ok = app.filter((v) => rule.holds(v));
	const bad = app.filter((v) => !rule.holds(v));
	return { applicable: app.length, ok: ok.length, bad: bad.length, badList: bad };
}

function measureByYear(views, rule) {
	const years = [...new Set(views.map((v) => v.year))].sort();
	const out = [];
	for (const y of years) {
		const r = measure(views.filter((v) => v.year === y), rule);
		if (r.applicable > 0) out.push({ year: y, ...r });
	}
	return out;
}

function pad(s, n) {
	s = String(s);
	return s + ' '.repeat(Math.max(0, n - [...s].length));
}
function padLeft(s, n) {
	s = String(s);
	return ' '.repeat(Math.max(0, n - [...s].length)) + s;
}

// ── ПОРОГ ─────────────────────────────────────────────────────────────────
//
// Правило — это то, что заказчик соблюдал НЕ ЗАДУМЫВАЯСЬ. Значит:
//   • применимых постов не меньше 20 (на десятке любое совпадение выглядит
//     законом — прямое требование задания);
//   • выполняется не меньше чем в 95 %;
//   • и НЕ РАЗЪЕЗЖАЕТСЯ ПО ГОДАМ: в каждом году, где применимых не меньше 10,
//     доля тоже не ниже 80 %. Год с меньшим числом в приговор не идёт,
//     но печатается.
// Всё, что проходит первые два условия и валится на третьем, называется
// «правилом периода» отдельно — это не привычка, а смена стиля.
const MIN_APPLICABLE = 20;
const RULE_SHARE = 0.95;
const YEAR_MIN_APPLICABLE = 10;
const YEAR_SHARE = 0.8;

function verdict(total, years) {
	if (total.applicable < MIN_APPLICABLE) return 'мало данных';
	const share = total.ok / total.applicable;
	if (share < 0.6) return 'не правило';
	const big = years.filter((y) => y.applicable >= YEAR_MIN_APPLICABLE);
	const drift = big.filter((y) => y.ok / y.applicable < YEAR_SHARE);
	if (share >= RULE_SHARE) return drift.length ? 'правило периода' : 'ПРАВИЛО';
	return drift.length ? 'привычка периода' : 'привычка';
}

async function main() {
	const posts = await readPostsRaw();
	const views = posts.map(viewOf);
	const pub = views.filter((v) => !v.draft);
	const dra = views.filter((v) => v.draft);

	const listAt = process.argv.indexOf('--list');
	if (listAt !== -1 && process.argv[listAt + 1]) {
		const key = process.argv[listAt + 1];
		const rule = RULES.find((r) => r.key === key);
		if (!rule) {
			console.error(`Правила «${key}» нет. Есть: ${RULES.map((r) => r.key).join(', ')}`);
			process.exit(1);
		}
		const scope = process.argv.includes('--drafts') ? dra : pub;
		const r = measure(scope, rule);
		console.log(`${rule.key}: нарушают ${r.bad} из ${r.applicable}`);
		for (const v of r.badList) console.log(`  ${v.year} ${CATEGORY_LABEL[v.category] ?? v.category}: ${v.id}`);
		return;
	}

	const cats = ['podcast', 'note', 'article', 'videoessay', 'bonus'];

	// Что переклассифицировано и на каком основании — вслух, а не молча.
	const moved = views.filter((v) => v.category !== v.categoryInFile);
	console.log();
	console.log('─'.repeat(96));
	console.log(`РАСПОЗНАНО ВИДЕОЭССЕ СРЕДИ ВЫПУСКОВ: ${moved.length} (по слову в заголовке)`);
	console.log('─'.repeat(96));
	const movedPub = moved.filter((v) => !v.draft);
	console.log(`  из них опубликованных: ${movedPub.length}` +
		(movedPub.length === 0
			? '  ← ноль. Значит все прошедшие через руки уже переведены, и ложных срабатываний правило не даёт.'
			: '  ← НЕ ноль: правило спорит с решением человека, разобрать поимённо!'));
	for (const v of movedPub) console.log(`     ${v.id}: ${v.front.title}`);
	const byYear = {};
	for (const v of moved) byYear[v.year] = (byYear[v.year] ?? 0) + 1;
	console.log(`  по годам: ${Object.entries(byYear).sort().map(([y, n]) => `${y}: ${n}`).join(', ')}`);
	console.log();

	console.log('═'.repeat(96));
	console.log('ЗАМЕР ПРАВИЛ ПО ОПУБЛИКОВАННЫМ. Порог: применимых ≥' + MIN_APPLICABLE +
		', выполнение ≥' + Math.round(RULE_SHARE * 100) + '%, и по годам не ниже ' +
		Math.round(YEAR_SHARE * 100) + '%.');
	console.log('═'.repeat(96));

	for (const cat of cats) {
		const set = pub.filter((v) => v.category === cat);
		const draftSet = dra.filter((v) => v.category === cat);
		console.log();
		console.log('▄'.repeat(96));
		console.log(`  ${(CATEGORY_LABEL[cat] ?? cat).toUpperCase()} — опубликовано ${set.length}, черновиков ${draftSet.length}`);
		console.log('▀'.repeat(96));
		console.log(`${pad('правило', 34)}${padLeft('вып.', 6)}${padLeft('из', 6)}${padLeft('%', 6)}  ${pad('приговор', 17)}по годам (год: вып/прим)`);

		for (const rule of RULES) {
			if (rule.cats && !rule.cats.includes(cat)) continue;
			const r = measure(set, rule);
			if (r.applicable === 0) continue;
			const years = measureByYear(set, rule);
			const share = Math.round((r.ok / r.applicable) * 100);
			const yearStr = years
				.map((y) => `${y.year.slice(2)}:${y.ok}/${y.applicable}${y.applicable < YEAR_MIN_APPLICABLE ? '·' : ''}`)
				.join(' ');
			console.log(
				`${pad(rule.key, 34)}${padLeft(r.ok, 6)}${padLeft(r.applicable, 6)}${padLeft(share + '%', 6)}  ${pad(verdict(r, years), 17)}${yearStr}`,
			);
		}

		// то же по черновикам — чтобы видеть, сколько работы даст правило
		console.log();
		console.log('  ↳ те же правила по ЧЕРНОВИКАМ этой категории (сколько постов нарушает):');
		for (const rule of RULES) {
			if (rule.cats && !rule.cats.includes(cat)) continue;
			const r = measure(draftSet, rule);
			if (r.applicable === 0) continue;
			const share = Math.round((r.ok / r.applicable) * 100);
			console.log(
				`    ${pad(rule.key, 34)}${padLeft(r.bad, 6)} нарушают из ${padLeft(r.applicable, 5)} применимых  (${share}% выполняют)`,
			);
		}
	}

	// Расшифровка правил словами
	console.log();
	console.log('═'.repeat(96));
	console.log('ЧТО ЗНАЧИТ КАЖДЫЙ КЛЮЧ');
	console.log('═'.repeat(96));
	for (const rule of RULES) {
		console.log(`${pad(rule.key, 34)}${rule.title}`);
		if (rule.why) console.log(`${' '.repeat(34)}${rule.why}`);
	}
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
//
// У каждого правила случаи в ОБЕ стороны. Проверка, которая на здоровом
// молчит, но и на больном молчит, — это ложь в сторону «всё хорошо».

const FAKES = [
	// [ключ правила, ожидание holds, шапка, тело, пояснение]
	['H-нет-h1h2', false, {}, '# Заголовок\n\nтекст', 'H1 в теле обязан ловиться'],
	['H-нет-h1h2', false, {}, 'текст\n\n## Второй уровень\n\nещё', 'H2 обязан ловиться'],
	['H-нет-h1h2', true, {}, 'текст\n\n### Третий уровень\n\nещё', 'H3 законен'],
	// Решётка внутри абзаца и внутри адреса до дерева заголовком не доезжает.
	// Настоящий заголовок в подлоге нужен, иначе правило неприменимо и молчит
	// не потому, что разобралось, а потому, что его не спросили.
	['H-нет-h1h2', true, {}, '### Настоящий\n\nтекст с решёткой #хештег внутри абзаца', 'решётка в тексте — не заголовок'],
	['H-нет-h1h2', true, {}, '### Настоящий\n\nссылка [тут](https://x.ru/a#anchor) с якорем', 'решётка в адресе — не заголовок'],

	['H-один-уровень', false, {}, '### А\n\nт\n\n#### Б\n\nт', 'разные уровни обязаны ловиться'],
	['H-один-уровень', true, {}, '### А\n\nт\n\n### Б\n\nт', 'одинаковые уровни законны'],

	['H-не-первый', false, {}, '### Заголовок\n\nтекст', 'заголовок первым обязан ловиться'],
	['H-не-первый', true, {}, 'текст\n\n### Заголовок\n\nещё', 'заголовок не первым законен'],
	// Невидимую метку читатель не видит, поэтому первым ВИДИМЫМ блоком остаётся
	// заголовок — правило обязано нарушиться, а не спрятаться за метку.
	['H-не-первый', false, {}, '::anime-ref{id="x"}\n\n### Заголовок\n\nт', 'невидимая метка заголовок не прикрывает'],
	['H-не-первый', true, {}, '::image{src="/i/a.jpg" width="column"}\n\n### Заголовок\n\nт', 'картинка перед заголовком — законное начало'],

	['H-не-последний', false, {}, 'текст\n\n### Хвост', 'заголовок последним обязан ловиться'],
	['H-не-последний', true, {}, 'текст\n\n### Хвост\n\nещё текст', 'заголовок с текстом под ним законен'],
	['H-не-последний', true, {}, 'текст\n\n### Хвост\n\nещё\n\n::anime-ref{id="x"}', 'невидимая метка после заголовка не спасает — но текст есть, законно'],

	['H-без-жирного', false, {}, '### **Жирный заголовок**', 'жирный внутри заголовка обязан ловиться'],
	['H-без-жирного', true, {}, '### Обычный заголовок', 'обычный заголовок законен'],

	['H-без-точки', false, {}, '### Заголовок с точкой.', 'точка обязана ловиться'],
	['H-без-точки', true, {}, '### Заголовок без точки', 'без точки законно'],
	['H-без-точки', true, {}, '### Заголовок с многоточием…', 'многоточие — не точка'],

	['НАЧ-выпуск-обложка', false, { category: 'podcast' }, 'просто текст', 'выпуск без картинки обязан ловиться'],
	['НАЧ-выпуск-обложка', true, { category: 'podcast' }, '![Обложка](https://cdn.mave.digital/a.jpg)\n\nтекст', 'обложка с хостинга законна'],

	['НАЧ-видеоэссе-ролик', false, { category: 'videoessay' }, 'текст\n\n::video{youtube="https://x"}', 'ролик не первым обязан ловиться'],
	['НАЧ-видеоэссе-ролик', true, { category: 'videoessay' }, '::video{youtube="https://x"}\n\nтекст', 'ролик первым законен'],

	['НАЧ-картинка-дубль-обложки', false, { category: 'note', cover: '/i/a.jpg' }, '::image{src="/i/ДРУГАЯ.jpg" width="column"}\n\nт', 'другая картинка обязана ловиться'],
	['НАЧ-картинка-дубль-обложки', false, { category: 'note', cover: '/i/a.jpg' }, 'текст\n\n::image{src="/i/a.jpg" width="column"}', 'картинка не первой обязана ловиться'],
	['НАЧ-картинка-дубль-обложки', true, { category: 'note', cover: '/i/a.jpg' }, '::image{src="/i/a.jpg" width="column"}\n\nт', 'та же картинка первой законна'],

	['КОН-не-голая-ссылка', false, {}, 'текст\n\nhttps://t.me/podcastbaka', 'голый адрес в конце обязан ловиться'],
	['КОН-не-голая-ссылка', true, {}, 'текст\n\n[канал](https://t.me/podcastbaka)', 'ссылка с подписью законна'],
	['КОН-не-голая-ссылка', true, {}, 'https://t.me/x\n\nтекст после', 'голый адрес НЕ в конце это другое правило'],

	['КАР-блоком', false, {}, '![подпись](/images/uploads/a.jpg)\n\nтекст', 'своя markdown-картинка обязана ловиться'],
	['КАР-блоком', true, {}, '![Обложка](https://cdn.mave.digital/a.jpg)\n\nтекст', 'обложка выпуска — законное исключение'],
	['КАР-блоком', true, {}, '::image{src="/i/a.jpg" width="column"}\n\nтекст', 'блок ::image законен'],

	['КАР-ширина-колонка', false, {}, '::image{src="/i/a.jpg" width="full"}', 'ширина full обязана ловиться'],
	['КАР-ширина-колонка', false, {}, '::image{src="/i/a.jpg"}', 'ширина не указана — обязано ловиться'],
	['КАР-ширина-колонка', true, {}, '::image{src="/i/a.jpg" width="column"}', 'колонка законна'],

	['КАР-подписи-всё-или-ничего', false, {}, '::image{src="/a.jpg" caption="раз" width="column"}\n\n::image{src="/b.jpg" width="column"}', 'вперемешку обязано ловиться'],
	['КАР-подписи-всё-или-ничего', true, {}, '::image{src="/a.jpg" caption="раз" width="column"}\n\n::image{src="/b.jpg" caption="два" width="column"}', 'у всех — законно'],
	['КАР-подписи-всё-или-ничего', true, {}, '::image{src="/a.jpg" width="column"}\n\n::image{src="/b.jpg" width="column"}', 'ни у одной — законно'],

	['ТЕК-нет-жирных-абзацев', false, {}, 'текст\n\n**Весь абзац жирный**\n\nещё', 'жирный абзац обязан ловиться'],
	['ТЕК-нет-жирных-абзацев', true, {}, 'текст с **жирным словом** внутри', 'жирное слово внутри абзаца законно'],

	['ТЕК-нет-цитат', false, {}, '> цитата', 'цитата обязана ловиться'],
	['ТЕК-нет-цитат', true, {}, 'текст со знаком > внутри строки', 'знак в тексте — не цитата'],

	['ТЕК-нет-черты', false, {}, 'текст\n\n---\n\nещё', 'черта обязана ловиться'],
	['ТЕК-нет-черты', true, {}, 'текст\n\nещё', 'без черты законно'],

	['ТЕК-нет-таблиц-кода-html', false, {}, '| а | б |\n|---|---|\n| 1 | 2 |', 'таблица обязана ловиться'],
	['ТЕК-нет-таблиц-кода-html', false, {}, '```\nкод\n```', 'блок кода обязан ловиться'],
	['ТЕК-нет-таблиц-кода-html', false, {}, '<div>сырой html</div>', 'сырой HTML обязан ловиться'],
	['ТЕК-нет-таблиц-кода-html', true, {}, 'текст с `кодом внутри строки`', 'встроенный код — не блок'],

	['ТЕК-нет-списков', false, {}, '- раз\n- два', 'список обязан ловиться'],
	['ТЕК-нет-списков', false, {}, '1. раз\n2. два', 'нумерованный список обязан ловиться'],
	['ТЕК-нет-списков', true, {}, 'текст с дефисом — вот таким', 'тире в тексте — не список'],

	['ТЕК-нет-голых-адресов', false, {}, 'текст\n\nhttps://x.ru/a\n\nещё', 'голый адрес обязан ловиться'],
	['ТЕК-нет-голых-адресов', true, {}, 'текст со ссылкой [тут](https://x.ru/a) внутри', 'ссылка с подписью законна'],

	['ТЕК-ссылка-с-подписью', false, {}, '[https://t.me/x](https://t.me/x)', 'адрес вместо подписи обязан ловиться'],
	['ТЕК-ссылка-с-подписью', true, {}, '[наш канал](https://t.me/x)', 'словесная подпись законна'],

	['ШАП-описание-пусто', false, { description: 'что-то' }, 'текст', 'заполненное описание обязано ловиться'],
	['ШАП-описание-пусто', true, { description: '' }, 'текст', 'пустое описание законно'],
	['ШАП-описание-пусто', true, {}, 'текст', 'отсутствие поля законно'],

	['ШАП-обложка-решена', false, { category: 'note' }, 'текст', 'пустая обложка без галочки обязана ловиться'],
	['ШАП-обложка-решена', true, { category: 'note', cover: '/i/a.jpg' }, 'текст', 'обложка есть — законно'],
	['ШАП-обложка-решена', true, { category: 'note', noCover: true }, 'текст', 'галочка «без обложки» — законно'],
];

// Подлоги на распознавание видеоэссе среди выпусков. Слово «эссе» коротко
// и сидит внутри других слов — без случаев «обязано промолчать» правило
// молча перекрасило бы чужие посты.
const CATEGORY_FAKES = [
	['podcast', 'Лучшее аниме о ностальгии | Мини-эссе', 'videoessay', 'мини-эссе через дефис'],
	['podcast', 'Исекаи — все! Что будет дальше? | Эссе', 'videoessay', 'Эссе с большой буквы'],
	['podcast', 'Исекай. Как этот жанр захватил аниме? | Врата аниме №10', 'videoessay', 'рубрика «Врата аниме»'],
	['podcast', 'ВРАТА   АНИМЕ №3', 'videoessay', 'капслок и лишние пробелы внутри рубрики'],
	['podcast', 'Фрирен — лучшее аниме в истории?', 'podcast', 'обычный выпуск не трогать'],
	['podcast', 'Что мы узнали в процессе съёмок', 'podcast', 'ПРОЦЕССЕ — не эссе'],
	['podcast', 'Об интересе к сэйнену', 'podcast', 'ИНТЕРЕСЕ — не эссе'],
	['podcast', 'Эссенция жанра', 'podcast', 'ЭССЕНЦИЯ — не эссе'],
	['podcast', 'Ворота аниме открыты', 'podcast', 'ВОРОТА — не «врата»'],
	['note', 'Мини-эссе про опенинги', 'note', 'заметку не перекрашивать: правило только про выпуски'],
	['videoessay', 'Вся история Харухи Судзумии', 'videoessay', 'видеоэссе без слова «эссе» остаётся собой'],
];

function selftest() {
	let bad = 0;
	let done = 0;
	const seen = new Set();

	for (const [cat, title, expect, note] of CATEGORY_FAKES) {
		const got = effectiveCategory({ category: cat, title });
		done++;
		if (got !== expect) {
			console.log(`  ✗ распознавание: «${title}» — ожидалось ${expect}, вышло ${got} — «${note}»`);
			bad++;
		}
	}

	for (const [key, expect, front, body, note] of FAKES) {
		const rule = RULES.find((r) => r.key === key);
		if (!rule) {
			console.log(`  ✗ подлог ссылается на несуществующее правило «${key}»`);
			bad++;
			continue;
		}
		seen.add(key);
		const fake = viewOf({
			id: 'подлог',
			file: 'подлог.md',
			draft: true,
			front: { date: '2026-01-01', category: 'note', ...front },
			head: '',
			body: '\n' + body + '\n',
			raw: '',
		});

		if (!rule.applies(fake)) {
			console.log(`  ✗ ${key}: правило сочло подлог НЕПРИМЕНИМЫМ — «${note}»`);
			bad++;
			continue;
		}
		const got = rule.holds(fake);
		done++;
		if (got !== expect) {
			console.log(`  ✗ ${key}: ожидалось ${expect ? 'ВЫПОЛНЕНО' : 'НАРУШЕНО'}, вышло ${got ? 'ВЫПОЛНЕНО' : 'НАРУШЕНО'} — «${note}»`);
			bad++;
		}
	}

	// Правило без подлога — это правило, которое нечем уронить.
	const noFake = RULES.filter((r) => !seen.has(r.key));
	if (noFake.length) {
		console.log(`  ✗ правила без подлогов: ${noFake.map((r) => r.key).join(', ')}`);
		bad += noFake.length;
	}

	const neg = FAKES.filter(([, e]) => e === false).length;
	console.log();
	console.log(`Подлогов прогнано: ${done}. Из них «обязано НАРУШИТЬСЯ»: ${neg}, «обязано пройти»: ${done - neg}.`);
	if (bad) {
		console.log(`ПОДЛОГИ ПРОВАЛЕНЫ: ${bad}`);
		process.exit(1);
	}
	console.log('Все подлоги сошлись: каждое правило и ловит, и молчит там, где должно.');
}

// «МЕНЯ ЗАПУСТИЛИ НАПРЯМУЮ ИЛИ ПОДКЛЮЧИЛИ?» — сравнение ПУТЯМИ, а не строками.
// В пути к проекту русские буквы: `import.meta.url` их кодирует (`%D0%A1%D0%B0…`),
// а `process.argv[1]` — нет, и строчное сравнение не совпадёт НИКОГДА. Скрипт
// при этом не падает, он молча ничего не делает и выходит с кодом 0 (урок
// проекта, `статус/уроки-подробно.md`). Без этой развилки любой `import`
// отсюда печатал бы весь отчёт вместе со своим.
const runDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');

if (runDirectly) {
	if (process.argv.includes('--selftest')) {
		selftest();
	} else {
		main().catch((err) => {
			console.error('ЗАМЕР УПАЛ:', err);
			process.exit(1);
		});
	}
}
