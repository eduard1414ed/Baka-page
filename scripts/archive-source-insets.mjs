// ПРАВКА 2Б ЗАДАЧИ 19: ИСТОЧНИКИ СОБИРАЮТСЯ ВО ВРЕЗКУ ::link.
//
// Образец — опубликованные посты: 106 врезок из 127 это источники, и стоят они
// группой под подписью («Источники», «Список материалов», «Что ещё посмотреть
// и почитать», «Полезные материалы к этому выпуску»).
//
// РАБОТАЕМ ПО СТРОКАМ ВНУТРИ АБЗАЦЕВ, А НЕ ПО БЛОКАМ. Подводка и первая ссылка
// сплошь и рядом лежат в ОДНОМ абзаце, разделённые мягким переносом:
//     Обещанные ссылки:
//     Gigguk — Fantasy Anime…: [https://youtu.be/…](…)
// Разбор видит тут один абзац, и блочная правка либо съела бы подводку вместе
// со ссылкой, либо не нашла бы ни того ни другого. Поэтому дерево спрашивается
// только о том, ГДЕ можно трогать (абзац — можно, код, цитата и наши блоки —
// нельзя), а режется по строкам.
//
// ФОРМ ЗАПИСИ ЧЕТЫРЕ, и все найдены замером, а не придуманы:
//   А. `Подпись: ссылка`            — подпись и адрес в одной строке
//   Б. `Подпись — ссылка`           — то же через тире
//   В. `Подпись (ссылка)`           — адрес в скобках в конце
//   Г. `N. Подпись` + строка-адрес  — нумерованный список, адрес следующей строкой
//   Д. голый адрес без подписи      — НЕ ТРОГАЕМ, показываем отдельной группой
//
// Запуск:
//   node scripts/archive-source-insets.mjs             — разбор, ничего не пишет
//   node scripts/archive-source-insets.mjs --only ep-83 — один пост целиком
//   node scripts/archive-source-insets.mjs --selftest  — подлоги

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, writePostBody, parseBody } from './archive-clean-lib.mjs';
import { effectiveCategory } from './archive-rules-measure.mjs';
// ПРИЗНАК «СВОЯ ПЛОЩАДКА» БЕРЁТСЯ У ПРАВКИ 2А, а не пишется здесь второй раз.
// Разойдись эти два списка — 2а сносила бы одно, а 2б верстала бы другое,
// и обвес переехал бы во врезку под видом источника. На живых данных это
// и случилось: у бонусов обвес записан эмодзи («💛 → ВК», «💚 → Бусти»),
// формы 2а не имеет, и 2б собралась его сверстать.
import { ownNameOf } from './archive-own-links.mjs';
// Вопрос «разметка ссылки собралась?» задаётся ТЕМ ЖЕ правилом, что и в сборке:
// своя копия отвечала бы про правило, которого на сайте нет.
import { сломаннаяРазметкаСсылок } from '../src/plugins/post-links-integration.mjs';
// Кавычка в значении атрибута директивы — одно правило на проект, и ту же
// функцию зовут четыре плагина сборки на обратной замене.
import { escapeAttr } from '../src/lib/directiveAttr.mjs';

const CATEGORY_LABEL = { podcast: 'Выпуск', note: 'Заметка', article: 'Статья', videoessay: 'Видеоэссе', bonus: 'Бонус' };

/** Категории, где врезка — это правило опубликованных. Заметки живут иначе. */
const SCOPE = new Set(['podcast', 'videoessay', 'bonus']);

// РЕКЛАМУ ИЩЕМ И В ТЕКСТЕ, И В САМОМ АДРЕСЕ. Живой прогон показал, что метки
// сидят внутри ссылки латиницей и мимо словесного признака проходят:
// `?eridLjN8KZKvH` (без границы слова после erid) и
// `utm_campaign=promocode-bekam25`. Пропустить рекламную ссылку во врезку
// нельзя: маркировка — закон, и рвать её от её ссылки мы не вправе.
// «Скидка» и «по ссылке от меня» — тоже реклама, и это нашёл живой прогон:
// у HD School в ep-124/126/127 ни erid в адресе, ни слова «промокод» нет,
// а строка маркировки стоит в самом конце тела, далеко от своей ссылки.
const AD_MARK = /\berid\b|промокод|скидк|реклама\.|рекламодател|\bинн\b|по ссылке от меня/i;
const AD_IN_URL = /erid|promocode|partnerid|utm_campaign=promo|utm_medium=cpa/i;

