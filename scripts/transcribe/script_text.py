#!/usr/bin/env python3
"""Очистка сценария видеоэссе: markdown из Google Docs -> только то, что звучит вслух.

Зачем это отдельный файл. По шагу 2 в тз/05-транскрипты.md текст выпусков со
сценарием берётся не из распознавания, а из готового сценария — распознавание
даёт только время. Значит сценарий должен содержать ровно произнесённые слова:
любая непроизносимая строка, оставленная внутри, не просто добавит лишний текст,
а СДВИНЕТ таймкоды всех соседних фраз, потому что сопоставление идёт по порядку.

Что выбрасывается и почему — разбор всех 34 сценариев, август 2026:

  1. Подзаголовки решётками (`## ИНТРО`) — 137 штук.
  2. Подзаголовки БЕЗ решёток — ещё 78 штук. В ТЗ сказано, что подзаголовки
     помечены решётками, но это верно не везде: часть выгрузилась из Google Docs
     обычной строкой капсом (`ДЕМОНЫ`, `ЯГУТИ`), часть — жирным
     (`**ЧАСТЬ I. ЧТО ТАКОЕ АНИМЕ?**`). Ловить только решётки нельзя.
  3. Технические пометки — они же капсом: `ТУТ НАРЕЗКА`, `ПЕРЕБИВКА`,
     `ВИДЕО ТАЦУКИ, КОТОРЫЙ ПЫТАЕТСЯ ПОЛЕТЕТЬ`. Отдельного правила не нужно,
     их забирает правило 2.
  4. Строки, целиком состоящие из ссылки, — 4 штуки: ролики для монтажа
     (`[Paprika Opening HD](https://...)`).
  5. Адреса внутри ссылок — 36 штук. ВИДИМЫЙ ТЕКСТ ОСТАЁТСЯ: в
     «аниме «[Кацудо сясин](https://kinopoisk.ru/...)»» вслух звучит
     «Кацудо сясин», а адрес — нет.
  6. Подпись «Цитата:» перед цитатой — 4 штуки. Сама цитата читается вслух,
     слово «Цитата» — нет.
  7. Экранирование Google Docs (`из\\-за`, `Но\\!`) — 132 строки. Это не текст,
     а служебные слэши выгрузки.

ЧТО СОЗНАТЕЛЬНО НЕ ВЫБРАСЫВАЕТСЯ — РЕМАРКИ В СКОБКАХ. В ТЗ написано их убрать,
и для этих сценариев это указание неверно. Из 157 скобок в архиве почти все
оказались живой речью: «(первый фильтр)», «(он же Зик)», «(кроме Ван-Писа)»,
«(а еще пожилым гномам, но это мы оставим за скобками)». Выбросив их, мы порвали
бы текст в 157 местах и в каждую дырку подставилось бы кривое распознавание.
Непроизносимых скобок нашлось две, и обе — внутри названий роликов, которые
и так уходят по правилу 4. Отмена согласована с заказчиком 8 августа 2026.
"""

import re
import unicodedata

# Строка-подзаголовок: всё, что осталось от букв, — заглавные, и строка короткая.
# Ограничение по длине нужно, чтобы под правило не попал абзац, который автор
# написал капсом ради крика.
#
# Сначала стояло 80 — и этого не хватило: в ep-112 пометка для монтажа
# «БЫСТРАЯ НАРЕЗКА ЧЕЛОВЕКА-БЕНЗОПИЛЫ, ОГЛЯНИСЬ, ДАНДАДАНА, АДСКОГО РАЯ
# И СЕМЬИ ШПИОНА» оказалась длиной 83 знака, пролезла в текст и встала
# на странице тремя репликами. Замер по всем 34 сценариям: это ЕДИНСТВЕННАЯ
# строка капсом длиннее 80 знаков, следующая по длине — ровно 80. Значит порог
# 120 забирает её и не забирает больше ничего.
CAPS_MAX_LEN = 120

RE_HEADING = re.compile(r"^\s{0,3}#{1,6}\s")
RE_MD_LINK = re.compile(r"\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)")
RE_BARE_URL = re.compile(r"https?://\S+")
RE_EMPHASIS = re.compile(r"(\*\*|\*|__|_|~~)")
RE_QUOTE_LABEL = re.compile(r"^\s*Цитата(?:\s+из\s+[^:]*)?:\s*")
RE_UNESCAPE = re.compile(r"\\([^A-Za-zА-Яа-яЁё0-9\s])")
RE_LIST_MARK = re.compile(r"^\s*(?:[-*+]|\d{1,2}[.)])\s+")


def _strip_markdown(text):
	"""Убрать разметку, оставив то, что читается вслух."""
	text = RE_UNESCAPE.sub(r"\1", text)          # из\-за -> из-за, Но\! -> Но!
	text = RE_MD_LINK.sub(r"\1", text)           # [Кацудо сясин](url) -> Кацудо сясин
	text = RE_BARE_URL.sub("", text)             # голый адрес, если остался
	text = RE_EMPHASIS.sub("", text)             # **жирный**, *курсив*, ~~зачёркнутый~~
	return text


def _is_caps_line(text):
	"""Строка целиком заглавными — подзаголовок или пометка для монтажа."""
	if len(text) > CAPS_MAX_LEN:
		return False
	letters = [c for c in text if c.isalpha()]
	if len(letters) < 2:
		return False
	return all(c.isupper() for c in letters)


