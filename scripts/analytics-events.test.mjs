// ПРОВЕРКА СОБЫТИЙ АНАЛИТИКИ НА ПОДДЕЛЬНОМ ОКНЕ.
//
//   node scripts/analytics-events.test.mjs
//
// ГОНЯЕТ НАСТОЯЩИЙ СОБРАННЫЙ ФАЙЛ из dist/_astro/, а не копию кода рядом.
// Копия разошлась бы с оригиналом на первой же правке, и проверка стала бы
// проверять саму себя. Отсюда требование: сначала `npm run build`.
//
// ПОЧЕМУ НЕ БРАУЗЕР. Правило проекта: расширение Chrome тут не используется,
// а всё, что живёт в браузере, проверяет заказчик руками. Но «живёт
// в браузере» и «требует браузера» — разные вещи: порядок событий, арифметика
// прослушанного и разбор нажатий проверяются подделкой окна за секунду,
// и проверяются НАДЁЖНЕЕ, чем глазами (перемотку глазами не отличишь
// от прослушивания).
//
// ЧТО ИМЕННО ПРОВЕРЯЕТСЯ — не только «сработало», но и «НЕ сработало там,
// где не должно»: ссылка на чужой ролик YouTube не «уход слушать подкаст»,
// перемотка не «дослушал», localhost не считается вовсе.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ПАПКА = 'dist/_astro';
const файл = readdirSync(ПАПКА).find((f) => f.startsWith('AnalyticsEvents.astro') && f.endsWith('.js'));
if (!файл) {
	console.error('Собранного файла нет. Сначала: npm run build');
	process.exit(1);
}

// ── ПОДДЕЛЬНОЕ ОКНО ────────────────────────────────────────────────────────


class Узел {
	constructor(классы = [], свойства = {}) {
		this.классы = new Set(классы);
		this.родитель = null;
		this.дети = [];
		this.dataset = свойства.dataset ?? {};
		this.hidden = свойства.hidden ?? false;
		this.textContent = свойства.textContent ?? '';
		this.value = свойства.value ?? '';
		this.href = свойства.href ?? '';
		this.tag = свойства.tag ?? 'div';
		this.id = свойства.id ?? '';
		this.слушатели = new Map();
		this.classList = {
			contains: (имя) => this.классы.has(имя),
		};
	}
	добавить(ребёнок) {
		ребёнок.родитель = this;
		this.дети.push(ребёнок);
		return ребёнок;
	}
	getAttribute(имя) {
		return имя === 'href' ? this.href : null;
	}
	подходит(селектор) {
		return селектор
			.split(',')
			.map((s) => s.trim())
			.some((s) => {
				if (s === 'a[href]') return this.tag === 'a' && Boolean(this.href);
				if (s.startsWith('.')) return this.классы.has(s.slice(1));
				// ГОЛОЕ ИМЯ ТЕГА. Без этой строки подделка не понимала
				// closest('a'), и проверка объявила поломкой исправный код:
				// ссылка внутри реплики «не считалась ссылкой». Сломан был
				// измеритель. 26 августа 2026.
				if (/^[a-z]+$/.test(s)) return this.tag === s;
				return false;
			});
	}
	closest(селектор) {
		let у = this;
		while (у) {
			if (у.подходит?.(селектор)) return у;
			у = у.родитель;
		}
		return null;
	}
	addEventListener(тип, fn) {
		if (!this.слушатели.has(тип)) this.слушатели.set(тип, []);
		this.слушатели.get(тип).push(fn);
	}
	вызвать(тип, событие = {}) {
		for (const fn of this.слушатели.get(тип) ?? []) fn(событие);
	}
}

class Аудио extends Узел {
	constructor() {
		super([], { tag: 'audio' });
		this.currentSrc = '';
		this.currentTime = 0;
		this.duration = NaN;
	}
}

