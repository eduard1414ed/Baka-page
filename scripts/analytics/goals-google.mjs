// КЛЮЧЕВЫЕ СОБЫТИЯ GOOGLE ANALYTICS — то же, что цели у Метрики.
//
//   node scripts/analytics/goals-google.mjs            — показать план
//   node scripts/analytics/goals-google.mjs --завести   — объявить недостающие
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ МЕТРИКИ, И ОТЛИЧИЕ ВАЖНОЕ.
// Метрика принимает только те события, для которых цель заведена ЗАРАНЕЕ:
// незнакомое имя она выбрасывает молча, и вернуть его нельзя. Google
// собирает все события сам, а «ключевым» событие объявляют когда угодно —
// прошлые данные при этом никуда не денутся, они уже собраны.
//
// Отсюда порядок работы: у Метрики цели ДО кода, у Google — можно после.
// Оба списка берутся из одного места (goals-list.mjs), чтобы
// имя события не разъехалось между сервисами.
//
// ЧТО ЗДЕСЬ НЕ ДЕЛАЕТСЯ. Параметры событий (какой выпуск, какой запрос,
// сколько нашлось) в отчётах Google сами не появятся: их надо объявить
// «пользовательскими параметрами» в панели, вручную, и их число ограничено.
// Скрипт этого не трогает — решение, какие параметры нужны в отчётах,
// принимается глазами по живым данным, а не заранее.

import { ЦЕЛИ } from './goals-list.mjs';
import { googleПропуск, РЕСУРС } from './lib.mjs';

const ПРАВО = 'https://www.googleapis.com/auth/analytics.edit';
const хочуЗавести = process.argv.includes('--завести');

async function админка(путь, { method = 'GET', тело, версия = 'v1beta' } = {}) {
	const token = await googleПропуск(ПРАВО);
	const r = await fetch(`https://analyticsadmin.googleapis.com/${версия}/properties/${РЕСУРС}${путь}`, {
		method,
		headers: { Authorization: `Bearer ${token}`, ...(тело ? { 'Content-Type': 'application/json' } : {}) },
		...(тело ? { body: JSON.stringify(тело) } : {}),
	});
	const j = await r.json().catch(() => ({}));
	if (!r.ok) {
		const е = new Error(`${r.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 200)}`);
		е.код = r.status;
		throw е;
	}
	return j;
}

/**
 * У этой части API две живые версии, и какая отвечает — зависит от ресурса.
 * Спрашиваем сначала стабильную, при отказе — предварительную. Молча падать
 * на первой нельзя: снаружи это выглядит как «нет доступа».
 */
async function ключевые(путь, настройки = {}) {
	try {
		return await админка(путь, { ...настройки, версия: 'v1beta' });
	} catch (e) {
		if (e.код !== 404 && e.код !== 400) throw e;
		return await админка(путь, { ...настройки, версия: 'v1alpha' });
	}
}

const было = await ключевые('/keyEvents');
const имена = new Set((было.keyEvents ?? []).map((k) => k.eventName));

console.log(`Ресурс ${РЕСУРС}. Ключевых событий сейчас: ${(было.keyEvents ?? []).length}`);
for (const k of было.keyEvents ?? []) console.log(`   есть: ${k.eventName}${k.custom === false ? ' (своё у Google)' : ''}`);
console.log();

const нужно = ЦЕЛИ.filter((ц) => !имена.has(ц.ключ));
if (!нужно.length) {
	console.log('Объявлять нечего — все наши события уже ключевые.');
	process.exit(0);
}

if (!хочуЗавести) {
	console.log(`ПЛАН (ничего не сделано). Объявить ключевыми ${нужно.length} событий:\n`);
	for (const ц of нужно) console.log(`  ${ц.ключ.padEnd(20)} — ${ц.имя}`);
	console.log('\nЧтобы объявить на самом деле: тот же вызов с ключом --завести');
	process.exit(0);
}

console.log(`ОБЪЯВЛЯЮ ${нужно.length} событий…\n`);
let удачно = 0;
const беды = [];
for (const ц of нужно) {
	try {
		// ONCE_PER_EVENT — считать каждое событие. Второй вариант,
		// ONCE_PER_SESSION, схлопнул бы пять нажатий по таймкодам в одно,
		// а нам интересно именно сколько раз.
		const k = await ключевые('/keyEvents', { method: 'POST', тело: { eventName: ц.ключ, countingMethod: 'ONCE_PER_EVENT' } });
		console.log(`  ✓ ${ц.ключ} — ${ц.имя}`);
		удачно++;
	} catch (e) {
		console.log(`  ✗ ${ц.ключ}: ${e.message}`);
		беды.push(ц.ключ);
	}
}

// Последнее слово — за живым ответом Google, а не за нашим счётчиком удач.
const стало = await ключевые('/keyEvents');
const теперь = new Set((стало.keyEvents ?? []).map((k) => k.eventName));
const наших = ЦЕЛИ.filter((ц) => теперь.has(ц.ключ)).length;
console.log(`\nОбъявлено в этот заход: ${удачно} из ${нужно.length}.`);
if (беды.length) console.log(`НЕ ОБЪЯВЛЕНЫ: ${беды.join(', ')}`);
console.log(`Проверка у Google: наших ключевых событий теперь ${наших} из ${ЦЕЛИ.length}.`);
if (наших < ЦЕЛИ.length) process.exitCode = 1;
