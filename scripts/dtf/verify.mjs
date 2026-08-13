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
		// Вторая половина: на здоровых файлах все проверки обязаны МОЛЧАТЬ.
		['здоровый обзор зимы 2022', () => checkZima2022(zima), false],
		['здоровый «Голубой период»', () => checkBluePeriod(bp), false],
		['здоровая подборка весны 2023', () => checkPodborka2023(vesna, 1696863), false],
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