function собратьОкно(хост) {
	const корень = new Узел();
	const узлы = new Map();
	const слушателиДокумента = new Map();
	const аудио = new Аудио();
	узлы.set('player-audio', аудио);

	const все = [];
	const зарегистрировать = (у) => {
		все.push(у);
		корень.добавить(у);
		if (у.id) узлы.set(у.id, у);
		return у;
	};

	const document = {
		addEventListener(тип, fn) {
			if (!слушателиДокумента.has(тип)) слушателиДокумента.set(тип, []);
			слушателиДокумента.get(тип).push(fn);
		},
		getElementById: (id) => узлы.get(id) ?? null,
		querySelector: (сел) => все.find((у) => у.подходит(сел)) ?? null,
		querySelectorAll: (сел) => все.filter((у) => у.подходит(сел)),
	};

	const цели = [];
	let выделено = '';
	const window = {
		getSelection: () => ({ toString: () => выделено }),
		ym: (_id, действие, имя, параметры) => {
			if (действие === 'reachGoal') цели.push({ сервис: 'метрика', имя, параметры });
		},
		gtag: (_вид, имя, параметры) => цели.push({ сервис: 'google', имя, параметры }),
	};

	// Часы под нашим управлением: время идёт тогда, когда мы скажем.
	// Настоящие паузы в 1,2 секунды превратили бы проверку в минуту ожидания.
	const очередь = [];
	let номер = 0;
	const мойSetTimeout = (fn, мс) => {
		const id = ++номер;
		очередь.push({ id, fn, когда: мс });
		return id;
	};
	const мойClearTimeout = (id) => {
		const i = очередь.findIndex((з) => з.id === id);
		if (i > -1) очередь.splice(i, 1);
	};
	const прокрутитьВремя = () => {
		// Задачи могут ставить новые задачи (поиск переспрашивает выдачу) —
		// крутим, пока очередь не опустеет, но не бесконечно.
		for (let шаг = 0; шаг < 50 && очередь.length; шаг++) {
			const з = очередь.shift();
			з.fn();
		}
	};

	return {
		document,
		window,
		location: { hostname: хост, pathname: '/posts/ep-152/', href: `https://${хост}/posts/ep-152/` },
		цели,
		аудио,
		узлы,
		зарегистрировать,
		Узел,
		вызватьНаДокументе: (тип, событие) => {
			for (const fn of слушателиДокумента.get(тип) ?? []) fn(событие);
		},
		setTimeout: мойSetTimeout,
		clearTimeout: мойClearTimeout,
		прокрутитьВремя,
		выделить: (текст) => { выделено = текст; },
	};
}

// ── ЗАПУСК НАСТОЯЩЕГО СКРИПТА ──────────────────────────────────────────────

async function поднять(хост) {
	const о = собратьОкно(хост);
	globalThis.window = о.window;
	globalThis.document = о.document;
	globalThis.location = о.location;
	globalThis.setTimeout = о.setTimeout;
	globalThis.clearTimeout = о.clearTimeout;
	// Кэш модулей у Node один на процесс, а скрипт заперт защёлкой
	// `window.__бакаСобытия` и второй раз не выполнится. Поэтому каждый
	// прогон грузит файл заново — с приписанным к адресу номером.
	await import(`${pathToFileURL(join(process.cwd(), ПАПКА, файл)).href}?прогон=${Math.random()}`);
	// ПОДДЕЛЬНЫЕ ЧАСЫ ОСТАЮТСЯ ПОСЛЕ ЗАГРУЗКИ. Наступили 26 августа 2026:
	// настоящий таймер возвращался сразу, и отложенные задачи поиска уходили
	// в настоящее время — очередь оставалась пустой, а проверка отвечала
	// «событие не пришло» про исправный код. Ложь в сторону «сломано».
	return о;
}

// ── СВЕРКА ─────────────────────────────────────────────────────────────────

let провалов = 0;
function проверить(что, условие, пояснение = '') {
	const знак = условие ? '  ок  ' : '  ✗   ';
	if (!условие) провалов++;
	console.log(`${знак}${что}${пояснение ? `  — ${пояснение}` : ''}`);
}

const имена = (о) => о.цели.filter((ц) => ц.сервис === 'метрика').map((ц) => ц.имя);
const параметры = (о, имя) => о.цели.find((ц) => ц.сервис === 'метрика' && ц.имя === имя)?.параметры ?? {};

console.log('ПРОВЕРКА СОБЫТИЙ АНАЛИТИКИ');
console.log(`Собранный файл: ${файл}\n`);

