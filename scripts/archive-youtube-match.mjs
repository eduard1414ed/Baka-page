// ПРАВКА 3 ЗАДАЧИ 19: СОПОСТАВЛЕНИЕ ПОСТОВ С РОЛИКАМИ КАНАЛА.
// РАЗБОР. Записи в этом файле нет вовсе — она в archive-youtube-embed.mjs.
//
// ЦЕНА ОШИБКИ ЗДЕСЬ ВЫШЕ, ЧЕМ ГДЕ-ЛИБО В ЗАДАЧЕ. Не тот ролик под выпуском
// выглядит совершенно нормально: заголовок правильный, картинка правильная,
// видео играет. Заметить подмену может только человек, который смотрел
// и то, и другое. Поэтому:
//   • совпадение считается по СЛОВАМ, а не по «похожести» строк;
//   • у каждой пары печатается, ЧЕМ она подтверждена и какой второй кандидат;
//   • всё, что ниже порога, показывается отдельной группой и НЕ применяется;
//   • порог назван числом и выведен из разрыва в замере, а не назначен на глаз.
//
// Список роликов берётся файлом (`--videos путь`), а не тянется из сети
// при каждом запуске: канал отвечает по-разному в разные дни, а решение
// заказчика принимается по конкретному списку.
//
// Запуск:
//   node scripts/archive-youtube-match.mjs --videos yt.json
//   node scripts/archive-youtube-match.mjs --videos yt.json --selftest

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPostsRaw, parseBody } from './archive-clean-lib.mjs';
import { effectiveCategory } from './archive-rules-measure.mjs';

const CATEGORY_LABEL = { podcast: 'Выпуск', videoessay: 'Видеоэссе', note: 'Заметка', article: 'Статья', bonus: 'Бонус' };

/**
 * Слова названия, приведённые к общему виду.
 *
 * Хвосты вроде «| Подкаст», «| Видеоэссе», «| Эссе» на ютюбе есть, а в посте
 * их нет (и наоборот) — они не различают материалы, а только шумят, поэтому
 * выбрасываются. Кавычки-ёлочки, тире и прочая типографика тоже: в посте
 * «Хёка», на ютюбе «Хёка» без кавычек — это одно и то же название.
 */
const NOISE = new Set([
	'подкаст', 'видеоэссе', 'эссе', 'миниэссе', 'мини', 'выпуск', 'спешал',
	'бака', 'baka', 'аниме', 'и', 'в', 'на', 'о', 'об', 'с', 'а', 'но', 'не',
	'это', 'как', 'что', 'почему', 'для', 'по', 'из', 'за', 'же', 'ли', 'то',
	'все', 'всё', 'мы', 'я', 'нас', 'наш', 'наши',
]);

