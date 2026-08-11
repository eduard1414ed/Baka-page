// llms.txt — карта сайта словами, для больших языковых моделей (тз/14, часть 5).
//
// ЧЕСТНО О ТОМ, ЧТО ЭТО ДАЁТ: НИЧЕГО НЕ ГАРАНТИРОВАНО. Формат не утверждён
// никаким органом, Google 15 мая 2026 года публично заявил, что не даёт ему
// особого статуса, а замеры показывают, что ИИ-краулеры его почти не
// запрашивают. Файл сделан потому, что стоит полчаса и ничего не ломает, —
// а не потому, что поднимет цитируемость. Не дописывайте сюда обещаний.
//
// ПОЧЕМУ КОДОМ, А НЕ ФАЙЛОМ В public/. Ровно по той же причине, что robots.txt:
// внутри адреса, а адрес сайта живёт одной константой SITE_URL. Плюс список
// материалов обязан считаться теми же getCollection и isPublished, что и сами
// страницы, — иначе сюда однажды утёк бы черновик, а черновиков у нас 1570
// против 26 опубликованных.
//
// Настоящий актив проекта — расшифровки: 141 выпуск, 83 часа речи. Они лежат
// прямо в разметке страницы выпуска обычным текстом, с именем говорящего
// и минутой. Об этом здесь сказано прямо, потому что ни один поисковый файл
// сам об этом не догадается.

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublished } from '../lib/publishing.mjs';
import { isExternalPost } from '../lib/externalPost.mjs';
import { postDescription } from '../lib/excerpt.mjs';
import { visibleCategories, categoriesShownIn } from '../content.config';
import { absoluteUrl, SITE_NAME, SITE_DESCRIPTION } from '../lib/site.mjs';
// Окончания числительных — общей функцией сайта, а не на глаз: «141 расшифровок»
// в файле, который читают машины, выглядит ровно так же неряшливо, как на странице.
import { withCount } from '../lib/plural.mjs';

export const prerender = true;

/** Строка списка: «- [Заголовок](адрес): описание». Описание в одну строку. */
function пункт(title: string, path: string, note?: string): string {
	const описание = note ? `: ${note.replace(/\s+/g, ' ').trim()}` : '';
	return `- [${title}](${absoluteUrl(path)})${описание}`;
}

export const GET: APIRoute = async () => {
	const посты = await getCollection('posts', ({ data }) => isPublished(data));
	const своиСтраницы = посты.filter((post) => !isExternalPost(post.data));
	const тайтлы = await getCollection('anime');
	const расшифровки = new Set((await getCollection('transcripts')).map((t) => t.id));

	const свежие = [...своиСтраницы].sort(
		(a, b) => +(b.data.publishAt ?? b.data.date) - +(a.data.publishAt ?? a.data.date),
	);

	const сРасшифровкой = свежие.filter((post) => {
		const id = post.data.transcript ?? post.data.audioGuid;
		return id ? расшифровки.has(id) : false;
	});

	const разделы = visibleCategories.map((category) => {
		const свои = categoriesShownIn(category.id);
		const сколько = посты.filter((post) => свои.includes(post.data.category)).length;
		return пункт(
			category.label,
			`/category/${category.id}/`,
			withCount(сколько, category.countForms as unknown as [string, string, string]),
		);
	});

	const текст = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}. Русскоязычный подкаст об аниме: выпуски с полными расшифровками разговора, видеоэссе, статьи и короткие заметки, плюс каталог упомянутых тайтлов.

Сайт ведут авторы подкаста. Материалы на русском языке. У каждого выпуска
подкаста на странице лежит ПОЛНАЯ РАСШИФРОВКА разговора обычным текстом —
с именем говорящего и минутой у каждой реплики. Это самое ценное, что здесь
есть: ${withCount(расшифровки.size, ['расшифровка', 'расшифровки', 'расшифровок'])}, около 83 часов речи и 24 900 реплик.
Расшифровка стоит прямо в разметке страницы, её не нужно догружать скриптом.

Названия аниме внутри текстов и внутри расшифровок размечены ссылками
на страницу тайтла, а на странице тайтла собраны все материалы и все минуты
разговоров, где он упоминался.

## Основные страницы

${пункт('Главная', '/', 'свежие материалы и подборка тайтлов')}
${пункт('О проекте', '/about/', 'что это за подкаст, кто его ведёт и где слушать')}
${пункт('Архив', '/archive/', `все материалы одной лентой, ${withCount(посты.length, ['материал', 'материала', 'материалов'])}`)}
${пункт('Каталог аниме', '/anime/', `${withCount(тайтлы.length, ['тайтл', 'тайтла', 'тайтлов'])}, упомянутых в подкасте`)}
${пункт('Поддержать', '/support/', 'как поддержать проект')}

## Разделы

${разделы.join('\n')}

## Выпуски с полной расшифровкой разговора

${
	сРасшифровкой.length > 0
		? сРасшифровкой.map((post) => пункт(post.data.title, `/posts/${post.id}/`, postDescription(post, ''))).join('\n')
		: '(пока ни одного опубликованного выпуска с расшифровкой)'
}

## Остальные материалы

${
	свежие
		.filter((post) => !сРасшифровкой.includes(post))
		.map((post) => пункт(post.data.title, `/posts/${post.id}/`, postDescription(post, '')))
		.join('\n') || '(пока ничего)'
}

## Ещё

${пункт('Карта сайта', '/sitemap.xml', 'полный список адресов в машинном виде')}
${пункт('Лента постов', '/rss.xml', 'RSS сайта; RSS самого подкаста раздаёт хостинг Mave')}
${пункт('Правила для роботов', '/robots.txt', 'что можно обходить, а что нет')}
`;

	return new Response(текст, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
