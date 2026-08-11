// robots.txt — что можно смотреть роботам (тз/06 шаг 9, тз/14 часть 4).
//
// ПОЧЕМУ КОДОМ, А НЕ ФАЙЛОМ В public/. Раньше файл лежал в public/robots.txt,
// и адрес карты сайта был вписан в него руками. Это вторая копия правила
// «какой у сайта адрес»: сменили константу SITE_URL — карта в robots.txt
// осталась указывать на старый домен, и заметить это было бы нечем.
// Задача 14 меняла адрес ровно так, поэтому файл переехал сюда: строка
// Sitemap строится из той же константы, что canonical, og:url и сама карта.
//
// Всё остальное содержимое файла не изменилось ни на байт.

import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/site.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
	const body = `# Что можно смотреть поисковым роботам (тз/06, шаг 9).

User-agent: *
Allow: /

# Админка. Логин там через GitHub, чужой человек внутрь не попадёт, но и в
# выдаче ей делать нечего.
Disallow: /admin/

# Служебные файлы данных для админки — это не страницы, а куски JSON.
Disallow: /admin-posts.json
Disallow: /admin-data/
Disallow: /anime-index.json
Disallow: /anime-fields.json
Disallow: /anime-alias-hints.json
Disallow: /publish-queue.json

# Внутренности поискового индекса: сотни файлов-фрагментов, из которых
# страница поиска собирает выдачу. Для человека они нечитаемы.
Disallow: /pagefind/

# Страница поиска закрыта не тут, а тегом noindex прямо на ней
# (src/pages/search.astro): Disallow запретил бы роботу её ЧИТАТЬ, и он бы
# так и не узнал, что индексировать её не надо.

Sitemap: ${absoluteUrl('/sitemap.xml')}
`;

	return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
