// ЗАСЛОН: В ГОТОВОМ САЙТЕ НЕТ НИ ОДНОЙ СТРАНИЦЫ НЕОПУБЛИКОВАННОГО МАТЕРИАЛА.
// Стоит в `npm run build` сразу за `astro build` (сессия «Тесты-3»,
// решение заказчика 9 октября 2026).
//
//   node scripts/check-drafts-in-dist.mjs             — спросить dist/
//   node scripts/check-drafts-in-dist.mjs --selftest  — плюс подлоги
//
// ЗАЧЕМ, ЕСЛИ И ТАК НЕ ПОПАДАЕТ. С сессии «Тесты-3» черновик ТЕСТА получает
// страницу в режиме разработки (`isDevTestPreview`, src/lib/publishing.mjs):
// его надо пройти руками до публикации. На сайт он не попадает потому, что
// настоящая сборка подставляет в признак «режим разработки» значение «нет».
// Это правда, но держится она на одной строке кода, а правило проекта
// говорит: то, что можно сломать обычной работой, обязано стеречься сборкой.
// Перепутай кто-нибудь условие — на сайт уедут неготовые тесты и вместе
// с ними ответы викторин, и выкладка пройдёт зелёной.
//
// ЧТО СЧИТАЕТСЯ НЕОПУБЛИКОВАННЫМ — то же правило, что у сайта: `isPublished`
// по шапке, прочитанной `normalizeFrontmatter` (пустая галочка «черновик» —
// черновик). Своей копии правила тут нет.
//
// СТРАНИЦЫ РЕЗУЛЬТАТОВ ТЕСТА (сессия «Тесты-5а») лежат ВНУТРИ папки теста —
// /posts/<тест>/<результат>/, — поэтому вопрос «есть ли папка» ловит и их:
// утекла хоть одна страница результата — папка черновика в сборке есть.
// В сообщении они перечисляются поимённо.
//
// СПРАШИВАЕТ ТОЛЬКО ПАПКУ СТРАНИЦЫ, А НЕ УПОМИНАНИЯ АДРЕСА. Ссылка на черновик
// из опубликованного поста — обычное дело (её показывает post-links-integration),
// и заслон, краснеющий на обычной работе, сняли бы вместе с пользой.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { normalizeFrontmatter } from '../src/lib/frontmatter.mjs';
import { isPublished } from '../src/lib/publishing.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Материалы, у которых на сайте страницы быть не должно, и нашлась ли она.
 *
 * @param {string} postsDir папка с .md материалов
 * @param {string} distDir  папка готового сайта
 * @returns {{ checked: number, leaks: { id: string, title: string, results: string[] }[] }}
 */
