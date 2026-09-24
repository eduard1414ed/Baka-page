// ПЕРЕЛИНКОВКА, СЕССИЯ 1Б, ШАГ 2 — ВЫБОРКА ДЛЯ СЛОВАРЯ ТЕМ.
//
//   node scripts/crosslinks/sample-1b.mjs
//
// Читает ~/baka-audit/crosslinks/data/posts.json (выгрузка collect.mjs), пишет
// ~/baka-audit/crosslinks/1b/выборка.json — список с причиной, почему пост
// в выборке, — и ~/baka-audit/crosslinks/1b/тексты/<id>.md — тело поста
// блоками с номерами (тем же, что в posts.json), чтобы разметчик ссылался
// на номера блоков. В репозиторий не пишет ничего.
//
// Случайная часть выбирается с зерном: повторный запуск даёт ту же выборку,
// пока не поменялся архив.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = join(homedir(), 'baka-audit/crosslinks');
const OUT = join(BASE, '1b');
const { posts } = JSON.parse(await readFile(join(BASE, 'data/posts.json'), 'utf8'));
const byId = new Map(posts.map((p) => [p.id, p]));

const picked = new Map(); // id → { why[] }
const add = (id, why) => {
	if (!byId.has(id)) throw new Error(`В выгрузке нет поста ${id} (${why})`);
	if (!picked.has(id)) picked.set(id, { why: [] });
	picked.get(id).why.push(why);
};

// 1. Тематический эталон: 10 пар из проверки на 71 + две тайтловые, которые
//    держатся на человеке и на анонсе (отчёт сессии 1, раздел 9).
export const ETALON = [
	['dom-na-gorizonte', 'bunko-desyat-luchshih-novyh-mang-2025-goda'],
	['esche-rybalka', 'ep-126'],
	['idealniy-sloubern-ty-i-ya-polnye-protivopolozhnosti', 'pro-talantlivyy-dizayn-personazha'],
	['kak-ranniy-internet-izmenil-animatsiyu', 'ep-154'],
	['koulun-na-ekranah', 'ep-123'],
	['luchshie-anime-pro-demonov', 'zhivye-torgovye-avtomaty-razumnaya-sliz-i-satana-v-fastfude-chto-takoe-isekay'],
	['romantika-sezona-3640', 'idealniy-sloubern-ty-i-ya-polnye-protivopolozhnosti'],
	['rozhdestvenskaya-podborka-anime', 'ep-110'],
	['ty-i-ya-polnye-protivopolozhnosti-i-ledyanaya-stena-proishodyat-v-odnoy-vselennoy', 'idealniy-sloubern-ty-i-ya-polnye-protivopolozhnosti'],
	['vosem-storon-fudzimoto', 'ep-112'],
	['znakomtes-kohey-honda', 'chto-budet-kogda-lyudi-ischeznut'],
	['kak-poyavilas-legenda-o-beskonechnom-lete', 'ep-153'],
];
for (const [s, t] of ETALON) {
	add(s, `эталон: источник → ${t}`);
	add(t, `эталон: цель ← ${s}`);
}

// 2. Смысловой фильтр, «не выкинуть»: средние и слабые вставки Эда из проверки
//    на 71 и два кандидата, одобренные в браузере («Винланд», «Хоримия»).
export const KEEP = [
	['glavnyy-geroy', 'kto-iz-nih-vret', 'Магическая битва'],
	['nastoyaschee-iskusstvo', 'tarantino-v-vostorge', 'Магическая битва'],
	['ne-skuchayte-po-maomao', 'ep-103', 'Монолог фармацевта'],
	['premiya-crunchyroll-snova-mimo', 'ep-141', 'Стометровка'],
	['santu-vyzyvali', 'rozhdestvenskaya-podborka-anime', 'Санда'],
	['tarantino-v-vostorge', 'nastoyaschee-iskusstvo', 'Магическая битва'],
	['kak-rabota-s-liniyami-delaet-stil-anime-shater-charodeya-luchshe', '10-samyh-ozhidaemyh-anime-leta-2026-goda', 'Шатёр чародея'],
	['luchshie-anime-pro-demonov', 'ep-85', 'Повелитель тьмы на подработке!'],
	['narisuy-eto-potom-umri', 'ep-96', 'Белый ящик'],
	['osennie-anime', 'obzor-vseh-anime-oseni-2022', 'Сделай это сам!!'],
	['osennie-anime', 'po-pervym-seriyam', 'Моя любовь 999 уровня к Ямаде'],
	['zarya-mappa', 'deti-na-holme-pervoe-anime-studii-mappa', 'Дети на холме'],
	['znakomtes-toyya-osima', 'pro-samyy-zhutkiy-serial-sezona', 'Первородный грех Такопи'],
	['kakoe-anime-stoit-smotret-etoy-zimoy-2023', 'ep-75', 'Сага о Винланде'],
	['kakoe-anime-stoit-smotret-etim-letom-2023', 'bonusnyy-vypusk-horimiya', 'Хоримия'],
];
for (const [s, t, a] of KEEP) add(s, `фильтр, оставить: → ${t} по «${a}»`);
for (const t of ['ep-103', 'ep-141', 'deti-na-holme-pervoe-anime-studii-mappa', 'ep-96']) add(t, 'цель одобренной вставки');

