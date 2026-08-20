// СПЛОШНАЯ СВЕРКА ФОРМЫ ПРЕВЬЮ ПО ГОТОВОЙ СБОРКЕ.
//
// Спрашивает то же, что и scripts/og-size.test.mjs, но ДРУГИМ ПУТЁМ и о другом:
// тест проверяет ПРАВИЛО (чистую функцию `ogSize`), а этот скрипт — РЕЗУЛЬТАТ,
// то есть файлы, которые сборка положила в dist/og. Разойтись они могут
// запросто: правило останется верным, а рисовальщик перестанет его звать —
// и превью снова поедут полосой, а тест этого не заметит.
//
// Запуск: сначала `npm run build`, потом `node scripts/og-shape.check.mjs`.
// В сборку не вписан намеренно: он читает метаданные у полутора тысяч файлов
// и идёт около минуты, а сборка и без него небыстрая.
//
// Считает три вещи: сошлась ли форма у каждого материала со своей обложкой,
// не осталось ли превью прежней полосой 1200×630 и нет ли битых ссылок.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { socialSource } from '../src/lib/postImage.mjs';
import { ogSize, ogUrlForPost, OG_DEFAULT_WIDTH, OG_DEFAULT_HEIGHT } from '../src/lib/ogImage.mjs';

const корень = new URL('../', import.meta.url);
const путь = (...части) => fileURLToPath(new URL(части.join(''), корень));

if (!existsSync(путь('dist/og'))) {
	console.error('✗ Нет папки dist/og — сначала соберите сайт: npm run build');
	process.exit(1);
}

const POSTS = путь('src/content/posts/');
let сошлось = 0;
let разошлось = 0;
let нетФайла = 0;
const беды = [];

/** Копия для превью лежит в сборке, оригинал — в public. Спрашиваем обе папки. */
function исходникНаДиске(src) {
	const имя = decodeURIComponent(src);
	for (const папка of ['dist', 'public']) {
		const p = путь(папка, имя);
		if (existsSync(p)) return p;
	}
	return null;
}

for (const f of (await readdir(POSTS)).filter((n) => n.endsWith('.md'))) {
	const text = await readFile(POSTS + f, 'utf8');
	const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!m) continue;
	const [, head, body] = m;
	// У черновиков и постов-ссылок страницы нет, значит нет и превью.
	if (/^draft:\s*true/m.test(head) || /^externalUrl:\s*['"]?https?:/m.test(head)) continue;

	const cover = (head.match(/^cover:\s*(.+)$/m)?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '');
	// Обложку выпуска с хостинга подкаста тут не спрашиваем: за ней пришлось бы
	// идти в сеть. Своя копия такой обложки лежит в /episodes и находится сама.
	const src = socialSource({ cover, episodeImageUrl: null, body });
	if (!src || /^https?:/.test(src)) continue;

	const slug = f.replace(/\.md$/, '');
	const ogPath = путь('dist', ogUrlForPost(slug));
	if (!existsSync(ogPath)) {
		нетФайла += 1;
		if (беды.length < 10) беды.push(`${slug}: страница ссылается на превью, а файла нет`);
		continue;
	}

	const исходник = исходникНаДиске(src);
	if (!исходник) continue;

	const и = await sharp(исходник).metadata();
	const ждём = ogSize(и.width, и.height);
	const есть = await sharp(ogPath).metadata();

	if (есть.width === ждём.width && есть.height === ждём.height) сошлось += 1;
	else {
		разошлось += 1;
		if (беды.length < 10) {
			беды.push(`${slug}: обложка ${и.width}×${и.height} → ждали ${ждём.width}×${ждём.height}, получили ${есть.width}×${есть.height}`);
		}
	}
}

// Полоса 1200×630 — подпись прежнего правила. Законна она ровно у одной
// картинки: общей, на которой лежит логотип, а не чья-то обложка.
const все = (await readdir(путь('dist/og'))).filter((n) => n.endsWith('.jpg'));
let полос = 0;
for (const n of все) {
	const m = await sharp(путь('dist/og/', n)).metadata();
	if (m.width === OG_DEFAULT_WIDTH && m.height === OG_DEFAULT_HEIGHT && n !== 'default.jpg') {
		полос += 1;
		if (полос <= 3) беды.push(`${n}: осталось полосой ${OG_DEFAULT_WIDTH}×${OG_DEFAULT_HEIGHT}`);
	}
}

console.log(`Материалов сверено: ${сошлось + разошлось}. Форма сошлась: ${сошлось}, разошлась: ${разошлось}.`);
console.log(`Всего файлов превью: ${все.length}. Осталось полосой: ${полос}. Превью не найдено: ${нетФайла}.`);

if (разошлось + полос + нетФайла > 0) {
	console.error('✗ Есть расхождения:');
	for (const б of беды) console.error('   ' + б);
	process.exit(1);
}

console.log('ок      Каждое превью в форме своей обложки, полос не осталось, битых ссылок нет.');
