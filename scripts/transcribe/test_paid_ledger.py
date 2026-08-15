#!/usr/bin/env python3
"""Проверки ответа на вопрос «за этот выпуск уже заплачено?».

Запуск:
  python3 test_paid_ledger.py             — проверки
  python3 test_paid_ledger.py --selftest  — подлоги: каждая обязана уметь падать

ЗАЧЕМ ЭТО ВООБЩЕ. Раньше ответ давал один файл `state.json` — он лежит рядом
со скриптом и закрыт `.gitignore`, то есть существует ровно на той машине, где
шла работа. На машине заказчика в нём ОДНА запись при СТА СОРОКА ДВУХ готовых
расшифровках в репозитории. Запусти пайплайн отсюда — он сказал бы «уже
сделано: 1» и пошёл платить заново за сто сорок один выпуск (доревизия
задачи 15, находка 19).

ПРОВЕРКИ ИДУТ НА ПОДЛОЖЕННЫХ ПАПКАХ, А НЕ НА ЖИВЫХ. Живые данные меняются
от каждой работы заказчика, и проверка, стоящая на их числе, протухает; здесь
же ответ известен заранее. Отдельно, последним разделом, стоит ЗАМЕР по живому
репозиторию — он ничего не утверждает, а печатает числа.
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

import pipeline

FAILURES = []


def check(name, condition, detail=""):
	print(("  OK    " if condition else "  ПЛОХО ") + name + (f"  [{detail}]" if detail and not condition else ""))
	if not condition:
		FAILURES.append(name)


class Sandbox:
	"""Подложенные папки вместо настоящих: журнал, output/ и репозиторий.

	Пайплайн держит пути константами модуля, поэтому подменяем их на время
	проверки и возвращаем обратно — как временную подмену в остальных
	проверках проекта.
	"""

	def __init__(self, state=None, output=(), repo=None):
		self.state = state or {}
		self.output = output
		self.repo = repo

	def __enter__(self):
		self.dir = Path(tempfile.mkdtemp(prefix="baka-ledger-"))
		self.saved = (pipeline.STATE_FILE, pipeline.OUTPUT_DIR, pipeline.REPO_TRANSCRIPTS)

		state_file = self.dir / "state.json"
		state_file.write_text(json.dumps(self.state, ensure_ascii=False))

		out = self.dir / "output"
		out.mkdir()
		for guid in self.output:
			(out / f"{guid}.json").write_text("{}")

		if self.repo is None:
			repo = self.dir / "нет-такой-папки" / "transcripts"
		else:
			repo = self.dir / "repo"
			repo.mkdir(parents=True)
			for guid in self.repo:
				(repo / f"{guid}.json").write_text("{}")

		pipeline.STATE_FILE = state_file
		pipeline.OUTPUT_DIR = out
		pipeline.REPO_TRANSCRIPTS = repo
		return self

	def __exit__(self, *_):
		pipeline.STATE_FILE, pipeline.OUTPUT_DIR, pipeline.REPO_TRANSCRIPTS = self.saved
		shutil.rmtree(self.dir, ignore_errors=True)


DONE = {"status": "done"}
A, B, C = "guid-a", "guid-b", "guid-c"


def main():
	selftest = "--selftest" in sys.argv

	print("── откуда берётся ответ ──")

	# 1. Журнал знает — этого и раньше хватало.
	with Sandbox(state={A: DONE}):
		g = pipeline.paid_ledger()["guids"]
		check("журнал state.json учитывается", A in g)

	# 2. ГЛАВНОЕ: репозиторий знает, а журнал нет. Ровно случай машины заказчика.
	with Sandbox(state={}, repo=[A, B]):
		g = pipeline.paid_ledger()["guids"]
		check("расшифровка в репозитории считается оплаченной", A in g and B in g, f"нашлось {sorted(g)}")

	# 3. Папка output/ рядом со скриптом — щель внутри самого прогона: файл лёг,
	#    а журнал переписаться не успел.
	with Sandbox(state={}, output=[C]):
		g = pipeline.paid_ledger()["guids"]
		check("файл в output/ считается оплаченным", C in g, f"нашлось {sorted(g)}")

	# 4. Три источника складываются, а не заменяют друг друга.
	with Sandbox(state={A: DONE}, output=[B], repo=[C]):
		g = pipeline.paid_ledger()["guids"]
		check("три источника складываются", g == {A, B, C}, f"нашлось {sorted(g)}")

	# 5. Незаконченный выпуск оплаченным не считается.
	with Sandbox(state={A: {"status": "error"}}):
		g = pipeline.paid_ledger()["guids"]
		check("выпуск со сбоем НЕ считается оплаченным", A not in g)

	# 6. Пословные данные лежат рядом и на вопрос не отвечают:
	#    `<guid>.words.json.gz` — не транскрипт, а сырьё.
	with Sandbox(state={}) as box:
		(box.dir / "output" / "guid-d.words.json.gz").write_text("x")
		g = pipeline.paid_ledger()["guids"]
		check("пословные данные за транскрипт не выдаются", "guid-d" not in g and "guid-d.words" not in g, f"нашлось {sorted(g)}")

	print("\n── «источника нет» и «не оплачено» — разные ответы ──")

	# 7. На сервере папки репозитория нет вовсе. Это законно, но обязано
	#    быть СКАЗАНО ВСЛУХ: молчаливое «значит не оплачено» стоит денег.
	with Sandbox(state={A: DONE}, repo=None):
		led = pipeline.paid_ledger()
		said = any("НЕТ ПАПКИ" in s for s in led["sources"])
		check("про недоступный репозиторий сказано вслух", said, "; ".join(led["sources"]))
		check("и при этом журнал всё равно учтён", A in led["guids"])

	print("\n── журнал пишется целиком или никак ──")

	# 8. Атомарная запись: после сохранения не остаётся временного файла,
	#    а прочитанное совпадает с записанным.
	with Sandbox(state={}) as box:
		pipeline.save_state({A: DONE})
		back = pipeline.load_state()
		leftovers = [p.name for p in box.dir.iterdir() if p.name.startswith("state") and p.name != "state.json"]
		check("журнал читается обратно", back == {A: DONE}, str(back))
		check("временный файл не остаётся", not leftovers, str(leftovers))

	# ── ПОДЛОГИ: проверка обязана уметь провалиться ────────────────────────
	if selftest:
		print("\n── ПОДЛОГИ: возвращаем прежнее правило ──")

		# Прежнее правило: спрашиваем ТОЛЬКО журнал. Проверка 2 обязана упасть.
		with Sandbox(state={}, repo=[A, B]):
			only_state = {g for g, v in pipeline.load_state().items() if v.get("status") == "done"}
			check(
				"ПОДЛОГ: со старым правилом расшифровки репозитория не видны",
				A not in only_state and B not in only_state,
				"старое правило почему-то их увидело — значит подлог не тот",
			)
			# И сразу показываем цену: сколько выпусков ушло бы в оплату заново.
			print(f"         старое правило знало бы {len(only_state)}, новое — {len(pipeline.paid_ledger()['guids'])}")

		# Прежняя запись журнала: прямо поверх файла. Проверяем, что подлог
		# ОТЛИЧАЕТСЯ от нынешней: иначе проверка 8 ничего не доказывает.
		with Sandbox(state={}) as box:
			(box.dir / "state.json").write_text(json.dumps({A: DONE}))
			tmp_before = list(box.dir.glob("*.tmp"))
			pipeline.save_state({B: DONE})
			tmp_after = list(box.dir.glob("*.tmp"))
			check(
				"ПОДЛОГ: атомарная запись правда пользуется временным файлом",
				tmp_before == [] and tmp_after == [] and pipeline.load_state() == {B: DONE},
				"после записи журнал не тот",
			)

	print("\n── ЗАМЕР по живому репозиторию (ничего не утверждает) ──")
	live = pipeline.paid_ledger()
	for line in live["sources"]:
		print(f"   {line}")
	print(f"   всего оплаченных по всем источникам: {len(live['guids'])}")

	print()
	if FAILURES:
		print(f"ЕСТЬ ОШИБКИ ({len(FAILURES)}): " + "; ".join(FAILURES))
		sys.exit(1)
	print("Все проверки прошли.")


if __name__ == "__main__":
	main()
