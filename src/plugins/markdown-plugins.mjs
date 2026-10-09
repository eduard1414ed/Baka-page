// СПИСОК ПЛАГИНОВ РАЗМЕТКИ — ОДИН НА ВЕСЬ САЙТ (сессия «Тесты-3», 9 октября 2026).
//
// Жил внутри astro.config.mjs и вынесен сюда ДОСЛОВНО, порядок и комментарии
// те же. Причина одна: читать его теперь двое. Сборка постов (через
// astro.config.mjs) и страница теста — пояснения к вопросам и тексты
// результатов лежат в шапке файла строками, а не телом поста, и размечаются
// отдельно (src/lib/markdownString.mjs). Вторая копия списка разошлась бы
// с первой молча: врезка `::material` или ссылка на тайтл в пояснении
// выглядели бы не так, как в статье, и никто бы этого не заметил.
//
// ПОРЯДОК ВАЖЕН — объяснения у каждого пункта ниже.
import remarkDirective from 'remark-directive';
import remarkColonText from './remark-colon-text.mjs';
import remarkImageFigure from './remark-image-figure.mjs';
import remarkEpisodeCover from './remark-episode-cover.mjs';
import remarkLeadCover from './remark-lead-cover.mjs';
import remarkAdLabel from './remark-ad-label.mjs';
import remarkSpoiler from './remark-spoiler.mjs';
import remarkVideo from './remark-video.mjs';
import remarkLinkList from './remark-link-list.mjs';
import remarkBlockLabel from './remark-block-label.mjs';
import remarkPostRef from './remark-post-ref.mjs';
import remarkAnime from './remark-anime.mjs';
import remarkTimecode from './remark-timecode.mjs';

// Порядок важен: спойлер должен видеть уже сгруппированные картинки/галереи.
export const remarkPlugins = [
	remarkDirective,
	// Двоеточие перед словом («Re:Zero», «Erid:2Vtz…», «в 20:00») разбор
	// считает меткой и слово после него теряет. Возвращаем такие места
	// в текст ДО всех остальных плагинов — они должны видеть текст целым.
	remarkColonText,
	// Обычная markdown-картинка с хостинга подкаста → сжатая копия
	// из public/episodes/. Он же убирает из текста картинку, которая
	// уже показана в шапке выпуска или бонуса.
	//
	// ИДЁТ ДО remarkImageFigure, И ЭТО ОБЯЗАТЕЛЬНО: тот превращает блок
	// `::image` в готовую вёрстку с подписью и номером, и после него
	// узла-директивы, который надо убрать, в дереве уже нет. Раньше
	// плагин стоял после — тогда он умел убирать только markdown-картинку
	// с хостинга подкаста, а её remarkImageFigure и не трогает.
	remarkEpisodeCover,
	// Обложка поста в начало текста, если картинок в тексте нет ни одной.
	// СТРОГО ЗДЕСЬ: после remarkEpisodeCover — иначе обложка выпуска,
	// которую тот вот-вот уберёт из тела, посчиталась бы картинкой
	// в тексте; до remarkAdLabel и remarkImageFigure — чтобы маркировка
	// рекламы встала под наш кадр, а сам кадр разобрал тот же код,
	// что и обычные иллюстрации. Зачем это нужно — в шапке плагина.
	remarkLeadCover,
	// Маркировка рекламы из поля поста. МЕЖДУ ЭТИМИ ДВУМЯ И НИГДЕ БОЛЬШЕ:
	// после remarkEpisodeCover — чтобы не встать под обложку выпуска,
	// которую тот только что убрал из тела; до remarkImageFigure —
	// чтобы `::image` и `::video` были ещё директивами и медиа можно было
	// отличить от текста. Зачем это нужно — в шапке самого плагина.
	remarkAdLabel,
	remarkImageFigure,
	remarkVideo,
	// Собирает подряд идущие `::link` в одну врезку — до спойлера,
	// чтобы внутри спрятанного блока врезка была уже одним узлом,
	// а не россыпью отдельных маркеров.
	remarkLinkList,
	// Подпись блока внутри текста — тоже до спойлера, чтобы спрятанный
	// блок уносил её вместе с собой одним куском.
	remarkBlockLabel,
	// Врезка на другой материал сайта. СТРОГО ЗДЕСЬ:
	//   после remarkBlockLabel — врезка сама рисует свою подпись
	//     `[ ещё по теме ]`, и чужая подпись, поставленная автором
	//     отдельным блоком, к этому моменту уже разобрана;
	//   до remarkAnime — иначе название тайтла внутри заголовка врезки
	//     стало бы ссылкой на тайтл ВНУТРИ ссылки на материал, а вложенных
	//     ссылок не бывает: у слова пропало бы нажатие целиком;
	//   до remarkSpoiler — чтобы спрятанный блок уносил врезку с собой
	//     одним куском, как уже уносит галерею и список ссылок.
	remarkPostRef,
	remarkAnime,
	remarkTimecode,
	remarkSpoiler,
];
