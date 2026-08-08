#!/usr/bin/env python3
"""Подстановка текста сценария в распознавание: точные слова + настоящее время.

Шаг 2 в тз/05-транскрипты.md. Идея целиком: у выпусков-видеоэссе есть готовый
сценарий, но нет таймкодов; у распознавания есть таймкод каждого слова, но слова
кривые. Значит распознавание работает как измерительный прибор — мы забираем
у него ТОЛЬКО ВРЕМЯ, а текст берём из сценария.

Отдельными инструментами выравнивания по звуку (forced alignment) на сервере
это сознательно не делается: ставить их ради экономии пары долларов не надо
(прямое указание в ТЗ), а пословных таймкодов ElevenLabs для задачи достаточно.

ПОЧЕМУ ЭТО ОТДЕЛЬНЫЙ ШАГ, А НЕ ЧАСТЬ РАСПОЗНАВАНИЯ. Сопоставление ничего
не стоит и не ходит в сеть: оно работает с уже сохранённым файлом `*.words.json.gz`.
Значит алгоритм можно крутить и перезапускать сколько угодно, ни разу не заплатив
второй раз за то же аудио. Если бы это делалось внутри process_episode, любая
правка правил означала бы повторную оплату всех 36 выпусков.

КАК СОПОСТАВЛЯЕТСЯ. Оба текста превращаются в списки слов в сравнимом виде
(нижний регистр, «ё»=«е», без знаков препинания) и скармливаются difflib —
тому же алгоритму, которым сравнивают версии файлов. Он выдаёт участки четырёх
видов, и с каждым мы поступаем по-своему:

  equal    слово в слово           -> текст сценария, время своего слова
  replace  то же место, но криво   -> ТЕКСТ СЦЕНАРИЯ, время растянуто по участку
                                      (ровно та ситуация, ради которой всё
                                      затевалось: «Фринен» -> «Фрирен»)
  delete   в сценарии есть, в звуке нет -> текст сценария, время между соседями
  insert   в звуке есть, в сценарии нет -> ИМПРОВИЗАЦИЯ: оставляем текст
                                      распознавания с его настоящим временем,
                                      а не выбрасываем (прямое требование ТЗ)
"""

import gzip
import json
import re
from pathlib import Path
from difflib import SequenceMatcher

from script_text import clean_script, normalize_word, split_words

# Границы реплики. Держим те же значения, что в pipeline.py: транскрипты
# видеоэссе попадут в тот же интерфейс, что и подкасты, и вести себя должны так же.
PAUSE_SPLIT_SEC = 1.5
MAX_REPLICA_SEC = 75.0

# Сколько подряд идущих слов, которых нет в сценарии, считать импровизацией.
#
# Замерено на ep-146 («Фрирен»): из 12 таких мест десять оказались длиной
# в одно-два слова, и почти все — не речь, а мусор распознавания. Тире в тексте
# сервис слышит как отдельные слова: «Классический пример такого подхода —
# «Властелин колец»» превращалось в «...подхода — «- это Властелин колец»».
# Вставлять такое в вычищенный текст сценария — ровно то, ради чего вся эта
# работа и затевалась НЕ делать.
#
# Настоящая импровизация в том же выпуске — «соответственно, они оба люди»,
# четыре слова. Порог в три слова отделяет одно от другого. Слова при этом
# не «теряются»: время берётся из опорных слов вокруг, поэтому таймкоды
# соседних фраз не сдвигаются ни на секунду.
MIN_IMPROV_WORDS = 3

# Сколько секунд максимум может занимать ОДНО слово сценария на растянутом участке.
#
# Обычная речь — примерно 2,5 слова в секунду, то есть 0,4 с на слово. Две секунды
# это пятикратный запас: на нормальной речи правило не срабатывает никогда.
#
# Зачем понадобилось. difflib иногда ставит рядом кусок сценария из одного-двух слов
# и кусок распознавания из двухсот — так бывает там, где после фразы идёт реклама
# или прощание, которых в сценарии нет вовсе. Без ограничения это слово получало
# время «от начала фразы до конца рекламы»: в первом прогоне так вышло 12 реплик
# длиной до 163 секунд, каждая из одного слова вроде «жизни.». На странице это
# ровно та стена без таймкодов, из-за которой в шаге 5 вводили порог в 90 секунд.
#
# Что делаем вместо этого: слова сценария получают начало отрезка, а весь остаток
# уходит в импровизацию — со своим настоящим временем и своим текстом.
MAX_WORD_SEC = 2.0

