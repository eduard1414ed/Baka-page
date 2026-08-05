import { visit } from 'unist-util-visit';
import { getYoutubeEmbedUrl } from '../lib/youtube.mjs';

/**
 * `::video{youtube="..."}` или `::video{src="..."}` → вставка ролика в любом
 * месте текста. YouTube в приоритете, если заполнены оба поля.
 */
export default function remarkVideo() {
	return (tree) => {
		visit(tree, 'leafDirective', (node) => {
			if (node.name !== 'video') return;

			const attrs = node.attributes ?? {};
			const embedUrl = attrs.youtube ? getYoutubeEmbedUrl(attrs.youtube) : null;

			if (embedUrl) {
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
				return;
			}

			if (attrs.src) {
				node.data = {
					hName: 'video',
					hProperties: { class: 'video', src: attrs.src, controls: true, preload: 'none' },
					hChildren: [],
				};
			}
		});
	};
}
