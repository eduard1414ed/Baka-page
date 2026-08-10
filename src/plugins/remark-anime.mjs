import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { visit } from 'unist-util-visit';
import { buildAnimeMatcher, findMentions } from '../lib/animeMentions.mjs';

const ANIME_CONTENT_DIR = new URL('../content/anime/', import.meta.url);

// Карточка тайтла читается один раз на сборку: постов 1594, а тайтлов 53,
// и один и тот же файл иначе читался бы с диска сотни раз.
const cache = new Map();

function loadAnimeEntry(id) {
	if (cache.has(id)) return cache.get(id);

	const path = fileURLToPath(new URL(`${id}.json`, ANIME_CONTENT_DIR));
	let entry = null;

	if (existsSync(path)) {
		try {
			entry = { id, data: JSON.parse(readFileSync(path, 'utf8')) };
		} catch {
			entry = null;
		}
	}

	cache.set(id, entry);
	return entry;
}

function autoLinkNode(id, text) {
	return {
		type: 'animeAutoLink',
		data: {
			hName: 'a',
			hProperties: { href: `/anime/${id}`, class: 'anime-mention' },
			hChildren: [{ type: 'text', value: text }],
		},
	};
}

/**
 * `:anime[Текст]{id="frieren" source="shikimori" source-id="9253"}` — метка тайтла
 * в тексте, ставит кнопка «Аниме» в админке (public/admin/index.html). `id` — slug
 * тайтла в справочнике (src/content/anime/), `source`/`source-id` нужны только
 * роботу, который добирает данные тайтла после публикации (scripts/sync-anime.mjs),
 * сам сайт их не читает.
 *
 * Первое упоминание каждого id в посте становится ссылкой на /anime/id,
 * повторные — обычный текст (см. тз/03-тайтлы.md, п. 4).
 *
 * Тайтлы, которые есть в поле `anime` поста (например, проставлены вручную
 * до появления кнопки «Аниме», как в «Знакомьтесь: Ёдзи Такэсигэ»), но нигде
 * не отмечены меткой в тексте, доразмечаются сами: ищем в тексте первое
 * упоминание названия тайтла и превращаем его в такую же ссылку — руками
 * расставлять метки по старым постам не нужно.
 *
 * ПО ЧЕМУ ИЩЕМ — НЕ НАШЕ ДЕЛО, И ЭТО ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА.
 * Список названий и правило совпадения берутся у `src/lib/animeMentions.mjs`,
 * того же кода, которым размечаются расшифровки выпусков. Значит сюда сами
 * собой приходят: оба списка вариантов написания (ручной `aliases` и падежный
 * `aliasesAuto`), кусок названия до двоеточия, нечувствительность к регистру
 * и к «е»/«ё», границы слова и галочка «только в кавычках».
 *
 * ДО ЭТАПА 11, ЧАСТИ B, ЗДЕСЬ ЛЕЖАЛА СВОЯ КОПИЯ ЭТОГО ПРАВИЛА — и она была
 * разъехавшейся: искала только `titleRu` и `titleOriginal`, точным совпадением
 * буква в букву, о вариантах написания не знала вовсе. «в Ходячем замке»
 * в посте ссылкой не становилось, хотя ровно эта форма записана у тайтла
 * в карточке. Заметить копию было нельзя: варианты заполнены у двух тайтлов
 * из 53, и расхождению негде было случиться (СТАТУС.md, хвост 45).
 *
 * ЧТО ОСТАЛОСЬ СВОИМ. Два правила, и оба про пост, а не про названия:
 * ищем только тайтлы, стоящие в поле «Тайтлы поста» (а не весь справочник,
 * как в расшифровках), и размечаем только первое упоминание каждого.
 *
 * `::anime-ref{id="" source="" source-id=""}` — служебная метка без видимого
 * текста, ничего не выводит на странице. Ставит поле «Тайтлы поста» в CMS
 * (public/admin/index.html, preSave), когда через него добавляют тайтл,
 * которого ещё нет в справочнике: сам по себе тайтл в тексте не упомянут
 * (иначе не нужно было бы это поле), но роботу на GitHub Actions
 * (scripts/sync-anime.mjs) нужно откуда-то узнать source/source-id, чтобы
 * его найти — эта метка и есть то место.
 */
export default function remarkAnime() {
	return (tree, file) => {
		const seen = new Set();

		visit(tree, 'textDirective', (node, index, parent) => {
			if (node.name !== 'anime' || !parent || typeof index !== 'number') return;

			const id = node.attributes?.id;
			if (!id) return;

			if (seen.has(id)) {
				// Не первое упоминание — заменяем узел его же содержимым, без ссылки.
				parent.children.splice(index, 1, ...node.children);
				return index;
			}

			seen.add(id);
			node.data = { hName: 'a', hProperties: { href: `/anime/${id}`, class: 'anime-mention' } };
		});

		// Служебная метка (см. описание выше) — ничего не показываем, просто убираем узел.
		visit(tree, 'leafDirective', (node, index, parent) => {
			if (node.name !== 'anime-ref' || !parent || typeof index !== 'number') return;
			parent.children.splice(index, 1);
			return index;
		});

		const frontmatterAnime = file.data?.astro?.frontmatter?.anime;
		if (!Array.isArray(frontmatterAnime)) return;

		const pending = new Set();
		const entries = [];
		for (const id of frontmatterAnime) {
			if (seen.has(id) || pending.has(id)) continue;
			const entry = loadAnimeEntry(id);
			if (!entry) continue;
			pending.add(id);
			entries.push(entry);
		}

		if (pending.size === 0) return;

		let matcher = buildAnimeMatcher(entries);
		if (matcher.length === 0) return;

		// ССЫЛКУ ВНУТРЬ ССЫЛКИ СТАВИТЬ НЕЛЬЗЯ. Название тайтла запросто окажется
		// подписью авторской ссылки («читайте про Атаку титанов»), и обёрнутое
		// нашим `<a>` оно дало бы вложенные ссылки: разметка недопустимая, а на
		// странице у слова пропадает нажатие целиком. До части B случай был
		// почти невозможен (искалось точное совпадение с названием), теперь
		// ищутся ещё и падежные формы, и он стал обычным.
		const insideLink = new Set();
		visit(tree, ['link', 'linkReference'], (node) => {
			visit(node, 'text', (child) => insideLink.add(child));
		});

		visit(tree, 'text', (node, index, parent) => {
			if (!parent || typeof index !== 'number' || pending.size === 0) return;
			if (insideLink.has(node)) return;

			const hit = findMentions(node.value, matcher).find((mention) => pending.has(mention.id));
			if (!hit) return;

			const before = node.value.slice(0, hit.start);
			const after = node.value.slice(hit.end);

			const replacement = [];
			if (before) replacement.push({ type: 'text', value: before });
			replacement.push(autoLinkNode(hit.id, node.value.slice(hit.start, hit.end)));
			if (after) replacement.push({ type: 'text', value: after });

			parent.children.splice(index, 1, ...replacement);
			pending.delete(hit.id);
			matcher = matcher.filter((entry) => entry.id !== hit.id);

			return index;
		});
	};
}