// ── 1. ПЛЕЕР ───────────────────────────────────────────────────────────────
{
	console.log('── Плеер ──');
	const о = await поднять('ru.bakapodcast.com');
	о.узлы.set('player-link', new о.Узел([], { tag: 'a', href: 'https://ru.bakapodcast.com/posts/ep-152/', textContent: 'Выпуск 152' }));

	const a = о.аудио;
	a.currentSrc = 'https://mave.stream/ep152.mp3';
	a.duration = 100;

	a.вызвать('playing');
	проверить('включение выпуска засчитано', имена(о).includes('player_start'));
	проверить('в событии есть название выпуска', параметры(о, 'player_start').episode === 'Выпуск 152', `пришло: ${параметры(о, 'player_start').episode}`);

	// Слушаем по-настоящему: шажками, как шлёт браузер (4 раза в секунду).
	for (let t = 0.25; t <= 26; t += 0.25) {
		a.currentTime = t;
		a.вызвать('timeupdate');
	}
	проверить('четверть засчитана после 26 секунд из 100', имена(о).includes('player_25'));
	проверить('половина НЕ засчитана', !имена(о).includes('player_50'));

	// ПЕРЕМОТКА: ползунок увели на 95 секунд одним движением.
	a.currentTime = 95;
	a.вызвать('timeupdate');
	a.currentTime = 95.25;
	a.вызвать('timeupdate');
	проверить('перемотка НЕ засчитана как «дослушал»', !имена(о).includes('player_90'), 'ползунок на 95 из 100, а прослушано 26');

	// Повторное нажатие «играть» того же выпуска.
	const было = имена(о).filter((и) => и === 'player_start').length;
	a.вызвать('playing');
	проверить('снятие с паузы не считается новым включением', имена(о).filter((и) => и === 'player_start').length === было);

	// Другой выпуск — новое включение.
	a.currentSrc = 'https://mave.stream/ep153.mp3';
	a.вызвать('playing');
	проверить('второй выпуск — второе включение', имена(о).filter((и) => и === 'player_start').length === было + 1);
	console.log();
}

