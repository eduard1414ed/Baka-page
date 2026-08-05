import { visit } from 'unist-util-visit';
import { getYoutubeEmbedUrl } from '../lib/youtube.mjs';

/**
 * `::video{youtube="..."}` → вставка ролика с YouTube в любом месте текста.
 * Свой видеофайл этот блок пока не поддерживает — 25 МБ на файл на Cloudflare
 * и репозиторий не годятся для видео; загрузку на Hetzner сделаем отдельно
 * на этапе "Выпуски и плеер".
 */
export default function remarkVideo() {
	return (tree) => {
		visit(tree, 'leafDirective', (node) => {
			if (node.name !== 'video') return;

			const embedUrl = node.attributes?.youtube ? getYoutubeEmbedUrl(node.attributes.youtube) : null;
			if (!embedUrl) return;

			node.data = {
				hName: 'div',
				hProperties: { class: 'video-wrap' },
				hChildren: [
					{
						type: 'element',
						tagName: 'iframe',
						properties: {
							src: embedUrl,
							title: 'Видео',
							loading: 'lazy',
							allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
							allowfullscreen: true,
						},
						children: [],
					},
				],
			};
		});
	};
}
