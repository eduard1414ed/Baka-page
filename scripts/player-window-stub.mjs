// ПОДДЕЛКА ОКНА ДЛЯ СКРИПТОВ ПЛЕЕРА — ОДНА НА ВСЕ ПРОВЕРКИ.
//
// Правило проекта «всё, что живёт в браузере, проверяет заказчик руками»
// осталось в силе для ВИДА. А порядок событий и подключение блоков к звуку
// проверяются здесь: собранный скрипт панели берётся из `dist/` КАК ЕСТЬ
// и исполняется в Node поверх этой подделки. Проверяется настоящий код,
// а не его пересказ.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. Проверок стало две — порядок знакомства расшифровки
// с плеером (`transcript-player-order.test.mjs`) и подключение блоков к звуку
// (`post-play-wiring.test.mjs`). Вторая копия подделки разъехалась бы с первой
// правкой, и разошедшимся оказался бы не вид, а ответ на вопрос «а так ли
// ведёт себя браузер». Ровно тот же довод, по которому заведён browser-stub.mjs
// для служебных страниц: та подделка про другое (там дерево и нажатия),
// и слить их значило бы получить одну, которая не умеет ни того ни другого.
//
// ПОДДЕЛКА НАРОЧНО БЕДНАЯ, И ЭТО НЕ ЛЕНЬ. Она умеет ровно два вопроса:
// «когда объявился плеер» и «какие блоки он подключил». Всё остальное отвечает
// заглушкой — потому что панель при запуске ищет полтора десятка кнопок по id
// и сразу вешает на них слушатели: верни подделка «ничего не нашла», запуск
// падал бы на первой же кнопке и до объявления плеера не доходил никогда.
// Тогда проверка отвечала бы «плеер не объявлен» ВСЕГДА, в любом порядке
// скриптов, — то есть меряла бы собственную бедность, а не порядок.

/**
 * Элемент, отвечающий на всё. Зачем именно так — в шапке файла.
 *
 * ТРИ ВЕЩИ ОН ДЕЛАЕТ ПО-НАСТОЯЩЕМУ, А НЕ ЗАГЛУШКОЙ: запоминает слушателей,
 * складывает детей и умеет убрать себя от родителя. Первая редакция отвечала
 * заглушкой и на это — и проверка фасада объявила поломкой исправный код:
 * `remove()` ничего не делал, окошко оставалось в коробке, и выходило, будто
 * ролик не закрывается. Сломан был измеритель, а не измеряемое.
 */
export function makeElement(свои = {}) {
	const el = {
		слушатели: [],
		addEventListener(событие, fn) {
			this.слушатели.push([событие, fn]);
		},
		removeEventListener(событие, fn) {
			const где = this.слушатели.findIndex(([с, f]) => с === событие && f === fn);
			if (где !== -1) this.слушатели.splice(где, 1);
		},
		/** Позвать слушателей события — так, как это делает браузер. */
		dispatch(событие, данные) {
			for (const [с, fn] of [...this.слушатели]) if (с === событие) fn(данные ?? { type: событие });
		},
		querySelectorAll: () => [],
		classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
		dataset: {},
		style: { setProperty() {}, removeProperty() {} },
		setAttribute() {},
		removeAttribute() {},
		getAttribute: () => null,
		// Переключение атрибута — им панель прячет один значок кнопки и
		// показывает другой (`icon-play` / `icon-pause`). Без него запуск падал
		// на первом же нажатии, и падение это — бедность подделки, а не код.
		toggleAttribute(имя, включить) {
			if (имя === 'hidden') this.hidden = включить ?? !this.hidden;
			return this.hidden;
		},
		hasAttribute: () => false,
		appendChild(узел) {
			this.append(узел);
		},
		append(...новые) {
			for (const узел of новые) {
				узел.parent = this;
				this.children.push(узел);
			}
		},
		insertBefore() {},
		remove() {
			const дети = this.parent?.children;
			if (!дети) return;
			const где = дети.indexOf(this);
			if (где !== -1) дети.splice(где, 1);
			this.parent = null;
		},
		contains: () => false,
		closest: () => null,
		focus() {},
		blur() {},
		click() {},
		scrollIntoView() {},
		getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
		children: [],
		childNodes: [],
		textContent: '',
		innerHTML: '',
		value: '',
		hidden: false,
		disabled: false,
		checked: false,
		// свойства звука — панель читает их при запуске
		currentTime: 0,
		duration: 0,
		paused: true,
		playbackRate: 1,
		readyState: 0,
		networkState: 0,
		src: '',
		play() {
			this.paused = false;
			return Promise.resolve();
		},
		pause() {
			this.paused = true;
		},
		load() {},
		...свои,
	};
	el.querySelector = свои.querySelector ?? (() => makeElement());
	return el;
}

/**
 * Блок с признаком «здесь есть выпуск и его кнопки» — такой, каким его видит
 * панель плеера.
 *
 * @param {object} опции
 * @param {string} опции.guid Выпуск, на который блок указывает.
 * @param {string[]} опции.контролы Какие хваты у блока ЕСТЬ. Мини-плеер врезки
 *   несёт не все: ни перемотки ±15, ни выбора скорости у него нет.
 */
export function makeCard({ guid, контролы, duration = '0' }) {
	const части = new Map();
	for (const имя of контролы) {
		части.set(имя, makeElement({ нажатия: [], addEventListener(событие, fn) { this.нажатия.push([событие, fn]); } }));
	}
	const блок = makeElement({
		dataset: { episodeCard: '', guid, audio: `https://example.invalid/${guid}.mp3`, title: guid, cover: '', link: `/posts/${guid}/`, duration },
		querySelector: (sel) => части.get(sel.replace(/^\./, '')) ?? null,
	});
	блок.части = части;
	return блок;
}