// ── 2. ТРАНСКРИПТ И ТАЙТЛЫ ─────────────────────────────────────────────────
{
	console.log('── Транскрипт, таймкоды, тайтлы ──');
	const о = await поднять('ru.bakapodcast.com');

	const нажать = (у) => о.вызватьНаДокументе('click', { target: у });

	нажать(о.зарегистрировать(new о.Узел(['tr-expand'])));
	проверить('раскрытие транскрипта засчитано', имена(о).includes('transcript_open'));

	// ПЕРЕМОТКА СЧИТАЕТСЯ ПО ВСЕЙ РЕПЛИКЕ — так мотает сам сайт.
	// Собираем настоящее гнездо: раздел «с плеером» → блок реплики → текст.
	const гнездо = (о, классыРаздела = ['transcript', 'is-playable']) => {
		const раздел = о.зарегистрировать(new о.Узел(классыРаздела));
		const блок = раздел.добавить(new о.Узел(['tr-block'], { dataset: { start: '61.7' } }));
		return { раздел, блок, текст: блок.добавить(new о.Узел(['tr-text'])) };
	};

	const г = гнездо(о);
	нажать(г.текст);
	проверить('нажатие на текст реплики засчитано перемоткой', имена(о).includes('transcript_seek'));
	проверить('место — расшифровка', параметры(о, 'transcript_seek').place === 'transcript');
	проверить('секунда взята из блока', параметры(о, 'transcript_seek').seconds === 61.7);

	// Плашка времени лежит внутри блока — то же правило, отдельной ветки не надо.
	const о3 = await поднять('ru.bakapodcast.com');
	const г3 = гнездо(о3);
	о3.вызватьНаДокументе('click', { target: г3.блок.добавить(new о3.Узел(['tr-time'], { tag: 'button' })) });
	проверить('нажатие на плашку времени тоже засчитано', имена(о3).includes('transcript_seek'));

	// Расшифровка без плеера: блоки не кликабельны, считать нечего.
	const о4 = await поднять('ru.bakapodcast.com');
	const г4 = гнездо(о4, ['transcript']);
	о4.вызватьНаДокументе('click', { target: г4.текст });
	проверить('расшифровка без плеера НЕ засчитана', !имена(о4).includes('transcript_seek'));

	// Человек выделял цитату, а не мотал.
	const о5 = await поднять('ru.bakapodcast.com');
	const г5 = гнездо(о5);
	о5.выделить('кусок реплики');
	о5.вызватьНаДокументе('click', { target: г5.текст });
	проверить('выделение текста НЕ засчитано перемоткой', !имена(о5).includes('transcript_seek'));

	// Ссылка на тайтл внутри реплики ведёт на тайтл, а не мотает.
	const о6 = await поднять('ru.bakapodcast.com');
	const г6 = гнездо(о6);
	о6.вызватьНаДокументе('click', { target: г6.блок.добавить(new о6.Узел(['anime-mention', 'tr-anime'], { tag: 'a', href: 'https://ru.bakapodcast.com/anime/naruto' })) });
	проверить('ссылка внутри реплики — не перемотка', !имена(о6).includes('transcript_seek'));
	проверить('она засчитана как нажатие на тайтл', имена(о6).includes('anime_link'));

	// Строка списка таймкодов у выпуска — своя ветка.
	const о7 = await поднять('ru.bakapodcast.com');
	о7.вызватьНаДокументе('click', { target: о7.зарегистрировать(new о7.Узел(['timecode'], { tag: 'button', dataset: { seconds: '724' } })) });
	проверить('строка списка таймкодов засчитана', имена(о7).includes('transcript_seek'));
	проверить('место — список таймкодов', параметры(о7, 'transcript_seek').place === 'timecodes');
	проверить('секунда записана', параметры(о7, 'transcript_seek').seconds === 724);

	нажать(о.зарегистрировать(new о.Узел(['anime-mention'], { tag: 'a', href: 'https://ru.bakapodcast.com/anime/naruto' })));
	проверить('название тайтла в тексте засчитано', имена(о).includes('anime_link'));
	проверить('место — текст', параметры(о, 'anime_link').place === 'text');

	const о2 = await поднять('ru.bakapodcast.com');
	о2.вызватьНаДокументе('click', {
		target: о2.зарегистрировать(new о2.Узел(['anime-mention', 'tr-anime'], { tag: 'a', href: 'https://ru.bakapodcast.com/anime/naruto' })),
	});
	проверить('название внутри расшифровки помечено иначе', параметры(о2, 'anime_link').place === 'transcript');
	console.log();
}

// ── 3. УХОДЫ НА ПЛОЩАДКИ ───────────────────────────────────────────────────
{
	console.log('── Уходы на площадки ──');
	const случаи = [
		['https://boosty.to/bakapodcast', 'go_support', 'Boosty'],
		['https://boosty.to/bakapodcast/posts/abc?share=post_link', 'go_support', 'пост на Boosty'],
		['https://t.me/tribute/app?startapp=s26z', 'go_support', 'закрытый телеграм'],
		['https://podcasts.apple.com/podcast/id1577387113?i=1000', 'go_listen', 'Apple Podcasts'],
		['https://mave.stream/baka', 'go_listen', 'Mave'],
		['https://www.youtube.com/@bakapodcast', 'go_listen', 'канал на YouTube'],
		['https://www.youtube.com/watch?v=Yjai1MjLXVA', null, 'ЧУЖОЙ ролик на YouTube'],
		// СОЦСЕТИ И КАНАЛЫ — цель go_social, заведена 26 августа 2026 взамен
		// двух автоцелей Метрики. Строчка про t.me/podcastbaka до этого дня
		// стояла с ждём=null: канал не считался ничем.
		['https://t.me/podcastbaka', 'go_social', 'телеграм-канал подкаста'],
		['https://t.me/bakapodcast', 'go_social', 'второй телеграм подкаста'],
		['https://www.tiktok.com/@bakapodcast', 'go_social', 'TikTok подкаста'],
		// ПЛАТНАЯ ПОДПИСКА И ОТКРЫТЫЙ КАНАЛ ЖИВУТ НА ОДНОМ ДОМЕНЕ t.me,
		// и различает их начало адреса. Сверяем, что появление соцсетей
		// не отобрало у Tribute его достижения.
		['https://t.me/tribute/app?startapp=s26z&utm=tg', 'go_support', 'Tribute с хвостом — всё ещё платная'],
		// ЗАПИСЬ ЖИВОГО ПОВЕДЕНИЯ, А НЕ ПОЖЕЛАНИЕ. Адрес Tribute записан
		// в списке площадок ВМЕСТЕ с параметром ?startapp=…, сравнение идёт
		// по началу — и ссылка без параметра короче записанной, значит
		// не засчитывается никуда. На сайте таких нет: замер по всей сборке
		// дал 1350 ссылок, все с параметром. Строчка стоит здесь затем, чтобы
		// это было известным свойством, а не сюрпризом.
		['https://t.me/tribute/app', null, 'Tribute БЕЗ параметра не считается (так сегодня)'],
		['https://t.me/kakoy-to-chuzhoy-kanal', null, 'ЧУЖОЙ телеграм-канал из текста'],
		['https://t-j.ru/anime-summer-2026/', null, 'ссылка на источник в тексте'],
		['https://ru.bakapodcast.com/posts/ep-150/', null, 'внутренняя ссылка'],
	];
	for (const [адрес, ждём, подпись] of случаи) {
		const о = await поднять('ru.bakapodcast.com');
		о.вызватьНаДокументе('click', { target: о.зарегистрировать(new о.Узел([], { tag: 'a', href: адрес })) });
		const пришло = имена(о).find((и) => и === 'go_support' || и === 'go_listen' || и === 'go_social') ?? null;
		проверить(`${подпись}`, пришло === ждём, `ждали ${ждём ?? 'ничего'}, пришло ${пришло ?? 'ничего'}`);
	}
	console.log();
}