def _is_link_only(raw):
	"""Строка целиком состоит из одной ссылки — ролик для монтажа, не речь.

	ВАЖНО: проверять надо ИСХОДНУЮ строку, а не очищенную. У таких строк
	видимый текст ссылки не пустой — это название ютуб-ролика
	(`[Paprika Opening HD](https://...)`), и по «что осталось после очистки»
	они не ловятся вовсе. Отличие от обычной ссылки внутри предложения —
	именно в том, что кроме неё в строке НИЧЕГО нет: в предложении
	«аниме «[Кацудо сясин](url)»» видимый текст произносится и должен остаться,
	а название ролика для вставки — нет.
	"""
	stripped = RE_UNESCAPE.sub(r"\1", raw).strip()
	# Круглые скобки вокруг всей строки снимаем ПАРОЙ. Обрезать «любые скобки
	# по краям» нельзя: у markdown-ссылки строка начинается с «[», и такое
	# обрезание разорвало бы саму ссылку, после чего она перестала бы опознаваться.
	while stripped.startswith("(") and stripped.endswith(")"):
		stripped = stripped[1:-1].strip()
	stripped = stripped.rstrip(".,;: ")
	if not stripped:
		return False
	if RE_BARE_URL.fullmatch(stripped):
		return True
	rest = RE_MD_LINK.sub("", stripped, count=1).strip()
	return not rest


def clean_script(markdown, collect_dropped=False):
	"""Markdown сценария -> список абзацев произносимого текста.

	Абзацы сохраняются отдельными элементами намеренно: по их границам потом режутся
	реплики, и транскрипт получает ту же структуру, в которой текст писался.

	С `collect_dropped=True` вторым значением возвращает список выброшенного —
	нужно, чтобы показать заказчику, что именно ушло под нож.
	"""
	text = unicodedata.normalize("NFC", markdown)
	paragraphs = []
	dropped = []

	for raw_line in text.split("\n"):
		raw = raw_line.strip()
		if not raw:
			paragraphs.append(None)  # пустая строка = граница абзаца
			continue

		if RE_HEADING.match(raw):
			dropped.append(("подзаголовок решётками", raw))
			continue

		if _is_link_only(raw):
			dropped.append(("строка-ссылка", raw))
			continue

		body = RE_LIST_MARK.sub("", raw)
		cleaned = _strip_markdown(body).strip()

		if _is_caps_line(cleaned):
			dropped.append(("подзаголовок капсом", raw))
			continue

		without_label = RE_QUOTE_LABEL.sub("", cleaned)
		if without_label != cleaned:
			dropped.append(("подпись «Цитата:»", cleaned[: len(cleaned) - len(without_label)]))
			cleaned = without_label.strip()

		cleaned = re.sub(r"[ \t]+", " ", cleaned).strip()
		if not cleaned:
			continue
		paragraphs.append(cleaned)

	# Склеиваем подряд идущие непустые строки в абзацы.
	result = []
	buf = []
	for item in paragraphs:
		if item is None:
			if buf:
				result.append(" ".join(buf))
				buf = []
		else:
			buf.append(item)
	if buf:
		result.append(" ".join(buf))

	return (result, dropped) if collect_dropped else result


# --- Слова -----------------------------------------------------------------

RE_WORD = re.compile(r"[0-9A-Za-zА-Яа-яЁё]+(?:[-'’][0-9A-Za-zА-Яа-яЁё]+)*", re.UNICODE)


def normalize_word(word):
	"""Вид слова для СРАВНЕНИЯ (не для показа).

	«ё» приравнивается к «е» — распознавание пишет «Унесенные» там, где в тексте
	«Унесённые». То же правило действует в поиске по транскрипту и в разметке
	тайтлов (src/lib/animeMentions.mjs), заводить здесь другое было бы ошибкой.
	"""
	return word.lower().replace("ё", "е").replace("’", "'")


def split_words(paragraphs):
	"""Абзацы -> плоский список слов с привязкой к абзацу.

	Знаки препинания не выбрасываются: они нужны, чтобы собрать текст обратно
	читаемым. Поэтому у каждого слова хранится «хвост» — то, что шло за ним
	до следующего слова.
	"""
	words = []
	for para_index, para in enumerate(paragraphs):
		matches = list(RE_WORD.finditer(para))
		for i, m in enumerate(matches):
			tail_end = matches[i + 1].start() if i + 1 < len(matches) else len(para)
			words.append(
				{
					"text": m.group(0),
					"norm": normalize_word(m.group(0)),
					"tail": para[m.end():tail_end],
					"paragraph": para_index,
					"paragraph_start": i == 0,
				}
			)
	return words


if __name__ == "__main__":
	import sys
	from pathlib import Path

	if len(sys.argv) < 2:
		print("Использование: python3 script_text.py <файл-сценария.md> [--dropped]")
		raise SystemExit(1)

	src = Path(sys.argv[1])
	paragraphs, dropped = clean_script(src.read_text(encoding="utf-8"), collect_dropped=True)
	words = split_words(paragraphs)

	if "--dropped" in sys.argv:
		print(f"=== ВЫБРОШЕНО ({len(dropped)}) ===")
		for kind, sample in dropped:
			print(f"  [{kind}] {sample[:100]}")
		print()

	print(f"=== ОСТАЛОСЬ: {len(paragraphs)} абзацев, {len(words)} слов ===")
	for p in paragraphs[:5]:
		print(f"  {p[:160]}")