RE_HAS_LETTER = re.compile(r"[0-9A-Za-zА-Яа-яЁё]")


def load_words(path):
	"""Прочитать пословные данные распознавания (сжатый файл из pipeline.py)."""
	opener = gzip.open if str(path).endswith(".gz") else open
	with opener(path, "rt", encoding="utf-8") as f:
		return json.load(f)


def _spread(items, start, end):
	"""Разложить слова по отрезку времени пропорционально их длине.

	Внутри такого участка настоящего времени у каждого слова нет — распознавание
	либо услышало другое число слов, либо не услышало ничего. Делить поровну
	неправильно: «и» и «противопоставлению» звучат разное время, поэтому вес —
	длина слова. Это приближение, и оно честное: точное время есть только
	у опорных слов (equal), а между ними мы не выдумываем данных, а растягиваем.
	"""
	if not items:
		return
	span = max(0.0, end - start)
	weights = [max(1, len(w["text"])) for w in items]
	total = sum(weights)
	cursor = start
	for w, weight in zip(items, weights):
		share = span * weight / total
		w["start"] = round(cursor, 3)
		w["end"] = round(cursor + share, 3)
		cursor += share


def _emit_improvisation(stream, stats, rec_words, j1, j2, paragraph):
	"""Дописать в поток речь, которой нет в сценарии.

	Два разных случая, и путать их нельзя: настоящая импровизация (её ТЗ прямо
	запрещает выбрасывать) и мусор распознавания в одно-два слова — тире, которое
	сервис слышит как отдельное слово (см. MIN_IMPROV_WORDS).
	"""
	spoken = [rec_words[j] for j in range(j1, j2) if RE_HAS_LETTER.search(rec_words[j]["text"])]
	if len(spoken) < MIN_IMPROV_WORDS:
		stats["noise_dropped"] += j2 - j1
		return
	for rw in spoken:
		stream.append(
			{
				"text": rw["text"],
				"tail": "" if rw["text"] in ",.!?;:…" else " ",
				"paragraph": paragraph,
				"source": "recognized",
				"start": rw["start"],
				"end": rw["end"],
			}
		)
	stats["improvised"] += len(spoken)
	stats["longest_improvised"] = max(stats["longest_improvised"], len(spoken))


def align(script_words, rec_words):
	"""Слить сценарий и распознавание в один поток слов со временем.

	Возвращает (поток, статистика).
	"""
	a = [w["norm"] for w in script_words]
	b = [normalize_word(w["text"]) for w in rec_words]

	# autojunk=False обязателен. По умолчанию difflib объявляет «мусором» элементы,
	# встречающиеся чаще, чем в 1% последовательности, — для русского текста это
	# «и», «в», «не», «что», то есть самые надёжные опорные слова. С autojunk=True
	# сопоставление разваливается именно там, где текст совпадает лучше всего.
	matcher = SequenceMatcher(a=a, b=b, autojunk=False)

	stream = []
	stats = {
		"script_words": len(script_words),
		"rec_words": len(rec_words),
		"exact": 0,
		"replaced": 0,
		"script_only": 0,
		"improvised": 0,
		"noise_dropped": 0,
		"longest_script_only": 0,
		"longest_improvised": 0,
	}

	def script_item(sw, source):
		return {
			"text": sw["text"],
			"tail": sw["tail"],
			"paragraph": sw["paragraph"],
			"source": source,
		}

	for tag, i1, i2, j1, j2 in matcher.get_opcodes():
		if tag == "equal":
			for k in range(i2 - i1):
				sw, rw = script_words[i1 + k], rec_words[j1 + k]
				item = script_item(sw, "script")
				item["start"] = rw["start"]
				item["end"] = rw["end"]
				stream.append(item)
			stats["exact"] += i2 - i1

		elif tag == "replace":
			items = [script_item(script_words[i], "script") for i in range(i1, i2)]
			span_start = rec_words[j1]["start"]
			span_end = rec_words[j2 - 1]["end"]
			limit = span_start + len(items) * MAX_WORD_SEC

			if span_end > limit:
				# Распознанного в этом месте намного больше, чем в сценарии — значит
				# кроме сценария тут говорилось что-то ещё (см. MAX_WORD_SEC).
				# Слова сценария забирают начало отрезка, остаток идёт в импровизацию.
				cut = j1
				while cut < j2 and rec_words[cut]["start"] < limit:
					cut += 1
				_spread(items, span_start, rec_words[max(j1, cut - 1)]["end"])
				stream.extend(items)
				_emit_improvisation(stream, stats, rec_words, cut, j2, items[-1]["paragraph"])
			else:
				_spread(items, span_start, span_end)
				stream.extend(items)
			stats["replaced"] += i2 - i1

		elif tag == "delete":
			# Слов сценария нет в звуке. Время берём из щели между соседями:
			# конец предыдущего распознанного слова и начало следующего.
			prev_end = rec_words[j1 - 1]["end"] if j1 > 0 else 0.0
			next_start = rec_words[j1]["start"] if j1 < len(rec_words) else prev_end
			items = [script_item(script_words[i], "script-only") for i in range(i1, i2)]
			# Тот же потолок, что и в replace: щель между соседями бывает длинной
			# (пауза, музыка), и растягивать по ней пару слов на минуту нельзя.
			end = min(max(prev_end, next_start), prev_end + len(items) * MAX_WORD_SEC)
			_spread(items, prev_end, end)
			stream.extend(items)
			stats["script_only"] += i2 - i1
			stats["longest_script_only"] = max(stats["longest_script_only"], i2 - i1)

		elif tag == "insert":
			para = script_words[i1]["paragraph"] if i1 < len(script_words) else None
			if para is None and stream:
				para = stream[-1]["paragraph"]
			_emit_improvisation(stream, stats, rec_words, j1, j2, para)

	_enforce_monotonic(stream)
	stats["matched_ratio"] = stats["exact"] / max(1, stats["script_words"])
	stats["covered_ratio"] = (stats["exact"] + stats["replaced"]) / max(1, stats["script_words"])
	return stream, stats