// ── 4. ПОИСК ПО САЙТУ ──────────────────────────────────────────────────────
{
	console.log('── Поиск по сайту ──');
	const о = await поднять('ru.bakapodcast.com');
	const поле = о.зарегистрировать(new о.Узел(['s-input'], { tag: 'input', value: '' }));
	const мета = о.зарегистрировать(new о.Узел(['results-meta'], { hidden: true }));
	const счётчик = о.зарегистрировать(new о.Узел(['results-count'], { textContent: '' }));
	const пусто = о.зарегистрировать(new о.Узел(['empty-state'], { hidden: true }));

	// Печатаем по букве, как человек. Выдачи ещё нет.
	for (const слово of ['н', 'на', 'нар', 'нару', 'нарут', 'наруто']) {
		поле.value = слово;
		о.вызватьНаДокументе('input', { target: поле });
	}
	// Выдача готова: нашлось 12.
	мета.hidden = false;
	счётчик.textContent = '12';
	о.прокрутитьВремя();

	проверить('запрос засчитан ОДИН раз, а не на каждую букву', имена(о).filter((и) => и === 'site_search').length === 1, `пришло: ${имена(о).filter((и) => и === 'site_search').length}`);
	проверить('записан законченный запрос, а не обрывок', параметры(о, 'site_search').query === 'наруто', `пришло: ${параметры(о, 'site_search').query}`);
	проверить('записано число находок', параметры(о, 'site_search').found === 12);
	проверить('«ничего не найдено» НЕ засчитано', !имена(о).includes('site_search_empty'));
	проверить('место — страница поиска', параметры(о, 'site_search').place === 'site');

	// Пустая выдача.
	const о2 = await поднять('ru.bakapodcast.com');
	const поле2 = о2.зарегистрировать(new о2.Узел(['s-input'], { tag: 'input', value: '' }));
	о2.зарегистрировать(new о2.Узел(['results-meta'], { hidden: true }));
	о2.зарегистрировать(new о2.Узел(['results-count'], { textContent: '' }));
	const пусто2 = о2.зарегистрировать(new о2.Узел(['empty-state'], { hidden: true }));
	поле2.value = 'гносия';
	о2.вызватьНаДокументе('input', { target: поле2 });
	пусто2.hidden = false;
	о2.прокрутитьВремя();
	проверить('запрос без находок засчитан', имена(о2).includes('site_search'));
	проверить('«ничего не найдено» засчитано', имена(о2).includes('site_search_empty'));
	проверить('найдено ноль', параметры(о2, 'site_search').found === 0);
	console.log();
}

