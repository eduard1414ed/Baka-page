// СЛИТЬ ФАЙЛ РЕШЕНИЙ ПО КАНДИДАТАМ: список от вкладки + пометки от робота.
//
//   node scripts/anime-candidates-decisions-merge.mjs <свежий> <свой> > результат
//   node scripts/anime-candidates-decisions-merge.mjs --selftest
//
// ЗАЧЕМ. В `src/data/animeCandidateDecisions.json` пишут двое: вкладка
// `/admin/tools/candidates/` (заказчик отмечает решения) и робот применения
// (ставит пометку «применено»). Робот работает минуту-полторы, и всё это время
// вкладка живая — заказчик отмечает следующие строки. Тогда git при записи
// встаёт столкновением ровно на этом файле.
//
// 11 августа 2026 это стоило ВСЕЙ работы робота: он завёл «Человека-бензопилу»
// с обложками, отправил в письме бодрое «Применено: 2» — и не смог записать
// ничего, потому что `git pull --rebase` упёрся в столкновение и упал.
// В репозитории не осталось ни карточки, ни обложек, ни строчки в стоп-листе.
//
// ПРАВИЛО СЛИЯНИЯ — по одному вопросу на каждую половину файла:
//
//   КТО В СПИСКЕ            — решает вкладка (свежий файл). Она хозяйка списка:
//                             там и новые решения, и отменённые кнопкой
//                             «Передумал». Решение, которое человек убрал уже
//                             ПОСЛЕ применения, так и остаётся убранным —
//                             работа сделана, а строка ему больше не нужна.
//   ЧТО С НИМ СЛУЧИЛОСЬ     — решает робот (свой файл): `applied`, `result`,
//                             `error`. Потеряй мы пометку — робот применил бы
//                             решение во второй раз.
//
// Сливаем по `id`. Порядок берём у свежего файла, чтобы разница в коммите
// читалась глазами.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Пометки робота — то, чего вкладка знать не может. */
const MARKS = ['applied', 'result', 'error'];

export function mergeDecisions(fresh, mine) {
	if (!Array.isArray(fresh)) throw new Error('свежий файл решений — не список');
	if (!Array.isArray(mine)) throw new Error('свой файл решений — не список');

	const marksById = new Map();
	for (const item of mine) {
		if (!item || item.id === undefined) continue;
		const marks = {};
		for (const key of MARKS) {
			if (item[key] !== undefined) marks[key] = item[key];
		}
		marksById.set(item.id, marks);
	}

	return fresh.map((item) => {
		const marks = marksById.get(item?.id);
		if (!marks) return item;

		const out = { ...item };
		for (const key of MARKS) {
			// Пометка робота сильнее пустоты у вкладки, но и снимать её она
			// не имеет права: `error` от прошлого захода уходит только тогда,
			// когда робот сам его перебил успехом.
			if (marks[key] === undefined) delete out[key];
			else out[key] = marks[key];
		}
		return out;
	});
}

async function readList(path, what) {
	let text;
	try {
		text = await readFile(path, 'utf8');
	} catch (error) {
		throw new Error(`${what} (${path}) не прочитался: ${error.code ?? error.message}`);
	}
	// Пустой файл — законное состояние: решений могло не быть вовсе.
	if (text.trim() === '') return [];
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`${what} (${path}) не разбирается как JSON: ${error.message}`);
	}
}

// ── Самопроверка ────────────────────────────────────────────────────────────
//
// Слияние живёт внутри воркфлоу и на живых данных срабатывает редко: столкнуться
// вкладка с роботом должны в одну и ту же минуту. Значит «молчит» тут не значит
// ничего, и спрашивать надо на подложенных данных. Подлоги написаны настоящим
// случаем 11 августа, а не пересказом правила.

