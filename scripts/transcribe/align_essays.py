#!/usr/bin/env python3
"""Подставить сценарии во все распознанные видеоэссе разом (шаг 2 тз/05).

Работает с уже скачанными результатами распознавания — в сеть не ходит и денег
не стоит. Значит запускать можно сколько угодно раз: если правила сопоставления
придётся менять, повторно платить за аудио не нужно.

Запуск:
  python3 align_essays.py --input <папка с output/> [--dry-run]

Что делает с каждым выпуском из essay-map.json:
  * есть сценарий и покрытие не ниже порога -> текст сценария + время из звука;
  * есть сценарий, но покрытие ниже порога  -> НЕ ТРОГАЕМ, оставляем чистую
    расшифровку и говорим об этом отдельной строкой;
  * сценария нет (ep-86, ep-88)             -> текст распознавания, но со своей
    разбивкой: пороги подкаста рассчитаны на диалог и на монологе дают
    куски по 75 секунд.
"""

import argparse
import json
from pathlib import Path

from script_align import align_episode, build_transcript, load_words, replicas_from_words

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
ESSAY_DIR = ROOT / "scripts" / "essay"
OUT_DIR = ROOT / "src" / "content" / "transcripts"
MAP_FILE = HERE / "essay-map.json"

# Порог согласован с заказчиком 8 августа 2026. Ниже него сценарий считается
# разошедшимся с записью: подставлять его нельзя, потому что расхождение
# означает, что текст говорит одно, а звук в этот момент — другое.
MIN_COVERED_RATIO = 0.85


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--input", required=True, help="папка с *.json и *.words.json.gz")
	parser.add_argument("--dry-run", action="store_true", help="посчитать и показать, ничего не записывая")
	args = parser.parse_args()

	src = Path(args.input)
	cfg = json.loads(MAP_FILE.read_text(encoding="utf-8"))

	rows = []
	for entry in cfg["episodes"]:
		guid, slug = entry["guid"], entry["slug"]
		rec_path = src / f"{guid}.json"
		words_path = src / f"{guid}.words.json.gz"
		script_path = ESSAY_DIR / entry["script"]

		if not rec_path.exists() or not words_path.exists():
			rows.append({"slug": slug, "state": "НЕТ РАСПОЗНАВАНИЯ"})
			continue

		replicas, stats, stream, dropped = align_episode(script_path, words_path)
		recognized = json.loads(rec_path.read_text(encoding="utf-8"))
		good = stats["covered_ratio"] >= MIN_COVERED_RATIO

		if good:
			transcript = build_transcript(recognized, replicas, stats, entry["script"])
			state = "сценарий"
		else:
			# Сценарий разошёлся с записью — оставляем расшифровку, как договорились.
			transcript = recognized
			state = "НИЗКОЕ ПОКРЫТИЕ -> оставлена расшифровка"

		if not args.dry_run:
			(OUT_DIR / f"{guid}.json").write_text(
				json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8"
			)

		rows.append(
			{
				"slug": slug,
				"state": state,
				"exact": stats["matched_ratio"],
				"covered": stats["covered_ratio"],
				"words": stats["script_words"],
				"replicas": len(transcript["replicas"]),
				"improvised": stats["improvised"],
				"dropped": stats["dropped_lines"],
			}
		)

	for slug in cfg["noScript"]:
		guid = _guid_of(slug)
		rec_path = src / f"{guid}.json"
		words_path = src / f"{guid}.words.json.gz"
		if not rec_path.exists() or not words_path.exists():
			rows.append({"slug": slug, "state": "НЕТ РАСПОЗНАВАНИЯ"})
			continue

		# Текст остаётся распознанный, но разбивку делаем свою: пороги подкаста
		# рассчитаны на диалог и на монологе дают куски по 75 секунд.
		data = json.loads(rec_path.read_text(encoding="utf-8"))
		data["replicas"] = replicas_from_words(load_words(words_path))
		if not args.dry_run:
			(OUT_DIR / f"{guid}.json").write_text(
				json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
			)
		rows.append({"slug": slug, "state": "без сценария", "replicas": len(data["replicas"])})

	_report(rows)


def _guid_of(slug):
	import re
	text = (ROOT / "src" / "content" / "posts" / f"{slug}.md").read_text(encoding="utf-8")
	return re.search(r"^audioGuid: *(.*)$", text, re.M).group(1).strip().strip("'\"")


def _report(rows):
	print(f"{'выпуск':<9}{'точно':>7}{'покрыто':>9}{'слов':>7}{'реплик':>8}{'импр.':>7}  состояние")
	print("-" * 78)
	rows.sort(key=lambda r: int(r["slug"].split("-")[1]))
	for r in rows:
		exact = f"{r['exact']*100:.1f}%" if "exact" in r else "—"
		cov = f"{r['covered']*100:.1f}%" if "covered" in r else "—"
		print(
			f"{r['slug']:<9}{exact:>7}{cov:>9}{r.get('words','—'):>7}"
			f"{r.get('replicas','—'):>8}{r.get('improvised','—'):>7}  {r['state']}"
		)

	done = [r for r in rows if r["state"] == "сценарий"]
	low = [r for r in rows if r["state"].startswith("НИЗКОЕ")]
	miss = [r for r in rows if r["state"] == "НЕТ РАСПОЗНАВАНИЯ"]
	print("-" * 78)
	print(f"со сценарием      : {len(done)}")
	if done:
		print(f"  покрытие в среднем: {sum(r['covered'] for r in done)/len(done)*100:.1f}%")
		print(f"  худшее покрытие   : {min(r['covered'] for r in done)*100:.1f}%")
	print(f"ниже порога       : {len(low)}" + (f" -> {[r['slug'] for r in low]}" if low else ""))
	print(f"без распознавания : {len(miss)}" + (f" -> {[r['slug'] for r in miss]}" if miss else ""))


if __name__ == "__main__":
	main()
