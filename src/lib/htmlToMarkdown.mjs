// Переводит простое HTML-описание выпуска из RSS (src/lib/podcastFeed.mjs)
// в markdown для тела поста — сохраняя абзацы, жирный/курсив, списки и ссылки.
// Не универсальный HTML-парсер: только теги, которые реально встречаются
// в описаниях подкаста (p, br, a, b, i, ul, li) — для остального не нужен.
// Незнакомый тег просто вырезается, не ломая сборку.

export function htmlToMarkdown(html) {
	if (!html) return '';

	let text = html;

	text = text.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_match, href, inner) => {
		const label = inner.trim();
		return label ? `[${label}](${href})` : href;
	});

	text = text.replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/g, '**$1**');
	text = text.replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/g, '*$1*');

	text = text.replace(/<li>([\s\S]*?)<\/li>/g, (_match, inner) => `- ${inner.trim()}\n`);
	text = text.replace(/<\/?ul>/g, '\n');

	text = text.replace(/<br\s*\/?>/g, '\n');
	text = text.replace(/<\/?p>/g, '\n\n');

	// Что не распознали (незнакомый тег) — просто убираем, не выводя сырой HTML.
	text = text.replace(/<[^>]+>/g, '');

	return text
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