def _enforce_monotonic(stream):
	"""Время не должно идти назад.

	Растянутые участки (replace/delete) считаются независимо друг от друга,
	и на стыке двух соседних может получиться, что следующее слово начинается
	раньше предыдущего. На сайте это выглядело бы как прыжок плеера назад
	при клике по плашке, поэтому подравниваем.
	"""
	last = 0.0
	for w in stream:
		if w["start"] < last:
			w["start"] = last
		if w["end"] < w["start"]:
			w["end"] = w["start"]
		last = w["start"]


def build_replicas(stream, speaker="speaker_0", pause_sec=PAUSE_SPLIT_SEC, max_sec=MAX_REPLICA_SEC):
	"""Собрать поток слов в реплики.

	Границы — четыре:
	  * новый абзац сценария (у подкастов такого сигнала нет, а тут он есть
	    и он самый честный: ровно та структура, в которой текст писался);
	  * пауза длиннее полутора секунд;
	  * реплика доросла до 75 секунд;
	  * текст переключился между сценарием и импровизацией — нет, НЕ режем:
	    импровизация должна читаться как продолжение речи, а не как врезка.

	Пороги те же, что в pipeline.py, намеренно: транскрипт видеоэссе попадает
	в тот же интерфейс, и «стена текста без таймкодов» здесь так же недопустима.
	"""
	replicas = []
	current = None
	prev_end = None
	prev_para = None

	for w in stream:
		gap = (w["start"] - prev_end) if prev_end is not None else 0.0
		too_long = current is not None and (w["end"] - current["start"]) > max_sec
		new_para = current is not None and w["paragraph"] != prev_para
		if current is None or new_para or gap > pause_sec or too_long:
			if current is not None:
				replicas.append(current)
			current = {
				"speaker": speaker,
				"start": w["start"],
				"end": w["end"],
				"chunks": [w["text"], w["tail"]],
			}
		else:
			current["end"] = max(current["end"], w["end"])
			current["chunks"].append(w["text"])
			current["chunks"].append(w["tail"])
		prev_end = w["end"]
		prev_para = w["paragraph"]

	if current is not None:
		replicas.append(current)

	out = []
	for r in replicas:
		text = re.sub(r"\s+", " ", "".join(r["chunks"])).strip()
		if not text:
			continue
		out.append(
			{
				"start": round(r["start"], 2),
				"end": round(r["end"], 2),
				"speaker": r["speaker"],
				"text": text,
			}
		)
	return out


