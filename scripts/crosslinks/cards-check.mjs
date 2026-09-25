// ПЕРЕЛИНКОВКА, КАНАЛ «ТЕМЫ» — ПРОВЕРКА КАРТОЧЕК РАЗМЕТЧИКА (сессия 1б).
//
//   node scripts/crosslinks/cards-check.mjs <папка пачек> [<папка карточек>] [--selftest] [--present]
//
// --present  проверять только пачки, у которых карточки уже есть (разметка
//            архива идёт кругами, и неразмеченная пачка — не ошибка круга).
//
// Сверяет ответ помощника с пачкой (пачки.json) и словарём:
//   - на каждый пост пачки ровно одна карточка;
//   - метки только из словаря, уровни только разрешённые, блоки существуют;
//   - у `реальные-места` указано место, у `по-мотивам` — на что ссылается;
//   - на каждый вопрос фильтра есть ответ «тема» или «пример»;
//   - тайтлы (охват, «о чём на самом деле») — существующие id;
//   - люди не из списка словаря печатаются как новые (это не ошибка).
// Карточки лежат в <папка карточек>/пачка-NN.json (по умолчанию — рядом с пачками).
// Код 1, если есть ошибки. В репозиторий не пишет ничего.
//
// --selftest портит заведомо хорошую карточку пятью способами и требует,
// чтобы проверка поймала каждый; иначе «ошибок нет» ничего не значит.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './lib.mjs';
import { readDictionary } from './dictionary.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const selftest = process.argv.includes('--selftest');
const presentOnly = process.argv.includes('--present');
const batchDir = args[0];
const cardDir = args[1] ?? batchDir;

export const LEVELS = ['главная', 'раздел', 'мимоходом'];
export const PERSON_LEVELS = ['главный', 'упомянут'];
export const SCOPES = ['общий', 'узкий'];
export const VERDICTS = ['тема', 'пример'];
export const ROLES = ['мангака', 'режиссёр', 'аниматор', 'арт-директор', 'дизайнер персонажей', 'композитор', 'сэйю', 'продюсер', 'сценарист', 'автор ранобэ', 'автор игры', 'другое'];

// Коды меток и известные люди — из словаря (dictionary.mjs), а не из копии здесь.
export { readDictionary };

