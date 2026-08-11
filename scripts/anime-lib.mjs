// Общее для scripts/fetch-anime.mjs (запускаете вручную по одному тайтлу) и
// scripts/sync-anime.mjs (робот на GitHub Actions, донабирает тайтлы, размеченные
// в текстах постов) — скачать обложку, сжать её и записать файл тайтла в справочник.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ANIME_POSTER_WIDTHS } from '../src/lib/animePoster.mjs';
import { initMorph, computeAliasesAuto, strictQuotesHint } from './anime-cases-lib.mjs';

export const ROOT = new URL('../', import.meta.url);
export const ANIME_CONTENT_DIR = new URL('src/content/anime/', ROOT);
export const ANIME_PUBLIC_DIR = new URL('public/anime/', ROOT);

// ПАУЗА МЕЖДУ ЗАПРОСАМИ К ЧУЖОМУ ИСТОЧНИКУ — ОДНО ЧИСЛО НА ВЕСЬ ПРОЕКТ.
//
// Вежливость к Shikimori — не украшение, а условие, на котором мы им
// пользуемся, и числу тут место одно. До 11 августа 2026 их было два:
// 1500 мс в `fetch-anime.mjs` и 1200 мс в `sync-anime.mjs` (хвост 56).
// Разъехались они молча и, разумеется, в сторону «спрашиваем чаще, чем
// договаривались». Взято большее.
export const SHIKIMORI_PAUSE_MS = 1500;

