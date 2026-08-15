import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * Сборка говорит вслух: опубликованный пост ссылается на пост, у которого
 * страницы нет (тз/07, задача 7.3).
 *
 * ЗАЧЕМ ЭТО ВООБЩЕ НУЖНО. Задача 7.3 переписала ссылки внутрь телеграм-канала
 * на ссылки внутрь сайта — в том числе те, что ведут на посты, ещё лежащие
 * черновиками. Решение заказчика: ждать публикации всех полутора тысяч постов
 * дольше, чем прожить с временно битыми ссылками. Но у этого решения есть
 * оборотная сторона: битая ссылка становится видна читателю ровно в ту минуту,
 * когда заказчик опубликует пост, ВНУТРИ которого она стоит, — а из админки
 * узнать об этом нельзя никак.
 *
 * ЭТО ТОЛЬКО ПОКАЗ. Ничего не чинится, сборка не роняется, файлы не правятся:
 * решать, публиковать ли цель следом, — заказчику. Автоправка тут была бы
 * ровно тем «тихо подменённым словом», которое в проекте уже запрещено.
 *
 * ЧЕРНОВИКИ НЕ СПРАШИВАЮТСЯ ВОВСЕ. У черновика нет страницы, читателю его
 * ссылки не видны, и ругань на них была бы шумом на полторы тысячи строк —
 * то есть ровно тем письмом «всё хорошо», которое перестают читать.
 */

const POSTS_DIR = 'src/content/posts';

// Ссылка на страницу поста в теле: `](/posts/адрес/)`. Здесь довольно
// выражения, а не разбора markdown: спрашивается не «настоящая ли это ссылка»
// (ошибись мы — будет лишняя строчка в отчёте, а не испорченный файл), а «какие
// внутренние адреса вообще упомянуты». Форма адреса своя, её пишет один
// `postAddress` в scripts/telegram-inner-links.mjs и `postHref`
// в src/lib/externalPost.mjs.
const POST_LINK = /\]\(\/posts\/([^)\/#?\s]+)\/?[^)]*\)/g;

async function readPosts(root) {
	const dir = path.join(fileURLToPath(root), POSTS_DIR);
	const posts = new Map();

	for (const name of (await readdir(dir)).filter((n) => n.endsWith('.md'))) {
		const text = await readFile(path.join(dir, name), 'utf8');
		const parts = text.split(/^---$/m);
		let head = {};
		try {
			head = yaml.load(parts[1] ?? '') ?? {};
		} catch {
			// Нечитаемая шапка — не наша забота: на ней упадёт сама сборка,
			// и упадёт громче, чем мы бы сказали.
			continue;
		}
		posts.set(name.replace(/\.md$/, ''), {
			draft: head.draft === true,
			external: Boolean(head.externalUrl),
			title: String(head.title ?? ''),
			body: parts.slice(2).join('---'),
		});
	}

	return posts;
}

/**
 * Ссылки в никуда у опубликованных постов.
 *
 * ВЫНЕСЕНО ИЗ ХУКА ОТДЕЛЬНОЙ ФУНКЦИЕЙ РОВНО ЗАТЕМ, ЧТОБЫ ЕЁ МОЖНО БЫЛО
 * УРОНИТЬ ПОДЛОГОМ. Проверка, которая на живых данных не может провалиться,
 * ничем не отличается от проверки, сломавшейся от опечатки: обе отвечают
 * «всё хорошо». Таких в проекте нашлось шесть. Здесь случай ровно такой —
 * пока ни один опубликованный пост не ссылается на черновик, хук будет молчать
 * всегда, поэтому спрашивают его на выдуманных постах
 * (scripts/telegram-inner-links.test.mjs).
 *
 * @param {Map<string, {draft: boolean, external: boolean, title: string, body: string}>} posts
 */
export function brokenLinks(posts) {
	const broken = [];

	for (const [slug, post] of posts) {
		// ЧЕРНОВИКИ НЕ СПРАШИВАЮТСЯ: страницы у них нет, читателю ссылки не видны.
		if (post.draft) continue;

		for (const match of post.body.matchAll(POST_LINK)) {
			const target = posts.get(match[1]);
			const why = !target
				? 'такого поста нет'
				: target.draft
					? 'ещё черновик'
					: target.external
						? 'пост-ссылка на чужой сайт, своей страницы у него нет'
						: null;
			if (why) broken.push({ slug, title: post.title, to: match[1], why });
		}
	}

	return broken;
}

/**
 * РАЗМЕТКА ССЫЛКИ, КОТОРАЯ НЕ СОБРАЛАСЬ. Читателю это видно как мусор в тексте:
 * лишние скобки, адрес словами, ссылка в никуда.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ `brokenLinks`. Та спрашивает «есть ли страница у цели»,
 * то есть про ЖИВОСТЬ адреса. Здесь вопрос про САМУ ЗАПИСЬ: адрес может быть
 * прекрасным, а разметка вокруг него разорванной, и тогда ссылки просто нет.
 * Раздел отчёта про это был обещан в разовом скрипте задачи 19 и не работал
 * никогда: список, который он печатает, не заполнялся ни разу (доревизия
 * задачи 15, находка 30). Пока он молчал, на двух опубликованных страницах
 * жили: незакрытая круглая скобка в ep-106 (читатель видел «[», адрес,
 * «](» и одинокую «)» абзацем ниже) и врезка ep-97, у которой в адрес
 * затесался кусок markdown — то есть ссылка вела в никуда.
 *
 * ПРАВИЛА ДВА, И ОБА ВЫВЕДЕНЫ ИЗ ЭТИХ ДВУХ СЛУЧАЕВ, а не придуманы про запас:
 *
 *   1. В строке есть `](`, но ни одной ПОЛНОЙ пары `[…](…)` — значит скобка
 *      не закрылась и ссылка рассыпалась.
 *   2. В адресе внутри нашего блока (`url="…"`, `source-url="…"`) стоит `](`
 *      или пробел — туда затекла разметка.
 *
 * ЧЕРНОВИКИ НЕ СПРАШИВАЮТСЯ — по той же причине, что и у соседки: страницы
 * у них нет, читателю не видно, а ругани вышло бы на полторы тысячи строк.
 *
 * @param {Map<string, {draft: boolean, external: boolean, title: string, body: string}>} posts
 */
export function сломаннаяРазметкаСсылок(posts) {
	const ПОЛНАЯ_ССЫЛКА = /\[[^\]]*\]\([^)\s]+\)/;
	const АДРЕС_В_БЛОКЕ = /\b(?:source-)?url="([^"]*)"/g;
	const out = [];

	for (const [slug, post] of posts) {
		if (post.draft) continue;

		post.body.split('\n').forEach((line, index) => {
			// НАШ БЛОК — НЕ MARKDOWN-ССЫЛКА, и правило про скобку к нему не относится:
			// `](` внутри `url="…"` это затёкшая разметка, у неё своя причина ниже.
			// Без этой оговорки одна беда называлась бы двумя причинами сразу,
			// и в отчёте её пришлось бы читать дважды.
			const нашБлок = /^::[a-z-]+\{/.test(line.trim());
			if (!нашБлок && line.includes('](') && !ПОЛНАЯ_ССЫЛКА.test(line)) {
				out.push({ slug, title: post.title, line: index + 1, why: 'круглая скобка не закрылась — ссылка рассыпалась', text: line.trim().slice(0, 100) });
			}
			for (const match of line.matchAll(АДРЕС_В_БЛОКЕ)) {
				const url = match[1];
				if (url.includes('](') || /\s/.test(url)) {
					out.push({ slug, title: post.title, line: index + 1, why: 'в адрес затекла разметка — ссылка ведёт в никуда', text: url.slice(0, 100) });
				}
			}
		});
	}

	return out;
}