export function words(title) {
	return String(title ?? '')
		.toLowerCase()
		.replace(/ё/g, 'е')
		.replace(/[«»„“”"'`’]/g, ' ')
		.replace(/[^a-zа-я0-9]+/gi, ' ')
		.split(' ')
		// ЦИФРА — ПОЛНОЦЕННОЕ СЛОВО. Первая версия выбрасывала всё короче двух
		// знаков, то есть и однозначные числа, — и «Наруто. Экзамен на Чуунина.
		// Часть 1» сошлось с «Частью 2» на 100 %. Под первой частью встала бы
		// вторая, и заметить это мог бы только тот, кто смотрел обе.
		.filter((w) => w && (w.length > 1 || /\d/.test(w)) && !NOISE.has(w));
}

/**
 * ЧИСЛА В НАЗВАНИИ РАЗЛИЧАЮТ, А НЕ УКРАШАЮТ. Номер части, номер выпуска
 * рубрики, год — всё это ровно то, чем соседние материалы отличаются друг
 * от друга, и совпадение остальных слов у них заведомо высокое. Поэтому
 * расхождение чисел — приговор паре, а не минус к доле.
 */
export function numbersOf(title) {
	return new Set(String(title ?? '').match(/\d+/g) ?? []);
}

function numbersAgree(postTitle, videoTitle) {
	const a = numbersOf(postTitle);
	const b = numbersOf(videoTitle);
	if (!a.size && !b.size) return true;
	// Числа поста обязаны найтись у ролика. Лишние числа у ролика законны:
	// в его названии бывает год выхода или номер сезона, которых в посте нет.
	for (const n of a) if (!b.has(n)) return false;
	return true;
}

/**
 * Насколько название поста и название ролика — про одно и то же.
 *
 * Считаем ДОЛЮ СЛОВ ПОСТА, нашедшихся у ролика, а не симметричную похожесть:
 * у ролика в названии часто есть лишнее («| Подкаст», имя гостя), и штрафовать
 * за это не за что. Плюс отдельно — сколько слов совпало числом: две общие
 * буквы «оно» и «дитя» это не то же самое, что восемь совпавших слов.
 */
export function score(postTitle, videoTitle) {
	const a = words(postTitle);
	const b = new Set(words(videoTitle));
	if (!a.length) return { share: 0, hits: 0, total: 0, common: [], numbersOk: false };
	const common = a.filter((w) => b.has(w));
	return {
		share: common.length / a.length,
		hits: common.length,
		total: a.length,
		common,
		numbersOk: numbersAgree(postTitle, videoTitle),
	};
}

// ПОРОГ. Выведен из разрыва в замере по живым данным, а не назначен: у верных
// пар доля совпавших слов 0.6 и выше при трёх и более общих словах, у ложных —
// 0.5 и ниже при одном-двух. Пара, не прошедшая оба условия, идёт в «не
// сопоставлено» и НЕ применяется.
const MIN_SHARE = 0.6;
const MIN_HITS = 3;
// КОРОТКОЕ НАЗВАНИЕ ТРЁХ СОВПАВШИХ СЛОВ НАБРАТЬ НЕ МОЖЕТ. «Что такое дунхуа?»
// после чистки шума — это два слова, и порог в три отверг бы верную пару.
// Для таких требуем совпадения ПОЛНОГО: доля 1.0 и все слова на месте.
const SHORT_TITLE = 2;

function passes(s) {
	if (!numbersOkFlag(s)) return false;
	if (s.total <= SHORT_TITLE) return s.share === 1 && s.hits >= 2;
	return s.share >= MIN_SHARE && s.hits >= MIN_HITS;
}
// Согласие чисел кладём в саму оценку — чтобы решение принималось в одном
// месте, а не проверялось отдельно в каждом вызывающем.
const numbersOkFlag = (s) => s.numbersOk !== false;

/**
 * Ролик для поста — или null, если уверенности нет.
 *
 * ОДНА ФУНКЦИЯ НА ДВА ФАЙЛА: её зовёт и разбор (показать заказчику), и запись
 * (поставить в пост). Второй экземпляр правила означал бы, что человек
 * принимает решение по одному списку пар, а в посты уезжает другой, — и
 * разойтись они могли бы молча.
 *
 * @returns {{ v: object, s: object, second: object|null } | null}
 */
export function matchFor(postTitle, videos) {
	const ranked = videos
		.map((v) => ({ v, s: score(postTitle, v.title) }))
		.sort((x, y) => y.s.share - x.s.share || y.s.hits - x.s.hits);
	const best = ranked[0];
	if (!best || !passes(best.s)) return null;
	return { v: best.v, s: best.s, second: ranked[1] ?? null };
}

async function main() {
	const at = process.argv.indexOf('--videos');
	if (at === -1) {
		console.error('Нужен список роликов: --videos путь/к/yt.json');
		process.exit(1);
	}
	const videos = JSON.parse(await readFile(process.argv[at + 1], 'utf8'));
	if (!Array.isArray(videos) || !videos.length) {
		console.error('Список роликов пуст — это не «роликов нет», а сломанный список. Останавливаюсь.');
		process.exit(1);
	}

	const posts = await readPostsRaw();
	const dir = (n) => (n && (n.type === 'leafDirective' || n.type === 'containerDirective') ? n.name : null);

	const need = [];
	for (const post of posts) {
		if (!post.draft) continue;
		const cat = effectiveCategory(post.front);
		if (cat !== 'videoessay' && cat !== 'podcast') continue;
		const blocks = parseBody(post.body).children ?? [];
		if (blocks.some((b) => dir(b) === 'video')) continue; // ролик уже стоит
		need.push({ post, cat, blocks });
	}

	console.log('═'.repeat(96));
	console.log('ПРАВКА 3: СОПОСТАВЛЕНИЕ С РОЛИКАМИ КАНАЛА. РАЗБОР, НИЧЕГО НЕ ПИШЕТСЯ.');
	console.log('═'.repeat(96));
	console.log();
	console.log(`Роликов на канале: ${videos.length}`);
	console.log(`Черновиков без ролика: ${need.length} (видеоэссе ${need.filter((n) => n.cat === 'videoessay').length}, выпусков ${need.filter((n) => n.cat === 'podcast').length})`);
	console.log(`Порог: доля слов ≥ ${MIN_SHARE} и совпавших ≥ ${MIN_HITS}; у названий из ${SHORT_TITLE} слов — совпадение полное. Числа обязаны сойтись.`);
	console.log();

	const matched = [];
	const unmatched = [];

	for (const n of need) {
		const ranked = videos
			.map((v) => ({ v, s: score(n.post.front?.title, v.title) }))
			.sort((x, y) => y.s.share - x.s.share || y.s.hits - x.s.hits);
		const best = ranked[0];
		const second = ranked[1];
		// Приговор берём у ОБЩЕЙ функции, а не считаем здесь второй раз.
		const ok = matchFor(n.post.front?.title, videos) !== null;
		(ok ? matched : unmatched).push({ ...n, best, second });
	}

	console.log('─'.repeat(96));
	console.log(`СОПОСТАВЛЕНО — ${matched.length}`);
	console.log('─'.repeat(96));
	for (const m of matched) {
		console.log(`\n  ▸ ${m.post.id}  (${CATEGORY_LABEL[m.cat]})`);
		console.log(`      пост:  ${m.post.front?.title}`);
		console.log(`      ролик: ${m.best.v.title}`);
		console.log(`      https://youtu.be/${m.best.v.id}   ${m.best.v.length}`);
		console.log(`      совпало слов ${m.best.s.hits} из ${m.best.s.total} (${Math.round(m.best.s.share * 100)}%): ${m.best.s.common.join(', ')}`);
		if (m.second) {
			console.log(`      второй кандидат: ${Math.round(m.second.s.share * 100)}% — ${m.second.v.title.slice(0, 62)}`);
		}
	}

	console.log();
	console.log('─'.repeat(96));
	console.log(`НЕ СОПОСТАВЛЕНО — ${unmatched.length}. НЕ ПРИМЕНЯЕТСЯ.`);
	console.log('─'.repeat(96));
	for (const u of unmatched) {
		console.log(`\n  ▸ ${u.post.id}  (${CATEGORY_LABEL[u.cat]})`);
		console.log(`      пост:  ${u.post.front?.title}`);
		if (u.best && u.best.s.hits) {
			console.log(`      ближе всех (${Math.round(u.best.s.share * 100)}%, слов ${u.best.s.hits}): ${u.best.v.title.slice(0, 70)}`);
			console.log(`      общие слова: ${u.best.s.common.join(', ') || '—'}`);
		} else {
			console.log('      похожего нет вовсе');
		}
	}
	console.log();
	console.log('Это разбор. Чтобы применить, нужен отдельный прогон записи.');
}

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
// Проверяем не «похоже ли», а решает ли правило РАЗЛИЧАТЬ. Половина случаев —
// пары, которые обязаны НЕ сойтись.
const FAKES = [
	// [название поста, название ролика, обязано сойтись?, пояснение]
	[
		'«Голубой период» — лучшее аниме о труде и таланте | Эссе',
		'Голубой период — лучшее аниме о труде и таланте | Видеоэссе',
		true,
		'кавычки и хвост рубрики различать не должны',
	],
	[
		'Атака Титанов — это спираль | Мини-эссе',
		'Атака Титанов — это спираль',
		true,
		'хвост «мини-эссе» есть только у поста',
	],
	[
		'Исекай. Как этот жанр захватил аниме? | Врата аниме №10',
		'Врата аниме №10 | Исекай. Как этот жанр захватил аниме?',
		true,
		'порядок частей названия роли не играет',
	],
	[
		'Наруто. Введение. Страна Волн',
		'Наруто. Экзамен на Чуунина. Часть 1',
		false,
		'ОДИН СЕРИАЛ, РАЗНЫЕ АРКИ — сойтись не должны',
	],
	[
		'Наруто. Экзамен на Чуунина. Часть 1',
		'Наруто. Экзамен на Чуунина. Часть 2',
		false,
		'ЧАСТЬ 1 И ЧАСТЬ 2 — сойтись не должны',
	],
	[
		'Лучшие аниме 2024 года | Бака Anime Awards',
		'Лучшие аниме 2025 года',
		false,
		'РАЗНЫЕ ГОДЫ — сойтись не должны',
	],
	[
		'Фрирен — лучшее аниме в истории?',
		'Почему все демоны злые? | Фрирен',
		false,
		'один тайтл, разные материалы — одного общего слова мало',
	],
	['Что такое дунхуа?', 'Что такое дунхуа? И как оно стало популярно?', true, 'ролик длиннее поста — это норма'],
];

function selftest() {
	let bad = 0;
	for (const [postTitle, videoTitle, expect, note] of FAKES) {
		const s = score(postTitle, videoTitle);
		const got = passes(s);
		if (got !== expect) {
			console.log(`  ✗ «${note}»`);
			console.log(`      пост:  ${postTitle}`);
			console.log(`      ролик: ${videoTitle}`);
			console.log(`      ожидалось ${expect ? 'СОЙТИСЬ' : 'НЕ сойтись'}, вышло ${got ? 'сошлось' : 'не сошлось'} — доля ${s.share.toFixed(2)}, слов ${s.hits} (${s.common.join(', ')}), числа ${s.numbersOk ? 'сошлись' : 'РАЗОШЛИСЬ'}`);
			bad++;
		}
	}
	const neg = FAKES.filter(([, , e]) => e === false).length;
	console.log();
	console.log(`Подлогов: ${FAKES.length}. «Обязано сойтись»: ${FAKES.length - neg}, «обязано НЕ сойтись»: ${neg}.`);
	if (bad) {
		console.log(`ПОДЛОГИ ПРОВАЛЕНЫ: ${bad}`);
		process.exit(1);
	}
	console.log('Все подлоги сошлись: правило и находит, и различает.');
}

const runDirectly = resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '');
if (runDirectly) {
	if (process.argv.includes('--selftest')) selftest();
	else
		main().catch((err) => {
			console.error('РАЗБОР УПАЛ:', err);
			process.exit(1);
		});
}