/**
 * Размеченная ссылка `[текст](адрес)` и голый адрес — оба считаются ссылкой.
 *
 * КАРТИНКА — НЕ ССЫЛКА, и отличается она одним знаком. `![Обложка](адрес)`
 * от `[Обложка](адрес)` отличается восклицательным знаком перед скобкой,
 * и первая версия правила его не смотрела: обложка выпуска, которую робот
 * кладёт первой строкой тела, разбиралась как строка врезки с подписью «!».
 * Сверстай мы так — обложки уехали бы во врезку у ВСЕХ выпусков разом.
 */
const MD_LINK = /(!?)\[([^\]]*)\]\((\s*[^)\s]+)\s*\)/;
const BARE_URL = /^(https?:\/\/\S+)$/;

/**
 * Строки тела, которые ТРОГАТЬ МОЖНО.
 * Спрашиваем дерево: всё, что не абзац (заголовок, цитата, код, список
 * с разметкой, наши директивы), из правки исключено. Список — исключение:
 * форма Г как раз им и записана, поэтому список разрешён, но только
 * нумерованный и только если его пункты выглядят подписями.
 */
function editableLineRange(body) {
	const tree = parseBody(body);
	const ok = new Set();
	const lineOf = (offset) => body.slice(0, offset).split('\n').length - 1;
	for (const b of tree.children ?? []) {
		const kind = b.type;
		const allowed = kind === 'paragraph' || (kind === 'list' && b.ordered);
		if (!allowed) continue;
		const from = lineOf(b.position.start.offset);
		const to = lineOf(b.position.end.offset - 1);
		for (let i = from; i <= to; i++) ok.add(i);
	}
	return ok;
}

/** Разбор одной строки: что это — подпись со ссылкой, голый адрес, подводка? */
function readLine(raw) {
	const line = raw.trim();
	if (!line) return { kind: 'пусто' };
	if (AD_MARK.test(line)) return { kind: 'реклама' };

	const bare = line.match(BARE_URL);
	if (bare) {
		if (ownNameOf(bare[1])) return { kind: 'обвес — не мой случай', url: bare[1], line };
		if (AD_IN_URL.test(bare[1])) return { kind: 'реклама', line };
		return { kind: 'голый адрес', url: bare[1] };
	}

	const m = line.match(MD_LINK);
	if (m) {
		if (m[1] === '!') return { kind: 'картинка — не ссылка', line };
		if (ownNameOf(m[3].trim())) return { kind: 'обвес — не мой случай', url: m[3].trim(), line };
		if (AD_IN_URL.test(m[3])) return { kind: 'реклама', line };
		const shown = m[2].trim();
		const url = m[3].trim();
		const before = line.slice(0, m.index).trim();
		const after = line.slice(m.index + m[0].length).trim();
		// Адрес в скобках в конце: «Имя — описание ([адрес](адрес))»
		const inParens = before.endsWith('(') && after === ')';
		// Ведущий маркер списка («— Читай-город», «• ВК») в подпись не идёт:
		// точку списка на странице рисует уже сама врезка.
		const label = (inParens ? before.slice(0, -1) : before)
			.replace(/[\s—–:•·|-]+$/u, '')
			.replace(/^[\s—–•·*-]+/u, '')
			.trim();
		// Ссылка вплетена в предложение — не наш случай.
		if (!inParens && after !== '') return { kind: 'ссылка внутри текста', line };
		// Подпись у самой ссылки («Ковбой Бибоп на самом деле кино»), если
		// снаружи её нет, а внутри — не адрес.
		const innerLabel = /^https?:\/\//.test(shown) ? '' : shown;
		return {
			kind: label || innerLabel ? 'подпись со ссылкой' : 'адрес без подписи',
			label: label || innerLabel,
			url,
			shownIsUrl: /^https?:\/\//.test(shown),
			line,
		};
	}

	// Пункт нумерованного списка — подпись для следующей строки-адреса.
	const numbered = line.match(/^(\d{1,2})[.)]\s+(.+)$/);
	if (numbered) return { kind: 'номер с подписью', label: numbered[2].trim(), line };

	if (line.endsWith(':')) {
		// ПОДПИСЬ ВРЕЗКИ — ЭТО ПОСЛЕДНЕЕ ПРЕДЛОЖЕНИЕ ПОДВОДКИ, А НЕ ВСЯ ОНА.
		// «Еще в выпуске я рассказываю про мангу „Пять невесть“. Где ее можно
		// купить:» — первое предложение это рассказ, и в узкий технический
		// столбец врезки ему нельзя. Режем по точке, вопросу и восклицанию;
		// текст перед ними остаётся в теле абзацем.
		const whole = line.slice(0, -1).trim();
		const cut = whole.search(/[.!?]\s+(?=[^\s])(?![^А-ЯA-Z]*$)/u);
		const tail = cut === -1 ? whole : whole.slice(cut + 1).trim();
		return { kind: 'подводка', label: tail, head: cut === -1 ? '' : whole.slice(0, cut + 1).trim(), line };
	}
	return { kind: 'текст', line };
}

