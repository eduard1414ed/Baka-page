// ПОВТОР ПРИ СБОЕ СЕТИ — ОДИН ДОМ НА ПРОЕКТ.
//
//   node scripts/retry-home.test.mjs             — спросить
//   node scripts/retry-home.test.mjs --selftest  — плюс подлоги
//
// ЗАЧЕМ. Карта кода уверяла: «`сПовторами` в `scripts/retry.mjs`, одно место
// на проект». На деле копий было ЧЕТЫРЕ, и три из них лежали в `scripts/dtf/`
// со своим циклом и своим списком того, что считать сбоем сети. Списки уже
// разошлись: в `dtf/` НЕ считались сетевыми отказ DNS (`ENOTFOUND`,
// `EAI_AGAIN`), оборванное соединение (`terminated`) и ответы 502/503/504 —
// самые частые временные отказы чужого сервера (доревизия задачи 15,
// находка 27). Пересборка поста падала там, где остальной проект переждал бы.
//
// СПРАШИВАЕТСЯ ДВА РАЗНЫХ ВОПРОСА, И ОБА НУЖНЫ:
//   1. НЕТ ЛИ ВТОРОЙ КОПИИ — поиском по исходникам.
//   2. ПРАВДА ЛИ ПУТЬ DTF ТЕПЕРЬ ПЕРЕЖИВАЕТ 503 — прогоном на подделке сети.
// Первый вопрос про букву, второй про поведение; ответ «да» на один ничего
// не говорит про другой.
import { readdir, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { похоженаСбойСети } from './retry.mjs';

const ЗДЕСЬ = dirname(fileURLToPath(import.meta.url));
const КОРЕНЬ = join(ЗДЕСЬ, '..');

// Признак своей копии правила: список сетевых бед, написанный на месте.
// Ищем не слово «retry» и не цикл (их пишут по-разному), а именно тот кусок,
// который у всех четырёх копий совпадал дословно.
const СВОЯ_КОПИЯ = /fetch failed[^\n]*\|[^\n]*(?:ECONN|timeout)/;

// Файлы, которым эта строка положена: дом правила и проверки, которые про него
// рассказывают. Список ЯВНЫЙ — «всё остальное» отменило бы саму проверку.
const КОМУ_МОЖНО = new Set([
	'scripts/retry.mjs',
	'scripts/retry-home.test.mjs',
	'scripts/anime-candidates.test.mjs',
	'scripts/candidates-screen.test.mjs',
]);

async function всеИсходники(папка, собрано = []) {
	for (const запись of await readdir(папка, { withFileTypes: true })) {
		if (запись.name === 'node_modules' || запись.name.startsWith('.')) continue;
		const путь = join(папка, запись.name);
		if (запись.isDirectory()) await всеИсходники(путь, собрано);
		else if (['.mjs', '.js', '.ts'].includes(extname(запись.name))) собрано.push(путь);
	}
	return собрано;
}

/** Файлы, в которых лежит своя копия списка сетевых бед. */
async function копииПравила() {
	const найдено = [];
	for (const папка of ['scripts', 'src', 'public/admin']) {
		let файлы = [];
		try {
			файлы = await всеИсходники(join(КОРЕНЬ, папка));
		} catch {
			continue;
		}
		for (const путь of файлы) {
			const относительный = путь.slice(КОРЕНЬ.length + 1).replaceAll('\\', '/');
			if (КОМУ_МОЖНО.has(относительный)) continue;
			if (СВОЯ_КОПИЯ.test(await readFile(путь, 'utf8'))) найдено.push(относительный);
		}
	}
	return найдено;
}

let плохо = 0;
const скажи = (ок, что) => {
	if (!ок) плохо++;
	console.log(`${ок ? '  ок  ' : ' ПЛОХО'}  ${что}`);
};

console.log('ПОВТОР ПРИ СБОЕ СЕТИ: один дом, и он правда переживает 503.');
console.log();

// ── 1. Второй копии нет ───────────────────────────────────────────────────
const копии = await копииПравила();
скажи(копии.length === 0, `своих копий списка сетевых бед: ${копии.length}`);
for (const файл of копии) console.log(`          ${файл}`);

// ── 2. Что дом считает сетевым ────────────────────────────────────────────
// Не «работает ли повтор вообще» (это спрашивает anime-candidates.test.mjs),
// а именно те беды, которых копии в `dtf/` не знали.
for (const [текст, ждём] of [
	['fetch failed', true],
	['getaddrinfo ENOTFOUND api.dtf.ru', true],
	['getaddrinfo EAI_AGAIN api.dtf.ru', true],
	['terminated', true],
	['HTTP 502', true],
	['HTTP 503', true],
	['HTTP 504', true],
	['AniList: слишком частые запросы (429)', true],
	['в ответе нет статьи 1149385', false],
	['HTTP 404 у 9c2f', false],
]) {
	const вышло = похоженаСбойСети(new Error(текст));
	скажи(вышло === ждём, `«${текст}» → ${вышло ? 'сетевое' : 'НЕ сетевое'}`);
}

// ── 3. Путь DTF на подделке сети ──────────────────────────────────────────
// СПРАШИВАЕМ САМ `fetchArticle`, а не `сПовторами` рядом: вопрос находки был
// не «умеет ли дом повторять», а «дошёл ли дом до этого файла».
const { fetchArticle } = await import('./dtf/source.mjs');
const ВЫДУМАННАЯ_СТАТЬЯ = 999000001;
const КЭШ = join(КОРЕНЬ, '.tmp-dtf', `dtf-${ВЫДУМАННАЯ_СТАТЬЯ}.json`);
const настоящийFetch = globalThis.fetch;
const тихо = console.log;

async function спроситьDTF(ответы) {
	await rm(КЭШ, { force: true });
	let заходов = 0;
	globalThis.fetch = async () => {
		const ответ = ответы[Math.min(заходов, ответы.length - 1)];
		заходов++;
		if (ответ instanceof Error) throw ответ;
		return ответ;
	};
	// Строчку «сеть подвела…» глушим: она тут ожидаема и мешает читать отчёт.
	console.log = () => {};
	try {
		const результат = await fetchArticle(ВЫДУМАННАЯ_СТАТЬЯ);
		return { заходов, результат };
	} catch (ошибка) {
		return { заходов, ошибка };
	} finally {
		console.log = тихо;
		globalThis.fetch = настоящийFetch;
		await rm(КЭШ, { force: true });
	}
}

const хорошийОтвет = () => ({
	ok: true,
	status: 200,
	text: async () => JSON.stringify({ result: { id: ВЫДУМАННАЯ_СТАТЬЯ, blocks: [] } }),
});
const пятьсотТри = { ok: false, status: 503, text: async () => '' };

const после503 = await спроситьDTF([пятьсотТри, хорошийОтвет()]);
скажи(после503.заходов === 2 && Boolean(после503.результат), `503 у DTF пережит: заходов ${после503.заходов}, статья получена`);

const послеDNS = await спроситьDTF([
	Object.assign(new Error('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND api.dtf.ru') }),
	хорошийОтвет(),
]);
скажи(послеDNS.заходов === 2 && Boolean(послеDNS.результат), `отказ DNS пережит: заходов ${послеDNS.заходов}`);

