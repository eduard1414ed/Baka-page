#!/usr/bin/env python3
"""Сопоставить файлы сценариев с выпусками и записать карту в essay-map.json.

Зачем отдельным файлом, а не «на лету» при каждом прогоне: пары «сценарий →
выпуск» заказчик подтвердил глазами один раз (8 августа 2026). Если сопоставлять
заново при каждом запуске, изменившееся название поста или переименованный файл
молча уведут сценарий к другому выпуску, и мы это заметим уже по кривому
транскрипту. Карта фиксирует подтверждённое решение.

Запуск: python3 make_essay_map.py [--check]
  --check  ничего не писать, только сверить существующую карту с папкой
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ESSAY_DIR = ROOT / "scripts" / "essay"
POSTS_DIR = ROOT / "src" / "content" / "posts"
MAP_FILE = HERE / "essay-map.json"

# Выпуски, которые распознаём БЕЗ сценария: он не нашёлся. Текст у них остаётся
# из расшифровки, разбивка на реплики — обычная, по паузам (пайплайн это умеет).
NO_SCRIPT = ["ep-86", "ep-88"]

# Выпуски, которые заказчик решил не расшифровывать вовсе (решение 8 августа
# 2026): ep-1 «Опенинг» — служебная запись на 18 секунд, ep-23 — трейлер
# другого подкаста. К видеоэссе отношения не имеют.
SKIP = ["ep-1", "ep-23"]


def norm(s):
	s = unicodedata.normalize("NFC", s).lower().replace("ё", "е")
	s = re.sub(r"[«»\"“”„‘’'`]", "", s)
	s = re.sub(r"[—–−-]", " ", s)
	s = re.sub(r"[^a-zа-я0-9|]+", " ", s)
	return re.sub(r"\s+", " ", s).strip()


def read_posts():
	posts = []
	for f in sorted(POSTS_DIR.glob("*.md")):
		text = f.read_text(encoding="utf-8")
		def field(name):
			m = re.search(rf"^{name}: *(.*)$", text, re.M)
			return m.group(1).strip().strip("'\"") if m else ""
		posts.append({"slug": f.stem, "title": field("title"), "guid": field("audioGuid")})
	return posts


def build():
	posts = read_posts()
	by_norm = {}
	for p in posts:
		by_norm.setdefault(norm(p["title"]), []).append(p)

	entries = []
	unmatched = []
	for f in sorted(ESSAY_DIR.glob("*.md")):
		base = re.sub(r"\.docx$", "", f.stem)
		candidates = by_norm.get(norm(base), [])
		if len(candidates) == 1:
			p = candidates[0]
			entries.append(
				{"slug": p["slug"], "guid": p["guid"], "title": p["title"], "script": f.name}
			)
		else:
			unmatched.append((f.name, len(candidates)))
	return entries, unmatched


def main():
	entries, unmatched = build()
	print(f"Сценариев в папке : {len(list(ESSAY_DIR.glob('*.md')))}")
	print(f"Сопоставлено      : {len(entries)}")
	if unmatched:
		print("НЕ СОПОСТАВЛЕНО:")
		for name, n in unmatched:
			print(f"  {name}  (подходящих выпусков: {n})")

	slugs = [e["slug"] for e in entries]
	dupes = {s for s in slugs if slugs.count(s) > 1}
	if dupes:
		print(f"ОДИН ВЫПУСК ЗАБРАЛИ НЕСКОЛЬКО СЦЕНАРИЕВ: {dupes}")
		sys.exit(1)

	if "--check" in sys.argv:
		if not MAP_FILE.exists():
			print("Карты ещё нет.")
			sys.exit(1)
		old = json.loads(MAP_FILE.read_text(encoding="utf-8"))
		same = old["episodes"] == entries
		print("Карта совпадает с папкой." if same else "КАРТА РАСХОДИТСЯ С ПАПКОЙ.")
		sys.exit(0 if same else 1)

	MAP_FILE.write_text(
		json.dumps(
			{
				"comment": "Подтверждено заказчиком 8 августа 2026. Пары не менять без пересогласования.",
				"noScript": NO_SCRIPT,
				"skip": SKIP,
				"episodes": entries,
			},
			ensure_ascii=False,
			indent=2,
		),
		encoding="utf-8",
	)
	print(f"Записано: {MAP_FILE}")


if __name__ == "__main__":
	main()