/** Полный разбор тела: строки + что из них выйдет. */
function analyse(body) {
	const lines = body.split('\n');
	const editable = editableLineRange(body);
	const read = lines.map((l, i) => (editable.has(i) ? readLine(l) : { kind: 'нельзя трогать' }));

	// Форма Г: «N. Подпись», а через строку-другую — голый адрес.
	//
	// ПУСТУЮ СТРОКУ СПРАШИВАЕМ У ТЕКСТА, А НЕ У РАЗБОРА. Пустая строка между
	// двумя блоками не принадлежит НИ ОДНОМУ из них, и дерево помечает её
	// «нельзя трогать», а не «пусто». Первая версия обрывала поиск адреса
	// ровно на ней — и форма Г не собиралась ни разу, молча.
	for (let i = 0; i < read.length; i++) {
		if (read[i].kind !== 'номер с подписью') continue;
		for (let j = i + 1; j < Math.min(i + 4, read.length); j++) {
			if (lines[j].trim() === '') continue;
			if (read[j].kind === 'голый адрес' || (read[j].kind === 'адрес без подписи')) {
				read[j] = { kind: 'подпись со ссылкой', label: read[i].label, url: read[j].url, fromNumber: true, line: read[j].line ?? read[j].url };
				read[i] = { kind: 'подпись ушла в ссылку' };
			}
			break;
		}
	}

	// ── ГРУППЫ ────────────────────────────────────────────────────────────
	//
	// СТРОКА ИДЁТ ВО ВРЕЗКУ, ТОЛЬКО ЕСЛИ ОНА В СПИСКЕ. Список — это либо две
	// и больше строк-ссылок подряд, либо одна строка прямо под подводкой,
	// кончающейся двоеточием.
	//
	// Без этого условия живой прогон тащил во врезку одиночные ссылки
	// на конце предложения: «На все эти вопросы (и множество других) нам
	// помогает ответить [ссылка]» — это проза, а не пункт списка, и подпись
	// у такой строки получается обрубком фразы. Одиночную ссылку в прозе
	// автор ставил как ссылку в тексте, и трогать её нельзя.
	//
	// РЯДОМ С РЕКЛАМОЙ НЕ ВЕРСТАЕМ ВОВСЕ. У рекламной ссылки метка может
	// лежать в СОСЕДНЕМ абзаце («Сайт Tripster: clck.ru/…» — ни erid,
	// ни промокода в самой строке), и, уехав во врезку, ссылка оторвалась бы
	// от своей маркировки. Поэтому группа, у которой в двух строках сверху
	// или снизу есть реклама, пропускается целиком.
	const groups = [];
	let i = 0;
	while (i < read.length) {
		if (read[i].kind !== 'подпись со ссылкой') { i++; continue; }
		let end = i;
		const members = [];
		for (let j = i; j < read.length; j++) {
			if (read[j].kind === 'подпись со ссылкой') { members.push(j); end = j; continue; }
			if (lines[j].trim() === '' || read[j].kind === 'подпись ушла в ссылку' || read[j].kind === 'нельзя трогать') continue;
			break;
		}

		// подводка: ближайшая строка «подводка» над группой, не дальше двух
		// значащих строк
		let lead = null;
		let leadLine = -1;
		for (let k = i - 1, seen = 0; k >= 0 && seen < 2; k--) {
			if (lines[k].trim() === '') continue;
			// Подпись нумерованного пункта уже уехала в строку врезки, а сама
			// строка сейчас исчезнет — она подводку не заслоняет. Без этой
			// оговорки «Полезные материалы:» в ep-83 не находилась вовсе:
			// поиск упирался в «1. Johan Liebert…» и обрывался.
			if (read[k].kind === 'подпись ушла в ссылку') continue;
			seen++;
			if (read[k].kind === 'подводка') { lead = read[k].label; leadLine = k; break; }
			break;
		}

		// РЕКЛАМА СТОИТ ПЕРЕД СВОЕЙ ССЫЛКОЙ, А НЕ ПОСЛЕ. Поэтому смотрим одну
		// значащую строку СВЕРХУ, а не окно в обе стороны: строка `erid`
		// лежит в самом конце тела и при широком окне выбрасывала законную
		// группу «Обещанные ссылки» через полтела от себя.
		let adNear = false;
		for (let k = i - 1; k >= 0; k--) {
			if (lines[k].trim() === '') continue;
			adNear = read[k].kind === 'реклама';
			break;
		}

		const isList = members.length >= 2 || lead !== null;
		groups.push({ from: i, to: end, members, lead, leadLine, adNear, take: isList && !adNear });
		i = end + 1;
	}

	return { lines, read, groups };
}

