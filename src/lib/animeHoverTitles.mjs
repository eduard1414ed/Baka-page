// Данные всплывающей марки тайтла (src/components/AnimeHoverCard.astro)
// для тайтлов, на которые со страницы есть ссылки.
//
// ОДНО ПРАВИЛО НА ДВЕ СТРАНИЦЫ: страницу материала и страницу результата
// теста (сессия «Тесты-5а»). До неё жило внутри posts/[slug].astro; вынесено
// дословно, чтобы марка над одной и той же ссылкой не разошлась видом.
import { getAnimePosterSrcs } from './animePoster.mjs';
import { plural } from './plural.mjs';
import { stampVar } from './animeStamp.mjs';

/**
 * @param {Array<{ id: string, data: Record<string, any> }>} entries тайтлы из справочника
 * @param {Map<string, { code?: string | null, count?: number }>} catalogById каталог (buildCatalog) по адресу тайтла
 */
export function hoverTitles(entries, catalogById) {
	return entries.map((entry) => {
		const item = catalogById.get(entry.id);
		const posters = getAnimePosterSrcs(entry.data.poster);
		const count = item?.count ?? 0;

		return {
			id: entry.id,
			href: `/anime/${entry.id}/`,
			code: item?.code ?? null,
			title: entry.data.titleRu || entry.data.titleOriginal,
			// Две строки, как в блоке каталога на главной: одной строкой перенос рвал
			// её по любому пробелу, и число отрывалось от своего слова.
			meta: [
				[entry.data.year, entry.data.studio].filter(Boolean).join(' · '),
				count > 0 ? `${count} ${plural(count, ['упоминание', 'упоминания', 'упоминаний'])}` : '',
			],
			// Постер 320w: колонка в марке 120 px, этого хватает и на плотный экран.
			poster: posters.length > 0 ? posters[0].src : null,
			stamp: stampVar(entry.id),
		};
	});
}
