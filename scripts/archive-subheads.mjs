// ПРАВКА 2 ЗАДАЧИ 16: ЖИРНЫЙ АБЗАЦ → ПОДЗАГОЛОВОК, А БЛОК ССЫЛОК — ПРОЧЬ.
//
//   node scripts/archive-subheads.mjs            — разведка, не пишет ничего
//   node scripts/archive-subheads.mjs --write     — применение
//   node scripts/archive-subheads.mjs --selftest  — подлоги на настоящих данных
//
// ДЕЛ ТРИ, И ДВА ИЗ НИХ ПОЯВИЛИСЬ ОТ ЗАМЕРА, А НЕ ИЗ ТЗ.
//
//   А. Жирный абзац черновика → `### Текст`.
//
//   Б. Уже стоящий заголовок `### **Текст**` → `### Текст`, И В ОПУБЛИКОВАННЫХ
//      ТОЖЕ. В архиве нашлись обе формы, обе сделаны рукой, и в одном посте
//      («Хоримия») они лежали одновременно: три заголовка без жирного и три
//      с жирным. Решение заказчика 12 августа 2026: жирного внутри заголовка
//      не бывает. Без этой половины скрипт наплодил бы третью форму рядом
//      с двумя существующими.
//
//   В. Жирная подводка вместе со списком ссылок под ней — УДАЛЯЕТСЯ ЦЕЛИКОМ.
//      Решение заказчика 12 августа 2026. Таких блоков 67, все в конце поста,
//      все в черновиках, 66 из них категории «Бонус».
//
// ПОЧЕМУ УДАЛЕНИЕ ЗДЕСЬ НИЧЕГО НЕ ТЕРЯЕТ — И ПОЧЕМУ ЭТО ПРОВЕРЯЕТСЯ, А НЕ
// ПРЕДПОЛАГАЕТСЯ. У бонуса на странице есть плашка подписки, и адреса она берёт
// из поля «Ссылки бонуса», а где пусто — общий адрес площадки. Значит блок
// в тексте — ручная копия того, что сайт рисует сам. Но копия ли ОН НА САМОМ
// ДЕЛЕ, надо спросить, а не решить: сверка по всем 67 дала 66 «дословно то же»
// и ОДИН пост, где ссылки ведут на ЧУЖОЙ подкаст («2D Деды»), и плашка их
// не покажет никогда.
//
// ПОЭТОМУ УСЛОВИЕ УДАЛЕНИЯ НАПИСАНО ПО СУЩЕСТВУ, А НЕ ИМЕНЕМ ПОСТА: удаляем,
// только если КАЖДАЯ ссылка блока уже показана плашкой. Впиши мы «кроме
// luchshie-anime-2024-goda-s-2d-dedami» — правило было бы верно ровно до
// следующего такого поста, а узнать о нём было бы неоткуда. У заметки плашки
// нет вовсе, поэтому она отваливается сама собой, без единой оговорки.
// (CLAUDE.md: пример надо доставать из данных, а не вписывать именем.)
//
// ЧТО ПОКАЖЕТ ПЛАШКА, СПРАШИВАЕМ У `bonusSupportLinks` — той самой функции,
// которой это считает сайт. Своя копия правила «пусто значит общий адрес»
// разъехалась бы молча, и разъехалась бы В СТОРОНУ УДАЛЕНИЯ ЧУЖОГО.
//
// ЧТО СЧИТАЕТСЯ ЖИРНЫМ АБЗАЦЕМ. Абзац, у которого после выброса пустых кусков
// остался ровно ОДИН ребёнок, и он `strong`. Не «строка начинается с двух
// звёздочек»: строчное правило не отличит `**А** и **Б**` от `**А и Б**`,
// а разбор отличает. Список и цитату спрашиваем у предков — дерево знает.
//
// ПОРОГ ДЛИНЫ 80 ЗНАКОВ НА ЖИВЫХ ДАННЫХ НЕ СРАБАТЫВАЕТ НИ РАЗУ: самый длинный
// жирный абзац архива — 70 знаков, выше нет ничего. Он оставлен на будущее
// и проверяется ТОЛЬКО подлогом; в отчёте печатается распределение длин,
// чтобы это было видно, а не подразумевалось.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, writePostBody, parseBody } from './archive-clean-lib.mjs';
import { планСнятияЖирного } from './heading-bold.mjs';
import { bonusSupportLinks } from '../src/data/platforms.js';

