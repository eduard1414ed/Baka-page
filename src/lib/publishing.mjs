// Пост виден на сайте, если это не черновик и время публикации (если задано)
// уже наступило. `date` и `publishAt` — разные оси (см. тз/09-отложенный-постинг.md):
// `date` только для отображения и сортировки, `publishAt` только для видимости.
// Используется везде, где раньше была проверка `!data.draft` — сборка сайта,
// лента, категории, страница поста.
export function isPublished({ draft, publishAt }, now = new Date()) {
	if (draft) return false;
	if (publishAt && publishAt.getTime() > now.getTime()) return false;
	return true;
}
