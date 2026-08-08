#!/usr/bin/env python3
"""Проверки подстановки сценария на выдуманных данных, где ответ известен заранее.

Запуск: python3 test_script_align.py

Зачем отдельные проверки, если результат виден на живых выпусках: живой выпуск
показывает, что «в целом похоже», а здесь заранее известно, какое слово откуда
должно взяться. Каждая проверка отвечает за одно правило, и если правило
сломается при следующей правке, будет видно, какое именно.
"""

import sys

from script_align import MAX_WORD_SEC, align, build_replicas
from script_text import clean_script, split_words

FAILURES = []


def check(name, condition, detail=""):
	print(("  OK    " if condition else "  ПЛОХО ") + name + (f"  [{detail}]" if detail and not condition else ""))
	if not condition:
		FAILURES.append(name)


def rec(words, step=1.0, start=0.0):
	"""Список распознанных слов: по слову на каждые `step` секунд."""
	out = []
	t = start
	for w in words:
		out.append({"text": w, "start": round(t, 2), "end": round(t + step * 0.8, 2), "speaker": "speaker_0"})
		t += step
	return out


def test_basic():
	print("\n--- Текст берётся из сценария, время из звука ---")
	md = (
		"## ЗАГОЛОВОК\n\n"
		"Сегодня мы поговорим про Фрирен и её путешествие.\n\n"
		"ПОДЗАГОЛОВОК КАПСОМ\n\n"
		"Это второй абзац, он про демонов и про мораль.\n\n"
		"Третий абзац рассказывает о людях.\n"
	)
	paragraphs = clean_script(md)
	sw = split_words(paragraphs)
	spoken = (
		"Сегодня мы поговорим про Фринен и её путешествие "        # «Фринен» — кривое распознавание
		"так вот смотрите "                                        # 3 слова = настоящая импровизация
		"Это второй абзац он про демонов "                         # «и про мораль» не расслышано
		"Третий абзац рассказывает о людях"
	).split()
	stream, stats = align(sw, rec(spoken))
	text = " ".join(w["text"] for w in stream)

	check("«Фрирен» из сценария, а не «Фринен» из звука", "Фрирен" in text and "Фринен" not in text)
	check("импровизация из 3 слов сохранена", "смотрите" in text)
	check("не расслышанное «мораль» не потеряно", "мораль" in text)
	check("подзаголовки в текст не попали", "ЗАГОЛОВОК" not in text and "ПОДЗАГОЛОВОК" not in text)
	check("время не идёт назад", all(stream[i]["start"] <= stream[i + 1]["start"] for i in range(len(stream) - 1)))
	check("абзацы стали репликами", len(build_replicas(stream)) == 3, f"{len(build_replicas(stream))} шт")


def test_noise_dropped():
	print("\n--- Обрывок в одно-два слова считается мусором, а не речью ---")
	paragraphs = clean_script("Классический пример такого подхода — «Властелин колец».\n")
	sw = split_words(paragraphs)
	# Тире распознаётся как отдельные слова «- это» — ровно то, что портило ep-146.
	spoken = "Классический пример такого подхода - это Властелин колец".split()
	stream, stats = align(sw, rec(spoken))
	text = " ".join(w["text"] for w in stream)
	check("вставка «- это» не просочилась", "«- это Властелин" not in text and " это Властелин" not in text)
	check("текст сценария цел", "Классический пример такого подхода" in text and "Властелин" in text)
	check("мусор посчитан отдельно", stats["noise_dropped"] > 0, f"{stats['noise_dropped']}")


def test_long_tail_not_stretched():
	print("\n--- Слово сценария не растягивается на минуты ---")
	# После короткой фразы идёт длинная реклама, которой в сценарии нет вовсе.
	paragraphs = clean_script("Вот и всё о смысле жизни.\n")
	sw = split_words(paragraphs)
	spoken = "Вот и всё о смысле жизнь".split() + ("а".split() * 0)
	ad = "кстати напоследок порекомендую вам курс по рисованию комиксов от идеи до печати".split()
	words = rec(spoken + ad, step=1.0)
	stream, stats = align(sw, words)

	longest = max(w["end"] - w["start"] for w in stream if w["source"] != "recognized")
	check(
		f"ни одно слово сценария не длиннее {MAX_WORD_SEC} с",
		longest <= MAX_WORD_SEC + 0.01,
		f"самое длинное {longest:.1f} с",
	)
	replicas = build_replicas(stream)
	worst = max(r["end"] - r["start"] for r in replicas)
	check("нет реплик длиннее 90 секунд", worst <= 90, f"самая длинная {worst:.0f} с")
	text = " ".join(w["text"] for w in stream)
	check("реклама сохранена как импровизация", "порекомендую" in text)


def test_replica_limits():
	print("\n--- Реплика не вырастает в стену текста ---")
	# Один абзац, речь без пауз, семь минут подряд.
	long_para = " ".join(f"слово{i}" for i in range(1000))
	# тот же текст в распознавании, по слову каждые 0.4 с
	paragraphs = clean_script(long_para + "\n")
	sw = split_words(paragraphs)
	stream, stats = align(sw, rec([f"слово{i}" for i in range(1000)], step=0.4))
	replicas = build_replicas(stream)
	worst = max(r["end"] - r["start"] for r in replicas)
	check("самая длинная реплика не больше 90 с", worst <= 90, f"{worst:.0f} с")
	check("реплик больше одной", len(replicas) > 1, f"{len(replicas)}")


def main():
	test_basic()
	test_noise_dropped()
	test_long_tail_not_stretched()
	test_replica_limits()
	print()
	if FAILURES:
		print(f"ЕСТЬ ОШИБКИ ({len(FAILURES)}): " + "; ".join(FAILURES))
		sys.exit(1)
	print("Все проверки прошли.")


if __name__ == "__main__":
	main()
