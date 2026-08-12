#!/usr/bin/env node
// Проверки правила «двоеточие перед словом — это двоеточие, а не метка»
// (src/plugins/remark-colon-text.mjs).
//
// ФАЙЛОМ, А НЕ ОДНОСТРОЧНИКОМ `node -e`: обратный слэш внутри однострочника
// проходит через две системы экранирования подряд, и проверка начинает молча
// отвечать «всё хорошо». За проект так уже врали дважды подряд.
//
// СЛУЧАИ ВЗЯТЫ ИЗ АРХИВА, А НЕ СОЧИНЕНЫ ПОД ФОРМУЛИРОВКУ ПРАВИЛА. Подлог,
// повторяющий слова проверки, проверяет не проверку, а собственную
// аккуратность — этим уже обжигались.
//
// ПРОВАЛИТЬСЯ ОНА УМЕЕТ, И ЭТО ПОКАЗАНО ТУТ ЖЕ: те же случаи прогоняются
// вторым заходом БЕЗ плагина, и каждый обязан не сойтись. Молчание «плагин
// выключен, а всё равно хорошо» значило бы, что проверка не проверяет ничего.
//
//   node scripts/remark-colon-text.test.mjs

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import { visit } from 'unist-util-visit';
import remarkColonText from '../src/plugins/remark-colon-text.mjs';

// Куски настоящих постов архива: сначала те, что ломались, потом те,
// что ломаться не должны ни при какой починке.
const CASES = [
	{
		name: 'рекламная маркировка выпуска (ep-118)',
		md: 'Реклама. ООО "ХДС" ИНН 9717171550 Erid:2VtzqwfAwHC',
		wantText: 'Реклама. ООО "ХДС" ИНН 9717171550 Erid:2VtzqwfAwHC',
	},
	{
		name: 'название с двоеточием прямо в тексте (ep-85)',
		md: 'смотрели «Подручный Луизы-Нулизы», Re:Zero и другое',
		wantText: 'смотрели «Подручный Луизы-Нулизы», Re:Zero и другое',
	},
	{
		name: 'время в тексте (smotrim-i-otsenivaem…)',
		md: 'в воскресенье, 28 июня, в 20:00 (по мск)',
		wantText: 'в воскресенье, 28 июня, в 20:00 (по мск)',
	},
	{
		name: 'японское слово с двоеточием (baykery-i-veter-svobody)',
		md: 'как и в слове «бо:рёкудан» (暴力団, гангстер)',
		wantText: 'как и в слове «бо:рёкудан» (暴力団, гангстер)',
	},
	{
		name: 'двоеточие внутри подписи метки (kak-fanfiki-izmenili-anime)',
		md: 'исекаев, в том числе :anime[Re:Zero]{id="re-zero-kara-hajimeru-isekai-seikatsu" source="shikimori"} и «Реинкарнация безработного»',
		wantText: 'исекаев, в том числе Re:Zero и «Реинкарнация безработного»',
		wantDirective: { name: 'anime', label: 'Re:Zero' },
	},
	{
		name: 'обычная метка тайтла остаётся меткой',
		md: 'а вот и :anime[Фрирен]{id="sousou-no-frieren" source="shikimori"} рядом',
		wantText: 'а вот и Фрирен рядом',
		wantDirective: { name: 'anime', label: 'Фрирен' },
	},
	{
		name: 'метка спойлера остаётся меткой',
		md: 'и тут :spoiler-inline[он умирает]{} вот так',
		wantText: 'и тут он умирает вот так',
		wantDirective: { name: 'spoiler-inline', label: 'он умирает' },
	},
];

function parse(md, withFix) {
	const proc = withFix
		? unified().use(remarkParse).use(remarkDirective).use(remarkColonText)
		: unified().use(remarkParse).use(remarkDirective);
	const file = { value: md };
	const tree = proc.parse(file);
	return proc.runSync(tree, file);
}

function flatten(tree) {
	let out = '';
	visit(tree, ['text', 'inlineCode'], (node) => { out += node.value; });
	return out;
}

function directives(tree) {
	const found = [];
	visit(tree, 'textDirective', (node) => {
		found.push({ name: node.name, label: flatten({ type: 'root', children: node.children ?? [] }) });
	});
	return found;
}

// Число текстовых кусков подряд в одном абзаце. Разметка тайтлов ищет название
// внутри ОДНОГО куска, поэтому склейка — часть правила, а не косметика.
function maxTextRun(tree) {
	let max = 0;
	visit(tree, 'paragraph', (para) => {
		let run = 0;
		for (const child of para.children) {
			if (child.type === 'text') { run++; max = Math.max(max, run); } else run = 0;
		}
	});
	return max;
}

function check(kase, withFix) {
	const tree = parse(kase.md, withFix);
	const problems = [];

	const text = flatten(tree);
	if (text !== kase.wantText) problems.push(`текст «${text}» вместо «${kase.wantText}»`);

	const dirs = directives(tree);
	if (kase.wantDirective) {
		const hit = dirs.find((d) => d.name === kase.wantDirective.name);
		if (!hit) problems.push(`метка :${kase.wantDirective.name} потерялась`);
		else if (hit.label !== kase.wantDirective.label) {
			problems.push(`подпись метки «${hit.label}» вместо «${kase.wantDirective.label}»`);
		}
		if (dirs.length !== 1) problems.push(`меток ${dirs.length}, а должна быть одна`);
	} else if (dirs.length > 0) {
		problems.push(`метка появилась там, где её нет: :${dirs.map((d) => d.name).join(', :')}`);
	}

	// Кусок текста без меток обязан остаться ОДНИМ куском.
	if (!kase.wantDirective && maxTextRun(tree) > 1) {
		problems.push(`текст разорван на ${maxTextRun(tree)} куска — разметка тайтлов такое название не найдёт`);
	}

	return problems;
}

let failed = 0;

console.log('С плагином (всё обязано сойтись):');
for (const kase of CASES) {
	const problems = check(kase, true);
	if (problems.length) {
		failed++;
		console.log(`  ✗ ${kase.name}`);
		for (const p of problems) console.log(`      ${p}`);
	} else {
		console.log(`  ✓ ${kase.name}`);
	}
}

console.log('\nБез плагина (проверка обязана поймать каждый сломанный случай):');
const SHOULD_BREAK = CASES.filter((k) => k.md.match(/:[^\s[{]/) && !k.name.startsWith('обычная метка') && !k.name.startsWith('метка спойлера'));
for (const kase of SHOULD_BREAK) {
	const problems = check(kase, false);
	if (problems.length) {
		console.log(`  ✓ поймано: ${kase.name} — ${problems[0]}`);
	} else {
		failed++;
		console.log(`  ✗ НЕ поймано: ${kase.name} — без плагина проверка молчит, значит она ничего не проверяет`);
	}
}

console.log(failed === 0 ? '\nВсё сошлось.' : `\nНе сошлось: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
