// КАК ПРОЧИТАТЬ ПОСТ ГОЛЫМ ТЕКСТОМ — ОДНО МЕСТО НА ВСЕ РАЗОВЫЕ ПРОГОНЫ.
//
// Пользуются двое: разведка по кавычкам (scripts/anime-quotes.mjs, этап 11,
// часть B) и сбор кандидатов в тайтлы (scripts/anime-candidates.mjs, часть C).
// Обоим нужно одно и то же — тело поста без разметки и пара полей шапки, —
// и разъехаться им нельзя: они меряют один архив и отвечают заказчику числами,
// которые он сравнивает между собой.
//
// ШАПКУ РАЗБИРАЕМ ТЕМ ЖЕ js-yaml, КОТОРЫМ ЕЁ ЧИТАЕТ СБОРКА, а не строчными
// догадками: `anime` и `draft` решают в этих отчётах всё, и промахнуться в них
// значит назвать заказчику числа не про его сайт.
//
// ТЕЛО СНИМАЕМ `toPlainText` — тем же кодом, которым его снимает сайт для
// описаний и превью: иначе счёт пошёл бы по адресам ссылок и атрибутам меток,
// которых читатель не видит.

import { readdir, readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { toPlainText } from '../src/lib/plainText.mjs';

export const POSTS_DIR = new URL('../src/content/posts/', import.meta.url);
export const TRANSCRIPTS_DIR = new URL('../src/content/transcripts/', import.meta.url);

/**
 * Все посты репозитория, включая черновики.
 * @returns {Promise<{ id: string, draft: boolean, guid: string|null, tagged: Set<string>, title: string, text: string }[]>}
 */
export async function readPostsPlain() {
	const files = (await readdir(POSTS_DIR)).filter((name) => name.endsWith('.md'));
	const out = [];

	for (const file of files) {
		const raw = await readFile(new URL(file, POSTS_DIR), 'utf8');
		let front = {};
		let body = raw;

		if (raw.startsWith('---')) {
			const end = raw.indexOf('\n---', 3);
			if (end > 0) {
				try {
					front = yaml.load(raw.slice(4, end)) ?? {};
				} catch {
					front = {};
				}
				body = raw.slice(end + 4);
			}
		}

		out.push({
			id: file.replace(/\.md$/, ''),
			draft: front.draft === true,
			// Номер выпуска в ленте подкаста. Нужен там, где надо сказать,
			// сколько прибавки видно НА САЙТЕ: расшифровка называется по нему,
			// а опубликован или нет — знает пост.
			guid: front.audioGuid ? String(front.audioGuid) : null,
			tagged: new Set(Array.isArray(front.anime) ? front.anime : []),
			title: String(front.title ?? file),
			text: toPlainText(body),
		});
	}

	return out;
}

/**
 * Все расшифровки репозитория. Файл называется по guid выпуска.
 *
 * Живёт тут по той же причине, что и чтение постов: пользуются двое —
 * разведка по кавычкам (часть B) и сбор кандидатов (часть C), — и оба меряют
 * ОДИН архив, отвечая заказчику числами, которые он сравнивает между собой.
 *
 * @returns {Promise<{ id: string, replicas: { text: string }[] }[]>}
 */
export async function readTranscriptsPlain() {
	const files = (await readdir(TRANSCRIPTS_DIR)).filter((name) => name.endsWith('.json'));
	const out = [];

	for (const file of files) {
		const data = JSON.parse(await readFile(new URL(file, TRANSCRIPTS_DIR), 'utf8'));
		out.push({ id: file.replace(/\.json$/, ''), replicas: data.replicas ?? [] });
	}

	return out;
}
