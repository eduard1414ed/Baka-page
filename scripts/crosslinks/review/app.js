// ПЕРЕЛИНКОВКА — СТРАНИЦА РЕВЬЮ, ПОВЕДЕНИЕ (сессия 2).
//
// Единица ревью — ПОСТ: все его кандидаты на своих местах, запасные цели
// рядом. Каждое действие — решение, и оно сохраняется сразу (сервер пишет
// статус/перелинковка/решения.json и отклонено.json). В макете (window.STATIC)
// сервера нет: решения живут до перезагрузки.
//
// Решение по кандидату — одна запись с ключом «источник→цель»:
//   state   approved | rejected | deferred (нет записи — не решено);
//   place   { afterBlock, anchorWords } — где встанет вставка;
//   moved   место перенесено Эдом; manual — своя цель Эда;
//   from    main | reserve | manual — откуда кандидат;
//   replaces — ключ основного, вместо которого подставлен запасной;
//   play, label — вид вставки; reason, comment — причина отказа;
//   kind, confidence — вид связи и уверенность НА МОМЕНТ РЕШЕНИЯ: по ним
//   считается статистика, и она не должна зависеть от будущего пересчёта.

(() => {
	'use strict';

	const REASONS = [
		['weak', 'слабая связь'],
		['place', 'не то место'],
		['better', 'цель неудачная, есть лучше'],
		['none', 'посту не нужна вставка'],
		['other', 'другое'],
	];
	const LEVEL_CLASS = { сильный: 'strong', средний: 'medium', слабый: 'weak' };

	let D = null; // данные страницы (model.mjs)
	const S = { decisions: new Map(), cursor: null };
	const UI = { post: 0, cur: 0, moving: null, rejecting: null, showAllRes: false, keysMin: false, summary: false, confirmAll: false, search: '', hit: 0 };

	// ——— Хранение ———
	const api = window.STATIC
		? {
				async load() {
					return { decisions: [], cursor: null };
				},
				async save() {},
				async remove() {},
				async cursor() {},
			}
		: {
				async load() {
					const r = await fetch('api/state');
					if (!r.ok) throw new Error(await r.text());
					return r.json();
				},
				async save(rec) {
					await post('api/decision', rec);
				},
				async remove(key) {
					await post('api/decision', { key, remove: true });
				},
				async cursor(c) {
					await post('api/cursor', c);
				},
			};

	async function post(url, body) {
		const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		if (!r.ok) {
			const t = await r.text();
			toast(`НЕ СОХРАНИЛОСЬ: ${t}`, true);
			throw new Error(t);
		}
	}

	let toastTimer = null;
	function toast(text, bad = false) {
		let el = document.querySelector('.toast');
		if (!el) {
			el = document.createElement('div');
			document.body.append(el);
		}
		el.className = 'toast' + (bad ? ' bad' : '');
		el.textContent = text;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => el.remove(), bad ? 8000 : 1800);
	}

	const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
	const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '');

	// ——— Модель поста ———
	const P = () => D.posts[UI.post];
	const batchPosts = (b) => D.posts.filter((p) => p.batch === b);

	/** Кандидаты поста на экране: основные + всё, по чему уже есть решение. */
	function items(p) {
		const out = p.candidates.filter((c) => c.status === 'основной').map((c) => ({ ...c, from: 'main' }));
		const have = new Set(out.map((c) => c.key));
		for (const rec of S.decisions.values()) {
			if (rec.source !== p.id || have.has(rec.key)) continue;
			const base = p.candidates.find((c) => c.key === rec.key);
			out.push(
				base
					? { ...base, from: rec.from ?? 'reserve' }
					: // Кандидата нет в нынешнем списке: своя цель Эда — или пара, которую
						// find.mjs после отказа больше не предлагает. Вид берём из решения.
						{
							key: rec.key,
							target: rec.target,
							status: rec.manual ? 'ручная' : 'нет в списке',
							confidence: rec.confidence ?? '—',
							channels: rec.channels ?? [],
							kind: rec.kind ?? 'manual',
							kindLabel: rec.manual ? 'своя цель' : (D.kinds[rec.kind] ?? rec.kind),
							reason: rec.manual ? 'добавлено вручную' : 'пары нет в нынешнем списке кандидатов (после отказа поиск её больше не предлагает)',
							reasons: [],
							place: rec.originalPlace ?? rec.place,
							notes: [],
							playDefault: false,
							from: rec.from ?? 'manual',
						},
			);
			have.add(rec.key);
		}
		// Номера К1, К2… — сверху вниз по тексту, как их видно на экране.
		const at = (c) => (S.decisions.get(c.key)?.place ?? c.place)?.afterBlock ?? Infinity;
		return out.map((c, i) => [c, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([c]) => c);
	}

	const decision = (key) => S.decisions.get(key) ?? null;
	const placeOf = (c) => decision(c.key)?.place ?? c.place;
	const stateOf = (c) => decision(c.key)?.state ?? 'pending';
	const target = (id) => D.targets[id] ?? { id, title: id, kindLabel: '?', about: '', url: '#', canPlay: false };

	function playOf(c) {
		const d = decision(c.key);
		if (d && typeof d.play === 'boolean') return d.play;
		return Boolean(c.playDefault && target(c.target).canPlay);
	}

	function textUpTo(p, b) {
		let n = 0;
		for (const x of p.blocks) if (x.n <= b && x.kind === 'text') n++;
		return n;
	}
	function tailStart(p) {
		let i = p.blocks.length;
		while (i > 0) {
			const k = p.blocks[i - 1].kind;
			if (k === 'anime-ref' || k === 'material' || k.startsWith('directive:') || k.startsWith('other:')) i--;
			else break;
		}
		return i;
	}
	const textBetween = (p, a, b) => p.blocks.filter((x) => x.kind === 'text' && x.n > Math.min(a, b) && x.n <= Math.max(a, b)).length;

	/** Нарушения правил места — предупреждение, не запрет (задание, шаг 1). */
	function placeWarnings(p, c, b) {
		const out = [];
		if (b == null) return ['место потеряно: абзац не найден в нынешнем тексте'];
		if (textUpTo(p, b) < D.rules.minTextBefore) out.push(`раньше конца ${D.rules.minTextBefore}-го абзаца`);
		if (b >= tailStart(p)) out.push('после карточек тайтлов');
		const at = p.blocks[b];
		if (at?.kind === 'heading' && at.depth <= 4) out.push('сразу под заголовком раздела');
		const others = [];
		for (const o of items(p)) if (o.key !== c.key && stateOf(o) !== 'rejected' && placeOf(o)) others.push(placeOf(o).afterBlock);
		// Уже стоящая вставка — блок `material` с номером m, то есть «после m−1».
		for (const x of p.blocks) if (x.kind === 'material') others.push(x.n - 1);
		if (others.some((o) => textBetween(p, o, b) < D.rules.minTextBetween)) out.push('ближе абзаца к другой вставке');
		return out;
	}

	/** Абзац-якорь места: ближайший текстовый блок не ниже b. */
	function anchorAt(p, b) {
		for (let i = b; i >= 0; i--) if (p.blocks[i]?.kind === 'text') return { anchorBlock: i, anchorWords: p.blocks[i].text.split(/\s+/).slice(0, 10).join(' ') };
		return { anchorBlock: null, anchorWords: '' };
	}
	const placeAt = (p, b) => ({ afterBlock: b, ...anchorAt(p, b) });

	// ——— Решения ———
	function baseRecord(c, extra = {}) {
		const p = P();
		const had = decision(c.key);
		const place = had?.place ?? c.place;
		return {
			key: c.key,
			source: p.id,
			target: c.target,
			from: c.from,
			kind: c.kind,
			confidence: c.confidence,
			channels: c.channels,
			batch: p.batch,
			targetKind: target(c.target).external ? 'external' : target(c.target).category,
			place: place ? placeAt(p, place.afterBlock) : null,
			originalPlace: c.place ? { afterBlock: c.place.afterBlock, anchorBlock: c.place.anchorBlock, anchorWords: c.place.anchorWords } : null,
			moved: had?.moved ?? false,
			manual: c.from === 'manual',
			replaces: had?.replaces ?? null,
			play: had?.play ?? playOf(c),
			label: had?.label ?? null,
			fingerprint: p.fingerprint,
			...extra,
			decidedAt: new Date().toISOString(),
		};
	}

	async function setDecision(rec) {
		S.decisions.set(rec.key, rec);
		render();
		await api.save(rec);
	}
	async function removeDecision(key) {
		S.decisions.delete(key);
		render();
		await api.remove(key);
	}

	const approve = (c, extra = {}) => setDecision(baseRecord(c, { state: 'approved', reason: null, comment: null, ...extra }));
	const defer = (c) => setDecision(baseRecord(c, { state: 'deferred', reason: null, comment: null }));
	const reject = (c, reason, comment = null) => setDecision(baseRecord(c, { state: 'rejected', reason, comment }));

	async function moveTo(c, b) {
		const p = P();
		const had = decision(c.key);
		const extra = { place: placeAt(p, b), moved: b !== c.place?.afterBlock };
		UI.moving = null;
		if (!had || had.state === 'rejected') await approve(c, extra);
		else await setDecision(baseRecord(c, { ...extra, state: had.state, reason: had.reason, comment: had.comment }));
		const w = placeWarnings(p, c, b);
		toast(w.length ? `Перенесено. Внимание: ${w.join('; ')}` : 'Перенесено и одобрено', w.length > 0);
	}

	// Запасной: «вместо основной» — на её место, основная отклоняется с причиной
	// «есть лучше»; «добавить» — на своё место.
	async function useReserve(r, replaceKey) {
		const p = P();
		const c = { ...r, from: 'reserve' };
		if (replaceKey) {
			const main = items(p).find((x) => x.key === replaceKey);
			await reject(main, 'better', `заменена на «${target(r.target).title}»`);
			await approve(c, { place: { ...placeOf(main) }, moved: true, replaces: replaceKey });
		} else await approve(c);
		UI.cur = items(p).findIndex((x) => x.key === r.key);
	}

	// «Заменить цель» прямо на плашке (замечание Эда после 15 постов: прежде
	// замена шла в три шага — своя цель в конец, перенос, отказ старой).
	// Новая цель встаёт на МЕСТО старой, старая отклоняется «есть лучше».
	// Цель из запасных поста сохраняет свой вид связи; любая другая — своя.
	async function replaceWith(oldKey, targetId) {
		const p = P();
		const old = items(p).find((x) => x.key === oldKey);
		const key = `${p.id}→${targetId}`;
		if (items(p).some((x) => x.key === key && stateOf(x) !== 'rejected')) {
			toast('Эта цель у поста уже стоит');
			return;
		}
		const reserve = p.candidates.find((x) => x.key === key);
		const c = reserve ? { ...reserve, from: 'reserve' } : { key, target: targetId, kind: 'manual', confidence: '—', channels: [], from: 'manual', place: null, playDefault: false };
		UI.replacing = null;
		UI.rsearch = '';
		await reject(old, 'better', `заменена на «${target(targetId).title}»`);
		await setDecision(baseRecord(c, { state: 'approved', place: placeAt(p, placeOf(old).afterBlock), moved: false, manual: !reserve, replaces: oldKey, play: reserve ? playOf(c) : false }));
		UI.cur = items(p).findIndex((x) => x.key === key);
		render();
		toast(`Заменено: «${target(targetId).title}»`);
	}

	/** Варианты замены: сначала запасные поста, потом весь архив по слову. */
	function replaceOptions(p, query) {
		const taken = new Set(items(p).filter((x) => stateOf(x) !== 'rejected').map((x) => x.target));
		const norm = (t) => t.toLowerCase().replace(/ё/g, 'е');
		const q = norm(query.trim());
		const res = p.candidates
			.filter((c) => c.status === 'запасной' && !taken.has(c.target) && (!q || norm(target(c.target).title).includes(q)))
			.map((c) => ({ id: c.target, note: `запасная · ${c.kindLabel} · ${c.confidence}` }));
		const seen = new Set(res.map((x) => x.id));
		const more =
			q.length >= 2
				? Object.values(D.targets)
						.filter((t) => t.id !== p.id && !taken.has(t.id) && !seen.has(t.id) && norm(t.title).includes(q))
						.map((t) => ({ id: t.id, note: 'своя цель' }))
				: [];
		return [...res.slice(0, q ? 20 : 6), ...more].slice(0, 14);
	}

	async function addManual(targetId) {
		const p = P();
		const key = `${p.id}→${targetId}`;
		if (items(p).some((x) => x.key === key)) {
			toast('Эта цель у поста уже есть');
			return;
		}
		const b = tailStart(p) - 1;
		const c = { key, target: targetId, kind: 'manual', confidence: '—', channels: [], from: 'manual', place: null, playDefault: false };
		await setDecision(baseRecord(c, { state: 'approved', place: placeAt(p, b), moved: false, manual: true, play: false }));
		UI.cur = items(p).findIndex((x) => x.key === key);
		UI.moving = key;
		UI.search = '';
		render();
		toast('Своя цель добавлена в конец. Выберите место: нажмите на абзац');
	}

	// ——— Навигация ———
	function goPost(i) {
		UI.post = Math.max(0, Math.min(D.posts.length - 1, i));
		UI.cur = 0;
		UI.moving = UI.rejecting = UI.replacing = null;
		UI.showAllRes = UI.confirmAll = false;
		api.cursor({ post: P().id }).catch(() => {});
		render();
		window.scrollTo(0, 0);
	}
	function nextPost() {
		const p = P();
		const nx = D.posts[UI.post + 1];
		if (!nx || nx.batch !== p.batch) {
			UI.summary = p.batch;
			render();
			return;
		}
		goPost(UI.post + 1);
	}

	// ——— Отрисовка ———
	function shortText(t) {
		const parts = t.split(/(?<=[.!?…])\s+/u);
		let s = parts[0];
		if (s.length < 90 && parts[1]) s += ' ' + parts[1];
		return s.length < t.length ? s + ' …' : s;
	}

	function blockHtml(p, b, full) {
		const n = `<span class="n">${b.n}</span>`;
		const tag = UI.moving != null ? ' data-move="' + b.n + '"' : '';
		if (b.kind === 'text') return `<p class="blk text${full.has(b.n) ? ' full' : ''}" data-n="${b.n}"${tag}>${n}${esc(full.has(b.n) ? b.text : shortText(b.text))}</p>`;
		if (b.kind === 'heading') return `<div class="blk heading" data-n="${b.n}"${tag}>${n}${esc(b.text)}</div>`;
		if (b.kind === 'material') return `<div class="blk existing" data-n="${b.n}"${tag}>${n}уже стоит вставка: «${esc(b.material.title)}»</div>`;
		const label = { image: '▣ картинка', video: '▶ видео', 'anime-ref': `◈ карточка тайтла: ${esc(b.anime)}`, 'directive:link': '⧉ ссылки врезкой', 'directive:label': '[ подпись блока ]' }[b.kind] ?? b.kind;
		return `<div class="blk chip" data-n="${b.n}"${tag}>${n}${label}</div>`;
	}

	function refHtml(c) {
		const t = target(c.target);
		const play = playOf(c);
		const d = decision(c.key);
		const label = d?.label || (play ? D.defaultLabel[t.category] : D.defaultLabel.link) || D.defaultLabel.link;
		const thumb = t.thumb ? `<img class="ref-thumb${t.category === 'podcast' ? ' square' : ''}" src="${esc(t.thumb)}" alt="" loading="lazy">` : '';
		const meta = `${esc(t.meta ?? t.kindLabel)}${t.date ? ' · ' + fmtDate(t.date) : ''}`;
		if (play)
			return `<div class="ref play${thumb ? '' : ' no-cover'}"><div class="label">${esc(label)}</div><div class="ref-row"><span class="play-btn">▶</span><div><div class="ref-title">${esc(t.title)} <span class="arrow">→</span></div><div class="ref-meta">${meta}</div></div>${thumb}</div></div>`;
		return `<div class="ref${thumb ? '' : ' no-cover'}"><div class="label">${esc(label)}</div><div class="ref-row">${thumb}<div><div class="ref-title">${esc(t.title)} <span class="arrow">${t.external ? '↗' : '→'}</span></div><div class="ref-meta">${meta}</div></div></div></div>`;
	}

	function insHtml(p, c, idx) {
		const t = target(c.target);
		const st = stateOf(c);
		const d = decision(c.key);
		const pl = placeOf(c);
		const warns = placeWarnings(p, c, pl?.afterBlock);
		const stName = { pending: 'не решено', approved: p.inserted?.includes(c.target) ? 'одобрено · вписано' : 'одобрено', rejected: 'отклонено', deferred: 'отложено' }[st];
		const fromName = { main: '', reserve: ' · из запасных', manual: ' · своя цель' }[c.from];
		const lost = d?.placeLost || c.placeLost;
		let html = `<div class="ins ${st}${idx === UI.cur ? ' current' : ''}" data-idx="${idx}">`;
		html += `<div class="ins-top"><span><b>К${idx + 1}</b> · ${esc(t.kindLabel)}${fromName}${d?.moved ? ' · место перенесено' : ''}</span><span class="state ${st}">${stName}${st === 'rejected' && d.reason ? ': ' + esc(REASONS.find((r) => r[0] === d.reason)?.[1]) : ''}</span></div>`;
		html += refHtml(c);
		if (t.about) html += `<div class="about"><b>О чём цель:</b> ${esc(t.about)}</div>`;
		html += `<div class="tags"><span class="tag">${esc(c.kindLabel)}</span>`;
		if (c.confidence !== '—') html += `<span class="tag ${LEVEL_CLASS[c.confidence] ?? ''}">${esc(c.confidence)}</span>`;
		if (c.channels?.length) html += `<span class="tag">${c.channels.length > 1 ? 'оба канала' : c.channels[0] === 'titles' ? 'канал «тайтлы»' : 'канал «темы»'}</span>`;
		for (const n of c.notes ?? []) html += `<span class="tag note">${esc(n)}</span>`;
		for (const w of warns) html += `<span class="tag warn">⚠ ${esc(w)}</span>`;
		if (lost) html += `<span class="tag warn">⚠ пост изменился, абзаца места больше нет — выберите место заново</span>`;
		html += `</div>`;
		const reasons = c.reasons?.length ? c.reasons : [c.reason];
		html += `<div class="why"><b>Почему:</b><ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`;
		if (pl) html += `<div style="color:var(--muted);font-size:14px;margin-top:6px">Место: после абзаца ${textUpTo(p, pl.afterBlock)} из ${p.blocks.filter((x) => x.kind === 'text').length}${c.place?.mode && !d?.moved ? ` (${esc(c.place.mode)})` : ''} — «${esc(pl.anchorWords)}…»</div>`;
		html += ` <a href="${esc(t.url)}" target="_blank" rel="noopener">открыть цель на сайте ↗</a></div>`;

		html += `<div class="acts">`;
		html += `<button class="btn${st === 'approved' ? ' ok' : ''}" data-act="approve" data-idx="${idx}">✅ Одобрить<kbd>A</kbd></button>`;
		html += `<button class="btn${st === 'rejected' ? ' no' : ''}" data-act="reject" data-idx="${idx}">❌ Отклонить<kbd>R</kbd></button>`;
		html += `<button class="btn${UI.moving === c.key ? ' on' : ''}" data-act="move" data-idx="${idx}">↕ Другое место<kbd>M</kbd></button>`;
		html += `<button class="btn${UI.replacing === c.key ? ' on' : ''}" data-act="replace-open" data-idx="${idx}">🔁 Заменить цель<kbd>Z</kbd></button>`;
		html += `<button class="btn${st === 'deferred' ? ' wait' : ''}" data-act="defer" data-idx="${idx}">⏭ Отложить<kbd>S</kbd></button>`;
		if (st !== 'pending') html += `<button class="btn" data-act="undo" data-idx="${idx}">↺ Вернуть «не решено»<kbd>U</kbd></button>`;
		html += `</div>`;
		if (UI.replacing === c.key) {
			const opts = replaceOptions(p, UI.rsearch ?? '');
			UI.rlist = opts.map((o) => o.id);
			html += `<div class="opts search replace"><input id="rsearch" type="text" placeholder="слово из заголовка — или выберите из запасных ниже" value="${esc(UI.rsearch ?? '')}" autocomplete="off"><span class="hint">↑/↓ и Enter — выбрать, Esc — отмена. Новая цель встанет на это место, эта отклонится «есть лучше».</span>`;
			html += opts.map((o, i) => `<button class="hit${i === (UI.rhit ?? 0) ? ' sel' : ''}" data-act="replace-pick" data-id="${esc(o.id)}" data-idx="${idx}">${esc(target(o.id).title)}<br><small>${esc(target(o.id).kindLabel)} · ${esc(o.note)} · ${fmtDate(target(o.id).date)}</small></button>`).join('') || '<div class="hint">Ничего не нашлось.</div>';
			html += `</div>`;
		}
		if (UI.moving === c.key) html += `<div class="opts"><span class="hint">Нажмите на абзац (или ↑/↓ и Enter), после которого встанет вставка. Esc — отмена.</span></div>`;
		if (UI.rejecting === c.key) {
			html += `<div class="reasons">${REASONS.map(([k, name], i) => `<button class="btn no" data-act="reason" data-reason="${k}" data-idx="${idx}">${esc(name)}<kbd>${i + 1}</kbd></button>`).join('')}`;
			html += `<textarea id="other-comment" placeholder="Коротко, почему (для «другое» — обязательно; Enter — сохранить)">${esc(d?.comment ?? '')}</textarea></div>`;
		}
		if (st === 'approved') {
			const why = !t.canPlay ? (t.external ? 'внешний материал играть не может' : t.category === 'bonus' ? 'у бонуса нет своего звука' : 'играть может только выпуск или эссе') : '';
			html += `<div class="opts"><button class="btn${playOf(c) ? ' on' : ''}" data-act="play" data-idx="${idx}" ${t.canPlay ? '' : 'disabled'}>▶ Играет здесь: ${playOf(c) ? 'да' : 'нет'}<kbd>P</kbd></button>${why ? `<span class="hint">${why}</span>` : ''}`;
			html += `<label>Подпись: <input type="text" data-act="label" data-idx="${idx}" value="${esc(d?.label ?? '')}" placeholder="${esc(playOf(c) ? D.defaultLabel[t.category] : D.defaultLabel.link)} (по умолчанию)"></label><span class="hint"><kbd>L</kbd> — к подписи, Enter — сохранить</span></div>`;
		}
		return html + `</div>`;
	}

	function sideHtml(p) {
		const shown = new Set(items(p).map((x) => x.key));
		const res = p.candidates.filter((c) => c.status === 'запасной' && !shown.has(c.key));
		// «Вместо» — вместо ВЫДЕЛЕННОЙ вставки (синяя рамка; J/K или клик).
		// Номер берётся по ключу: items() каждый раз отдаёт новые объекты,
		// и поиск по объекту давал −1, то есть «К0» (замечание Эда к макету).
		const all = items(p);
		const cur = all[UI.cur];
		const list = UI.showAllRes ? res : res.slice(0, 6);
		let h = `<section><h2>Запасные цели (${res.length})</h2>`;
		if (!res.length) h += `<div class="res m">Запасных нет.</div>`;
		for (const r of list) {
			const t = target(r.target);
			h += `<div class="res"><div class="t">${esc(t.title)}</div><div class="m">${esc(t.kindLabel)} · ${esc(r.kindLabel)} · ${esc(r.confidence)}<br>${esc(r.reason)}</div><div class="b">`;
			if (cur) h += `<button class="btn" data-act="replace" data-key="${esc(r.key)}" data-main="${esc(cur.key)}" title="Встанет на место К${UI.cur + 1}, а К${UI.cur + 1} отклонится с причиной «есть лучше»">вместо К${UI.cur + 1}</button>`;
			h += `<button class="btn" data-act="add" data-key="${esc(r.key)}">+ добавить</button><a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">↗</a></div></div>`;
		}
		if (res.length > 6) h += `<button class="btn" data-act="allres">${UI.showAllRes ? 'свернуть' : `показать все ${res.length}`}</button>`;
		h += `</section>`;

		h += `<section class="search"><h2>Своя цель <kbd>T</kbd></h2><input id="search" type="text" placeholder="слово из заголовка…" value="${esc(UI.search)}" autocomplete="off">`;
		if (UI.search.trim().length >= 2) {
			const q = UI.search.trim().toLowerCase().replace(/ё/g, 'е');
			const hits = Object.values(D.targets)
				.filter((t) => t.id !== p.id && t.title.toLowerCase().replace(/ё/g, 'е').includes(q))
				.slice(0, 12);
			UI.hitList = hits.map((t) => t.id);
			h += hits.map((t, i) => `<button class="hit${i === UI.hit ? ' sel' : ''}" data-act="manual" data-id="${esc(t.id)}">${esc(t.title)}<br><small>${esc(t.kindLabel)} · ${fmtDate(t.date)}</small></button>`).join('') || '<div class="res m">Ничего не нашлось.</div>';
		} else UI.hitList = [];
		h += `</section>`;

		h += `<section><h2>Весь пост</h2><button class="btn no wrap" data-act="rejectall">${UI.confirmAll ? 'Точно? Нажмите ещё раз' : 'Всё отклонить — посту не нужны вставки'}<kbd>X</kbd></button></section>`;
		return h + keysHtml();
	}

	function summaryHtml(b) {
		const posts = batchPosts(b);
		const ids = new Set(posts.map((p) => p.id));
		const recs = [...S.decisions.values()].filter((r) => ids.has(r.source));
		const decidedKeys = new Set(recs.map((r) => r.key));
		const undecided = posts.flatMap((p) => p.candidates.filter((c) => c.status === 'основной' && !decidedKeys.has(c.key)));
		const table = (title, keyOf, labels) => {
			const rows = new Map();
			const bump = (k, col) => {
				if (!rows.has(k)) rows.set(k, { approved: 0, rejected: 0, deferred: 0, pending: 0 });
				rows.get(k)[col]++;
			};
			for (const r of recs) bump(keyOf(r), r.state);
			for (const c of undecided) bump(keyOf(c), 'pending');
			let h = `<h3>${title}</h3><table><tr><th></th><th>одобрено</th><th>отклонено</th><th>отложено</th><th>не решено</th><th>доля «да»</th></tr>`;
			for (const [k, v] of [...rows].sort((a, b) => b[1].approved + b[1].rejected - a[1].approved - a[1].rejected)) {
				const done = v.approved + v.rejected;
				h += `<tr><td>${esc(labels?.[k] ?? k)}</td><td>${v.approved}</td><td>${v.rejected}</td><td>${v.deferred}</td><td>${v.pending}</td><td>${done ? Math.round((100 * v.approved) / done) + ' %' : '—'}</td></tr>`;
			}
			return h + `</table>`;
		};
		const kinds = { ...D.kinds, manual: 'своя цель' };
		let h = `<div class="overlay" data-act="closesum"><div class="sheet" onclick="event.stopPropagation()">`;
		h += `<h2>Сводка пачки ${b}: ${esc(D.batches[b])}</h2><div style="color:var(--muted)">Постов ${posts.length}. Решений ${recs.length}, основных без решения ${undecided.length}.</div>`;
		h += table('По виду связи', (r) => r.kind, kinds);
		h += table('По уверенности', (r) => r.confidence);
		const why = {};
		for (const r of recs.filter((r) => r.state === 'rejected')) why[r.reason] = (why[r.reason] ?? 0) + 1;
		h += `<h3>Причины отказов</h3><table>${REASONS.map(([k, n]) => `<tr><td>${esc(n)}</td><td>${why[k] ?? 0}</td></tr>`).join('')}</table>`;
		const comments = recs.filter((r) => r.state === 'rejected' && r.comment && !r.replaces);
		if (comments.length) h += `<h3>Комментарии к отказам</h3><table>${comments.map((r) => `<tr><td>${esc(target(r.target).title)}</td><td style="text-align:left">${esc(r.comment)}</td></tr>`).join('')}</table>`;
		h += `<h3>Ручное</h3><table><tr><td>своих целей</td><td>${recs.filter((r) => r.manual).length}</td></tr><tr><td>подставлено из запасных</td><td>${recs.filter((r) => r.from === 'reserve').length}</td></tr><tr><td>перенесённых мест</td><td>${recs.filter((r) => r.moved && r.state === 'approved').length}</td></tr><tr><td>«играет здесь» включено</td><td>${recs.filter((r) => r.state === 'approved' && r.play).length}</td></tr><tr><td>своих подписей</td><td>${recs.filter((r) => r.state === 'approved' && r.label).length}</td></tr></table>`;
		const nextBatch = D.posts.find((p) => p.batch > b);
		h += `<div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap"><button class="btn" data-act="closesum">Вернуться к постам<kbd>Esc</kbd></button>`;
		if (nextBatch) h += `<button class="btn ok" data-act="gobatch" data-b="${nextBatch.batch}">К пачке ${nextBatch.batch}: ${esc(D.batches[nextBatch.batch])}</button>`;
		return h + `</div></div></div>`;
	}

	// Клавиши — блоком в правой колонке, а не поверх текста (замечание Эда:
	// список в углу перекрывал плашку и абзацы).
	function keysHtml() {
		if (UI.keysMin) return `<section class="keys"><h2>Клавиши <kbd>?</kbd> показать</h2></section>`;
		const k = [
			['A', 'одобрить'],
			['R', 'отклонить → 1–5 причина'],
			['M', 'другое место (↑↓ Enter)'],
			['Z', 'заменить цель на этом месте'],
			['S', 'отложить'],
			['U', 'вернуть «не решено»'],
			['P', 'играет здесь'],
			['L', 'подпись'],
			['J / K', 'следующая / пред. вставка'],
			['N / →', 'следующий пост'],
			['B / ←', 'предыдущий пост'],
			['T', 'своя цель'],
			['X', 'всё отклонить'],
			['G', 'сводка пачки'],
			['?', 'спрятать']
		];
		return `<section class="keys"><h2>Клавиши</h2>${k.map(([a, b]) => `<div><kbd>${a}</kbd>${b}</div>`).join('')}</section>`;
	}

	function render() {
		const p = P();
		const list = items(p);
		UI.cur = Math.max(0, Math.min(list.length - 1, UI.cur));
		const inBatch = batchPosts(p.batch);
		const pos = inBatch.indexOf(p) + 1;
		const decided = inBatch.filter((x) => items(x).every((c) => decision(c.key))).length;

		// Какие абзацы показать целиком: вокруг каждой вставки.
		// Абзац перед вставкой и первый после неё.
		const full = new Set();
		for (const c of list) {
			const pl = placeOf(c);
			if (!pl) continue;
			for (let i = pl.afterBlock; i >= 0; i--)
				if (p.blocks[i]?.kind === 'text') {
					full.add(i);
					break;
				}
			const nx = p.blocks.find((x) => x.n > pl.afterBlock && x.kind === 'text');
			if (nx) full.add(nx.n);
		}
		for (const n of UI.opened ?? []) full.add(n);

		let body = '';
		const at = new Map();
		list.forEach((c, i) => {
			const b = placeOf(c)?.afterBlock ?? -1;
			if (!at.has(b)) at.set(b, []);
			at.get(b).push([c, i]);
		});
		for (const [c, i] of at.get(-1) ?? []) body += insHtml(p, c, i);
		for (const b of p.blocks) {
			body += blockHtml(p, b, full);
			for (const [c, i] of at.get(b.n) ?? []) body += insHtml(p, c, i);
		}

		const batchOpts = Object.entries(D.batches)
			.filter(([b]) => batchPosts(+b).length)
			.map(([b, name]) => `<option value="${b}"${+b === p.batch ? ' selected' : ''}>Пачка ${b}: ${esc(name)} (${batchPosts(+b).length})</option>`)
			.join('');
		const nMain = list.filter((c) => c.from === 'main').length;
		document.getElementById('app').innerHTML =
			`<div class="bar"><select id="batch" class="btn">${batchOpts}</select><span class="where">Пост ${pos} из ${inBatch.length} <small>· решено постов ${decided}</small></span><span class="progress"><i style="width:${Math.round((100 * decided) / inBatch.length)}%"></i></span><span class="spacer"></span>` +
			`<button class="btn" data-act="prev">← Предыдущий<kbd>B</kbd></button><button class="btn" data-act="next">Следующий →<kbd>N</kbd></button><button class="btn" data-act="sum">Сводка пачки<kbd>G</kbd></button></div>` +
			(window.STATIC ? `<div class="banner">МАКЕТ: два настоящих поста, решения не сохраняются и пропадут при перезагрузке.</div>` : '') +
			(!window.STATIC && !D.hasFingerprints ? `<div class="banner bad">В файле кандидатов нет отпечатков постов: изменившийся пост страница не заметит. Перезапустите find.mjs.</div>` : '') +
			(p.changed ? `<div class="banner bad">Пост изменился после поиска кандидатов (роботы или админка). Места проверены заново по первым словам абзаца — посмотрите на пометки ⚠.</div>` : '') +
			`<div class="layout${UI.moving ? ' moving' : ''}"><main><div class="post-head"><h1>${esc(p.title)}</h1><div class="meta">${esc(p.categoryLabel)} · ${fmtDate(p.date)}<a href="${esc(p.url)}" target="_blank" rel="noopener">открыть пост на сайте ↗</a></div></div>` +
			`<div class="summary-line">Вставок предложено: ${nMain}${list.length > nMain ? `, добавлено вами: ${list.length - nMain}` : ''}. Серые строки — абзацы в сжатом виде, нажмите, чтобы раскрыть.</div>${body}</main>` +
			`<aside class="side">${sideHtml(p)}</aside></div>` +
			(UI.summary ? summaryHtml(UI.summary) : '');
		if (UI.moving) {
			const c = list.find((x) => x.key === UI.moving);
			const b = UI.moveAt ?? placeOf(c)?.afterBlock;
			document.querySelector(`.blk[data-n="${b}"]`)?.classList.add('target-here');
		}
		if (UI.focusR) {
			const el = document.getElementById('rsearch');
			if (el) (el.focus(), el.setSelectionRange(el.value.length, el.value.length));
			UI.focusR = false;
		}
		if (UI.focusSearch) {
			const el = document.getElementById('search');
			el.focus();
			el.setSelectionRange(el.value.length, el.value.length);
			UI.focusSearch = false;
		}
	}

	// ——— События ———
	function cand(idx) {
		return items(P())[idx];
	}

	async function act(name, el) {
		const idx = el?.dataset.idx != null ? +el.dataset.idx : UI.cur;
		const c = cand(idx);
		if (el?.dataset.idx != null) UI.cur = idx;
		const p = P();
		switch (name) {
			case 'approve':
				UI.rejecting = null;
				return approve(c, { state: 'approved' });
			case 'reject':
				UI.rejecting = UI.rejecting === c.key ? null : c.key;
				return render();
			case 'reason': {
				const reason = el.dataset.reason;
				const comment = document.getElementById('other-comment')?.value.trim() || null;
				if (reason === 'other' && !comment) {
					toast('Для «другое» напишите коротко, почему', true);
					document.getElementById('other-comment')?.focus();
					return;
				}
				UI.rejecting = null;
				return reject(c, reason, comment);
			}
			case 'move':
				UI.moving = UI.moving === c.key ? null : c.key;
				UI.moveAt = null;
				return render();
			case 'defer':
				return defer(c);
			case 'replace-open':
				UI.replacing = UI.replacing === c.key ? null : c.key;
				UI.rsearch = '';
				UI.rhit = 0;
				UI.focusR = true;
				return render();
			case 'replace-pick':
				return replaceWith(c.key, el.dataset.id);
			case 'undo':
				UI.rejecting = null;
				return removeDecision(c.key);
			case 'play': {
				if (!target(c.target).canPlay) return;
				const d = decision(c.key);
				if (d?.state !== 'approved') return;
				return setDecision({ ...d, play: !playOf(c), decidedAt: new Date().toISOString() });
			}
			case 'prev':
				return goPost(UI.post - 1);
			case 'next':
				return nextPost();
			case 'sum':
				UI.summary = p.batch;
				return render();
			case 'closesum':
				UI.summary = false;
				return render();
			case 'gobatch':
				UI.summary = false;
				return goPost(D.posts.findIndex((x) => x.batch === +el.dataset.b));
			case 'replace':
				return useReserve(p.candidates.find((x) => x.key === el.dataset.key), el.dataset.main);
			case 'add':
				return useReserve(p.candidates.find((x) => x.key === el.dataset.key), null);
			case 'allres':
				UI.showAllRes = !UI.showAllRes;
				return render();
			case 'manual':
				return addManual(el.dataset.id);
			case 'rejectall':
				if (!UI.confirmAll) {
					UI.confirmAll = true;
					return render();
				}
				UI.confirmAll = false;
				for (const x of items(p)) if (stateOf(x) !== 'rejected') await reject(x, 'none', null);
				return toast('Все вставки поста отклонены');
		}
	}

	document.addEventListener('click', (e) => {
		const mv = e.target.closest('[data-move]');
		if (mv && UI.moving) {
			const c = items(P()).find((x) => x.key === UI.moving);
			return moveTo(c, +mv.dataset.move);
		}
		const el = e.target.closest('[data-act]');
		if (el && el.tagName !== 'INPUT' && !(el.tagName === 'A')) {
			if (el.classList.contains('overlay') && e.target !== el) return;
			e.preventDefault();
			return act(el.dataset.act, el);
		}
		const blk = e.target.closest('.blk.text');
		if (blk) {
			UI.opened ??= new Set();
			const n = +blk.dataset.n;
			UI.opened.has(n) ? UI.opened.delete(n) : UI.opened.add(n);
			render();
		}
	});

	document.addEventListener('change', (e) => {
		if (e.target.id === 'batch') goPost(D.posts.findIndex((x) => x.batch === +e.target.value));
	});

	document.addEventListener('input', (e) => {
		if (e.target.id === 'rsearch') {
			UI.rsearch = e.target.value;
			UI.rhit = 0;
			UI.focusR = true;
			return render();
		}
		if (e.target.id === 'search') {
			UI.search = e.target.value;
			UI.hit = 0;
			UI.focusSearch = true;
			render();
		}
	});

	async function saveLabel(input) {
		const c = cand(+input.dataset.idx);
		const d = decision(c.key);
		const v = input.value.trim() || null;
		if (d && d.label !== v) {
			await setDecision({ ...d, label: v, decidedAt: new Date().toISOString() });
			toast(v ? 'Подпись сохранена' : 'Подпись — по умолчанию');
		}
	}
	document.addEventListener(
		'blur',
		(e) => {
			if (e.target.dataset?.act === 'label') saveLabel(e.target);
		},
		true,
	);

	document.addEventListener('keydown', (e) => {
		const t = e.target;
		if (t.id === 'search') {
			if (e.key === 'Escape') (t.blur(), (UI.search = ''), render());
			else if (e.key === 'ArrowDown') (e.preventDefault(), (UI.hit = Math.min((UI.hitList?.length ?? 1) - 1, UI.hit + 1)), (UI.focusSearch = true), render());
			else if (e.key === 'ArrowUp') (e.preventDefault(), (UI.hit = Math.max(0, UI.hit - 1)), (UI.focusSearch = true), render());
			else if (e.key === 'Enter' && UI.hitList?.[UI.hit]) addManual(UI.hitList[UI.hit]);
			return;
		}
		if (t.id === 'rsearch') {
			if (e.key === 'Escape') (t.blur(), (UI.replacing = null), render());
			else if (e.key === 'ArrowDown') (e.preventDefault(), (UI.rhit = Math.min((UI.rlist?.length ?? 1) - 1, (UI.rhit ?? 0) + 1)), (UI.focusR = true), render());
			else if (e.key === 'ArrowUp') (e.preventDefault(), (UI.rhit = Math.max(0, (UI.rhit ?? 0) - 1)), (UI.focusR = true), render());
			else if (e.key === 'Enter' && UI.rlist?.[UI.rhit ?? 0]) (e.preventDefault(), replaceWith(UI.replacing, UI.rlist[UI.rhit ?? 0]));
			return;
		}
		if (t.dataset?.act === 'label') {
			if (e.key === 'Enter') (e.preventDefault(), t.blur());
			if (e.key === 'Escape') t.blur();
			return;
		}
		if (t.id === 'other-comment') {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				act('reason', { dataset: { reason: 'other', idx: String(UI.cur) } });
			}
			if (e.key === 'Escape') (t.blur(), (UI.rejecting = null), render());
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (UI.summary) {
			if (e.key === 'Escape') act('closesum');
			return;
		}
		const p = P();
		const list = items(p);
		const c = list[UI.cur];
		if (UI.moving) {
			const mc = list.find((x) => x.key === UI.moving);
			const cur = UI.moveAt ?? placeOf(mc)?.afterBlock ?? 0;
			if (e.key === 'Escape') (UI.moving = null), render();
			else if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), (UI.moveAt = Math.min(p.blocks.length - 1, cur + 1)), render());
			else if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), (UI.moveAt = Math.max(0, cur - 1)), render());
			else if (e.key === 'Enter') moveTo(mc, cur);
			return;
		}
		if (UI.rejecting && /^[1-5]$/.test(e.key)) {
			const [reason] = REASONS[+e.key - 1];
			if (reason === 'other') return document.getElementById('other-comment')?.focus(), e.preventDefault();
			return act('reason', { dataset: { reason, idx: String(UI.cur) } });
		}
		const k = e.key.toLowerCase();
		// Русская раскладка: те же физические клавиши.
		const map = { ф: 'a', к: 'r', ь: 'm', ы: 's', я: 'z', г: 'u', з: 'p', д: 'l', о: 'j', л: 'k', т: 'n', и: 'b', е: 't', ч: 'x', п: 'g', ',': '?' };
		const key = map[k] ?? k;
		const run = {
			a: () => act('approve'),
			r: () => act('reject'),
			m: () => act('move'),
			s: () => act('defer'),
			z: () => act('replace-open'),
			u: () => c && decision(c.key) && act('undo'),
			p: () => act('play'),
			l: () => document.querySelector(`input[data-act="label"][data-idx="${UI.cur}"]`)?.focus(),
			j: () => ((UI.cur = Math.min(list.length - 1, UI.cur + 1)), (UI.rejecting = null), render(), document.querySelector('.ins.current')?.scrollIntoView({ block: 'center', behavior: 'smooth' })),
			k: () => ((UI.cur = Math.max(0, UI.cur - 1)), (UI.rejecting = null), render(), document.querySelector('.ins.current')?.scrollIntoView({ block: 'center', behavior: 'smooth' })),
			n: () => nextPost(),
			arrowright: () => nextPost(),
			b: () => goPost(UI.post - 1),
			arrowleft: () => goPost(UI.post - 1),
			t: () => ((UI.focusSearch = true), render()),
			x: () => act('rejectall'),
			g: () => act('sum'),
			'?': () => ((UI.keysMin = !UI.keysMin), render()),
			escape: () => ((UI.rejecting = null), (UI.confirmAll = false), render()),
		}[key];
		if (run) {
			e.preventDefault();
			run();
		}
	});

	// ——— Запуск ———
	async function start() {
		D = window.STATIC ?? (await (await fetch('api/data')).json());
		const st = await api.load();
		for (const r of st.decisions ?? []) S.decisions.set(r.key, r);
		const at = st.cursor?.post ? D.posts.findIndex((p) => p.id === st.cursor.post) : 0;
		UI.post = at >= 0 ? at : 0;
		render();
	}
	start().catch((e) => {
		document.getElementById('app').innerHTML = `<div class="banner bad">Страница не загрузилась: ${esc(e.message)}</div>`;
	});
})();
