// ПЕРЕЛИНКОВКА — ЧТЕНИЕ СЛОВАРЯ `статус/перелинковка/словарь.md` (сессия 1в).
//
// Одно место на все скрипты: коды меток, известные люди и пометка «широкая».
// Раньше жило внутри cards-check.mjs, но тот при подключении запускает свою
// проверку, и поиску пар (themes.mjs) взять его было нельзя.
//
// Формат словаря, на который опирается разбор:
//   **Название** (`код`)            — строка-заголовок темы или повода;
//   Широкая: да | нет | —            — следующая строка; «—» значит «не решено»,
//                                      такая тема считается узкой;
//   **Люди, найденные в выборке** … ## 4.   — списки людей.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const DICTIONARY_FILE = join(REPO, 'статус/перелинковка/словарь.md');

export function parseDictionary(text) {
	const codes = new Set();
	const broad = new Set();
	const occasions = new Set(); // метки раздела «2. Поводы»
	let inOccasions = false;
	const undecided = new Set();
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (/^## /u.test(lines[i])) inOccasions = /Поводы/u.test(lines[i]);
		const m = lines[i].match(/^\*\*[^*\n]+\*\* \(`([^`]+)`\)/u);
		if (!m) continue;
		codes.add(m[1]);
		if (inOccasions) occasions.add(m[1]);
		const w = (lines[i + 1] ?? '').match(/^Широкая:\s*(\S+)/u);
		if (!w) throw new Error(`словарь: у метки «${m[1]}» нет строки «Широкая:» сразу под заголовком`);
		if (/^да/iu.test(w[1])) broad.add(m[1]);
		else if (!/^нет/iu.test(w[1])) undecided.add(m[1]);
	}
	const peopleBlock = text.slice(text.indexOf('**Люди, найденные в выборке**'), text.indexOf('## 4.'));
	// Строки «- мангаки: А, Б,» и продолжения «  В, Г;».
	const names = [];
	for (const line of peopleBlock.split('\n')) {
		if (/^- [^:]+:/u.test(line)) names.push(...line.slice(line.indexOf(':') + 1).split(','));
		else if (/^ {2}\S/u.test(line)) names.push(...line.split(','));
	}
	const people = new Set(names.map((s) => s.replace(/\*\*|\(.*?\)|[;.]/gu, '').trim()).filter(Boolean));
	return { codes, broad, undecided, people, occasions };
}

export async function readDictionary(file = DICTIONARY_FILE) {
	return parseDictionary(await readFile(file, 'utf8'));
}

/**
 * Сжатый словарь для помощника-разметчика: у каждой метки код, название
 * и определение БЕЗ примеров постов (слепой прогон 1б показал, что примеры
 * не нужны и завышают совпадение). Собирается из словаря при каждой нарезке
 * пачек, поэтому второй копии определений, которая разъедется, нет.
 * Плюс известные люди — для канонического написания.
 */
export function compactDictionary(text) {
	const out = [];
	const lines = text.split('\n');
	let section = '';
	for (let i = 0; i < lines.length; i++) {
		if (/^## /u.test(lines[i]) && /Темы|Поводы/u.test(lines[i])) out.push('', lines[i].replace(/^## \d+\.\s*/u, '### '));
		if (/^### /u.test(lines[i]) && lines[i] !== section && out.length) {
			section = lines[i];
			if (!/Спорные/u.test(lines[i])) out.push(`(${lines[i].replace(/^### /u, '')})`);
		}
		const m = lines[i].match(/^\*\*([^*\n]+)\*\* \(`([^`]+)`\)/u);
		if (!m) continue;
		const body = [];
		for (let j = i + 2; j < lines.length && lines[j].trim() && !/^\*\*/u.test(lines[j]); j++) {
			if (/^(Примеры|Широкая:)/u.test(lines[j])) break;
			body.push(lines[j].trim());
		}
		// «Решение Эда …», «Добавлена в 1в» — история, разметчику не нужна.
		// Вычищается то, что разметчику не нужно: история решений, правила
		// поиска пар (рубрики, «цель находит скрипт») и примеры посреди строки.
		const def = body
			.join(' ')
			.replace(/\s*Примеры:.*$/u, '')
			.replace(/\s*(Решение Эда[^.]*\.|Добавлена в 1в\.|Отдельно от[^.]*\.|Рубрики — .*?\(решение Эда 1в\)\.|\*\*Сильнейший сигнал[^.]*\.|;? ?цель находит скрипт[^.]*\.)/gu, '')
			.replace(/\s+/gu, ' ')
			.trim();
		out.push(`- \`${m[2]}\` — ${m[1]}.${def ? ' ' + def : ''}`);
	}
	const { people } = parseDictionary(text);
	out.push('', '### Известные люди (писать ровно так)', [...people].join(', ') + '.');
	return out.join('\n').trim();
}
