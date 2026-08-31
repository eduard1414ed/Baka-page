// РОЛИК НА СТРАНИЦЕ ВЫПУСКА ОБЯЗАН ИМЕТЬ СВОЙ ОБЪЕКТ РАЗМЕТКИ
// (TASK-markup, пункт 1.2).
//
// ЗАЧЕМ ЭТА ПРОВЕРКА ВООБЩЕ ЕСТЬ. «Как выглядит вставка ролика» знают ДВА
// куска кода, и разными путями:
//
//   src/plugins/remark-video.mjs — работает на разобранном дереве разметки
//                                  и рисует на странице <iframe>;
//   src/lib/youtube.mjs          — читает исходный markdown глазами строки
//                                  и отдаёт список адресов для разметки.
//
// Копии свести в одну нельзя: странице разобранное дерево недоступно, плагину
// исходный текст — уже не нужен. Значит они могут разъехаться, и разъедутся
// молча: на странице ролик будет, в разметке его не будет, и не заметит никто.
// Пометка «меняете тут — поправьте и там» в этом проекте не удержала ни одной
// копии, поэтому копии сверяет замер по СОБРАННЫМ страницам.
//
//   node scripts/video-schema.test.mjs             — проверить
//   node scripts/video-schema.test.mjs --selftest  — развести одну копию
//                                                    и убедиться, что красная
//
// ПОДЛОГ РАЗВОДИТ РОВНО ОДНУ СТРАНИЦУ, а не отменяет правило целиком: в жизни
// копии расходятся именно так — у одного ролика объект пропал, у другого
// появился лишний. Подлог, снимающий разметку со всех страниц сразу, проверял
// бы не то.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const selftest = process.argv.includes('--selftest');

const DIST = fileURLToPath(new URL('../dist/posts/', import.meta.url));

if (!existsSync(DIST)) {
	console.error('✗ Нет собранной папки dist/posts — сначала `npm run build`.');
	process.exit(1);
}

const LD_RE = /<script type="application\/ld\+json">(.*?)<\/script>/gs;
const IFRAME_SRC_RE = /<iframe[^>]*\bsrc="(https:\/\/www\.youtube\.com\/embed\/[^"]*)"/g;

/** Что на странице: адреса роликов в разметке и адреса роликов в вёрстке. */
function разобрать(html) {
	const объекты = [];
	let выпуск = false;

	for (const [, json] of html.matchAll(LD_RE)) {
		let data;
		try {
			data = JSON.parse(json);
		} catch {
			continue;
		}
		if (data['@type'] === 'PodcastEpisode') выпуск = true;
		if (data['@type'] === 'VideoObject' && data.embedUrl) объекты.push(data.embedUrl);
	}

	// Только те окошки, что стоят в тексте материала: закреплённый плеер
	// и прочая обвязка страницы роликов не содержит, но искать надо всё равно
	// по вёрстке, а не по нашему же списку — иначе проверка сверяла бы список
	// сам с собой.
	const вёрстка = [...html.matchAll(IFRAME_SRC_RE)].map(([, src]) => src.split('?')[0]);

	return { выпуск, объекты, вёрстка: [...new Set(вёрстка)] };
}

const файлы = (await readdir(DIST, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

const беды = [];
let страниц = 0;
let роликов = 0;
let подложено = false;

for (const slug of файлы) {
	const путь = `${DIST}${slug}/index.html`;
	if (!existsSync(путь)) continue;

	let html = await readFile(путь, 'utf8');

	// ПОДЛОГ: у первой же страницы выпуска, где ролик есть, отнимаем его объект
	// разметки. Ровно то, что случится, если правило разбора текста перестанет
	// узнавать вставку, которую плагин узнаёт.
	if (selftest && !подложено && html.includes('"@type":"VideoObject"') && html.includes('PodcastEpisode')) {
		html = html.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"VideoObject".*?<\/script>/s, '');
		подложено = true;
	}

	const { выпуск, объекты, вёрстка } = разобрать(html);
	if (!выпуск) continue;

	страниц += 1;
	роликов += вёрстка.length;

	for (const src of вёрстка) {
		if (!объекты.includes(src)) беды.push(`${slug}: ролик ${src} есть на странице, а объекта разметки у него нет`);
	}
	for (const src of объекты) {
		if (!вёрстка.includes(src)) беды.push(`${slug}: объект разметки ${src} есть, а самого ролика на странице нет`);
	}
}

if (selftest) {
	if (!подложено) {
		console.error('✗ ПОДЛОГ НЕ УДАЛСЯ: не нашлось ни одной страницы выпуска с роликом — проверять нечего.');
		process.exit(1);
	}
	if (беды.length === 0) {
		console.error('✗ ПОДЛОГ НЕ ПОЙМАН: у ролика отняли объект разметки, а проверка промолчала. Чинить надо проверку.');
		process.exit(1);
	}
	console.log(`✓ Подлог пойман: ${беды[0]}`);
	console.log('  Проверка умеет краснеть.');
	process.exit(0);
}

if (беды.length > 0) {
	console.error(`✗ Разметка роликов разошлась с вёрсткой в ${беды.length} случаях:`);
	for (const б of беды) console.error('   ' + б);
	process.exit(1);
}

console.log(`ок      Разметка роликов: страниц выпусков ${страниц}, роликов на них ${роликов}, у каждого свой объект.`);
