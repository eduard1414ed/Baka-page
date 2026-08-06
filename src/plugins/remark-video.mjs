import { visit } from 'unist-util-visit';
import { getYoutubeEmbedUrl } from '../lib/youtube.mjs';

/**
 * `::video{youtube="..."}` → вставка ролика с YouTube в любом месте текста.
 * `::video{video="https://.../file.mp4"}` → прямая ссылка на свой файл
 * (заливается через Cyberduck на Hetzner, см. тз/04-выпуски-и-плеер.md) —
 * обычный <video controls>, без загрузки в репозиторий или Cloudflare
 * (лимит 25 МБ на файл там всё равно не подходит для видео).
 * Если заполнены оба атрибута — побеждает YouTube.
 */
export default function remarkVideo() {
	return (tree) => {
		visit(tree, 'leafDirective', (node) => {
			if (node.name !== 'video') return;

			const embedUrl = node.attributes?.youtube ? getYoutubeEmbedUrl(node.attributes.youtube) : null;

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

			const fileUrl = node.attributes?.video;
			if (!fileUrl) return;

			node.data = {
				hName: 'video',
				hProperties: { class: 'content-video', src: fileUrl, controls: true, preload: 'none' },
				hChildren: [],
			};
		});
	};
}
