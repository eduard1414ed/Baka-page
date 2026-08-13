// Сверка перенесённых с DTF постов с первоисточником.
//
//   node scripts/dtf/verify.mjs             — сверить все шесть постов
//   node scripts/dtf/verify.mjs --selftest  — спросить проверки подлогами
//
// ПОДЛОГИ ОБЯЗАТЕЛЬНЫ, И У НИХ ДВЕ ПОЛОВИНЫ. «Пусто» ничего не значит, пока
// не показано, что проверка умеет находить; но и «поймала все шесть» ничего
// не значит, пока она не промолчала на здоровом файле. Проверка подписей
// однажды ругалась на все 46 здоровых строк — и каждый подлог выглядел
// пойманным на фоне общей ругани (CLAUDE.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, fetchArticle, postPath } from './source.mjs';

const SELFTEST = process.argv.includes('--selftest');

const strip = (html) => html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
const norm = (text) => text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Markdown → чистый текст.
 *
 * `keepCaptions` — для «Голубого периода»: там подпись «Работа: …» это часть
 * авторского текста, просто переехавшая к своим картинкам. Не оставь мы её —
 * сверка не заметила бы её пропажи.
 */
const plainMd = (md, { keepCaptions = false } = {}) => {
	let text = md;
	if (keepCaptions) text = text.replace(/^::image\{[^}]*caption="([^"]*)"[^}]*\}$/gm, '$1');
	return text
		.replace(/^::image\{[^}]*\}$/gm, '')
		.replace(/^::video\{[^}]*\}$/gm, '')
		.replace(/^::label\{text="[^"]*"\}$/gm, '')
		// Служебная метка админки: на странице её нет вовсе, remark-anime удаляет узел.
		.replace(/^::anime-ref\{[^}]*\}$/gm, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^\d+\.\s+/gm, '')
		.replace(/\\$/gm, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\*\*([^*]*)\*\*/g, '$1')
		.replace(/\*([^*]*)\*/g, '$1');
};

const bodyOf = (raw) => raw.split(/^---$/m).slice(2).join('---');
const blocksOf = (raw) => bodyOf(raw).trim().split(/\n\n+/).filter(Boolean);

/** Известные отличия перечисляются СПИСКОМ, а не размягчением сравнения. */
const KNOWN_LINKS = new Map([
	['https://dtf.ru/anime/1198618-vse-serialy-vesny-2022-chto-stoit-posmotret', '/posts/obzor-vseh-anime-vesny-162/'],
	['https://dtf.ru/podcasts/1018419-neobychnoe-taksi-chto-esli-by-tarantino-snimal-anime-i-kak-sdelat-detektiv-pro-morzha', '/posts/ep-22/'],
	['https://api.dtf.ru/v2.8/redirect?to=https%3A%2F%2Ft.me%2Fpodcastbaka&postId=1329025', 'https://t.me/podcastbaka'],
]);