export async function downloadPoster(posterUrl, slug) {
	const response = await fetch(posterUrl);
	if (!response.ok) {
		throw new Error(`Не удалось скачать обложку: ${response.status}`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());

	await mkdir(ANIME_PUBLIC_DIR, { recursive: true });
	for (const width of ANIME_POSTER_WIDTHS) {
		const outPath = fileURLToPath(new URL(`${slug}-${width}w.webp`, ANIME_PUBLIC_DIR));
		await sharp(buffer)
			.resize({ width, withoutEnlargement: true })
			.webp({ quality: 82 })
			.toFile(outPath);
	}
}

/** Название к сравнимому виду: регистр и знаки препинания не в счёт. */
function foldTitle(text) {
	return String(text ?? '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Обложка из запасного источника, когда у основного её нет.
 *
 * ЗАЧЕМ. У Shikimori обложка у свежих тайтлов появляется не сразу, а у AniList
 * она к этому времени обычно уже есть. Терять картинку из-за того, что первый
 * источник ответил раньше времени, незачем: остальные данные берутся у него же,
 * заимствуется только файл обложки.
 *
 * ИЩЕМ ПО ОРИГИНАЛЬНОМУ НАЗВАНИЮ — тому самому романизированному имени,
 * по которому тайтл и индексируется в AniList.
 *
 * И СВЕРЯЕМ, ЧТО НАШЛОСЬ ТО ЖЕ САМОЕ. Поиск по названию — это всегда риск
 * взять похожий тайтл (сиквел, спешл, ремейк), а чужая обложка хуже
 * отсутствующей: она выглядит правильной и потому не будет замечена никогда.
 * Название не совпало — обложку не берём и говорим об этом вслух.
 *
 * @param {object} result Что вернул основной источник.
 * @param {object[]} sources Все известные источники.
 * @param {string} primaryId `id` основного источника — его самого не спрашиваем.
 * @returns {Promise<string|undefined>} Адрес обложки или undefined.
 */
export async function borrowPoster(result, sources, primaryId) {
	const wanted = foldTitle(result.titleOriginal);
	if (!wanted) return undefined;

	for (const source of sources) {
		if (source.id === primaryId) continue;

		let found;
		try {
			found = await source.find(result.titleOriginal);
		} catch (error) {
			console.log(`  ${source.label} не ответил про обложку: ${error.message}`);
			continue;
		}

		if (!found?.posterUrl) continue;

		// Сверяем и с основным названием, и с альтернативными: у AniList
		// романизация иногда отличается написанием, а не тайтлом.
		const names = [found.titleOriginal, ...(found.sourceAliases ?? [])].map(foldTitle);
		if (!names.includes(wanted)) {
			console.log(
				`  обложку у ${source.label} не беру: там это «${found.titleOriginal}», а у нас «${result.titleOriginal}»`,
			);
			continue;
		}

		console.log(`  обложки в основном источнике нет — беру у ${source.label}`);
		return found.posterUrl;
	}

	return undefined;
}

// Поля, которые заказчик правит в админке и которые из-за этого нельзя
// перезаписывать данными источника (CLAUDE.md, раздел «Тайтл»). Признак стоит
// по каждому полю отдельно: описание переписано своими словами — не трогаем,
// а обложку в том же тайтле по-прежнему обновляем.
export const MANUAL_FIELDS = ['titleRu', 'synopsis', 'poster'];

async function readAnimeEntry(slug) {
	try {
		return JSON.parse(await readFile(new URL(`${slug}.json`, ANIME_CONTENT_DIR), 'utf8'));
	} catch {
		// Файла ещё нет (обычный случай для нового тайтла) или он битый —
		// в обоих случаях беречь нечего, пишем с нуля.
		return null;
	}
}

// source — модуль из scripts/anime-sources/ (id, label), result — то, что вернул
// find()/findById() этого модуля. Возвращает записанный объект тайтла.
export async function writeAnimeEntry(slug, source, result) {
	const previous = await readAnimeEntry(slug);
	const manual = (previous?.manual ?? []).filter((field) => MANUAL_FIELDS.includes(field));
	const kept = [];

	// Отмеченное как правленое руками оставляем от прежнего файла, а не берём
	// из источника. Что именно проигнорировали — обязательно говорим вслух:
	// молча разошедшиеся файл и API незаметны, а объясняться будут годами.
	const keep = (field, fromSource) => {
		if (manual.includes(field) && previous?.[field] !== undefined) {
			kept.push(field);
			return previous[field];
		}
		return fromSource;
	};

	const titleRu = keep('titleRu', result.titleRu);
	const synopsis = keep('synopsis', result.synopsis);
	const poster = keep('poster', result.posterUrl ? `/anime/${slug}.jpg` : undefined);

	// Обложку не качаем вовсе, если её пометили правленой руками: скачивание
	// перезаписывает файлы в public/anime/, и подменённая картинка пропала бы,
	// хотя путь к ней в JSON остался бы прежним.
	if (result.posterUrl && !manual.includes('poster')) {
		await downloadPoster(result.posterUrl, slug);
	}

	// Падежные формы (тз/11, часть A). Считаются здесь же, где заводится тайтл,
	// — так робот sync-anime получает их сразу, без второго прохода. Ручные
	// «Варианты написания» при этом передаются внутрь: форма, уже вписанная
	// человеком, второй раз не предлагается.
	await initMorph();
	const aliasesAuto = computeAliasesAuto({
		titleRu,
		titleOriginal: result.titleOriginal,
		aliases: previous?.aliases ?? [],
	});

	const entry = {
		id: slug,
		source: source.id,
		sourceId: result.sourceId,
		...(titleRu && { titleRu }),
		titleOriginal: result.titleOriginal,
		...(result.year && { year: result.year }),
		...(result.studio && { studio: result.studio }),
		...(poster && { poster }),
		...(synopsis && { synopsis }),
		...(result.url && { url: result.url }),
		// Варианты написания и сам признак ручной правки в источниках не
		// существуют — они живут только у нас, поэтому переносятся из прежнего
		// файла как есть, без всяких условий.
		...(previous?.aliases?.length && { aliases: previous.aliases }),
		// Галочка «только в кавычках» — тоже решение человека, и в источниках
		// её не существует. Не перенеси её здесь — и ближайшее обновление данных
		// тихо сняло бы запрет, поставленный руками: ссылки вернулись бы туда,
		// где заказчик их запретил, а причину искали бы в вёрстке.
		...(previous?.strictQuotes === true && { strictQuotes: true }),
		// А падежные формы, наоборот, считаются заново прямо здесь, из того
		// titleRu, который только что решился строкой выше: русское название
		// могло приехать из источника впервые или измениться, и формы обязаны
		// пойти за ним. Считать их отдельным шагом после записи значило бы
		// переписать файл дважды и завести второе место, где живёт это правило.
		...(aliasesAuto.length && { aliasesAuto }),
		// А альтернативные названия, наоборот, целиком приходят из источника
		// и обновляются вместе с остальными данными: в поиск они не идут,
		// портить ими нечего.
		...(result.sourceAliases?.length && { sourceAliases: result.sourceAliases }),
		...(manual.length && { manual }),
	};

	await mkdir(ANIME_CONTENT_DIR, { recursive: true });
	const outPath = new URL(`${slug}.json`, ANIME_CONTENT_DIR);
	await writeFile(outPath, JSON.stringify(entry, null, '\t') + '\n', 'utf8');

	if (kept.length > 0) {
		console.log(`  правлено руками, данные из ${source.label} для этих полей проигнорированы: ${kept.join(', ')}`);
	}

	// ПОДСКАЗКА ПРО ГАЛОЧКУ «ТОЛЬКО В КАВЫЧКАХ» (тз/11, B.2) — ровно в тот миг,
	// когда тайтл заводится, и ТОЛЬКО подсказкой. Сами не включаем ничего:
	// «Наруто» и «Монстр» формально одинаковы, а по существу нет, и решение
	// это редакторское. Строчка уходит в отчёт робота, то есть в задачу
	// на GitHub и письмо на почту.
	if (titleRu && previous?.strictQuotes !== true) {
		const hint = strictQuotesHint(titleRu);
		if (hint) {
			console.log(
				`  ⚑ «${titleRu}»: ${hint.why.join('; ')}. Стоит подумать о галочке «Линковать только внутри кавычек» ` +
					`в админке, иначе название будет ловиться в любом тексте.`,
			);
		}
	}

	return entry;
}

// ПОВТОР ПРИ СБОЕ СЕТИ ПЕРЕЕХАЛ В `scripts/retry.mjs` 11 августа 2026.
//
// Причина — третий пользователь из другой области: заливка сайта на зеркало.
// Ей ни `sharp`, ни словари морфологии не нужны, а импорт этой библиотеки
// притащил бы и то и другое. Отдаём дальше, чтобы прежние импорты
// (`anime-candidates.mjs`, `anime-candidates-apply.mjs` и их проверки)
// продолжали работать без правок.
export { sleep, похоженаСбойСети, сПовторами } from './retry.mjs';