export const MAX_HEAD_LENGTH = 80;

function inside(ancestors, types) {
	return ancestors.some((node) => types.includes(node.type));
}

/** Куски одного жирного узла как они написаны в исходнике. */
function innerSource(body, strong) {
	const inner = strong.children;
	const from = inner[0]?.position?.start?.offset;
	const to = inner[inner.length - 1]?.position?.end?.offset;
	if (from === undefined || to === undefined) return null;
	return body.slice(from, to);
}

/** Абзац, у которого КАЖДАЯ непустая строка содержит ссылку, и ссылок хотя бы две. */
function isLinkList(source) {
	const lines = source.split('\n').filter((line) => line.trim());
	if (lines.length < 2) return false;
	const links = [...source.matchAll(/\]\((https?:\/\/[^)]+)\)/gu)];
	if (links.length < 2) return false;
	return lines.every((line) => /\]\(https?:\/\//u.test(line));
}

const normalizeUrl = (url) =>
	String(url)
		.replace(/^https?:\/\/(www\.)?/u, '')
		.replace(/[?#].*$/u, '')
		.replace(/\/$/u, '')
		.toLowerCase();

/**
 * Все ли ссылки блока уже показаны плашкой подписки этого поста?
 * У поста не-бонуса плашки нет вовсе — значит не показана ни одна.
 */
function coveredByPaywall(front, source) {
	if (front?.category !== 'bonus') return false;
	const shown = bonusSupportLinks(front.bonusLinks ?? {}).map((item) => normalizeUrl(item.url));
	const urls = [...source.matchAll(/\]\((https?:\/\/[^)]+)\)/gu)].map((m) => normalizeUrl(m[1]));
	return urls.length > 0 && urls.every((url) => shown.includes(url));
}

/**
 * Тело поста → что с ним сделать.
 *
 * Вынесено функцией, чтобы её можно было уронить подлогом: правило, живущее
 * внутри цикла по архиву, спрашивается только полным прогоном, и «ничего
 * не найдено» у него неотличимо от поломки.
 *
 * @param {object} front — шапка поста: нужна категория и «Ссылки бонуса»
 * @param {{ onlyHeadings?: boolean }} options — для опубликованных постов
 */