export function findDraftPages(postsDir, distDir) {
	let checked = 0;
	const leaks = [];
	for (const file of readdirSync(postsDir)) {
		if (!file.endsWith('.md')) continue;
		const raw = readFileSync(join(postsDir, file), 'utf8');
		const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
		if (!head) continue;
		const data = normalizeFrontmatter(yaml.load(head[1]) ?? {});
		if (isPublished(data)) continue;

		checked++;
		const id = file.replace(/\.md$/, '');
		const folder = join(distDir, 'posts', id);
		if (!existsSync(folder)) continue;
		// Вложенные папки — страницы результатов теста.
		const results = readdirSync(folder, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
		leaks.push({ id, title: String(data.title ?? id), results });
	}
	return { checked, leaks };
}

function report({ checked, leaks }) {
	if (leaks.length === 0) {
		console.log(`ок      Страниц неопубликованных материалов в сборке нет (проверено ${checked})`);
		return 0;
	}
	console.error(`✗✗ В ГОТОВОМ САЙТЕ ЕСТЬ СТРАНИЦЫ НЕОПУБЛИКОВАННЫХ МАТЕРИАЛОВ: ${leaks.length}. Выкладывать нельзя.`);
	for (const leak of leaks) {
		console.error(`   /posts/${leak.id}/ — «${leak.title}»`);
		for (const result of leak.results) console.error(`      и страница результата /posts/${leak.id}/${result}/`);
	}
	console.error('   Скорее всего, сломано условие показа черновиков в режиме разработки:');
	console.error('   isDevTestPreview в src/lib/publishing.mjs и места, где его зовут.');
	return 1;
}

function selftest() {
	const box = mkdtempSync(join(tmpdir(), 'drafts-in-dist-'));
	let failed = 0;
	const check = (name, ok) => {
		console.log(`  ${ok ? 'ок  ' : 'ПРОВАЛ'}  ${name}`);
		if (!ok) failed++;
	};
	try {
		const posts = join(box, 'posts');
		const dist = join(box, 'dist');
		mkdirSync(posts);
		mkdirSync(join(dist, 'posts', 'opublikovan'), { recursive: true });
		const md = (head) => `---\n${head}\n---\nТекст.\n`;
		writeFileSync(join(posts, 'opublikovan.md'), md("title: Готово\ndate: 2026-10-01\ncategory: note\ndraft: false"));
		writeFileSync(join(posts, 'chernovik-testa.md'), md("title: Тест\ndate: 2026-10-01\ncategory: test\ndraft: true"));
		writeFileSync(join(posts, 'pustaya-galochka.md'), md("title: Пусто\ndate: 2026-10-01\ncategory: note\ndraft: ''"));
		writeFileSync(join(posts, 'v-budushchem.md'), md("title: Потом\ndate: 2026-10-01\ncategory: note\npublishAt: 2999-01-01T00:00:00Z"));

		// Здоровая сборка: страница есть только у опубликованного — молчим.
		let r = findDraftPages(posts, dist);
		check('здоровая сборка: молчит', r.leaks.length === 0);
		check('здоровая сборка: неопубликованных насчитано 3', r.checked === 3);

		// Подлог как в жизни: страница черновика теста попала в сборку.
		mkdirSync(join(dist, 'posts', 'chernovik-testa'));
		r = findDraftPages(posts, dist);
		check('страница черновика теста: поймана', r.leaks.length === 1 && r.leaks[0].id === 'chernovik-testa');
		rmSync(join(dist, 'posts', 'chernovik-testa'), { recursive: true });

		// Подлог как в жизни: страницы самого теста нет, а страница его
		// результата в сборку попала (сломан отбор у posts/[slug]/[result].astro).
		mkdirSync(join(dist, 'posts', 'chernovik-testa', 'novichok'), { recursive: true });
		r = findDraftPages(posts, dist);
		check(
			'только страница результата черновика: поймана и названа',
			r.leaks.length === 1 && r.leaks[0].id === 'chernovik-testa' && r.leaks[0].results.join() === 'novichok',
		);

		// У опубликованного теста страницы результатов законны — молчим.
		mkdirSync(join(dist, 'posts', 'opublikovan', 'znatok'));
		r = findDraftPages(posts, dist);
		check('результат опубликованного: молчит', !r.leaks.some((leak) => leak.id === 'opublikovan'));

		// Пустая галочка читается черновиком (в безопасную сторону).
		mkdirSync(join(dist, 'posts', 'pustaya-galochka'));
		mkdirSync(join(dist, 'posts', 'v-budushchem'));
		r = findDraftPages(posts, dist);
		check('пустая галочка и отложенный: пойманы оба', r.leaks.length === 3);
		check('код выхода при находке — 1', report(r) === 1);
	} finally {
		rmSync(box, { recursive: true, force: true });
	}
	console.log(failed === 0 ? 'Самопроверка: всё сошлось.' : `Самопроверка: провалов ${failed}.`);
	return failed === 0 ? 0 : 1;
}

let code = 0;
if (process.argv.includes('--selftest')) code = selftest();
if (code === 0) code = report(findDraftPages(join(ROOT, 'src', 'content', 'posts'), join(ROOT, 'dist')));
process.exit(code);
