// Заслон: сборщик не имеет права молча переписать пост, который правил человек.
//
// ЗАЧЕМ. Сборщики пересобирают ТЕЛО поста из первоисточника — шапку и метки
// они бережно берут из живого файла, а тело сочиняют заново. Пока пост никто
// не трогал, это безобидно: пересборка отдаёт те же байты. Но 13 августа
// заказчик открыл «Долой безделье!», подписал десять кадров, добавил
// одиннадцатый и опубликовал пост. Следующий запуск сборщика стёр бы всё это
// молча и выглядел бы обычной удачной пересборкой.
//
// Те же грабли уже стоили проекту работы: «СБОРЩИК, ПЕРЕПИСЫВАЮЩИЙ ФАЙЛ
// ЦЕЛИКОМ, ОБЯЗАН БРАТЬ У ЖИВОГО ФАЙЛА ТО, ЧТО ПРАВИТ ЧЕЛОВЕК» (CLAUDE.md).
// Тогда правило применили к ШАПКЕ. Тело осталось незащищённым — и ждало
// своего дня ровно до первой правки картинок.
//
// ПРИЗНАК ПРЯМОЙ: тело живого файла не совпало с тем, что сборщик только что
// собрал. Не дата, не число картинок, не «есть ли подписи» — сравнение
// байт в байт с тем, что мы сами и производим.
import fs from 'node:fs';

export const bodyOf = (raw) => raw.split(/^---$/m).slice(2).join('---');

/**
 * Правил ли пост человек после переноса.
 *
 * @param {string} file путь к посту
 * @param {string} built что сборщик собрал на этот раз
 * @returns {null | {lines: number, images: number, captions: number}} null — не трогали
 */
export function handEdited(file, built) {
	if (!fs.existsSync(file)) return null;
	const live = bodyOf(fs.readFileSync(file, 'utf8'));
	const fresh = bodyOf(built);
	// Пустые строки не считаем правкой: админка расставляет их по-своему,
	// и на этом заслон срабатывал бы после каждого сохранения впустую.
	const squeeze = (text) => text.split('\n').map((l) => l.trimEnd()).filter(Boolean).join('\n');
	if (squeeze(live) === squeeze(fresh)) return null;

	const count = (text, re) => (text.match(re) || []).length;
	return {
		lines: squeeze(live).split('\n').length - squeeze(fresh).split('\n').length,
		images: count(live, /^::image/gm) - count(fresh, /^::image/gm),
		captions: count(live, /caption="/g) - count(fresh, /caption="/g),
	};
}

/**
 * Записать пост — или отказаться, если его правил человек.
 *
 * ОТКАЗ ГРОМКИЙ, А НЕ ТИХИЙ. Молча ничего не сделать хуже, чем стереть:
 * стёртое видно в `git diff`, а несделанное не видно нигде.
 */
export function writeGuarded(file, built, { force = false } = {}) {
	const edited = handEdited(file, built);
	if (edited && !force) {
		const what = [
			edited.images ? `картинок ${edited.images > 0 ? '+' : ''}${edited.images}` : null,
			edited.captions ? `подписей ${edited.captions > 0 ? '+' : ''}${edited.captions}` : null,
			`строк ${edited.lines > 0 ? '+' : ''}${edited.lines}`,
		].filter(Boolean).join(', ');
		throw new Error(
			`пост правили руками после переноса (${what}) — пересборка стёрла бы эту правку.\n`
			+ `   Посмотрите «git diff», и если правку не жалко — запустите с ключом --force.`,
		);
	}
	fs.writeFileSync(file, built);
	return { forced: Boolean(edited) };
}