// ── 4б. ПОИСК ПО КАТАЛОГУ ТАЙТЛОВ ──────────────────────────────────────────
{
	console.log('── Поиск по каталогу тайтлов ──');
	const о = await поднять('ru.bakapodcast.com');
	const поле = о.зарегистрировать(new о.Узел(['search-box'], { tag: 'input', id: 'catalog-search', value: '' }));
	const счёт = о.зарегистрировать(new о.Узел(['page-count'], { id: 'catalog-count', textContent: '7 тайтлов' }));
	const пусто = о.зарегистрировать(new о.Узел(['empty-state'], { id: 'catalog-empty', hidden: true }));
	for (const слово of ['б', 'бе', 'бер', 'берсерк']) {
		поле.value = слово;
		о.вызватьНаДокументе('input', { target: поле });
	}
	о.прокрутитьВремя();
	проверить('запрос по каталогу засчитан один раз', имена(о).filter((и) => и === 'site_search').length === 1);
	проверить('место — каталог', параметры(о, 'site_search').place === 'catalog');
	проверить('число тайтлов взято из счётчика', параметры(о, 'site_search').found === 7, `пришло: ${параметры(о, 'site_search').found}`);

	const о2 = await поднять('ru.bakapodcast.com');
	const поле2 = о2.зарегистрировать(new о2.Узел(['search-box'], { tag: 'input', id: 'catalog-search', value: '' }));
	о2.зарегистрировать(new о2.Узел([], { id: 'catalog-count', textContent: '0 тайтлов' }));
	const пусто2 = о2.зарегистрировать(new о2.Узел(['empty-state'], { id: 'catalog-empty', hidden: true }));
	поле2.value = 'такого нет';
	о2.вызватьНаДокументе('input', { target: поле2 });
	пусто2.hidden = false;
	о2.прокрутитьВремя();
	проверить('пустой каталожный запрос помечен', имена(о2).includes('site_search_empty'));
	console.log();
}

// ── 5. ПОИСК ВНУТРИ РАСШИФРОВКИ ────────────────────────────────────────────
{
	console.log('── Поиск внутри расшифровки ──');
	const о = await поднять('ru.bakapodcast.com');
	const поле = о.зарегистрировать(new о.Узел(['tr-search'], { tag: 'input', value: '' }));
	for (const слово of ['ф', 'фр', 'фри', 'фрирен']) {
		поле.value = слово;
		о.вызватьНаДокументе('input', { target: поле });
	}
	о.прокрутитьВремя();
	проверить('поиск в расшифровке засчитан один раз', имена(о).filter((и) => и === 'transcript_search').length === 1);
	проверить('записано законченное слово', параметры(о, 'transcript_search').query === 'фрирен');
	console.log();
}

// ── 6. ЛОКАЛЬНЫЙ ПРЕДПРОСМОТР НЕ СЧИТАЕТСЯ ─────────────────────────────────
{
	console.log('── Свой предпросмотр ──');
	const о = await поднять('localhost');
	о.вызватьНаДокументе('click', { target: о.зарегистрировать(new о.Узел(['tr-expand'])) });
	о.аудио.currentSrc = 'x.mp3';
	о.аудио.вызвать('playing');
	проверить('на localhost не уходит НИЧЕГО', о.цели.length === 0, `ушло целей: ${о.цели.length}`);
	console.log();
}

// ── 7. ОБА СЕРВИСА ПОЛУЧАЮТ ОДНО И ТО ЖЕ ИМЯ ───────────────────────────────
{
	console.log('── Метрика и Google ──');
	const о = await поднять('ru.bakapodcast.com');
	о.вызватьНаДокументе('click', { target: о.зарегистрировать(new о.Узел(['tr-expand'])) });
	const мет = о.цели.filter((ц) => ц.сервис === 'метрика').map((ц) => ц.имя);
	const гуг = о.цели.filter((ц) => ц.сервис === 'google').map((ц) => ц.имя);
	проверить('событие ушло в оба сервиса', мет.length === 1 && гуг.length === 1);
	проверить('имя одно и то же', мет[0] === гуг[0], `${мет[0]} / ${гуг[0]}`);
	console.log();
}

console.log(провалов ? `ПРОВАЛОВ: ${провалов}` : 'ВСЁ СОШЛОСЬ');
process.exit(провалов ? 1 : 0);