export default function postLinksIntegration() {
	return {
		name: 'baka-post-links',
		hooks: {
			'astro:build:done': async ({ logger }) => {
				const posts = await readPosts(new URL('../../', import.meta.url));

				const рассыпалось = сломаннаяРазметкаСсылок(posts);
				if (рассыпалось.length) {
					logger.warn(
						`разметка ссылки не собралась: ${рассыпалось.length} ` +
							`в ${new Set(рассыпалось.map((x) => x.slug)).size} опубликованных постах. ` +
							'Читатель видит это мусором в тексте.',
					);
					for (const item of рассыпалось) {
						logger.warn(`  ${item.slug}:${item.line} — ${item.why}`);
						logger.warn(`      ${item.text}`);
					}
				}

				const broken = brokenLinks(posts);
				if (!broken.length) return;

				const bySource = new Map();
				for (const item of broken) bySource.set(item.slug, [...(bySource.get(item.slug) ?? []), item]);

				// Числа СЧИТАЮТСЯ, а не пишутся словами: число, вписанное руками,
				// переживает правку того, что описывает, и начинает врать.
				logger.warn(
					`ссылки в никуда: ${broken.length} в ${bySource.size} опубликованных постах. ` +
						'Читатель их уже видит — опубликуйте цель или уберите ссылку.',
				);
				for (const [slug, items] of bySource) {
					logger.warn(`  ${slug} («${items[0].title}»)`);
					for (const item of items) logger.warn(`      → /posts/${item.to}/ — ${item.why}`);
				}
			},
		},
	};
}