export function checkCards({ cards, batch, byId, animeIds, dict }) {
	const errors = [];
	const newPeople = [];
	const err = (id, msg) => errors.push(`${id}: ${msg}`);
	if (!Array.isArray(cards)) return { errors: ['ответ — не массив'], newPeople };
	const want = batch.posts.map((p) => p.id);
	const got = cards.map((c) => c?.id);
	for (const id of want) if (got.filter((g) => g === id).length !== 1) err(id, `карточек ${got.filter((g) => g === id).length}, нужна одна`);
	for (const id of got) if (!want.includes(id)) err(id, 'поста нет в пачке');

	for (const card of cards) {
		const id = card?.id;
		const post = byId.get(id);
		const spec = batch.posts.find((p) => p.id === id);
		if (!post || !spec) continue;
		const blockOk = (n) => Number.isInteger(n) && n >= 0 && n < post.blocks.length && post.blocks[n].kind !== 'material';
		if (typeof card.about !== 'string' || card.about.trim().length < 10) err(id, 'нет фразы «о чём пост»');

		for (const l of card.labels ?? []) {
			if (!dict.codes.has(l.code)) err(id, `метки «${l.code}» нет в словаре`);
			if (!LEVELS.includes(l.level)) err(id, `у метки «${l.code}» уровень «${l.level}»`);
			if (!Array.isArray(l.blocks) || !l.blocks.every(blockOk)) err(id, `у метки «${l.code}» неверные блоки ${JSON.stringify(l.blocks)}`);
			if (l.code === 'реальные-места' && !l.place) err(id, 'у «реальные-места» не указано место');
			if (l.code === 'по-мотивам' && !(l.ref && l.quote)) err(id, 'у «по-мотивам» нет ref или quote');
		}
		for (const p of card.people ?? []) {
			if (!p.name) err(id, 'человек без имени');
			if (!ROLES.includes(p.role)) err(id, `у «${p.name}» роль «${p.role}»`);
			if (!PERSON_LEVELS.includes(p.level)) err(id, `у «${p.name}» уровень «${p.level}»`);
			if (!Array.isArray(p.blocks) || !p.blocks.every(blockOk)) err(id, `у «${p.name}» неверные блоки`);
			if (p.name && !dict.people.has(p.name)) newPeople.push(`${p.name} (${p.role}) — ${id}`);
		}
		for (const s of card.studios ?? []) {
			if (!s.name) err(id, 'студия без имени');
			if (!['главная', 'упомянута'].includes(s.level)) err(id, `у студии «${s.name}» уровень «${s.level}»`);
		}
		for (const a of card.subjectAnime ?? []) {
			if (!animeIds.has(a.anime)) err(id, `тайтла «${a.anime}» нет в справочнике (о чём на самом деле)`);
			if (!a.why) err(id, `у «${a.anime}» (о чём на самом деле) нет пояснения`);
		}
		for (const c of card.coverage ?? []) {
			if (!animeIds.has(c.anime)) err(id, `тайтла «${c.anime}» нет в справочнике (охват)`);
			if (!SCOPES.includes(c.scope)) err(id, `у охвата «${c.anime}» значение «${c.scope}»`);
			if (c.scope === 'узкий' && !c.aspect) err(id, `у узкого охвата «${c.anime}» не назван аспект`);
		}
		// Охват обязателен для каждого главного тайтла по счётчику и для «о чём на самом деле».
		const need = new Set([...spec.mainAnime, ...(card.subjectAnime ?? []).map((a) => a.anime)]);
		for (const a of need) if (!(card.coverage ?? []).some((c) => c.anime === a)) err(id, `нет охвата для тайтла «${a}»`);
		for (const q of spec.questions) {
			const ans = (card.filter ?? []).find((f) => f.q === q.q);
			if (!ans) err(id, `нет ответа на ${q.q}`);
			else if (!VERDICTS.includes(ans.verdict)) err(id, `на ${q.q} ответ «${ans.verdict}»`);
			else if (!ans.why) err(id, `на ${q.q} нет пояснения`);
		}
	}
	return { errors, newPeople };
}

