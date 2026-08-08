// Исключения упоминаний: что убрать из индекса руками (тз/05, шаг 6).
//
// Зачем. Названия ищутся по справочнику совпадением текста, и среди названий
// аниме есть обычные слова («Монстр»). Такое срабатывание надо уметь убрать —
// так же, как тайтл убирается крестиком из поля «Тайтлы поста» в CMS.
// Зеркально работает поле «Варианты написания» у тайтла: варианты упоминания
// добавляют, исключения убирают.
//
// Два уровня:
//   1. Одно конкретное упоминание — ложное срабатывание в конкретном месте.
//   2. Тайтл целиком из выпуска — если разговор вообще не о нём.
//
// ЯКОРЬ — НОМЕР РЕПЛИКИ И ПОЗИЦИЯ В НЕЙ, А НЕ ТАЙМКОД. Впереди выравнивание
// готовых сценариев по звуку для 36 выпусков (шаг 2 тз/05) — после него
// таймкоды сдвинутся, и привязка по времени рассыпалась бы вся разом.
// Номер реплики пересчёт времени переживает.
//
// ПОЗИЦИЯ, А НЕ «КАКОЕ ПО СЧЁТУ». Сначала второй половиной якоря был номер
// вхождения тайтла в реплике, и это оказалось хрупко: стоит вписать вариант
// написания в поле «Варианты написания» у тайтла — и в реплике, где звучат
// и название, и вариант, нумерация сдвигается. Старая галочка при этом молча
// начинает прятать СОСЕДНЕЕ упоминание, и предупреждения не будет: правило-то
// сработало. Позиция в тексте от появления других совпадений не меняется
// вовсе, а если текст всё-таки правили, якорь просто не найдётся, и сборка
// скажет об этом вслух. Ломаться громко лучше, чем тихо врать.
//
// ПРАВИЛО ПРИ ПОТЕРЕ ПРИВЯЗКИ — ПОКАЗЫВАТЬ, А НЕ ПРЯТАТЬ. Если реплики с таким
// номером больше нет или упоминание на этом месте не начинается — упоминание
// остаётся на странице, а сборка пишет предупреждение. Лишнее в выдаче заметно
// и чинится; тихо пропавшее не заметит никто.
//
// ГДЕ ЛЕЖИТ: одной строкой в поле `mentionsHidden` самого поста, например
//   mentionsHidden: 'monster:* k-on:12,45.83'
// Читается так: «monster убран из выпуска целиком; у k-on убраны упоминание
// в самом начале реплики 12 и упоминание с 83-го символа реплики 45».
// Позиция считается с нуля и, когда упоминание начинает реплику, не пишется.
//
// Почему строкой в посте, а не отдельным файлом, хотя раньше был файл.
// Поле стоит в редакторе поста, а CMS умеет сохранять только свою же запись:
// писать за одно сохранение в два файла — это два коммита, из которых второй
// может не пройти. Строка для CMS — обычное текстовое поле, терять в нём
// нечего (списки внутри своих компонентов CMS на втором этапе теряла
// и портила). Ровно так это и было задумано в ТЗ.
//
// Чем за это заплатили. В прежнем файле у исключения хранился ещё и сам текст
// под якорем — страховка на случай, если реплики перенумеруются. В строку он
// не влезает, не превращая её в кашу. Защита при этом не исчезла: если на этом
// месте реплики упоминание не начинается, правило не сработает и сборка о нём
// предупредит.

const ENTRY_SEPARATOR = /\s+/;
const ANCHOR_SEPARATOR = ',';
const WHOLE_TITLE = '*';

const ALLOW_ALL = {
	isHidden: () => false,
	lost: () => [],
};

/**
 * Строка из поста → { hiddenAnime: string[], hiddenMentions: [{anime, replica, offset}] }.
 * Мусор молча пропускается: половина исключений лучше, чем упавшая сборка.
 */
