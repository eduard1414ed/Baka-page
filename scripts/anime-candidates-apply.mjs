// ПРИМЕНИТЬ РЕШЕНИЯ ПО КАНДИДАТАМ (тз/11, C.5).
//
// Экран на /admin/tools/ ничего не применяет сам: он записывает решения
// в `src/data/animeCandidateDecisions.json`, а исполняет их этот скрипт —
// из воркфлоу `.github/workflows/anime-candidates-apply.yml`, по кнопке
// «Применить решения».
//
// ПОЧЕМУ НЕ ИЗ БРАУЗЕРА. Завести тайтл — это скачать обложку и сжать её
// в два размера: в браузере такого нет. А раз одна из трёх кнопок всё равно
// требует робота, то и остальные две идут через него: иначе правило «как
// применяется решение» жило бы в двух местах сразу — в странице и в скрипте, —
// и разъехалось бы молча.
//
//   node scripts/anime-candidates-apply.mjs --dry   — только сказать, что сделает
//   node scripts/anime-candidates-apply.mjs         — применить
//
// ЧТО ДЕЛАЕТ КАЖДОЕ РЕШЕНИЕ:
//
//   create — тайтл заводится СУЩЕСТВУЮЩИМ механизмом (`writeAnimeEntry`),
//            тем же, которым его заводит робот добора: данные точно по номеру
//            Shikimori, без поиска по названию, обложка в двух размерах,
//            падежные формы считаются сразу.
//   alias  — фраза дописывается в «Варианты написания» существующего тайтла.
//   stop   — фразы уходят в стоп-лист и больше не предлагаются никогда.
//
// ПОВТОРНЫЙ ЗАПУСК БЕЗОПАСЕН. Применённое помечается прямо в файле решений
// и второй раз не исполняется; а то, что не вышло (сеть подвела), остаётся
// непомеченным и будет доделано следующим нажатием. Это то же правило, что
// у очереди телеграма: подтверждаем ТОЛЬКО ПОСЛЕ ЗАПИСИ.

import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import * as shikimori from './anime-sources/shikimori.mjs';
import * as anilist from './anime-sources/anilist.mjs';
import {
	writeAnimeEntry,
	borrowPoster,
	sleep,
	ANIME_CONTENT_DIR,
	SHIKIMORI_PAUSE_MS,
} from './anime-lib.mjs';
import { DECISIONS_PATH, STOPLIST_PATH, phraseKey, readDecisions, readStoplist } from './anime-candidates-lib.mjs';

const SOURCES = [shikimori, anilist];
const SOURCES_BY_ID = { shikimori, anilist };

const has = (name) => process.argv.includes(`--${name}`);

async function fileExists(url) {
	try {
		await access(url);
		return true;
	} catch {
		return false;
	}
}

/** Стоп-лист: дописать фразы, которых там ещё нет. */
async function addToStoplist(phrases) {
	const current = await readStoplist();
	const added = [];

	for (const phrase of phrases) {
		const key = phraseKey(phrase);
		if (current.keys.has(key)) continue;
		current.keys.add(key);
		current.phrases.push(phrase);
		added.push(phrase);
	}

	if (added.length > 0) {
		await writeFile(STOPLIST_PATH, JSON.stringify(current.phrases, null, '\t') + '\n', 'utf8');
	}
	return added;
}

/**
 * Вариант написания: дописать фразу в `aliases` существующего тайтла.
 *
 * Пишем ровно в `aliases`, а не в `aliasesAuto`: это решение человека,
 * и пересчёт морфологии не имеет права его стереть (тз/11, A.1).
 */
async function addAlias(animeId, phrases) {
	const path = new URL(`${animeId}.json`, ANIME_CONTENT_DIR);
	let entry;
	try {
		entry = JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`тайтла «${animeId}» в справочнике нет (${error.code ?? error.message})`);
	}

	const aliases = Array.isArray(entry.aliases) ? [...entry.aliases] : [];
	const seen = new Set(aliases.map(phraseKey));
	const added = [];

	for (const phrase of phrases) {
		const key = phraseKey(phrase);
		if (seen.has(key)) continue;
		seen.add(key);
		aliases.push(phrase);
		added.push(phrase);
	}

	if (added.length === 0) return [];

	entry.aliases = aliases;
	// Отступ табуляцией и перевод строки в конце — как пишет `writeAnimeEntry`.
	await writeFile(path, JSON.stringify(entry, null, '\t') + '\n', 'utf8');
	return added;
}

/** Завести тайтл — тем же механизмом, которым его заводит робот добора. */
async function createAnime({ slug, sourceId, source = 'shikimori' }) {
	if (await fileExists(new URL(`${slug}.json`, ANIME_CONTENT_DIR))) {
		return { skipped: true, why: 'такой тайтл в справочнике уже есть' };
	}

	const sourceModule = SOURCES_BY_ID[source];
	if (!sourceModule) throw new Error(`неизвестный источник «${source}»`);

	const result = await sourceModule.findById(sourceId);
	if (!result) throw new Error(`тайтла с номером ${sourceId} в ${sourceModule.label} нет (мог быть удалён)`);

	// Обложки у источника нет — спрашиваем остальные по оригинальному названию,
	// со сверкой имени. Остальные данные остаются от своего источника.
	if (!result.posterUrl) {
		result.posterUrl = await borrowPoster(result, SOURCES, sourceModule.id);
	}

	const entry = await writeAnimeEntry(slug, sourceModule, result);
	return { skipped: false, entry };
}

