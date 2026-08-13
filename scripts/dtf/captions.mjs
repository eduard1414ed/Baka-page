// Подпись под картинкой: «Название, студия X» или «Название, студии X и Y».
// Формат взят из образца заказчика (obzor-vseh-anime-vesny-162), а не выдуман.
import fs from 'node:fs';

const rows = JSON.parse(fs.readFileSync(new URL('./studios.json', import.meta.url), 'utf8'));
const byName = new Map(rows.map((row) => [row.name, row]));

/**
 * СЛОВО «STUDIO» В НАЧАЛЕ ИМЕНИ УБИРАЕМ — иначе выходит «студия Studio DEEN».
 * Так же поступил заказчик в образце: «студии KAI и HORNETS» при официальных
 * «Studio KAI» и «HORNETS». В конце имени не трогаем: «Geno Studio»
 * и «Bibury Animation Studios» — цельные имена.
 */
export const shortStudio = (name) => name.replace(/^studio\s+/i, '');

/**
 * СПРАВОЧНИК СИЛЬНЕЕ ANILIST, и это не вкус. Поле studio показывается
 * в каталоге сайта и правится заказчиком; разойдись подпись с карточкой —
 * читатель увидел бы у одного тайтла две разные студии на соседних страницах.
 * AniList берётся только там, где карточки нет вовсе.
 *
 * ДАННЫЕ СОБРАНЫ ОДИН РАЗ (studios.json) и в сеть больше не ходят: студия
 * у тайтла не меняется, а лишний поход к чужому сервису — лишний способ
 * упасть. Появится новый пост — соберите заново скриптом studios.mjs.
 */
export function studiosFor(title) {
	const row = byName.get(title);
	if (!row) return [];
	if (row.fromCatalog) return [shortStudio(row.fromCatalog)];
	return (row.fromAnilist ?? []).map(shortStudio);
}

export function captionFor(title) {
	const studios = studiosFor(title);
	if (!studios.length) return title;
	if (studios.length === 1) return `${title}, студия ${studios[0]}`;
	return `${title}, студии ${studios.slice(0, -1).join(', ')} и ${studios[studios.length - 1]}`;
}