function selftest() {
	const cases = [];
	const check = (name, got, want) => {
		const ok = JSON.stringify(got) === JSON.stringify(want);
		cases.push({ name, ok, got, want });
	};

	// 1. Настоящий случай 11 августа: робот читал файл с двумя решениями
	//    и пометил их; вкладка тем временем дописала ещё три.
	const mine = [
		{ id: 'cand:34443', what: 'stop', applied: '2026-08-11T09:38:00Z', result: 'в стоп-лист: Баки' },
		{ id: 'cand:44511', what: 'create', slug: 'chainsaw-man', applied: '2026-08-11T09:38:20Z', result: 'заведён' },
	];
	const fresh = [
		{ id: 'cand:34443', what: 'stop' },
		{ id: 'cand:44511', what: 'create', slug: 'chainsaw-man' },
		{ id: 'cand:57334', what: 'create', slug: 'dandadan' },
		{ id: 'cand:50265', what: 'create', slug: 'spy-x-family' },
		{ id: 'cand:42897', what: 'create', slug: 'horimiya' },
	];
	check('сделанное помечено, дописанное не потеряно', mergeDecisions(fresh, mine), [
		{ id: 'cand:34443', what: 'stop', applied: '2026-08-11T09:38:00Z', result: 'в стоп-лист: Баки' },
		{ id: 'cand:44511', what: 'create', slug: 'chainsaw-man', applied: '2026-08-11T09:38:20Z', result: 'заведён' },
		{ id: 'cand:57334', what: 'create', slug: 'dandadan' },
		{ id: 'cand:50265', what: 'create', slug: 'spy-x-family' },
		{ id: 'cand:42897', what: 'create', slug: 'horimiya' },
	]);

	// 2. Пометка не должна воскрешать строку, которую человек убрал
	//    кнопкой «Передумал», пока робот работал.
	check(
		'отменённое вкладкой не возвращается',
		mergeDecisions([{ id: 'b', what: 'stop' }], [
			{ id: 'a', what: 'stop', applied: 'вчера' },
			{ id: 'b', what: 'stop' },
		]),
		[{ id: 'b', what: 'stop' }],
	);

	// 3. Невышедшее остаётся невышедшим и с причиной: следующее нажатие
	//    возьмётся за него снова, а заказчик увидит, почему не вышло.
	check(
		'причина неудачи переносится',
		mergeDecisions([{ id: 'a', what: 'create', slug: 'x' }], [
			{ id: 'a', what: 'create', slug: 'x', error: 'тайтла с номером 1 в Shikimori нет' },
		]),
		[{ id: 'a', what: 'create', slug: 'x', error: 'тайтла с номером 1 в Shikimori нет' }],
	);

	// 4. Вкладка переиграла решение по той же строке: было «не аниме»,
	//    стало «завести». Тело — её, пометки — робота.
	check(
		'переигранное решение берётся у вкладки целиком',
		mergeDecisions([{ id: 'a', what: 'create', slug: 'x' }], [{ id: 'a', what: 'stop', applied: 'вчера' }]),
		[{ id: 'a', what: 'create', slug: 'x', applied: 'вчера' }],
	);

	// 5. Пустой свой файл — законное состояние (робот не применил ничего).
	check('пустой свой файл не съедает список', mergeDecisions([{ id: 'a', what: 'stop' }], []), [
		{ id: 'a', what: 'stop' },
	]);

	// 6. И ПОДЛОГ НАОБОРОТ: слияние обязано УМЕТЬ ошибаться. Если бы список
	//    брался у робота, а не у вкладки, три дописанных решения пропали бы —
	//    проверка 1 обязана это поймать.
	const наоборот = mergeDecisions(mine, fresh);
	cases.push({
		name: 'подлог: список от робота теряет дописанное вкладкой — и это видно',
		ok: наоборот.length === 2,
		got: наоборот.length,
		want: 2,
	});

	// 7. Битый вход роняет прогон громко, а не отдаёт пустоту.
	let ругнулось = false;
	try {
		mergeDecisions(null, []);
	} catch {
		ругнулось = true;
	}
	cases.push({ name: 'не-список роняет прогон', ok: ругнулось, got: ругнулось, want: true });

	console.log('=== СЛИЯНИЕ ФАЙЛА РЕШЕНИЙ: САМОПРОВЕРКА ===');
	for (const item of cases) {
		console.log(`  ${item.ok ? 'ок  ' : 'СБОЙ'}  ${item.name}`);
		if (!item.ok) {
			console.log(`        вышло:  ${JSON.stringify(item.got)}`);
			console.log(`        ждали:  ${JSON.stringify(item.want)}`);
		}
	}
	const bad = cases.filter((item) => !item.ok).length;
	console.log(bad === 0 ? `\nВсе ${cases.length} проверок прошли.` : `\nНЕ ПРОШЛО: ${bad}.`);
	return bad;
}

export async function main(argv) {
	if (argv.includes('--selftest')) {
		if (selftest() > 0) process.exitCode = 1;
		return;
	}

	const [fresh, mine] = argv.filter((arg) => !arg.startsWith('--'));
	if (!fresh || !mine) {
		throw new Error('нужны два файла: свежий (от вкладки) и свой (от робота)');
	}

	const merged = mergeDecisions(await readList(fresh, 'свежий файл решений'), await readList(mine, 'свой файл решений'));
	// Отступ табуляцией и перевод строки в конце — ровно так пишет вкладка;
	// разойдись мы с ней, каждый коммит был бы на весь файл.
	process.stdout.write(JSON.stringify(merged, null, '\t') + '\n');
}

// Русские буквы в пути к проекту: import.meta.url кодирует их, а process.argv[1]
// нет, и строчное сравнение не совпало бы НИКОГДА (CLAUDE.md, «Уроки проекта»).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	await main(process.argv.slice(2));
}