export function planSubheads(body, front = {}, options = {}) {
	const tree = parseBody(body);
	const take = [];
	const skip = [];

	// Последнее непустое место тела — чтобы понять, стоит ли блок в конце поста.
	const tailStart = body.replace(/\s+$/u, '').length;

	const walk = (node, ancestors) => {
		const kids = Array.isArray(node.children) ? node.children : [];

		kids.forEach((child, index) => {
			// ЗАГОЛОВКИ ЗДЕСЬ НЕ РАЗБИРАЮТСЯ ВОВСЕ — их берёт общее правило
			// ниже, `планСнятияЖирного`. Своя копия жила тут и отвечала иначе,
			// чем копия в `archive-headings.mjs`: та смотрела только верхний
			// уровень дерева, эта обходила дерево целиком. Одно правило
			// заказчика — два ответа (доревизия задачи 15, находка 36).
			// Заодно своя копия видела только заголовок, жирный ЦЕЛИКОМ,
			// а «### Часть **жирная**, часть нет» пропускала молча.
			if (child.type !== 'paragraph') return;
			if (options.onlyHeadings) return;
			if (inside([...ancestors, node], ['listItem', 'blockquote', 'containerDirective'])) return;

			const only = child.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
			if (only.length !== 1 || only[0].type !== 'strong') return;

			const text = innerSource(body, only[0]);
			if (text === null) return;
			const plain = text.replace(/\s+/gu, ' ').trim();

			// ── дело В: подводка + список ссылок под ней ──
			const next = kids[index + 1];
			if (next?.type === 'paragraph') {
				const nextSource = body.slice(next.position.start.offset, next.position.end.offset);
				if (isLinkList(nextSource)) {
					const atEnd = next.position.end.offset >= tailStart;
					const covered = coveredByPaywall(front, nextSource);
					if (atEnd && covered) {
						take.push({
							kind: 'блок',
							start: child.position.start.offset,
							end: next.position.end.offset,
							plain,
							links: [...nextSource.matchAll(/\]\((https?:\/\/[^)]+)\)/gu)].map((m) => m[1]),
						});
						return;
					}
					// Блок есть, а удалять нельзя — говорим об этом вслух и делаем
					// подводку заголовком: ссылки остаются на месте.
					skip.push({
						kind: 'блок',
						plain,
						length: plain.length,
						why: !atEnd
							? 'список ссылок стоит НЕ в конце поста — блок не трогаю, подводка станет заголовком'
							: 'ссылки НЕ показаны плашкой подписки (чужой подкаст или не бонус) — блок оставлен, подводка станет заголовком',
						links: [...nextSource.matchAll(/\]\((https?:\/\/[^)]+)\)/gu)].map((m) => m[1]),
					});
				}
			}

			// ── дело А: обычный жирный абзац ──
			const item = {
				kind: 'абзац',
				start: child.position.start.offset,
				end: child.position.end.offset,
				plain,
				length: plain.length,
			};
			if (/\n/u.test(text)) skip.push({ ...item, why: 'абзац в несколько строк — заголовком не бывает' });
			else if (plain.length > MAX_HEAD_LENGTH) skip.push({ ...item, why: `длиннее ${MAX_HEAD_LENGTH} знаков — это выделенный кусок, а не заголовок` });
			else if (/\.$/u.test(plain)) skip.push({ ...item, why: 'кончается точкой — заголовки точкой не кончаются' });
			else take.push(item);
		});

		for (const child of kids) walk(child, [...ancestors, node]);
	};
	walk(tree, []);

	// ── дело Б: у готового заголовка снимается жирный ──
	// Правило одно на проект и лежит отдельным файлом: его же зовёт
	// `archive-headings.mjs` и проверка сборки. Действует ВЕЗДЕ, включая
	// заголовок внутри цитаты, спойлера и пункта списка (решение заказчика
	// 15 августа 2026).
	for (const h of планСнятияЖирного(tree, body).заголовки) {
		take.push({ kind: 'заголовок', start: h.start, end: h.end, готовое: h.стало, plain: h.стало.replace(/^#+\s*/u, ''), level: h.уровень });
	}

	if (take.length === 0) return { body, take, skip, changed: false };

	const sorted = [...take].sort((a, b) => a.start - b.start);
	const pieces = [];
	let cursor = 0;
	for (const item of sorted) {
		pieces.push(body.slice(cursor, item.start));
		// Заголовок не пересобирается, а РЕЖЕТСЯ: общее правило вернуло готовую
		// строку, из которой вынуты ровно разделители жирного. Пересборка
		// «решётки плюс текст» съедала бы хвостовой пробел и склеивала бы
		// переносы внутри заголовка — то есть правила становилось бы два.
		if (item.kind === 'заголовок') pieces.push(item.готовое);
		else if (item.kind === 'абзац') pieces.push('### ' + item.plain);
		// блок — не пишем ничего, он уходит целиком
		cursor = item.end;
	}
	pieces.push(body.slice(cursor));

	// Блок стоял в конце поста: после него остаются пустые строки. Приводим
	// хвост к одному переводу строки — тому же виду, что у остальных постов.
	let result = pieces.join('');
	if (take.some((item) => item.kind === 'блок')) {
		result = result.replace(/\s+$/u, body.endsWith('\n') ? '\n' : '');
	}

	return { body: result, take, skip, changed: result !== body };
}

// ─────────────────────────── подлоги ───────────────────────────

const BONUS = { category: 'bonus', bonusLinks: { boosty: '', patreon: '', tgClosed: '', vkDonat: '' } };

// Образцы на случай, когда в архиве примеров не осталось: правка применена,
// и живому примеру взяться неоткуда. Живой пример по-прежнему главный —
// эти два берутся, только когда его нет.
const ОБРАЗЕЦ_ЗАГОЛОВКА = '### **Что это вообще такое?**';

async function selftest() {
	const posts = await readPostsRaw();

	let realHeading = null;
	let realBlockPost = null;
	for (const post of posts) {
		// Жирный внутри заголовка бывает записан и звёздочками, и подчёркиваниями:
		// админка переписывает разметку при сохранении, и знак решает не она,
		// а разбор. Ищем ОБА вида — прежде искали только звёздочки.
		const line = post.body.split('\n').find((l) => /^#{2,4} (\*\*.+\*\*|__.+__)$/u.test(l));
		if (line && !realHeading) realHeading = line;
		if (!realBlockPost && planSubheads(post.body, post.front).take.some((t) => t.kind === 'блок')) realBlockPost = post;
	}

	// ПУСТО — ЭТО СЛЕД СДЕЛАННОЙ РАБОТЫ, А НЕ ПОЛОМКА. Прежде проверка тут
	// ПАДАЛА целиком, то есть переставала быть прогоняемой ровно после того,
	// как сделала своё дело: блоков ссылок в архиве не осталось ни одного,
	// потому что она их и убрала (доревизия задачи 15, находка 21).
	const заголовокЖивой = realHeading !== null;
	if (!заголовокЖивой) {
		realHeading = ОБРАЗЕЦ_ЗАГОЛОВКА;
		console.log('  ПРИМЕЧАНИЕ: заголовков с жирным в архиве не осталось — правка применена.');
		console.log('              Беру записанный образец.');
	}
	if (!realBlockPost) {
		console.log('  ПРИМЕЧАНИЕ: блоков ссылок в архиве не осталось — правка применена.');
		console.log('              Случай «настоящий пост архива» пропускаю: подделать его');
		console.log('              значило бы проверять свою выдумку, а не живые данные.');
	}

	// Настоящие адреса плашки: берём у той же функции, что и правило.
	const shown = bonusSupportLinks({}).map((item) => item.url);
	const linkList = shown.map((url, i) => `🌕 [Площадка ${i + 1}](${url})`).join('\n');

	const cases = [
		{
			name: заголовокЖивой ? 'настоящий заголовок архива теряет жирный' : 'записанный образец заголовка теряет жирный',
			body: `\n${realHeading}\n\nТекст.\n`,
			front: {},
			must: (r) => r.changed && !/\*\*|__/u.test(r.body) && /^\n#{2,4} [^*_]/u.test(r.body),
		},
		// Случай на настоящем посте добавляется НИЖЕ и только если такой пост есть.
		{
			name: 'жирный абзац становится ### ',
			body: '\nТекст.\n\n**Что это?**\n\nЕщё текст.\n',
			front: {},
			must: (r) => r.body === '\nТекст.\n\n### Что это?\n\nЕщё текст.\n',
		},
		{
			name: 'блок ссылок бонуса удаляется вместе с подводкой',
			body: `\nТекст выпуска.\n\n**Где слушать?**\n\n${linkList}\n`,
			front: BONUS,
			must: (r) => r.body === '\nТекст выпуска.\n' && r.take.some((t) => t.kind === 'блок'),
		},
		{
			name: 'ЧУЖИЕ ССЫЛКИ НЕ УДАЛЯЮТСЯ — подводка становится заголовком',
			body: '\nТекст.\n\n**Где смотреть и слушать:**\n\n🌕 [Telegram](https://t.me/mavestreambot/app?startapp=2ddeds_157_player)\n🌓 [VK](https://vk.com/wall-206561239_2860)\n',
			front: BONUS,
			must: (r) => /mavestreambot/u.test(r.body) && /### Где смотреть и слушать:/u.test(r.body),
		},
		{
			name: 'У НЕ-БОНУСА БЛОК НЕ УДАЛЯЕТСЯ (плашки у него нет)',
			body: `\nТекст.\n\n**Где слушать?**\n\n${linkList}\n`,
			front: { category: 'note' },
			must: (r) => /boosty\.to/u.test(r.body) && /### Где слушать\?/u.test(r.body),
		},
		{
			name: 'БЛОК НЕ В КОНЦЕ ПОСТА НЕ УДАЛЯЕТСЯ',
			body: `\n**Где слушать?**\n\n${linkList}\n\nА дальше ещё абзац текста.\n`,
			front: BONUS,
			must: (r) => /boosty\.to/u.test(r.body) && /А дальше ещё абзац/u.test(r.body),
		},
		{
			name: 'ЖИРНОЕ ВНУТРИ ПРЕДЛОЖЕНИЯ НЕ ТРОГАЕМ',
			body: '\nЭто **очень** важно.\n',
			front: {},
			must: (r) => !r.changed,
		},
		{
			name: 'АБЗАЦ С ЖИРНЫМ И ХВОСТОМ НЕ ТРОГАЕМ',
			body: '\n**Что это?** Изначально манга.\n',
			front: {},
			must: (r) => !r.changed,
		},
		{
			name: 'ЖИРНОЕ В СПИСКЕ НЕ ТРОГАЕМ',
			body: '\n- **Первый пункт**\n- **Второй пункт**\n',
			front: {},
			must: (r) => !r.changed,
		},
		{
			name: 'ЖИРНОЕ В ЦИТАТЕ НЕ ТРОГАЕМ',
			body: '\n> **Он сказал так**\n',
			front: {},
			must: (r) => !r.changed,
		},
		{
			name: 'КОНЧАЕТСЯ ТОЧКОЙ — НЕ ПРЕВРАЩАЕМ, НО ПОКАЗЫВАЕМ',
			body: '\n**Это очень важное замечание.**\n',
			front: {},
			must: (r) => !r.changed && r.skip.some((s) => s.why.includes('точкой')),
		},
		{
			name: 'ДЛИННЫЙ ЖИРНЫЙ КУСОК НЕ ЗАГОЛОВОК',
			body: `\n**${'а'.repeat(MAX_HEAD_LENGTH + 5)}**\n`,
			front: {},
			must: (r) => !r.changed && r.skip.some((s) => s.why.includes('длиннее')),
		},
		{
			name: 'ДВА ЖИРНЫХ КУСКА В АБЗАЦЕ — НЕ ЗАГОЛОВОК',
			body: '\n**Первый** и **второй**\n',
			front: {},
			must: (r) => !r.changed,
		},
		{
			name: 'жирный абзац со ссылкой внутри: ссылка уцелела',
			body: '\n**[Смотрите тут](https://example.com/)**\n',
			front: {},
			must: (r) => r.body === '\n### [Смотрите тут](https://example.com/)\n',
		},
		{
			name: 'уровень существующего заголовка сохраняется',
			body: '\n## **Второй уровень**\n',
			front: {},
			must: (r) => r.body === '\n## Второй уровень\n',
		},
		{
			name: 'ГОТОВЫЙ ЗАГОЛОВОК БЕЗ ЖИРНОГО НЕ ТРОГАЕМ',
			body: '\n### Что это?\n',
			front: {},
			must: (r) => !r.changed,
		},
		{
			name: 'У ОПУБЛИКОВАННОГО ПРАВИМ ТОЛЬКО ЗАГОЛОВОК, АБЗАЦ НЕ ТРОГАЕМ',
			body: '\n### **Что это?**\n\n**А это абзац**\n',
			front: {},
			options: { onlyHeadings: true },
			must: (r) => r.body === '\n### Что это?\n\n**А это абзац**\n',
		},
		{
			name: 'ПОВТОРНЫЙ ПРОГОН НИЧЕГО НЕ МЕНЯЕТ',
			body: `\nТекст.\n\n**Где слушать?**\n\n${linkList}\n`,
			front: BONUS,
			must: (r) => !planSubheads(r.body, BONUS).changed,
		},
	];

	// НАСТОЯЩИЙ ПОСТ АРХИВА — ТОЛЬКО ЕСЛИ ОН ЕСТЬ. Сочинить его вместо живого
	// нельзя: сочинённый проверял бы нашу выдумку, а не данные заказчика.
	if (realBlockPost) {
		cases.push({
			name: `НАСТОЯЩИЙ пост архива (${realBlockPost.id}): блок ссылок уходит целиком`,
			body: realBlockPost.body,
			front: realBlockPost.front,
			must: (r) => r.take.some((t) => t.kind === 'блок') && !/boosty\.to/u.test(r.body) && r.body.endsWith('\n'),
		});
	}

	let bad = 0;
	for (const test of cases) {
		const result = planSubheads(test.body, test.front, test.options ?? {});
		const ok = test.must(result);
		if (!ok) bad++;
		console.log(`${ok ? '  ок  ' : ' ПЛОХО'}  ${test.name}`);
		if (!ok) console.log('          получилось:', JSON.stringify(result.body.slice(0, 300)));
	}
	console.log(`\nПодлогов ${cases.length}, провалилось ${bad}.`);
	if (bad > 0) process.exit(1);
}

// ─────────────────────────── прогон ───────────────────────────

async function main() {
	const write = process.argv.includes('--write');
	const posts = await readPostsRaw();

	// У опубликованного правим ТОЛЬКО жирный внутри заголовка — это отдельное
	// решение заказчика. Превращать в нём абзацы и сносить блоки никто не просил.
	const plans = posts.map((post) => ({
		post,
		plan: planSubheads(post.body, post.front, post.draft ? {} : { onlyHeadings: true }),
	}));

	const of = (kind, list) => list.flatMap(({ post, plan }) => plan.take.filter((t) => t.kind === kind).map((t) => ({ post, t })));
	const drafts = plans.filter(({ post }) => post.draft);
	const published = plans.filter(({ post }) => !post.draft);

	console.log('═══════════ ПРАВКА 2: ПОДЗАГОЛОВКИ И БЛОКИ ССЫЛОК ═══════════\n');

	console.log('─── А. жирный абзац → «### Текст» ───');
	console.log(`  черновики:     ${of('абзац', drafts).length} в ${new Set(of('абзац', drafts).map((x) => x.post.id)).size} постах`);
	console.log(`  опубликованные: не трогаем (${of('абзац', published).length})`);

	console.log('\n─── Б. у готового заголовка снимается жирный ───');
	console.log(`  черновики:      ${of('заголовок', drafts).length}`);
	console.log(`  опубликованные: ${of('заголовок', published).length}  ← ваше решение 12 августа`);
	for (const { post, t } of of('заголовок', published)) console.log(`      ${post.id}: ${'#'.repeat(t.level)} **${t.plain}**`);

	console.log('\n─── В. подводка + список ссылок УДАЛЯЮТСЯ ЦЕЛИКОМ ───');
	const blocks = of('блок', drafts);
	console.log(`  блоков: ${blocks.length} в ${new Set(blocks.map((x) => x.post.id)).size} постах`);
	console.log(`  ссылок в них: ${blocks.reduce((sum, x) => sum + x.t.links.length, 0)} — ВСЕ уже показаны плашкой подписки`);
	const wording = new Map();
	for (const { t } of blocks) wording.set(t.plain, (wording.get(t.plain) ?? 0) + 1);
	console.log('  формулировки подводок:');
	for (const [text, n] of [...wording].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  «${text}»`);

	console.log('\n─── БЛОКИ, КОТОРЫЕ УДАЛЯТЬ НЕЛЬЗЯ (и почему) ───');
	const keptBlocks = plans.flatMap(({ post, plan }) => plan.skip.filter((s) => s.kind === 'блок').map((s) => ({ post, s })));
	if (keptBlocks.length === 0) console.log('  таких нет');
	for (const { post, s } of keptBlocks) {
		console.log(`  ▼ ${post.id}  [${post.front.title}]  ${post.front.category}`);
		console.log(`     ${s.why}`);
		for (const link of s.links) console.log(`     остаётся: ${link}`);
	}

	const lengths = [...of('абзац', drafts).map((x) => x.t.length), ...plans.flatMap(({ plan }) => plan.skip.filter((s) => s.kind === 'абзац').map((s) => s.length))].sort((a, b) => a - b);
	console.log('\n─── длины жирных абзацев: порог виден или назначен? ───');
	let prev = 0;
	for (const edge of [10, 20, 30, 40, 50, 60, 70, 80, 100, 200, 10000]) {
		const n = lengths.filter((l) => l > prev && l <= edge).length;
		const mark = prev < MAX_HEAD_LENGTH && edge >= MAX_HEAD_LENGTH ? `   ← ПОРОГ ${MAX_HEAD_LENGTH}` : '';
		console.log(`  ${String(prev + 1).padStart(5)}–${String(edge).padEnd(6)} ${'█'.repeat(Math.min(60, n))} ${n}${mark}`);
		prev = edge;
	}
	console.log(`  Самый длинный в архиве: ${lengths[lengths.length - 1] ?? 0} знаков.`);

	console.log('\n─── ОТВЕРГНУТЫЕ АБЗАЦЫ (показываю, а не выбрасываю молча) ───');
	const skipped = plans.flatMap(({ post, plan }) => plan.skip.filter((s) => s.kind === 'абзац').map((s) => ({ post, s })));
	if (skipped.length === 0) console.log('  таких нет');
	for (const { post, s } of skipped) {
		console.log(`  ${post.draft ? 'чрн ' : 'ОПУБ'} ${String(s.length).padStart(4)} зн.  ${post.id}`);
		console.log(`        «${s.plain.slice(0, 160)}»`);
		console.log(`        причина: ${s.why}`);
	}

	const sample = Number(process.env.SAMPLE ?? 8);
	console.log(`\n─── разбор ${sample} постов целиком ───\n`);
	for (const { post, plan } of plans.filter(({ plan }) => plan.changed).slice(0, sample)) {
		console.log(`▼ ${post.id}  [${post.front.title}]  ${post.draft ? 'черновик' : 'ОПУБЛИКОВАН'}`);
		for (const t of plan.take) {
			if (t.kind === 'блок') {
				console.log(`    УДАЛЯЕТСЯ: **${t.plain}** и ${t.links.length} ссылок под ним`);
				for (const link of t.links) console.log(`               ${link.slice(0, 100)}`);
			} else if (t.kind === 'абзац') console.log(`    **${t.plain}**   →   ### ${t.plain}`);
			else console.log(`    ${'#'.repeat(t.level)} **${t.plain}**   →   ${'#'.repeat(t.level)} ${t.plain}`);
		}
		console.log();
	}

	if (!write) {
		console.log('═══ Это была РАЗВЕДКА. Ничего не записано. Применить: --write ═══');
		return;
	}

	console.log('═══ ЗАПИСЬ ═══');
	const queue = plans.filter(({ plan }) => plan.changed);
	let done = 0;
	for (const { post, plan } of queue) {
		await writePostBody(post, plan.body);
		done++;
		const counts = ['блок', 'абзац', 'заголовок'].map((k) => plan.take.filter((t) => t.kind === k).length);
		console.log(`  ✓ ${done}/${queue.length}  ${post.id}  (${post.draft ? 'чрн' : 'ОПУБ'}; блоков ${counts[0]}, абзацев ${counts[1]}, заголовков ${counts[2]})`);
	}
	console.log(`\nЗаписано постов: ${done}.`);
}

// ЗАПУСКАЕМСЯ ТОЛЬКО ТОГДА, КОГДА НАС ПОЗВАЛИ НАПРЯМУЮ. Без этой проверки файл
// начинает работать от простого `import` — а `planSubheads` отсюда как раз
// и берут соседи. Скрипт пишет во ВСЕ посты архива, и ключ `--write` достался
// бы ему от чужой командной строки: он смотрит на общую.
//
// Сравниваем ПУТЯМИ, а не строками: в пути к проекту русские буквы, и
// `import.meta.url` кодирует их (`%D0%A0%D0%B0…`), а `process.argv[1]` нет
// (CLAUDE.md, урок про русские буквы в пути).
const calledDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');

if (calledDirectly) {
	if (process.argv.includes('--selftest')) await selftest();
	else await main();
}
