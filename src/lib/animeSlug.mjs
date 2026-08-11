// АДРЕС ТАЙТЛА В СПРАВОЧНИКЕ (slug) — ОДНО ПРАВИЛО, ОДНО МЕСТО.
//
// Из названия делается имя файла `src/content/anime/<slug>.json` и адрес
// страницы `/anime/<slug>/`. Транслитерация нужна только ради читаемости
// адреса: на поиск, на выбор тайтла и на совпадения она не влияет никак.
//
// ВТОРАЯ КОПИЯ ЕСТЬ, И ОНА НЕИЗБЕЖНА: ровно то же самое написано в
// `public/admin/index.html` (кнопка «Аниме» в редакторе поста). Админка живёт
// вне сборки Astro и импортировать из `src/` не умеет вовсе — там свои
// `CYRILLIC_MAP` и `slugify`. МЕНЯЕТЕ ЗДЕСЬ — ПОПРАВЬТЕ И ТАМ, пометка стоит
// в обоих файлах. Разъедься они — один и тот же тайтл, заведённый кнопкой
// в редакторе и кнопкой на `/admin/tools/`, лёг бы в справочник двумя файлами
// с разными адресами.

const CYRILLIC_MAP = {
	а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
	и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
	с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
	щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugify(text) {
	const transliterated = String(text ?? '')
		.toLowerCase()
		.split('')
		.map((ch) => (ch in CYRILLIC_MAP ? CYRILLIC_MAP[ch] : ch))
		.join('');
	return (
		transliterated
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 60) || 'anime'
	);
}

/**
 * Свободный адрес: если такой уже занят, к нему приписывается номер.
 * Ровно то же делает `buildAnimeSlug` в админке.
 *
 * @param {string} name название, из которого делается адрес (оригинальное)
 * @param {Set<string>} taken адреса, которые уже заняты
 */
export function freeSlug(name, taken) {
	const base = slugify(name);
	let slug = base;
	let suffix = 1;
	while (taken.has(slug)) {
		suffix += 1;
		slug = `${base}-${suffix}`;
	}
	return slug;
}