// 3. Смысловой фильтр, «отсеять»: ложные находки сессии 1.
export const DROP = [
	['sportivnaya-manga-kak-praroditel-syonenov', 'Блич', 'назван как пример'],
	['reklamu-pohoron-zakazyvali', 'Тетрадь смерти', 'шутка в последнем абзаце'],
	['trend-na-uskorenie', 'Провожающая в последний путь Фрирен', '«жду продолжения»'],
	['anime-belyy-albom-pro-lyubov-shou-biznes-iskusstvo-muzyki', 'Нана', 'имя сэйю (снято исключением)'],
	['minutka-estetiki', 'Наруто', 'узкий бонус «Бикочу» вместо общего'],
	['zrya-ty-eto-uslyshal', '—', 'слишком общий внешний список'],
];
for (const [s, a, w] of DROP) add(s, `фильтр, отсеять: «${a}» — ${w}`);

// 4. «Наруто» — проверка охвата.
for (const id of ['bonusnyy-epizod-naruto-bikochu', 'ep-2', 'ep-119', 'a-kakie-fillery-smotret', 'vsegda-znal-chto-mezhdu-akamaru-i-naruto-mnogo-obschego']) {
	add(id, 'охват: «Наруто»');
}

// 5. Случайная часть — с зерном.
let seed = 20260924;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = (a) => a.map((x) => [rnd(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
const year = (p) => (p.date ?? '0000').slice(0, 4);

const sources = posts.filter((p) => p.ownPage && ['note', 'article'].includes(p.category) && !picked.has(p.id));
const years = [...new Set(sources.map(year))].sort();
for (const y of years) {
	for (const p of shuffle(sources.filter((x) => year(x) === y)).slice(0, 2)) add(p.id, `случайная ${p.category}, ${y}`);
}
const targets = posts.filter((p) => p.ownPage && ['bonus', 'podcast', 'videoessay'].includes(p.category) && !picked.has(p.id));
for (const cat of ['bonus', 'podcast', 'videoessay']) {
	for (const p of shuffle(targets.filter((x) => x.category === cat)).slice(0, 2)) add(p.id, `случайная цель ${cat}`);
}

// Запись.
await mkdir(join(OUT, 'тексты'), { recursive: true });
const list = [...picked].map(([id, x]) => {
	const p = byId.get(id);
	return { id, title: p.title, category: p.category, date: p.date, external: p.external, textChars: p.textChars, why: x.why };
});
await writeFile(join(OUT, 'выборка.json'), JSON.stringify({ made: new Date().toISOString(), etalon: ETALON, keep: KEEP, drop: DROP, posts: list }, null, 1));

for (const { id } of list) {
	const p = byId.get(id);
	const lines = [`# ${p.title}`, '', `id: ${id} · ${p.category}${p.external ? ' (на чужом сайте)' : ''} · ${p.date}`, `поле «тайтлы»: ${p.field.join(', ') || '—'}`, ''];
	for (const b of p.blocks) {
		if (b.kind === 'text' || b.kind === 'heading') lines.push(`[${b.n}${b.kind === 'heading' ? ' заголовок' : ''}] ${b.plain}`);
		else lines.push(`[${b.n} ${b.kind}${b.target ? ' → ' + b.target : ''}${b.animeId ? ' ' + b.animeId : ''}]`);
	}
	await writeFile(join(OUT, 'тексты', `${id}.md`), lines.join('\n') + '\n');
}

const cats = {};
for (const x of list) cats[x.category] = (cats[x.category] ?? 0) + 1;
console.log(`В выборке постов: ${list.length}, знаков текста: ${list.reduce((s, x) => s + x.textChars, 0)}`);
console.log(cats);
console.log(`Записано: ${join(OUT, 'выборка.json')} и ${list.length} текстов в ${join(OUT, 'тексты')}`);