async function main() {
	const { posts, anime } = await loadCorpus();
	const byId = new Map(posts.map((p) => [p.id, p]));
	const animeIds = new Set(anime.map((a) => a.id));
	const dict = await readDictionary();
	const manifest = JSON.parse(await readFile(join(batchDir, 'пачки.json'), 'utf8'));

	if (selftest) {
		// Эталон: пост с вопросом фильтра и главным тайтлом, карточка без ошибок.
		const batch = manifest.batches.find((b) => b.posts.some((p) => p.questions.length && p.mainAnime.length)) ?? manifest.batches[0];
		const spec = batch.posts.find((p) => p.questions.length && p.mainAnime.length) ?? batch.posts[0];
		const post = byId.get(spec.id);
		const tb = post.blocks.find((b) => b.kind === 'text').n;
		const good = {
			id: spec.id,
			about: 'Проверочная карточка для самопроверки.',
			labels: [{ code: [...dict.codes][0], level: 'главная', blocks: [tb] }],
			people: [],
			studios: [],
			subjectAnime: [],
			coverage: spec.mainAnime.map((a) => ({ anime: a, scope: 'общий', why: 'проверка' })),
			filter: spec.questions.map((q) => ({ q: q.q, verdict: 'тема', why: 'проверка' })),
		};
		const one = { posts: [spec] };
		const run = (card) => checkCards({ cards: [card], batch: one, byId, animeIds, dict }).errors.length;
		const bad = {
			'метка не из словаря': { ...good, labels: [{ code: 'нет-такой-метки', level: 'главная', blocks: [tb] }] },
			'несуществующий блок': { ...good, labels: [{ ...good.labels[0], blocks: [9999] }] },
			'нет ответа фильтра': { ...good, filter: [] },
			'нет охвата главного тайтла': { ...good, coverage: [] },
			'неизвестный тайтл': { ...good, subjectAnime: [{ anime: 'net-takogo-taytla', why: 'x' }] },
		};
		let fail = 0;
		console.log(`Хорошая карточка (${spec.id}): ошибок ${run(good)} — нужно 0`);
		if (run(good) !== 0) fail++;
		for (const [name, card] of Object.entries(bad)) {
			const n = run(card);
			console.log(`${n ? 'поймано' : 'ПРОПУЩЕНО'}: ${name}`);
			if (!n) fail++;
		}
		console.log(`Людей в словаре: ${dict.people.size}, меток: ${dict.codes.size}`);
		process.exitCode = fail ? 1 : 0;
		return;
	}

	let total = 0;
	const allNew = [];
	const files = new Set(await readdir(cardDir));
	for (const batch of manifest.batches) {
		const file = `${batch.name}.json`;
		if (!files.has(file)) {
			if (presentOnly) continue;
			console.log(`✗ ${batch.name}: карточек нет (${join(cardDir, file)})`);
			total++;
			continue;
		}
		let cards;
		try {
			cards = JSON.parse(await readFile(join(cardDir, file), 'utf8'));
		} catch (e) {
			console.log(`✗ ${batch.name}: не читается как JSON — ${e.message}`);
			total++;
			continue;
		}
		const { errors, newPeople } = checkCards({ cards, batch, byId, animeIds, dict });
		allNew.push(...newPeople);
		console.log(`${errors.length ? '✗' : '✓'} ${batch.name}: карточек ${cards.length}, ошибок ${errors.length}`);
		for (const e of errors) console.log('    ' + e);
		total += errors.length;
	}
	// Новые люди — по имени, с числом постов; ниже — пары похожих написаний
	// (одна фамилия или разница в одну-две буквы): опечатки и дубли вроде
	// «Хидеаки / Хидэаки Анно» видны сразу, а не на ревью.
	const byName = new Map();
	for (const s of allNew) {
		const m = s.match(/^(.*?) \((.*?)\) — (.*)$/u);
		if (!m) continue;
		const e = byName.get(m[1]) ?? { roles: new Set(), posts: [] };
		e.roles.add(m[2]);
		e.posts.push(m[3]);
		byName.set(m[1], e);
	}
	console.log(`\nНовых людей (нет в словаре): ${byName.size} имён, упоминаний ${allNew.length}`);
	for (const [name, e] of [...byName].sort((a, b) => b[1].posts.length - a[1].posts.length || a[0].localeCompare(b[0], 'ru'))) console.log(`  + ${name} (${[...e.roles].join(', ')}) ×${e.posts.length}: ${e.posts.slice(0, 4).join(', ')}${e.posts.length > 4 ? '…' : ''}`);
	const lev = (a, b) => {
		const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
		for (let j = 1; j <= b.length; j++) d[0][j] = j;
		for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		return d[a.length][b.length];
	};
	const everyone = [...new Set([...byName.keys(), ...dict.people])];
	const last = (n) => n.trim().split(/\s+/u).pop().toLowerCase();
	const similar = [];
	for (const a of byName.keys()) for (const b of everyone) if (a < b || !byName.has(b)) if (a !== b && (last(a) === last(b) || lev(a.toLowerCase(), b.toLowerCase()) <= 2)) similar.push(`${a} ≈ ${b}${byName.has(b) ? '' : ' (словарь)'}`);
	if (similar.length) console.log(`\nПохожие написания — проверить, не одно ли лицо (${similar.length}):\n  ${[...new Set(similar)].join('\n  ')}`);
	console.log(`\nОшибок всего: ${total}`);
	process.exitCode = total ? 1 : 0;
}

await main();