// ЧЕСТНЫЙ ОТКАЗ ПОВТОРОМ НЕ ЛЕЧИТСЯ — и это половина правила, без которой
// «повторяем всё» выглядело бы точно так же зелено.
const честныйОтказ = await спроситьDTF([{ ok: true, status: 200, text: async () => JSON.stringify({}) }]);
скажи(честныйОтказ.заходов === 1 && Boolean(честныйОтказ.ошибка), `«в ответе нет статьи» не повторяется: заходов ${честныйОтказ.заходов}`);

// ── ПОДЛОГИ ───────────────────────────────────────────────────────────────
// «Пусто» ничего не значит, пока не показано, что проверка умеет находить.
// Подлог СОЗДАЁТ вторую копию, а не меняет единственную: копия, переписанная
// во всех местах разом, расхождения не создаёт и не ловится (CLAUDE.md).
if (process.argv.includes('--selftest')) {
	console.log();
	console.log('── ПОДЛОГИ ──');

	const подделка = join(КОРЕНЬ, 'scripts', 'ПОДЛОГ-своя-копия.mjs');
	await writeFile(
		подделка,
		'// Так выглядела копия правила в scripts/dtf/source.mjs до сведения.\n' +
			'const network = error.cause || /fetch failed|timeout|network|ECONN|socket/i.test(error.message);\n' +
			'export default network;\n',
		'utf8',
	);
	try {
		const сПодлогом = await копииПравила();
		скажи(
			сПодлогом.some((файл) => файл.endsWith('ПОДЛОГ-своя-копия.mjs')),
			`подложенная вторая копия найдена (всего найдено ${сПодлогом.length})`,
		);
	} finally {
		await unlink(подделка);
	}

	// И проверка обязана МОЛЧАТЬ на здоровом: без этого «поймал» неотличимо
	// от «ругается на всё подряд».
	скажи((await копииПравила()).length === 0, 'после уборки подлога проверка снова молчит');
}

console.log();
if (плохо) {
	console.log(`ПРОВАЛОВ: ${плохо}`);
	process.exit(1);
}
console.log('Дом у повтора один, и путь DTF им пользуется.');