/**
 * ПРЯМАЯ КАВЫЧКА В ПОДПИСИ ЛОМАЕТ РАЗБОР ДИРЕКТИВЫ, и правило это живёт
 * в одном месте — `src/lib/directiveAttr.mjs`. В архиве такая подпись есть,
 * и не одна: `The Brilliance of Naoki Urasawa's "Monster"` в ep-83.
 *
 * Своё тут остаётся ровно одно — обрезка пробелов по краям: подпись врезки
 * собирается из строки поста и хвостовой пробел притаскивает с собой.
 */
const обрезатьИЭкранировать = (value) => escapeAttr(String(value).trim());

/**
 * Новое тело: группы заменены врезками.
 *
 * ПУСТЫЕ СТРОКИ ВОКРУГ ДИРЕКТИВ ОБЯЗАТЕЛЬНЫ. Подводка и первая ссылка лежат
 * в одном абзаце через мягкий перенос; поставь мы `::label` второй строкой
 * абзаца — разбор счёл бы её обычным текстом, и на странице появилось бы
 * «::label{text="…"}» словами. Поэтому каждая директива встаёт отдельным
 * блоком, с пустой строкой до и после — ровно так они записаны
 * в опубликованном ep-16.
 */
export function rewriteForPreview(body) { return rewrite(body); }

function rewrite(body) {
	const { lines, read, groups } = analyse(body);
	const taken = groups.filter((g) => g.take);
	if (!taken.length) return null;

	const out = lines.map((l) => [l]);
	const rows = [];

	for (const g of taken) {
		const block = [];
		if (g.lead !== null) {
			const head = read[g.leadLine].head;
			if (head) block.push(head, '');
			block.push(`::label{text="${обрезатьИЭкранировать(g.lead)}"}`, '');
			out[g.leadLine] = [];
		}
		for (const j of g.members) {
			const r = read[j];
			block.push(`::link{label="${обрезатьИЭкранировать(r.label)}" url="${r.url}"}`, '');
			out[j] = [];
			rows.push(r);
		}
		// Строки-подписи нумерованного списка уходят: их текст переехал
		// в подпись строки врезки, и оставить их значило бы написать дважды.
		// ИЩЕМ И ВЫШЕ НАЧАЛА ГРУППЫ: первая подпись стоит ПЕРЕД первым адресом,
		// то есть вне диапазона группы, и первая версия её не убирала —
		// в ep-83 «1. Johan Liebert…» осталась висеть рядом со своей врезкой.
		for (let j = Math.max(0, g.from - 3); j <= g.to; j++) {
			if (read[j].kind === 'подпись ушла в ссылку') out[j] = [];
		}
		// Врезка встаёт на место ПЕРВОЙ строки группы (или подводки).
		const at = g.lead !== null ? g.leadLine : g.from;
		out[at] = ['', ...block];
	}

	const next = out
		.flat()
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.replace(/\s+$/, '\n');
	return { body: next, rows: rows.length, insets: taken.length };
}

