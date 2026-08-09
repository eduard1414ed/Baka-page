import { visit, SKIP } from 'unist-util-visit';
import { resolveEpisodeCover, getEpisodeCoverSrcs } from '../lib/episodeCover.mjs';

// Категории, у которых обложка выпуска стоит в ШАПКЕ страницы квадратом 1:1
// (§13 дизайн-системы, часть 5 переноса). У них картинка из текста убирается
// целиком: робот сверки вставляет её первой строкой каждого выпуска, и после
// переверстки она оказалась бы на странице дважды подряд — крупная в шапке
// и она же на всю колонку ниже.
//
// Тела постов при этом НЕ ПРАВИМ (их 141): строка остаётся в файле, её видно
// в админке, и если однажды шапка перестанет показывать обложку, картинка
// вернётся в текст сама.
const CATEGORIES_WITH_COVER_IN_HERO = ['podcast', 'bonus'];

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
	return (tree, file) => {
		const category = file?.data?.astro?.frontmatter?.category;

		if (CATEGORIES_WITH_COVER_IN_HERO.includes(category)) {
			// Убираем не саму картинку, а абзац целиком: в файле она лежит
			// отдельной строкой, и от абзаца остался бы пустой <p> с отступом.
			visit(tree, 'paragraph', (node, index, parent) => {
				const onlyChild = node.children.length === 1 ? node.children[0] : null;
				if (!onlyChild || onlyChild.type !== 'image') return;
				if (getEpisodeCoverSrcs(onlyChild.url).length === 0) return;

				parent.children.splice(index, 1);
				// Индекс не сдвигаем: на его место встал следующий элемент.
				return [SKIP, index];
			});
			return;
		}

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