export function parseMentionExceptions(value) {
	const hiddenAnime = [];
	const hiddenMentions = [];

	for (const chunk of String(value ?? '').trim().split(ENTRY_SEPARATOR)) {
		const at = chunk.indexOf(':');
		if (at <= 0) continue;

		const anime = chunk.slice(0, at);
		const anchors = chunk.slice(at + 1);

		if (anchors === WHOLE_TITLE) {
			hiddenAnime.push(anime);
			continue;
		}

		for (const anchor of anchors.split(ANCHOR_SEPARATOR)) {
			const [replica, offset = '0'] = anchor.split('.');
			if (!/^\d+$/.test(replica) || !/^\d+$/.test(offset)) continue;
			hiddenMentions.push({ anime, replica: Number(replica), offset: Number(offset) });
		}
	}

	return { hiddenAnime, hiddenMentions };
}

/**
 * Обратно в строку. Тайтлы и якоря сортируются, чтобы одно и то же состояние
 * всегда давало одну и ту же строку — иначе в истории правок появлялись бы
 * коммиты, где ничего не поменялось, кроме порядка слов.
 */
export function serializeMentionExceptions({ hiddenAnime = [], hiddenMentions = [] } = {}) {
	const whole = new Set(hiddenAnime);
	const byAnime = new Map();

	for (const { anime, replica, offset = 0 } of hiddenMentions) {
		// Тайтл убран целиком — перечислять его отдельные упоминания незачем.
		if (whole.has(anime)) continue;
		const anchor = offset > 0 ? `${replica}.${offset}` : String(replica);
		byAnime.set(anime, [...(byAnime.get(anime) ?? []), { replica, offset, anchor }]);
	}

	const parts = [...whole].sort().map((anime) => `${anime}:${WHOLE_TITLE}`);

	for (const anime of [...byAnime.keys()].sort()) {
		const anchors = byAnime
			.get(anime)
			.sort((a, b) => a.replica - b.replica || a.offset - b.offset)
			.map((item) => item.anchor);
		parts.push(`${anime}:${anchors.join(ANCHOR_SEPARATOR)}`);
	}

	return parts.join(' ');
}

/**
 * Строка из поста → фильтр для поиска упоминаний.
 * @param {string} [value] — поле `mentionsHidden` поста
 */
export function makeExceptionFilter(value) {
	const { hiddenAnime: hiddenList, hiddenMentions } = parseMentionExceptions(value);
	const hiddenAnime = new Set(hiddenList);
	const rules = new Map();

	for (const rule of hiddenMentions) {
		rules.set(`${rule.anime} ${rule.replica} ${rule.offset}`, { rule, used: false });
	}

	if (hiddenAnime.size === 0 && rules.size === 0) return ALLOW_ALL;

	const usedAnime = new Set();

	return {
		/**
		 * @param {string} animeId
		 * @param {number} replicaIndex — место реплики в исходном массиве
		 * @param {number} offset — с какого символа реплики начинается упоминание
		 */
		isHidden(animeId, replicaIndex, offset) {
			if (hiddenAnime.has(animeId)) {
				usedAnime.add(animeId);
				return true;
			}

			const found = rules.get(`${animeId} ${replicaIndex} ${offset}`);
			if (!found) return false;

			found.used = true;
			return true;
		},

		// Правила, которые ни разу не сработали: якорь потерялся или тайтл
		// больше не находится. Сборка о таких предупреждает — иначе исключение
		// молча превратилось бы в мусор в поле поста.
		lost() {
			const out = [];
			for (const animeId of hiddenAnime) {
				if (!usedAnime.has(animeId)) out.push(`тайтл целиком: ${animeId}`);
			}
			for (const { rule, used } of rules.values()) {
				if (!used) out.push(`${rule.anime}, реплика ${rule.replica}, позиция ${rule.offset}`);
			}
			return out;
		},
	};
}