// ── отчёт ─────────────────────────────────────────────────────────────────

async function main() {
	const write = process.argv.includes('--write');
	const onlyAt = process.argv.indexOf('--only');
	const only = onlyAt !== -1 ? process.argv[onlyAt + 1] : null;

	const posts = await readPostsRaw();
	const shapes = {};
	const noLabel = [];
	const broken = [];
	const inText = [];
	const skipped = [];
	const perPost = [];

	for (const post of posts) {
		if (!post.draft) continue;
		const cat = effectiveCategory(post.front);
		if (!SCOPE.has(cat)) continue;
		if (only && post.id !== only) continue;

		for (const беда of сломаннаяРазметкаСсылок(
			new Map([[post.id, { draft: false, external: false, title: post.front?.title ?? '', body: post.body }]]),
		)) {
			broken.push({ id: post.id, why: беда.why, line: беда.text });
		}

		const { lines, read, groups } = analyse(post.body);
		read.forEach((r, i) => {
			shapes[r.kind] = (shapes[r.kind] ?? 0) + 1;
			if (r.kind === 'адрес без подписи' || r.kind === 'голый адрес') noLabel.push({ id: post.id, cat, line: lines[i].trim() });
			if (r.kind === 'ссылка внутри текста') inText.push({ id: post.id, line: r.line });
		});
		for (const g of groups) {
			if (g.take) continue;
			skipped.push({
				id: post.id,
				why: g.adNear ? 'рядом реклама — ссылку от её маркировки не отрываем' : 'одиночная ссылка в прозе, а не список',
				lines: g.members.map((j) => read[j].label).slice(0, 2),
			});
		}
		const taken = groups.filter((g) => g.take);
		if (taken.length) perPost.push({ post, cat, groups: taken, lines, read });
	}

	console.log('═'.repeat(94));
	console.log('ПРАВКА 2Б: ИСТОЧНИКИ ВО ВРЕЗКИ — РАЗБОР. НИЧЕГО НЕ ПИШЕТСЯ.');
	console.log('═'.repeat(94));
	console.log();
	console.log(`Черновиков в работе (выпуски, видеоэссе, бонусы): ${perPost.length}`);
	console.log(`Врезок соберётся: ${perPost.reduce((s, p) => s + p.groups.length, 0)}, строк в них: ${perPost.reduce((s, p) => s + p.groups.reduce((a, g) => a + g.members.length, 0), 0)}`);
	console.log();
	console.log('ЧТО ЗА СТРОКИ ВСТРЕТИЛИСЬ:');
	for (const [k, v] of Object.entries(shapes).sort((a, b) => b[1] - a[1])) {
		if (k === 'пусто' || k === 'нельзя трогать' || k === 'текст') continue;
		console.log(`  ${String(v).padStart(5)}  ${k}`);
	}
	console.log();

	if (noLabel.length) {
		console.log('─'.repeat(94));
		console.log(`АДРЕС БЕЗ ПОДПИСИ — ${noLabel.length}. ПОДПИСЬ ВЗЯТЬ НЕОТКУДА, НЕ ТРОГАЮ.`);
		console.log('─'.repeat(94));
		const byPost = {};
		for (const n of noLabel) byPost[n.id] = (byPost[n.id] ?? 0) + 1;
		for (const [id, n] of Object.entries(byPost).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
			console.log(`  ${id}: ${n}`);
		}
		console.log();
	}

	// БИТАЯ РАЗМЕТКА ССЫЛКИ. Раздел был обещан с первого дня, а список,
	// который он печатает, не заполнялся НИ РАЗУ: напечататься он не мог
	// никогда и читался как «битых ссылок нет» (доревизия задачи 15,
	// находка 30). Теперь вопрос задаётся по-настоящему — и не своим
	// правилом, а тем же, которое задаёт сборка на каждом прогоне
	// (`сломаннаяРазметкаСсылок` в src/plugins/post-links-integration.mjs).
	// Вторая копия правила разъехалась бы с первой: разовый скрипт смотрит
	// черновики, сборка — опубликованное, и отвечать они обязаны одинаково.
	if (broken.length) {
		console.log('─'.repeat(94));
		console.log(`БИТАЯ РАЗМЕТКА ССЫЛКИ — ${broken.length}. НЕ ТРОГАЮ, чинить руками.`);
		console.log('─'.repeat(94));
		for (const b of broken) console.log(`  ${b.id}: ${b.why}\n      ${b.line.slice(0, 88)}`);
		console.log();
	} else {
		console.log('Битой разметки ссылок не нашлось — спрошено тем же правилом, что и в сборке.');
		console.log();
	}

	if (inText.length) {
		console.log('─'.repeat(94));
		console.log(`ССЫЛКА ВПЛЕТЕНА В ПРЕДЛОЖЕНИЕ — ${inText.length}. ЭТО ТЕКСТ, А НЕ СПИСОК. НЕ ТРОГАЮ.`);
		console.log('─'.repeat(94));
		for (const b of inText.slice(0, 12)) console.log(`  ${b.id}: ${b.line.slice(0, 88)}`);
		if (inText.length > 12) console.log(`  … и ещё ${inText.length - 12}`);
		console.log();
	}

	if (skipped.length) {
		console.log('─'.repeat(94));
		console.log(`ПРОПУЩЕНО, ГРУППАМИ ПО ПРИЧИНЕ — ${skipped.length}`);
		console.log('─'.repeat(94));
		const why = {};
		for (const s2 of skipped) (why[s2.why] ??= []).push(s2);
		for (const [k, list] of Object.entries(why)) {
			console.log(`\n  ${list.length} × ${k}`);
			for (const s2 of list.slice(0, 8)) console.log(`      ${s2.id}: ${s2.lines.join(' | ').slice(0, 74)}`);
			if (list.length > 8) console.log(`      … и ещё ${list.length - 8}`);
		}
		console.log();
	}

	const show = only ? perPost : perPost.slice(0, 10);
	console.log('─'.repeat(94));
	console.log(only ? `ПОСТ ${only}` : `ПЕРВЫЕ ${show.length} ПОСТОВ: ЧТО СТАНЕТ ВРЕЗКОЙ`);
	console.log('─'.repeat(94));
	for (const p of show) {
		console.log(`\n  ▸ ${p.post.id}  (${CATEGORY_LABEL[p.cat]}, ${String(p.post.front?.date ?? '').slice(0, 10)})`);
		for (const g of p.groups) {
			console.log(`      подпись врезки: ${g.lead ? `«${g.lead}»` : '— нет, ставлю без неё'}`);
			for (const j of g.members) {
				const r = p.read[j];
				console.log(`      ${r.fromNumber ? '№' : ' '} «${r.label.slice(0, 66)}»`);
				console.log(`          → ${r.url}`);
			}
		}
	}
	console.log();

	if (!write) {
		console.log('Ничего не записано. Для записи: node scripts/archive-source-insets.mjs --write');
		return;
	}

	let done = 0;
	for (const p of perPost) {
		const next = rewrite(p.post.body);
		if (!next) continue;
		await writePostBody(p.post, next.body);
		done++;
	}
	console.log(`ЗАПИСАНО постов: ${done}`);

	// Повторный прогон обязан не найти ничего нового: врезка уже не абзац
	// со ссылкой, и правило её не видит.
	const again = [];
	for (const post of await readPostsRaw()) {
		if (!post.draft) continue;
		if (!SCOPE.has(effectiveCategory(post.front))) continue;
		if (rewrite(post.body)) again.push(post.id);
	}
	if (again.length) {
		console.log(`!! ПОВТОРНЫЙ ПРОГОН НАШЁЛ ЕЩЁ ${again.length} — правка не идемпотентна:`);
		for (const id of again) console.log(`   ${id}`);
		process.exit(1);
	}
	console.log('Повторный прогон меняет 0 постов — правка идемпотентна.');
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
const FAKES = [
	['Источники: ', 'подводка', 'подводка с двоеточием'],
	['Gigguk — Fantasy Anime: [https://youtu.be/a](https://youtu.be/a)', 'подпись со ссылкой', 'форма Б: подпись через тире'],
	['Эпизод о «Фрирен»: [https://pc.st/e/x](https://pc.st/e/x)', 'подпись со ссылкой', 'форма А: подпись через двоеточие'],
	['Юля Тарасюк — исследовательница ([https://t.me/x](https://t.me/x))', 'подпись со ссылкой', 'форма В: адрес в скобках'],
	['[Ковбой Бибоп на самом деле кино](https://youtu.be/x)', 'подпись со ссылкой', 'подпись внутри самой ссылки'],
	['2. Философия Монстра', 'номер с подписью', 'форма Г: пункт нумерованного списка'],
	['https://youtu.be/x', 'голый адрес', 'голый адрес без подписи'],
	['[https://youtu.be/x](https://youtu.be/x)', 'адрес без подписи', 'адрес подписан сам собой — подписи нет'],
	['В прошлом выпуске [мы говорили](https://x.ru) и вот почему', 'ссылка внутри текста', 'ссылка в предложении — не список'],
	['Реклама. ООО «ХДС». erid: 2Vtzq', 'реклама', 'рекламу не трогаем'],
	['Скидка 30% по промокоду BAKA: [https://x.ru](https://x.ru)', 'реклама', 'реклама с промокодом, даже со ссылкой'],
	['Наш телеграм-канал — [https://t.me/podcastbaka](https://t.me/podcastbaka)', 'обвес — не мой случай', 'обвес не идёт во врезку'],
	['💛 [Поддержать нас в группе VK](https://vk.com/podcast.baka)', 'обвес — не мой случай', 'обвес, записанный эмодзи, тоже'],
	['https://boosty.to/bakapodcast', 'обвес — не мой случай', 'голый адрес своей площадки — тоже обвес'],
	['![Обложка выпуска](https://cdn.mave.digital/storage/a.jpg)', 'картинка — не ссылка', 'КАРТИНКА, а не ссылка — восклицательный знак решает всё'],
	['ВК — [https://vk.com/komilfobook?eridLjN8KZKvH](https://vk.com/komilfobook?eridLjN8KZKvH)', 'реклама', 'erid внутри адреса, без границы слова'],
	['Медалистка — [https://www.chitai-gorod.ru/x?partnerid=1002188&utm_campaign=promocode-bekam25](https://www.chitai-gorod.ru/x?partnerid=1002188&utm_campaign=promocode-bekam25)', 'реклама', 'партнёрская метка внутри адреса'],
	['Просто абзац текста', 'текст', 'обычный текст'],
	['', 'пусто', 'пустая строка'],
];

function selftest() {
	let bad = 0;
	for (const [line, expect, note] of FAKES) {
		const got = readLine(line).kind;
		if (got !== expect) {
			console.log(`  ✗ «${note}»: ожидалось «${expect}», вышло «${got}»  ←  ${JSON.stringify(line.slice(0, 70))}`);
			bad++;
		}
	}

	// Форма Г целиком: номер + адрес следующей строкой.
	const g = analyse('\n2. Философия Монстра\n\n[https://youtu.be/a](https://youtu.be/a)\n');
	const rowsG = g.read.filter((r) => r.kind === 'подпись со ссылкой');
	if (rowsG.length !== 1 || rowsG[0].label !== 'Философия Монстра') {
		console.log(`  ✗ форма Г не собралась: ${JSON.stringify(rowsG)}`);
		bad++;
	}

	// Внутрь цитаты и кода лезть нельзя.
	for (const [body, note] of [
		['\n> Источник: [https://x.ru](https://x.ru)\n', 'цитата'],
		['\n```\nИсточник: [https://x.ru](https://x.ru)\n```\n', 'блок кода'],
		['\n::link{label="уже врезка" url="https://x.ru"}\n', 'готовая врезка'],
	]) {
		const a = analyse(body);
		if (a.read.some((r) => r.kind === 'подпись со ссылкой')) {
			console.log(`  ✗ полез внутрь: ${note}`);
			bad++;
		}
	}

	console.log();
	console.log(`Подлогов: ${FAKES.length + 4}.`);
	if (bad) {
		console.log(`ПОДЛОГИ ПРОВАЛЕНЫ: ${bad}`);
		process.exit(1);
	}
	console.log('Все подлоги сошлись.');
}

// «Запустили напрямую или подключили?» — сравнение путями, а не строками:
// в пути к проекту русские буквы (урок проекта).
const runDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');

if (runDirectly) {
	if (process.argv.includes('--selftest')) {
		selftest();
	} else {
		main().catch((err) => {
			console.error('РАЗБОР УПАЛ:', err);
			process.exit(1);
		});
	}
}
