// Правки расшифровки, сделанные руками в админке (тз/05, шаг 6).
//
// Все они лежат строками в полях самого поста, а файл расшифровки остаётся
// нетронутым — почему именно так, подробно в src/lib/speakerNames.mjs.
// Подстановка происходит при сборке сайта: стёрли строку в посте — вернулось
// как было, повторное распознавание не нужно ни в каком случае.
//
// Собрано в одну функцию нарочно: расшифровку читают и страница выпуска,
// и указатель упоминаний для страниц тайтлов. Считай они по-разному, на одной
// странице тайтл бы упоминался, а на другой нет.

import { applySpeakerNames } from './speakerNames.mjs';
import { applyNameCorrections } from './nameCorrections.mjs';

/**
 * @param {object} transcriptData — данные из src/content/transcripts/<guid>.json
 * @param {object} postData — данные поста (поля `speakers`, `corrections`)
 */
export function applyPostOverrides(transcriptData, postData) {
	return applyNameCorrections(applySpeakerNames(transcriptData, postData?.speakers), postData?.corrections);
}