/** Куски, выброшенные при переносе. Каждый — решение заказчика. */
const DROP = {
	zima2022: [/^Я решил устроить себе марафон/, /^(Кратко правила|Правила такие):/, /четверку аниме можно посмотреть/, /^Больше от подкаста/],
	podborki2023: [/Расскажите в комментариях/, /не забывайте подписываться/i, /^Ещё больше интересных фактов|^Еще больше интересных фактов/],
	bluePeriod: [/^Больше интересного и полезного в нашем телеграм/],
	// Строка «Оригинал интервью — тут» ОСТАЁТСЯ: это указание на первоисточник,
	// а не хвост площадки. Выброшены только теги DTF.
	interview: [/^#\S/],
	// Реклама канала — как в подборках 2023. Три звёздочки на DTF набраны
	// заголовком: это черта-разделитель перед послесловием, а не вопрос.
	jjk: [/^Читайте больше про аниме/, /^\*+$/],
};

const problemsOfImages = (raw) => {
	const problems = [];
	for (const match of raw.matchAll(/src="(\/images\/uploads\/[^"]+)"/g))
		if (!fs.existsSync(path.join(ROOT, 'public', match[1]))) problems.push(`нет файла картинки ${match[1]}`);
	for (const match of raw.matchAll(/^cover: (\S+)$/gm))
		if (!fs.existsSync(path.join(ROOT, 'public', match[1]))) problems.push(`нет файла обложки ${match[1]}`);
	return problems;
};

// ─── Зимний обзор 2022: склейка пяти статей плюс два поста телеграма ───────
async function checkZima2022(raw) {
	const problems = [];
	const parts = [1149385, 1150944, 1153300, 1157405, 1167923];
	const out = [];
	for (const [index, id] of parts.entries()) {
		const article = await fetchArticle(id);
		for (const block of article.blocks) {
			if (block.type !== 'text' && block.type !== 'header') continue;
			for (const chunk of block.data.text.split(/<\/p>|<br\s*\/?>/i)) {
				const text = norm(strip(chunk));
				if (!text) continue;
				if (DROP.zima2022.some((re) => re.test(text))) {
					// Подводка ПЕРВОЙ части — единственная, что осталась, и у неё
					// обрезан хвост «Первые четыре тайтла:»: в сборнике из двадцати
					// трёх это неправда (решение заказчика).
					if (index === 0 && /^Я решил устроить себе марафон/.test(text)) { out.push(text); continue; }
					if (index === 0 && /^Правила такие:/.test(text)) { out.push(text.replace(/\s*Первые четыре тайтла:\s*$/, '')); continue; }
					continue;
				}
				out.push(text);
			}
		}
	}
	// Хвост: два обзора, которых на DTF нет вовсе, — из телеграма (посты 115 и 116).
	// Тексты лежат в git: посты снесены как дубли.
	const { execSync } = await import('node:child_process');
	for (const [file, title] of [['obzor-vseh-anime-zimy-115', 'Медленная петля'], ['obzor-vseh-anime-zimy-116', 'Руководство гениального принца по вызволению страны из долгов']]) {
		const text = execSync(`git -C ${JSON.stringify(ROOT)} show ee66b3fc:src/content/posts/${file}.md`, { encoding: 'utf8' });
		const body = bodyOf(text).split('\n').filter((line) => !line.trim().startsWith('::anime-ref')).join('\n');
		out.push(norm(title), norm(body.replace(/\*\*([^*]*)\*\*/g, '$1')));
	}

	const want = norm(out.join(' '));
	const got = norm(plainMd(bodyOf(raw)));
	if (want !== got) {
		let i = 0; while (i < want.length && want[i] === got[i]) i++;
		problems.push(`текст разошёлся на знаке ${i}: ждали ${JSON.stringify(want.slice(i, i + 50))}, получили ${JSON.stringify(got.slice(i, i + 50))}`);
	}
	if (/\]\(https?:\/\/anilist/.test(raw)) problems.push('осталась ссылка на AniList');
	const heads = (raw.match(/^#### /gm) || []).length;
	const images = (raw.match(/^::image/gm) || []).length;
	if (heads !== 23) problems.push(`заголовков тайтлов ${heads}, ждали 23 (21 с DTF и 2 из телеграма)`);
	if (images !== 24) problems.push(`картинок ${images}, ждали 24 (23 иллюстрации и обложка)`);
	problems.push(...problemsOfImages(raw));
	return problems;
}

// ─── Летний обзор 2022 ────────────────────────────────────────────────────
async function checkLeto2022(raw) {
	const problems = [];
	const article = await fetchArticle(1329025);
	const want = norm(article.blocks.filter((b) => b.type === 'text' || b.type === 'header').map((b) => strip(b.data.text)).join(' '));
	const got = norm(plainMd(bodyOf(raw)));
	if (want !== got) {
		let i = 0; while (i < want.length && want[i] === got[i]) i++;
		problems.push(`текст разошёлся на знаке ${i}: ждали ${JSON.stringify(want.slice(i, i + 50))}, получили ${JSON.stringify(got.slice(i, i + 50))}`);
	}
	// Ссылки сравниваем НАБОРОМ, а не по порядку: ссылки на AniList сняты вовсе
	// (решение заказчика), и позиции сдвинулись.
	const dtfHrefs = article.blocks.flatMap((b) => (b.type === 'text' || b.type === 'header') ? [...b.data.text.matchAll(/href="([^"]*)"/g)].map((m) => m[1]) : []);
	const myHrefs = [...raw.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
	const wanted = new Set(dtfHrefs.filter((h) => !h.includes('anilist.co')).map((h) => KNOWN_LINKS.get(h) ?? h));
	for (const link of wanted) if (!myHrefs.includes(link)) problems.push(`пропала ссылка ${link}`);
	for (const link of myHrefs) if (!link.startsWith('/anime/') && !wanted.has(link)) problems.push(`лишняя ссылка ${link}`);
	if (/\]\(https?:\/\/anilist/.test(raw)) problems.push('осталась ссылка на AniList');
	problems.push(...problemsOfImages(raw));
	return problems;
}

// ─── Три подборки 2023 ────────────────────────────────────────────────────
const INCUT_HEAD = /^Другие (достойные упоминания продолжения|продолжения, достойные упоминания)/;

async function checkPodborka2023(raw, id) {
	const problems = [];
	const article = await fetchArticle(id);
	const out = [];
	for (const block of article.blocks) {
		if (block.type !== 'text' && block.type !== 'header' && block.type !== 'incut') continue;
		for (const chunk of block.data.text.split(/<\/p>|<br\s*\/?>/i)) {
			const text = norm(strip(chunk).replace(/^\d+\.\s*/, ''));
			if (!text || DROP.podborki2023.some((re) => re.test(text))) continue;
			// Заголовок врезки заменён подписью блока — искать его в тексте незачем.
			if (block.type === 'incut' && INCUT_HEAD.test(text)) continue;
			out.push(text);
		}
	}
	const want = norm(out.join(' '));
	const got = norm(plainMd(bodyOf(raw)));
	if (want !== got) {
		let i = 0; while (i < want.length && want[i] === got[i]) i++;
		problems.push(`текст разошёлся на знаке ${i}: ждали ${JSON.stringify(want.slice(i, i + 50))}, получили ${JSON.stringify(got.slice(i, i + 50))}`);
	}
	// РОЛИКИ СВЕРЯЕМ ПО ИДЕНТИФИКАТОРАМ, А НЕ ПО СЧЁТУ: подменённый чужим ролик
	// счётом не поймать вовсе.
	const wantVideos = article.blocks.filter((b) => b.type === 'video').map((b) => b.data.video.data.external_service.id);
	const gotVideos = [...raw.matchAll(/::video\{youtube="[^"]*v=([^"&]+)"\}/g)].map((m) => m[1]);
	if (wantVideos.join(',') !== gotVideos.join(',')) problems.push(`ролики разошлись: у DTF ${wantVideos.length}, у нас ${gotVideos.length}`);
	const wantImages = article.blocks.filter((b) => b.type === 'media').reduce((n, b) => n + b.data.items.length, 0);
	const gotImages = (raw.match(/^::image/gm) || []).length;
	if (wantImages !== gotImages) problems.push(`картинок у DTF ${wantImages}, у нас ${gotImages}`);
	if (/api\.dtf\.ru/.test(raw)) problems.push('осталась переадресация api.dtf.ru');
	problems.push(...checkCoverFirst(raw));
	problems.push(...problemsOfImages(raw));
	return problems;
}

// ─── «Голубой период» ─────────────────────────────────────────────────────
async function checkBluePeriod(raw) {
	const problems = [];
	const article = await fetchArticle(1247167);

	// ПОРЯДОК СЛОВ СРАВНИВАТЬ НЕЛЬЗЯ: подпись «Работа: …» стоит в статье НИЖЕ
	// описания, а у нас переехала выше, к своим картинкам (просьба заказчика).
	// Поэтому сверяется НАБОР абзацев: ни один не потерян и ни один не появился.
	const wantParas = new Set();
	for (const block of article.blocks) {
		if (block.type !== 'text' && block.type !== 'header' && block.type !== 'incut') continue;
		for (const chunk of block.data.text.split(/<\/p>|<br\s*\/?>/i)) {
			const text = norm(strip(chunk));
			if (!text || DROP.bluePeriod.some((re) => re.test(text))) continue;
			wantParas.add(text);
		}
	}
	const body = plainMd(bodyOf(raw), { keepCaptions: true });
	const gotParas = new Set(body.split(/\n\n+/).map(norm).filter(Boolean));
	for (const text of wantParas) if (!gotParas.has(text)) problems.push(`потерян абзац: «${text.slice(0, 60)}»`);
	for (const text of gotParas) if (!wantParas.has(text)) problems.push(`лишний абзац: «${text.slice(0, 60)}»`);

	// ГРУППЫ КАРТИНОК: у DTF они [1,2,1,1,…]; у нас галерея — это подряд идущие
	// строки `::image` без текста между ними. Разойдись группы — галереи
    // рассыпались бы на одиночные кадры, и текст при этом остался бы целым.
	const wantGroups = article.blocks.filter((b) => b.type === 'media').map((b) => b.data.items.length);
	const blocks = blocksOf(raw);
	const gotGroups = [];
	let run = 0;
	for (const block of blocks) { if (block.startsWith('::image')) run++; else if (run) { gotGroups.push(run); run = 0; } }
	if (run) gotGroups.push(run);
	if (wantGroups.join(',') !== gotGroups.join(',')) problems.push(`группы картинок разошлись: у DTF [${wantGroups.join(',')}], у нас [${gotGroups.join(',')}]`);

	// Подпись у галереи ОДНА и только у первой картинки — иначе плагин ругнётся.
	let prevWasImage = false;
	for (const block of blocks) {
		if (!block.startsWith('::image')) { prevWasImage = false; continue; }
		if (prevWasImage && block.includes('caption=')) problems.push(`подпись у второй картинки галереи: ${block.slice(0, 70)}`);
		prevWasImage = true;
	}
	const staleWorks = blocks.filter((b) => /^Работа:/.test(b));
	if (staleWorks.length) problems.push(`«Работа: …» осталась абзацем, а не подписью: ${staleWorks.length} шт.`);
	const wantWorks = article.blocks.filter((b) => b.type === 'text')
		.flatMap((b) => b.data.text.split(/<\/p>/i).map((x) => norm(strip(x))))
		.filter((t) => /^Работа:/.test(t)).length;
	const gotWorks = (raw.match(/caption="Работа:/g) || []).length;
	if (wantWorks !== gotWorks) problems.push(`подписей «Работа: …» у DTF ${wantWorks}, у нас ${gotWorks}`);
	if (/api\.dtf\.ru/.test(raw)) problems.push('осталась переадресация api.dtf.ru');
	problems.push(...problemsOfImages(raw));
	return problems;
}

// ─── Интервью «Долой безделье!» ───────────────────────────────────────────
async function checkInterview(raw) {
	const problems = [];
	const article = await fetchArticle(1805563);

	const want = norm(article.blocks
		.filter((b) => b.type === 'text' || b.type === 'header')
		.flatMap((b) => b.data.text.split(/<\/p>|<br\s*\/?>/i))
		.map((chunk) => norm(strip(chunk)))
		.filter((text) => text && !DROP.interview.some((re) => re.test(text)))
		.join(' '));
	const got = norm(plainMd(bodyOf(raw)));
	if (want !== got) {
		let i = 0; while (i < want.length && want[i] === got[i]) i++;
		problems.push(`текст разошёлся на знаке ${i}: ждали ${JSON.stringify(want.slice(i, i + 50))}, получили ${JSON.stringify(got.slice(i, i + 50))}`);
	}

	// КАЖДЫЙ ВОПРОС — ПЯТЫЙ УРОВЕНЬ, И СВЕРЯЕМ ИХ ТЕКСТОМ, А НЕ СЧЁТОМ. Уровень
	// заголовка решает весь вид блока (третий — в скобках и капсом, четвёртый —
	// капсом), и съехавший на соседний уровень вопрос счётом не поймать вовсе.
	const wantHeads = article.blocks.filter((b) => b.type === 'header').map((b) => norm(strip(b.data.text)));
	const gotHeads = [...raw.matchAll(/^(#{1,6}) (.+)$/gm)].map((m) => ({ level: m[1].length, text: norm(m[2]) }));
	if (wantHeads.join('\n') !== gotHeads.map((h) => h.text).join('\n'))
		problems.push(`вопросы разошлись: у DTF ${wantHeads.length}, у нас ${gotHeads.length}`);
	for (const head of gotHeads)
		if (head.level !== 5) problems.push(`вопрос стоит заголовком ${head.level}, а не 5: «${head.text.slice(0, 50)}»`);

	// ПОДПИСЬ У КАРТИНКИ ОДНА НА ВСЮ СТАТЬЮ, и потерять её легче всего:
	// у остальных десяти кадров подписи нет, значит пропажу единственной
	// не покажет ни счёт картинок, ни сверка текста — та её вовсе не видит.
	//
	// СВЕРЯЕМ ПАРАМИ «КАДР — ПОДПИСЬ», А НЕ СПИСКОМ ПОДПИСЕЙ. Первая редакция
	// сравнивала список, и подлог «подпись уехала к чужому кадру» прошёл мимо
	// насквозь: список-то тот же самый. А подпись не от того кадра хуже
	// пропавшей — она выглядит правильной, и заметить её будет некому.
	const wantCaptions = article.blocks.filter((b) => b.type === 'media').flatMap((b) => b.data.items.map((i) => norm(i.title ?? '')));
	const gotCaptions = [...raw.matchAll(/^::image\{([^}]*)\}$/gm)].map((m) => norm(/caption="([^"]*)"/.exec(m[1])?.[1] ?? ''));
	if (wantCaptions.length !== gotCaptions.length)
		problems.push(`картинок у DTF ${wantCaptions.length}, у нас ${gotCaptions.length}`);
	else for (const [index, wanted] of wantCaptions.entries())
		if (wanted !== gotCaptions[index])
			problems.push(`подпись ${index + 1}-го кадра разошлась: у DTF «${wanted.slice(0, 40) || '—'}», у нас «${gotCaptions[index].slice(0, 40) || '—'}»`);

	// Имя говорящего полужирным — так набрано в первоисточнике. Пропади разметка,
	// сверка текста этого не заметит: звёздочки она снимает с обеих сторон.
	const wantBold = article.blocks.filter((b) => b.type === 'text').reduce((n, b) => n + (b.data.text.match(/<b>/g) || []).length, 0);
	const gotBold = (bodyOf(raw).match(/\*\*[^*]+\*\*/g) || []).length;
	if (wantBold !== gotBold) problems.push(`имён говорящих полужирным у DTF ${wantBold}, у нас ${gotBold}`);

	// Переадресаций тут ДВЕ ПОРОДЫ: своя у DTF и приехавшая из Google Docs.
	// Вторая ведёт на первоисточник интервью — самое важное место текста.
	if (/api\.dtf\.ru/.test(raw)) problems.push('осталась переадресация api.dtf.ru');
	if (/google\.[a-z.]+\/url\?/.test(raw)) problems.push('осталась переадресация google.com/url');

	// `tgId` — не мелочь: по нему импорт узнаёт, что анонс 1256 уже на сайте.
	// Потеряй его — и робот заведёт анонс заново, вторым файлом рядом со статьёй.
	if (!/^tgId: 1256$/m.test(raw)) problems.push('пропал tgId: 1256 — импорт заведёт анонс из телеграма заново');

	problems.push(...checkCoverFirst(raw));
	problems.push(...problemsOfImages(raw));
	return problems;
}

// ─── Интервью «Магическая битва» ──────────────────────────────────────────
//
// ЧЕГО ЭТА ПРОВЕРКА НЕ УМЕЕТ, И ЭТО НАДО СКАЗАТЬ ВСЛУХ. Подписи под кадрами
// тут ПРИДУМАНЫ (на DTF они пустые), значит сверять их не с чем: правильность
// подписи знает только человек, который смотрел на кадр. Проверка утверждает
// лишь то, что проверяемо, — подпись есть у каждого кадра кроме обложки,
// и все они разные. Подпись, уехавшую к соседнему кадру, тут не поймает
// ничто, кроме глаз заказчика; у «Долой безделье!» она поймана лишь потому,
// что подпись там ОДНА и приехала из первоисточника.
async function checkJjk(raw) {
	const problems = [];
	const article = await fetchArticle(1383597);

	const want = norm(article.blocks
		.filter((b) => b.type === 'text' || b.type === 'header' || b.type === 'incut')
		.flatMap((b) => b.data.text.split(/<\/p>|<br\s*\/?>/i))
		.map((chunk) => norm(strip(chunk)))
		.filter((text) => text && !DROP.jjk.some((re) => re.test(text)))
		// Известное отличие — СПИСКОМ, а не размягчением сравнения: у ссылки
		// на выпуск подкаста текстом стоял сам адрес youtu.be, и он заменён
		// названием выпуска (иначе ссылка врала бы собственными словами).
		.map((text) => (text === 'https://youtu.be/TlZh4Kbalsk' ? 'Магическая битва | Лучший ли это сёнен или просто копия других аниме?' : text))
		.join(' '));
	const got = norm(plainMd(bodyOf(raw)));
	if (want !== got) {
		let i = 0; while (i < want.length && want[i] === got[i]) i++;
		problems.push(`текст разошёлся на знаке ${i}: ждали ${JSON.stringify(want.slice(i, i + 50))}, получили ${JSON.stringify(got.slice(i, i + 50))}`);
	}

	// Вопросы — текстом и уровнем. Черта-разделитель «***» на DTF набрана
	// заголовком, и в число вопросов не входит.
	const wantHeads = article.blocks.filter((b) => b.type === 'header').map((b) => norm(strip(b.data.text))).filter((t) => !/^\*+$/.test(t));
	const gotHeads = [...raw.matchAll(/^(#{1,6}) (.+)$/gm)].map((m) => ({ level: m[1].length, text: norm(m[2]) }));
	if (wantHeads.join('\n') !== gotHeads.map((h) => h.text).join('\n'))
		problems.push(`вопросы разошлись: у DTF ${wantHeads.length}, у нас ${gotHeads.length}`);
	for (const head of gotHeads)
		if (head.level !== 5) problems.push(`вопрос стоит заголовком ${head.level}, а не 5: «${head.text.slice(0, 50)}»`);

	const wantImages = article.blocks.filter((b) => b.type === 'media').reduce((n, b) => n + b.data.items.length, 0);
	const shots = [...raw.matchAll(/^::image\{([^}]*)\}$/gm)].map((m) => /caption="([^"]*)"/.exec(m[1])?.[1] ?? '');
	if (wantImages !== shots.length) problems.push(`картинок у DTF ${wantImages}, у нас ${shots.length}`);

	// Подпись есть у каждого кадра, кроме обложки, и все они разные.
	for (const [index, caption] of shots.entries())
		if (index > 0 && !caption) problems.push(`у ${index + 1}-го кадра нет подписи, а её просил заказчик`);
	const named = shots.slice(1).filter(Boolean);
	if (new Set(named).size !== named.length) problems.push('две подписи совпали — кадры подписаны одним текстом');

	const wantBold = article.blocks.filter((b) => b.type === 'text').reduce((n, b) => n + (b.data.text.match(/<b>/g) || []).length, 0);
	const gotBold = (bodyOf(raw).match(/\*\*[^*]+\*\*/g) || []).length;
	if (wantBold !== gotBold) problems.push(`имён говорящих полужирным у DTF ${wantBold}, у нас ${gotBold}`);

	if (/api\.dtf\.ru/.test(raw)) problems.push('осталась переадресация api.dtf.ru');
	if (/google\.[a-z.]+\/url\?/.test(raw)) problems.push('осталась переадресация google.com/url');
	if (/youtu\.?be/.test(raw)) problems.push('осталась ссылка на YouTube, а выпуск есть на сайте');
	if (!raw.includes('](/posts/ep-47/)')) problems.push('пропала ссылка на выпуск /posts/ep-47/');
	if (!/^tgId: 437$/m.test(raw)) problems.push('пропал tgId: 437 — импорт заведёт анонс из телеграма заново');
	// Первоисточник интервью назван — это чужая работа, и ссылка на неё обязательна.
	if (!raw.includes('crunchyroll.com')) problems.push('пропала ссылка на Crunchyroll — чьё это интервью');

	problems.push(...checkCoverFirst(raw));
	problems.push(...problemsOfImages(raw));
	return problems;
}

// ─── Вид: обложка, порядок, подписи (правки заказчика 13 августа) ─────────
function checkCoverFirst(raw) {
	const problems = [];
	const cover = (/^cover: (\S+)$/m.exec(raw) || [])[1];
	const first = blocksOf(raw)[0] ?? '';
	if (!first.startsWith('::image')) problems.push('первым блоком тела стоит не обложка');
	else {
		if (cover && !first.includes(`src="${cover}"`)) problems.push('картинка сверху не та, что в поле «Обложка»');
		if (first.includes('caption=')) problems.push('у обложки есть подпись, а её быть не должно');
	}
	return problems;
}

/** Обзоры-марафоны: картинка сразу после заголовка тайтла, подпись со студией. */
function checkLayout(raw) {
	const problems = [...checkCoverFirst(raw)];
	const blocks = blocksOf(raw);
	for (const [index, block] of blocks.entries()) {
		if (index === 0 || !block.startsWith('::image')) continue;
		const prev = blocks[index - 1] ?? '';
		if (!/^#### /.test(prev)) { problems.push(`картинка стоит не после заголовка тайтла, а после: ${prev.slice(0, 60)}`); continue; }
		const caption = (/caption="([^"]*)"/.exec(block) || [])[1];
		if (!caption) { problems.push(`у иллюстрации нет подписи: ${block.slice(0, 60)}`); continue; }
		// «студии?» — это «студи» плюс необязательная «и», и со «студия» такое
		// не совпадает НИКОГДА. Русское окончание пишется набором.
		if (!/, студи[яи] .+$/.test(caption)) problems.push(`в подписи не названа студия: «${caption}»`);
		const head = /^#### (?:\[([^\]]+)\]\([^)]*\)|(.+))$/.exec(prev) || [];
		const name = head[1] ?? head[2];
		if (name && !caption.startsWith(name)) problems.push(`подпись «${caption}» не совпадает с заголовком «${name}»`);
	}
	for (const [index, block] of blocks.entries())
		if (/^#### /.test(block) && !(blocks[index + 1] ?? '').startsWith('::image'))
			problems.push(`у тайтла нет картинки: ${block.slice(0, 60)}`);
	return problems;
}

// ─── Что и чем проверяем ──────────────────────────────────────────────────
const POSTS = [
	{ slug: 'obzor-vseh-anime-zimy-2022', name: 'обзор зимы 2022', checks: [checkZima2022, (raw) => checkLayout(raw)] },
	{ slug: 'obzor-vseh-anime-leta-2022', name: 'обзор лета 2022', checks: [checkLeto2022, (raw) => checkLayout(raw)] },
	{ slug: 'kakoe-anime-stoit-smotret-etoy-zimoy-2023', name: 'подборка зимы 2023', checks: [(raw) => checkPodborka2023(raw, 1546149)] },
	{ slug: 'kakoe-anime-stoit-smotret-etoy-vesnoy-2023', name: 'подборка весны 2023', checks: [(raw) => checkPodborka2023(raw, 1696863)] },
	{ slug: 'kakoe-anime-stoit-smotret-etim-letom-2023', name: 'подборка лета 2023', checks: [(raw) => checkPodborka2023(raw, 1922981)] },
	{ slug: 'realnye-kartiny-v-mange-goluboy-period', name: '«Голубой период»', checks: [checkBluePeriod] },
	{ slug: 'doloy-bezdele-intervyu-s-rezhisserom-anime-i-avtorom-originalnoy-mangi', name: 'интервью «Долой безделье!»', checks: [checkInterview] },
	{ slug: 'intervyu-s-sozdatelyami-magicheskoy-bitvy', name: 'интервью «Магическая битва»', checks: [checkJjk] },
];

async function runAll() {
	let bad = 0;
	for (const post of POSTS) {
		const file = postPath(post.slug);
		if (!fs.existsSync(file)) { console.log(`\n=== ${post.name} ===\n   ✗ файла нет: ${post.slug}.md`); bad++; continue; }
		const raw = fs.readFileSync(file, 'utf8');
		const problems = [];
		for (const check of post.checks) problems.push(...(await check(raw)));
		console.log(`\n=== ${post.name} ===`);
		if (problems.length) { problems.slice(0, 6).forEach((p) => console.log('   ✗', p)); bad += problems.length; }
		else {
			const images = (raw.match(/^::image/gm) || []).length;
			const videos = (raw.match(/^::video/gm) || []).length;
			console.log(`   ✓ сходится с DTF: картинок ${images}${videos ? `, роликов ${videos}` : ''}`);
		}
	}
	return bad;
}

// ─── Подлоги ──────────────────────────────────────────────────────────────
async function selftest() {
	const zima = fs.readFileSync(postPath('obzor-vseh-anime-zimy-2022'), 'utf8');
	const bp = fs.readFileSync(postPath('realnye-kartiny-v-mange-goluboy-period'), 'utf8');
	const vesna = fs.readFileSync(postPath('kakoe-anime-stoit-smotret-etoy-vesnoy-2023'), 'utf8');
	const talk = fs.readFileSync(postPath('doloy-bezdele-intervyu-s-rezhisserom-anime-i-avtorom-originalnoy-mangi'), 'utf8');
	// Вопрос достаём ИЗ ДАННЫХ, а не вписываем именем: вписанный, он протухнет
	// от первой же правки текста в админке, и заслон покраснеет на здоровом
	// посте (в проекте это уже случалось — «Баки!» уехала в стоп-лист).
	const firstQuestion = /^##### (.+)$/m.exec(talk)[1];
	const jjk = fs.readFileSync(postPath('intervyu-s-sozdatelyami-magicheskoy-bitvy'), 'utf8');
	// Подпись достаём ИЗ ДАННЫХ: вписанная именем, она протухнет от первой же
	// правки заказчика в админке, и заслон покраснеет на здоровом посте.
	const jjkCaption = /^::image\{[^}]*caption="([^"]*)"[^}]*\}$/m.exec(jjk)[1];

	const cases = [
		['зима 2022: потерян целый тайтл', () => checkZima2022(zima.replace(/#### \[Ниндзяла\]\([^)]*\)/, '')), true],
		['зима 2022: ссылка на AniList вернулась', () => checkZima2022(zima.replace('#### [Шэнму]', '#### [Шэнму](https://anilist.co/anime/123752/) [')), true],
		['зима 2022: картинка перед заголовком', () => {
			const blocks = zima.split(/\n\n/); const i = blocks.findIndex((b) => b.startsWith('#### [Похороны'));
			[blocks[i], blocks[i + 1]] = [blocks[i + 1], blocks[i]];
			return Promise.resolve(checkLayout(blocks.join('\n\n')));
		}, true],
		['зима 2022: в подписи нет студии', () => Promise.resolve(checkLayout(zima.replace(/caption="Похороны Короля Роз, студия [^"]*"/, 'caption="Похороны Короля Роз"'))), true],
		['весна 2023: ролик подменён чужим', () => checkPodborka2023(vesna.replace('29SndZlRFA4', 'dQw4w9WgXcQ'), 1696863), true],
		['весна 2023: потерян ролик', () => checkPodborka2023(vesna.replace(/::video\{youtube="[^"]*29SndZlRFA4"\}\n\n/, ''), 1696863), true],
		['«Голубой период»: подпись осталась абзацем', () => checkBluePeriod(bp.replace(/ caption="Работа: «Автопортрет в студии», 1929 год"/, '')), true],
		['«Голубой период»: галерея разорвана текстом', () => checkBluePeriod(bp.replace('::image{src="/images/uploads/dtf-blue-period-03.webp"', 'Лишний абзац между кадрами галереи.\n\n::image{src="/images/uploads/dtf-blue-period-03.webp"')), true],
		['«Голубой период»: файла картинки нет', () => checkBluePeriod(bp.replace('dtf-blue-period-05.webp', 'dtf-blue-period-99.webp')), true],
		['интервью: пропала подпись у единственного кадра с подписью', () => checkInterview(talk.replace(/ caption="21 октября 1600 года[^"]*"/, '')), true],
		['интервью: подпись уехала к чужому кадру', () => checkInterview(
			talk.replace(/ caption="(21 октября 1600 года[^"]*)"/, '').replace('::image{src="/images/uploads/dtf-doloy-bezdele-07.webp" alt=""', '::image{src="/images/uploads/dtf-doloy-bezdele-07.webp" alt="" caption="21 октября 1600 года в ходе Битвы при Секигахаре Шима Сакон служил одним из высокопоставленных офицеров Исиды Мицунари"')), true],
		['интервью: вопрос съехал на четвёртый уровень', () => checkInterview(talk.replace(`##### ${firstQuestion}`, `#### ${firstQuestion}`)), true],
		['интервью: вопрос потерян', () => checkInterview(talk.replace(`##### ${firstQuestion}\n\n`, '')), true],
		['интервью: имя говорящего осталось без полужирного', () => checkInterview(talk.replace('**Дэай Котоми:**', 'Дэай Котоми:')), true],
		['интервью: ссылка на первоисточник осталась через google.com/url', () => checkInterview(talk.replace('https://realsound.jp/movie/2023/04/post-1311555.html', 'https://www.google.com/url?q=https://realsound.jp/movie/2023/04/post-1311555.html&sa=D')), true],
		['интервью: потерян tgId — импорт заведёт анонс заново', () => checkInterview(talk.replace(/^tgId: 1256$/m, 'tgId: null')), true],
		// Обложку не удаляем, а ОПУСКАЕМ на абзац ниже: удаление ловится счётом
		// картинок, а это ловит только checkCoverFirst — ту проверку, ради
		// которой подлог и написан.
		['интервью: обложка не первым блоком', () => {
			const blocks = talk.split(/\n\n/);
			const i = blocks.findIndex((b) => b.startsWith('::image{src="/images/uploads/dtf-doloy-bezdele-01.webp"'));
			[blocks[i], blocks[i + 1]] = [blocks[i + 1], blocks[i]];
			return checkInterview(blocks.join('\n\n'));
		}, true],
		['интервью: у обложки появилась подпись', () => checkInterview(talk.replace('dtf-doloy-bezdele-01.webp" alt=""', 'dtf-doloy-bezdele-01.webp" alt="" caption="Кадр из аниме"')), true],
		['«Магическая битва»: у кадра пропала подпись', () => checkJjk(jjk.replace(` caption="${jjkCaption}"`, '')), true],
		['«Магическая битва»: два кадра подписаны одинаково', () => {
			const caps = [...jjk.matchAll(/^::image\{[^}]*caption="([^"]*)"[^}]*\}$/gm)].map((m) => m[1]);
			return checkJjk(jjk.replace(` caption="${caps[1]}"`, ` caption="${caps[0]}"`));
		}, true],
		['«Магическая битва»: ссылка на выпуск осталась на YouTube', () => checkJjk(jjk.replace('[Магическая битва | Лучший ли это сёнен или просто копия других аниме?](/posts/ep-47/)', '[https://youtu.be/TlZh4Kbalsk](https://youtu.be/TlZh4Kbalsk)')), true],
		['«Магическая битва»: пропала ссылка на Crunchyroll', () => checkJjk(jjk.replace(/\[поговорил\]\([^)]*\)/, 'поговорил')), true],
		['«Магическая битва»: реклама канала вернулась', () => checkJjk(jjk.replace('##### Сэко-сан,', 'Читайте больше про аниме в нашем телеграм-канале\n\n##### Сэко-сан,')), true],
		['«Магическая битва»: черта-разделитель вернулась заголовком', () => checkJjk(jjk.replace('Узнать больше о «Магической битве»', '##### ***\n\nУзнать больше о «Магической битве»')), true],
		['«Магическая битва»: потерян tgId', () => checkJjk(jjk.replace(/^tgId: 437$/m, 'tgId: null')), true],
		// Вторая половина: на здоровых файлах все проверки обязаны МОЛЧАТЬ.
		['здоровый обзор зимы 2022', () => checkZima2022(zima), false],
		['здоровый «Голубой период»', () => checkBluePeriod(bp), false],
		['здоровая подборка весны 2023', () => checkPodborka2023(vesna, 1696863), false],
		['здоровое интервью «Долой безделье!»', () => checkInterview(talk), false],
		['здоровое интервью «Магическая битва»', () => checkJjk(jjk), false],
	];

	let ok = true;
	for (const [name, run, shouldFail] of cases) {
		const problems = await run();
		const failed = problems.length > 0;
		if (failed === shouldFail) console.log(shouldFail ? `✓ поймано: ${name} → ${problems[0].slice(0, 75)}` : `✓ молчит: ${name}`);
		else { console.log(shouldFail ? `✗ ПРОПУЩЕНО: ${name}` : `✗ РУГАЕТСЯ НА ЗДОРОВОЕ: ${name} → ${problems[0]}`); ok = false; }
	}
	return ok ? 0 : 1;
}

// Русские буквы в пути: import.meta.url кодирует их, а process.argv[1] нет —
// сравнивать надо путями, иначе скрипт молча ничего не делает (CLAUDE.md).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	process.exit(SELFTEST ? await selftest() : (await runAll()) ? 1 : 0);
}