/**
 * Подделка окна.
 *
 * @param {object} опции
 * @param {any[]} опции.карточки Блоки, которые «лежат на странице».
 */
/**
 * Фасад видеоэссе — с настоящей коробкой, кнопкой и кадром внутри.
 *
 * ЗДЕСЬ ПОДДЕЛКА ЧУТЬ БОГАЧЕ ОСТАЛЬНОГО, И ЭТО НЕ ПРИХОТЬ. Проверяемое
 * поведение — «окошко ПОЯВИЛОСЬ в коробке, кнопка УШЛА из неё, при закрытии
 * вернулась». Ответь дерево заглушкой, как везде, — спросить об этом было бы
 * нечем, и проверка не смогла бы провалиться.
 */
export function makeFacade({ ролик }) {
	const найти = (узлы, sel) => {
		const класс = sel.startsWith('.') ? sel.slice(1) : null;
		return узлы.find((узел) => (класс ? String(узел.className ?? '').split(/\s+/).includes(класс) : узел.tagName === sel)) ?? null;
	};

	const сцена = makeElement({ className: 'post-face-stage', children: [] });
	сцена.querySelector = (sel) => найти(сцена.children, sel);

	const кнопка = makeElement({ className: 'post-face-play' });
	const кадр = makeElement({ className: 'post-face-frame' });
	сцена.append(кадр, кнопка);

	const фасад = makeElement({
		className: 'post-face',
		dataset: { youtube: ролик },
		querySelector: (sel) => (sel === '.post-face-stage' ? сцена : сцена.querySelector(sel)),
	});
	фасад.сцена = сцена;
	фасад.кнопка = кнопка;
	фасад.окошко = () => сцена.querySelector('iframe');
	фасад.кнопкаНаМесте = () => сцена.children.includes(кнопка);
	return фасад;
}

export function makeWindow({ карточки = [], фасады = [] } = {}) {
	const handlers = [];
	const наблюдаемые = [];
	let последнийНаблюдатель = null;

	// ЭЛЕМЕНТЫ ПО ИМЕНИ ЗАПОМИНАЮТСЯ, А НЕ ВЫДАЮТСЯ КАЖДЫЙ РАЗ НОВЫЕ.
	// Первая редакция отдавала новый на каждый вызов, и спросить «спрятана ли
	// панель» было НЕЧЕМ: скрипт прятал один элемент, а проверка смотрела
	// на другой. Проверки, написанные поверх такой подделки, не могли
	// провалиться вовсе — то есть врали в сторону «всё хорошо».
	const поИмени = new Map();
	const элемент = (id) => {
		if (!поИмени.has(id)) поИмени.set(id, makeElement());
		return поИмени.get(id);
	};

	const классыТела = new Set();
	const тело = makeElement({
		contains: (узел) => карточки.includes(узел),
		classList: {
			add: (имя) => классыТела.add(имя),
			remove: (имя) => классыТела.delete(имя),
			contains: (имя) => классыТела.has(имя),
			toggle: (имя, включить) => (включить ? классыТела.add(имя) : классыТела.delete(имя)),
		},
	});

	const documentStub = {
		addEventListener(name, fn) {
			handlers.push({ name, fn });
		},
		removeEventListener() {},
		querySelector: (sel) => (sel === '[data-episode-card]' ? (карточки[0] ?? null) : makeElement()),
		querySelectorAll: (sel) => {
			if (sel === '[data-episode-card]') return карточки;
			if (sel === '.post-face[data-youtube]') return фасады;
			return [];
		},
		getElementById: элемент,
		createElement: (тег) => makeElement({ tagName: тег }),
		body: тело,
		documentElement: makeElement(),
		head: makeElement(),
	};

	const win = {
		document: documentStub,
		addEventListener() {},
		removeEventListener() {},
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
		requestAnimationFrame: (fn) => fn(),
		getSelection: () => ({ toString: () => '' }),
		location: { hash: '', pathname: '/', href: 'https://ru.bakapodcast.com/' },
		history: { state: null, replaceState() {}, pushState() {} },
		localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
		sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
		// НАБЛЮДАТЕЛЬ НАСТОЯЩИЙ РОВНО НАСТОЛЬКО, ЧТОБЫ ЕМУ МОЖНО БЫЛО СКАЗАТЬ
		// «ЭТОТ БЛОК УШЁЛ ЗА КРАЙ». Именно от его ответов зависит, показывается
		// панель или нет, и проверять это иначе нечем.
		IntersectionObserver: class {
			constructor(fn) {
				this.fn = fn;
				последнийНаблюдатель = this;
			}
			observe(узел) {
				наблюдаемые.push(узел);
			}
			disconnect() {
				наблюдаемые.length = 0;
			}
		},
		HTMLMediaElement: { HAVE_CURRENT_DATA: 2, HAVE_NOTHING: 0, NETWORK_NO_SOURCE: 3 },
	};

	return {
		win,
		documentStub,
		handlers,
		наблюдаемые,
		/** Тот же элемент, что получил скрипт по этому имени. */
		элемент,
		/** Есть ли на теле страницы класс — по нему сайт двигает кнопку «наверх». */
		уТелаКласс: (имя) => классыТела.has(имя),
		/** Сказать наблюдателю, что блок появился на экране или ушёл за край. */
		видимость(узел, виден) {
			последнийНаблюдатель?.fn([{ target: узел, isIntersecting: виден }]);
		},
	};
}
