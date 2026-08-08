// Исправления названий, подтверждённые руками (тз/05, шаг 6).
//
// Откуда берутся предложения. После распознавания scripts/transcribe/pipeline.py
// сверяет текст со справочником и складывает похожие места в
// transcripts/<guid>.corrections.json — «Фринен» рядом с «Фрирен» и так далее.
// САМ НИЧЕГО НЕ МЕНЯЕТ: это предложения, а не правки.
//
// ПОЧЕМУ ПОДТВЕРЖДЕНИЕ ОБЯЗАТЕЛЬНО. Проверено на пяти файлах, что накопились
// в архиве: из 21 предложения не годится НИ ОДНО. 13 — просто ошибка («круто»
// и «народ» предложено заменить на «Наруто»), 5 — падежи («Ходячего замка»),
// от замены фраза стала бы безграмотной, ещё 3 — разница только в «ё», которую
// поиск упоминаний и так не различает. Автоматика тут ошибается чаще, чем
// угадывает, поэтому применяется только отмеченное человеком.
//
// Падежи и разговорные варианты правильнее закрывать не заменой текста,
// а полем «Варианты написания» у тайтла: упоминание находится, а сказанное
// человеком остаётся как сказано. Замена текста — только для настоящих
// искажений распознавания, которые читатель видит на странице как ошибку.
//
// Где лежит подтверждённое: строкой в поле `corrections` самого поста,
//   corrections: '9|Фринен|Фрирен; 81|Фринен|Фрирен'
// то есть «в реплике 9 заменить „Фринен“ на „Фрирен“». Причина хранить строкой
// и в посте — та же, что у имён спикеров, см. src/lib/speakerNames.mjs.

const PAIR_SEPARATOR = ';';
const FIELD_SEPARATOR = '|';

/** Строка из поста → [{ replica, found, suggested }, …]. Мусор пропускается. */
export function parseNameCorrections(value) {
	const fixes = [];

	for (const chunk of String(value ?? '').split(PAIR_SEPARATOR)) {
		const [replica, found, suggested] = chunk.split(FIELD_SEPARATOR).map((part) => part.trim());
		if (!found || !suggested || !/^\d+$/.test(replica ?? '')) continue;
		fixes.push({ replica: Number(replica), found, suggested });
	}

	return fixes;
}

/** [{ replica, found, suggested }, …] → строка для поля поста. */
export function serializeNameCorrections(fixes) {
	return (fixes ?? [])
		.map(({ replica, found, suggested }) =>
			// Разделители внутри значений сломали бы разбор — вырезаем.
			[replica, found, suggested].map((part) => String(part).replaceAll(PAIR_SEPARATOR, ' ').replaceAll(FIELD_SEPARATOR, ' ').trim()).join(FIELD_SEPARATOR),
		)
		.join('; ');
}

/**
 * Расшифровка + строка из поста → расшифровка с исправленным текстом.
 *
 * ПРИ ПОТЕРЕ ПРИВЯЗКИ НИЧЕГО НЕ МЕНЯЕМ. Если реплики с таким номером больше
 * нет или в ней нет исправляемого слова — правка молча пропускается, а текст
 * остаётся как был. Правило то же, что у исключений упоминаний: незаметно
 * подменённое слово хуже, чем неисправленное.
 *
 * Файл расшифровки при этом не трогается: подстановка происходит при сборке,
 * стёрли строку в посте — вернулось как было.
 */
export function applyNameCorrections(transcriptData, value) {
	const fixes = parseNameCorrections(value);
	if (fixes.length === 0 || !Array.isArray(transcriptData?.replicas)) return transcriptData;

	const byReplica = new Map();
	for (const fix of fixes) {
		byReplica.set(fix.replica, [...(byReplica.get(fix.replica) ?? []), fix]);
	}

	const replicas = transcriptData.replicas.map((replica, index) => {
		const here = byReplica.get(index);
		if (!here) return replica;

		let text = replica.text;
		// В одной реплике слово может прозвучать дважды — правим все вхождения:
		// человек отмечал реплику целиком, а не отдельное слово в ней.
		for (const fix of here) {
			if (text.includes(fix.found)) text = text.replaceAll(fix.found, fix.suggested);
		}

		return text === replica.text ? replica : { ...replica, text };
	});

	return { ...transcriptData, replicas };
}