export async function main() {
	const dry = has('dry');
	const decisions = await readDecisions();
	const pending = decisions.filter((item) => !item.applied);

	console.log(`Решений в файле: ${decisions.length}, из них ждут применения: ${pending.length}.`);
	if (pending.length === 0) {
		console.log('Применять нечего.');
		return { applied: 0, failed: 0, created: [] };
	}

	// Сначала сказать, что будет сделано, — и только потом делать. Устройство
	// как у всех прогонов проекта, и заодно это единственное, что видно
	// в письме, если робот упадёт на середине.
	for (const item of pending) {
		if (item.what === 'create') console.log(`  завести: ${item.title ?? item.slug} → /anime/${item.slug}/ (Shikimori ${item.sourceId})`);
		else if (item.what === 'alias') console.log(`  вариант написания: ${(item.phrases ?? []).map((p) => `«${p}»`).join(' ')} → ${item.animeId}`);
		else if (item.what === 'stop') console.log(`  не аниме: ${(item.phrases ?? []).map((p) => `«${p}»`).join(' ')}`);
		else console.log(`  ⚑ непонятное решение «${item.what}» — пропускаю`);
	}

	if (dry) {
		console.log('\nКлюч --dry: ничего не сделано.');
		return { applied: 0, failed: 0, created: [] };
	}

	let applied = 0;
	let failed = 0;
	const created = [];
	let wentToNetwork = false;

	for (const item of pending) {
		try {
			if (item.what === 'stop') {
				const added = await addToStoplist(item.phrases ?? []);
				item.result = added.length > 0 ? `в стоп-лист: ${added.join(', ')}` : 'уже было в стоп-листе';
			} else if (item.what === 'alias') {
				if (!item.animeId) throw new Error('не сказано, какому тайтлу вписывать вариант');
				const added = await addAlias(item.animeId, item.phrases ?? []);
				item.result = added.length > 0 ? `вписано в «${item.animeId}»: ${added.join(', ')}` : 'уже было вписано';
			} else if (item.what === 'create') {
				if (!item.slug || !item.sourceId) throw new Error('не сказано, что заводить');
				// Полторы секунды между походами к чужому источнику — условие,
				// на котором мы им пользуемся (одно число на проект, хвост 56).
				if (wentToNetwork) await sleep(SHIKIMORI_PAUSE_MS);
				wentToNetwork = true;
				const done = await createAnime(item);
				item.result = done.skipped ? done.why : `заведён: src/content/anime/${item.slug}.json`;
				if (!done.skipped) created.push({ slug: item.slug, title: done.entry.titleRu ?? done.entry.titleOriginal });
			} else {
				throw new Error(`непонятное решение «${item.what}»`);
			}

			// ПОМЕТКА СТАВИТСЯ ПОСЛЕДНИМ ДЕЙСТВИЕМ, после самой работы. Свались
			// робот между записью тайтла и пометкой — решение просто исполнится
			// ещё раз, и заведение это переживёт (файл уже на месте, шаг
			// пропустится). А пометь мы заранее — не вышедшее считалось бы
			// сделанным, и узнать об этом было бы неоткуда.
			item.applied = new Date().toISOString();
			delete item.error;
			applied++;
			console.log(`✓ ${item.result}`);
		} catch (error) {
			// НЕ ПОМЕЧАЕМ. Решение останется ждать и будет доделано следующим
			// нажатием — а на экране заказчик увидит, почему не вышло.
			item.error = String(error.message ?? error);
			failed++;
			console.log(`✗ ${item.what} ${item.slug ?? item.animeId ?? ''}: ${item.error}`);
		}
	}

	await writeFile(DECISIONS_PATH, JSON.stringify(decisions, null, '\t') + '\n', 'utf8');

	console.log(`\nПрименено: ${applied}. Не вышло: ${failed}.`);
	if (created.length > 0) {
		console.log(`Заведено тайтлов: ${created.length} — ${created.map((c) => c.title).join(', ')}.`);
		console.log('КАЖДЫЙ НОВЫЙ ТАЙТЛ ЛИНКУЕТСЯ ПО ВСЕМУ АРХИВУ. Посмотрите, не рябит ли, прежде чем заводить следующую порцию.');
	}
	if (failed > 0) {
		// Роняем громко: «применено 0, не вышло 12» в тихом прогоне выглядит
		// точно так же, как удачный, — а решения при этом остались невыполненными.
		throw new Error(`${failed} решений не применилось — смотрите строки со знаком ✗ выше.`);
	}

	return { applied, failed, created };
}

// Русские буквы в пути к проекту: import.meta.url кодирует их, а process.argv[1]
// нет, и строчное сравнение не совпало бы НИКОГДА (CLAUDE.md, «Уроки проекта»).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	await main();
}
