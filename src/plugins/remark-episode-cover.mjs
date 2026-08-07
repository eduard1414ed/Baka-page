import { visit } from 'unist-util-visit';
import { resolveEpisodeCover, getEpisodeCoverSrcs } from '../lib/episodeCover.mjs';

// Обложка выпуска в теле поста — обычная markdown-картинка
// `![Обложка выпуска](https://cdn.mave.digital/...)`, её вставляет робот сверки
// (scripts/sync-episodes.mjs). Здесь она подменяется на сжатую копию из
// public/episodes/ с srcset на два размера, чтобы телефон качал 27 КБ, а не 1 МБ.
//
// Тела постов при этом НЕ правим: в файле остаётся исходная ссылка на хостинг
// подкаста. Так работает и для 142 уже написанных черновиков, и для новых —
// подмена происходит при сборке, а в админке видна обычная понятная ссылка.
//
// Если обложка ещё не скачана (новый выпуск появился в RSS, а робот пока не
// добежал), resolveEpisodeCover вернёт исходный адрес — картинка будет тяжёлой,
// но не битой.
export default function remarkEpisodeCover() {
	return (tree) => {
		visit(tree, 'image', (node) => {
			const variants = getEpisodeCoverSrcs(node.url);
			// Не с хостинга подкаста — не наша картинка, не трогаем.
			if (variants.length === 0) return;

			const { src, srcset } = resolveEpisodeCover(node.url);

			node.data = {
				hName: 'img',
				hProperties: {
					src,
					...(srcset && { srcset, sizes: '(max-width: 700px) 100vw, 700px' }),
					alt: node.alt ?? '',
					loading: 'lazy',
					// Квадрат 2000×2000 у хостинга подкаста всегда — размеры в разметке
					// не дают странице дёргаться, пока картинка грузится.
					width: 700,
					height: 700,
				},
			};
		});
	};
}