# Границы реплики для монолога БЕЗ сценария (ep-86, ep-88).
#
# Обычные полторы секунды рассчитаны на разговор двух ведущих: там реплику
# в первую очередь рвёт смена голоса, а пауза только помогает. В монологе
# смены голоса нет вовсе, и на этом пороге выходило 7 и 9 разрывов на десять
# минут речи — реплики по 75 секунд, то есть ровно та стена, в которой
# невозможно найти нужное место.
#
# Замер по этим двум выпускам: порог 0,8 с даёт 28 и 22 разрыва вместо 7 и 9.
# Для текста, начитанного по бумаге, пауза в 0,8 с — это обычно конец
# предложения. Потолок в 45 секунд добирает те места, где автор читает подряд.
MONOLOGUE_PAUSE_SEC = 0.8
MONOLOGUE_MAX_SEC = 45.0


def replicas_from_words(rec_words, speaker="speaker_0"):
	"""Собрать реплики прямо из распознавания, без сценария.

	Нужно там, где сценарий не нашёлся: текст остаётся распознанный, но разбить
	его на части всё равно надо — иначе выпуск выглядит сплошным потоком.
	"""
	stream = [
		{
			"text": w["text"],
			"tail": "" if w["text"] in ",.!?;:…" else " ",
			"paragraph": 0,
			"source": "recognized",
			"start": w["start"],
			"end": w["end"],
		}
		for w in rec_words
	]
	return build_replicas(
		stream, speaker=speaker,
		pause_sec=MONOLOGUE_PAUSE_SEC, max_sec=MONOLOGUE_MAX_SEC,
	)


def align_episode(script_path, words_path, speaker="speaker_0"):
	"""Полный проход: сценарий + пословные данные -> реплики и статистика."""
	raw = script_path.read_text(encoding="utf-8")
	paragraphs, dropped = clean_script(raw, collect_dropped=True)
	script_words = split_words(paragraphs)
	rec_words = load_words(words_path)

	stream, stats = align(script_words, rec_words)
	replicas = build_replicas(stream, speaker=speaker)
	stats["dropped_lines"] = len(dropped)
	stats["paragraphs"] = len(paragraphs)
	stats["replicas"] = len(replicas)
	return replicas, stats, stream, dropped


def build_transcript(recognized, replicas, stats, script_name):
	"""Готовый файл транскрипта по схеме сайта (src/content.config.ts).

	За основу берётся транскрипт распознавания — у него уже правильные guid,
	название выпуска и карта голосов. Меняются только реплики и признак источника.
	"""
	transcript = dict(recognized)
	transcript["source"] = "aligned"
	transcript["replicas"] = replicas
	transcript["alignment"] = {
		"script": script_name,
		"scriptWords": stats["script_words"],
		"matchedExact": stats["exact"],
		"matchedRatio": round(stats["matched_ratio"], 4),
		"coveredRatio": round(stats["covered_ratio"], 4),
		"scriptOnly": stats["script_only"],
		"improvised": stats["improvised"],
		"noiseDropped": stats["noise_dropped"],
	}
	return transcript


def main():
	import argparse

	parser = argparse.ArgumentParser(
		description="Подставить текст сценария в распознавание, взяв оттуда таймкоды.",
	)
	parser.add_argument("--script", required=True, help="файл сценария (.md)")
	parser.add_argument("--words", required=True, help="пословные данные (*.words.json.gz)")
	parser.add_argument("--recognized", help="транскрипт распознавания (*.json) — основа для итогового файла")
	parser.add_argument("--out", help="куда записать готовый транскрипт")
	parser.add_argument("--speaker", default="speaker_0")
	args = parser.parse_args()

	script_path = Path(args.script)
	replicas, stats, stream, dropped = align_episode(script_path, Path(args.words), speaker=args.speaker)

	print(f"Сценарий: {script_path.name}")
	print(f"  слов в сценарии       : {stats['script_words']}")
	print(f"  совпало слово в слово : {stats['exact']} ({stats['matched_ratio']*100:.1f}%)")
	print(f"  покрыто сценарием     : {stats['covered_ratio']*100:.1f}%")
	print(f"  импровизация          : {stats['improvised']} слов")
	print(f"  реплик                : {stats['replicas']}")

	if args.out and args.recognized:
		recognized = json.loads(Path(args.recognized).read_text(encoding="utf-8"))
		transcript = build_transcript(recognized, replicas, stats, script_path.name)
		Path(args.out).write_text(
			json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8"
		)
		print(f"  записано              : {args.out}")


if __name__ == "__main__":
	main()
