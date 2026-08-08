#!/usr/bin/env python3
"""Робот: новые выпуски расшифровываются сами (шаг 7 в тз/05-транскрипты.md).

Живёт в GitHub Actions рядом с добором выпусков из RSS
(.github/workflows/sync-episodes.yml), а НЕ на Hetzner. Серверный `pipeline.py`
остаётся для массовых прогонов — один выпуск в месяц обрабатывается прямо
в роботе, без SSH и без зависимости от того, включён ли сервер.

Две задачи за прогон, и каждая срабатывает ПО СОВПАДЕНИЮ УСЛОВИЙ, а не по
порядку действий автора. Поэтому сценарий можно подложить когда угодно —
хоть до выхода выпуска, хоть через неделю после:

  1. Расшифровать. Есть пост, есть аудио в RSS, транскрипта нет -> распознать.
  2. Подставить сценарий. Есть транскрипт, у поста заполнено поле «Сценарий»,
     сопоставление с ЭТИМ файлом ещё не делалось -> сопоставить.

Ничего своего эти задачи не считают: распознавание — `pipeline.process_episode`,
сопоставление — `script_align.align_episode`, тот самый код, что отработал
на 36 выпусках архива. Второй копии правил нет намеренно.

Запуск (руками обычно не нужен, робот ходит по расписанию):
  python3 scripts/transcribe/auto.py                  # обычный прогон
  python3 scripts/transcribe/auto.py --dry-run        # показать, ничего не тратя
  python3 scripts/transcribe/auto.py --retry-failed   # снова попробовать сбойные
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import traceback
import unicodedata
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import pipeline
import providers
from align_essays import MIN_COVERED_RATIO
from script_align import align_episode, build_transcript, load_words, replicas_from_words

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

POSTS_DIR = ROOT / "src" / "content" / "posts"
TRANSCRIPTS_DIR = ROOT / "src" / "content" / "transcripts"
ESSAY_DIR = ROOT / "scripts" / "essay"

# Пословные данные для новых выпусков. Нужны для того, чтобы сценарий можно было
# подложить ПОЗЖЕ: сопоставление берёт таймкоды каждого слова, а в готовом
# транскрипте их уже нет — там склеенные реплики. Без этой папки поле «Сценарий»
# работало бы только в тот же прогон, что и распознавание.
#
# Папка в корне, а не в src/: Astro читает только src/content, и попади сюда
# .gz-файлы рядом с расшифровками — сборка споткнулась бы о схему.
WORDS_DIR = ROOT / "transcripts" / "words"

# Что робот уже пробовал и не смог. Только сбои: успех виден по самому файлу
# расшифровки, дублировать его отдельной записью незачем — разъедутся.
STATE_FILE = ROOT / "transcripts" / "auto-state.json"

ADMIN_ENTRY_URL = "https://baka-page.eduard1414ed.workers.dev/admin/#/collections/posts/entries/"

# Сколько выпусков за один прогон. Защита из ТЗ: сбой не должен съесть месячную
# квоту разом. Выходит примерно выпуск в месяц, так что двух хватает с запасом
# даже после долгого простоя робота — остальные подхватит следующий прогон.
DEFAULT_LIMIT = 2

# Сколько раз пробовать один и тот же выпуск, прежде чем отступиться.
# «Не молчать и не пытаться бесконечно» — сбой попадает в уведомление, а выпуск
# в этот список, и робот перестаёт за него платить. Вернуть в очередь —
# ручной запуск с галочкой «повторить сбойные» (--retry-failed).
MAX_ATTEMPTS = 2

# Выпуски, которые не расшифровываем никогда. Это НЕ прежний список исключений
# из pipeline.py: «эссе» и «врата аниме» оттуда убраны намеренно. По ТЗ (шаг 7)
# расшифровка одинаковая для всех, включая эссе, — отдельной облегчённой ветки
# быть не должно, сценарий влияет только на подстановку текста. Остаются две
# служебные записи, речи в них нет: «Опенинг» (18 секунд) и трейлер чужого
# подкаста. Оба уже в архиве и оба по решению заказчика не расшифровываются.
SKIP_EXACT_TITLES = ["опенинг"]
SKIP_TITLE_PARTS = ["трейлер подкаста"]


def is_skipped(title):
	low = title.strip().lower()
	if low in SKIP_EXACT_TITLES:
		return True
	return any(part in low for part in SKIP_TITLE_PARTS)


# --- Чтение того, что уже есть в репозитории -------------------------------

RE_AUDIO_GUID = re.compile(r"^audioGuid: *(.*)$", re.M)
RE_SCRIPT = re.compile(r"^script: *(.*)$", re.M)
RE_DRAFT = re.compile(r"^draft: *(.*)$", re.M)


def _yaml_scalar(raw):
	"""Значение простого поля frontmatter. Кавычки CMS ставит не всегда."""
	value = raw.strip()
	if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
		value = value[1:-1]
		if raw.strip()[0] == "'":
			value = value.replace("''", "'")
	return value.strip()


def read_posts():
	"""guid выпуска -> сведения о посте. Разбор регуляркой, как в sync-episodes.mjs.

	Полноценный YAML-разбор тут не нужен и требовал бы лишней зависимости:
	читаем три простых однострочных поля, а тело поста нас не интересует вовсе.
	"""
	posts = {}
	for path in sorted(POSTS_DIR.glob("*.md")):
		text = path.read_text(encoding="utf-8")
		guid_match = RE_AUDIO_GUID.search(text)
		if not guid_match:
			continue
		script_match = RE_SCRIPT.search(text)
		draft_match = RE_DRAFT.search(text)
		posts[_yaml_scalar(guid_match.group(1))] = {
			"slug": path.stem,
			"path": path,
			"script": _yaml_scalar(script_match.group(1)) if script_match else "",
			"draft": bool(draft_match) and _yaml_scalar(draft_match.group(1)) == "true",
		}
	return posts


def transcript_path(guid):
	return TRANSCRIPTS_DIR / f"{guid}.json"


def words_path(guid):
	return WORDS_DIR / f"{guid}.words.json.gz"


def load_state():
	if STATE_FILE.exists():
		return json.loads(STATE_FILE.read_text(encoding="utf-8"))
	return {}


def save_state(state):
	STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
	if state:
		STATE_FILE.write_text(
			json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
		)
	elif STATE_FILE.exists():
		# Пустой файл-заглушка только сбивал бы с толку: сбоев нет — записи нет.
		STATE_FILE.unlink()


def now_iso():
	return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# --- Сценарий: где лежит файл ----------------------------------------------

def resolve_script(value):
	"""Файл сценария по тому, что записано в поле «Сценарий» у поста.

	Поле заполняет CMS кнопкой загрузки файла, и она пишет туда путь вида
	`/scripts/essay/Название.md`. Но за годы поле могут заполнить и руками —
	одним именем файла или путём от корня, — поэтому принимаем все три вида.

	Отдельно про NFC. macOS хранит в именах файлов «й» разложенной («и» плюс
	отдельный значок), а браузер отдаёт её собранной — строки выглядят
	одинаково, но не равны. На этом уже спотыкалось сопоставление сценариев
	архива: совпадение падало до 80 % там, где названия совпадают точь-в-точь.
	Поэтому сравниваем нормализованные имена, а не пути.
	"""
	value = urllib.parse.unquote(value.strip()).lstrip("/")
	if not value:
		return None

	candidates = [ROOT / value]
	if "/" not in value:
		candidates.append(ESSAY_DIR / value)
	for candidate in candidates:
		if candidate.is_file():
			return candidate

	wanted = unicodedata.normalize("NFC", Path(value).name)
	directory = (ROOT / value).parent
	for folder in {directory, ESSAY_DIR}:
		if not folder.is_dir():
			continue
		for existing in folder.iterdir():
			if existing.is_file() and unicodedata.normalize("NFC", existing.name) == wanted:
				return existing
	return None


def script_fingerprint(path):
	"""Слепок содержимого сценария.

	По нему видно не только «сопоставление делалось», но и «сценарий с тех пор
	поправили». Иначе исправленная опечатка в сценарии не доехала бы до сайта
	никогда: отметка-то стоит. Пересопоставление ничего не стоит — оно идёт
	по сохранённым пословным данным и в сеть не ходит.
	"""
	return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def dominant_speaker(rec_words):
	"""Чей голос звучит в выпуске больше всех, по данным распознавания.

	Текст сценария — это монолог, все реплики достаются одному голосу. Какому
	именно, брать наугад нельзя: разделение голосов работает и на эссе (так
	требует ТЗ), и если оно услышало второй голос, имена в карте `speakers`
	могут стоять в любом порядке — начитанное автором эссе подписалось бы
	чужим именем.
	"""
	totals = {}
	for word in rec_words:
		speaker = word.get("speaker", "speaker_0")
		totals[speaker] = totals.get(speaker, 0.0) + (word["end"] - word["start"])
	if not totals:
		return "speaker_0"
	return max(totals.items(), key=lambda item: item[1])[0]


# --- Отчёт и уведомление ---------------------------------------------------

class Report:
	"""Что накопилось за прогон. Из этого собирается письмо (задача на GitHub)."""

	def __init__(self):
		self.done = []      # расшифровано
		self.aligned = []   # подставлен сценарий
		self.failed = []    # не смогли, и это надо показать
		self.notes = []     # не сбой, но стоит знать

	@property
	def has_news(self):
		return bool(self.done or self.aligned or self.failed)

	def title(self):
		if self.failed and not (self.done or self.aligned):
			first = self.failed[0]
			return f"⚠️ {first['slug']} — {first['what']}"
		parts = []
		if self.done:
			parts.append(f"расшифрован {', '.join(item['slug'] for item in self.done)}")
		if self.aligned:
			parts.append(f"подставлен сценарий: {', '.join(item['slug'] for item in self.aligned)}")
		head = "; ".join(parts) if parts else "прогон робота"
		if self.failed:
			head += f" (и {len(self.failed)} со сбоем)"
		return head[:1].upper() + head[1:]

	def body(self):
		lines = []
		for item in self.done:
			lines.append(f"### ✅ {item['slug']} — расшифрован, ждёт проверки")
			lines.append("")
			lines.append(f"**{item['title']}**")
			lines.append("")
			lines.append(f"- длительность: {item['minutes']:.1f} мин, реплик: {item['replicas']}")
			lines.append(f"- стоимость: {item['cost']}")
			lines.append(f"- голоса: {item['speakers']}")
			if item.get("needs_check"):
				lines.append("- ⚠️ автоматика сомневалась в именах — проверьте поле «Имена спикеров»")
			lines.append(f"- [открыть в админке]({ADMIN_ENTRY_URL}{item['slug']})")
			lines.append("")
		for item in self.aligned:
			lines.append(f"### 📝 {item['slug']} — подставлен текст сценария")
			lines.append("")
			lines.append(f"- сценарий: `{item['script']}`")
			lines.append(
				f"- совпало слово в слово {item['exact']:.1f} %, "
				f"покрыто сценарием {item['covered']:.1f} %"
			)
			lines.append(f"- реплик: {item['replicas']}")
			lines.append(f"- [открыть в админке]({ADMIN_ENTRY_URL}{item['slug']})")
			lines.append("")
		for item in self.failed:
			lines.append(f"### ❌ {item['slug']} — {item['what']}")
			lines.append("")
			lines.append(f"**{item['title']}**")
			lines.append("")
			lines.append("```")
			lines.append(item["error"])
			lines.append("```")
			if item.get("gave_up"):
				lines.append("")
				lines.append(
					f"Попыток было {MAX_ATTEMPTS}, больше робот за этот выпуск платить не будет. "
					"Чтобы попробовать снова: GitHub → вкладка **Actions** → «Добор выпусков "
					"из RSS» → **Run workflow** → поставить галочку «повторить сбойные»."
				)
			lines.append("")
		if self.notes:
			lines.append("### Заодно")
			lines.append("")
			for note in self.notes:
				lines.append(f"- {note}")
			lines.append("")
		lines.append("---")
		lines.append("")
		if self.done or self.aligned:
			lines.append(
				"Задачу можно закрыть, когда проверите выпуск и опубликуете его. "
			)
		lines.append(
			"Робот — `scripts/transcribe/auto.py`, шаг 7 в `тз/05-транскрипты.md`."
		)
		return "\n".join(lines)

	def print_summary(self):
		print("\n=== Итог прогона ===")
		print(f"расшифровано      : {len(self.done)}")
		print(f"подставлен сценарий: {len(self.aligned)}")
		print(f"сбоев             : {len(self.failed)}")
		for note in self.notes:
			print(f"  · {note}")


# --- Задача 1: расшифровать ------------------------------------------------

def transcribe_new(episodes, posts, state, report, args, provider, api_key):
	queue = []
	gave_up = []
	for episode in episodes:
		guid = episode["guid"]
		post = posts.get(guid)
		if post is None:
			# Черновик заводит sync-episodes.mjs шагом раньше в этом же прогоне.
			# Если поста нет, значит тот шаг до выпуска не дошёл — не наше дело.
			continue
		if is_skipped(episode["title"]):
			continue
		if transcript_path(guid).exists():
			continue
		if not episode.get("audio_url"):
			report.notes.append(f"{post['slug']}: в RSS нет ссылки на аудио, пропущен")
			continue
		attempts = state.get(guid, {}).get("attempts", 0)
		if attempts >= MAX_ATTEMPTS and not args.retry_failed:
			gave_up.append(post["slug"])
			continue
		queue.append((episode, post))

	if gave_up:
		report.notes.append(
			f"отложены после {MAX_ATTEMPTS} неудачных попыток: {', '.join(gave_up)} "
			"(вернуть в очередь — ручной запуск с галочкой «повторить сбойные»)"
		)

	if not queue:
		print(
			"Расшифровывать нечего: у всех выпусков из RSS транскрипт уже есть"
			+ (f" (кроме отложенных: {', '.join(gave_up)})." if gave_up else ".")
		)
		return

	print(f"Без расшифровки выпусков: {len(queue)}. Возьму за этот прогон: "
	      f"{min(len(queue), args.limit)} (лимит --limit).")

	for episode, post in queue[: args.limit]:
		guid = episode["guid"]
		print(f"\n--- {post['slug']} ---")
		try:
			transcript = pipeline.process_episode(
				episode, provider, api_key, dry_run=args.dry_run,
				# Разделение голосов и измерение высоты включены ВСЕГДА, даже
				# для эссе: так требует ТЗ (шаг 7). Иначе вставка из интервью
				# или реплика соведущей молча приписалась бы рассказчику.
				single_speaker=False,
			)
			if args.dry_run or transcript is None:
				continue
			publish_result(guid, post, episode, transcript, report)
			state.pop(guid, None)
		except Exception as exc:  # noqa: BLE001 — сбой одного выпуска не роняет прогон
			traceback.print_exc()
			attempts = state.get(guid, {}).get("attempts", 0) + 1
			state[guid] = {
				"title": episode["title"],
				"slug": post["slug"],
				"attempts": attempts,
				"lastError": str(exc)[:500],
				"lastTry": now_iso(),
			}
			report.failed.append({
				"slug": post["slug"],
				"title": episode["title"],
				"what": "распознавание не удалось",
				"error": str(exc)[:1500],
				"gave_up": attempts >= MAX_ATTEMPTS,
			})
		finally:
			if not args.dry_run:
				save_state(state)


def resplit_if_monologue(guid, transcript, report, post):
	"""Перерезать реплики монолога по паузам — бесплатно, по пословным данным.

	Обычные пороги рассчитаны на диалог, где реплику в первую очередь рвёт смена
	голоса. В монологе смены нет, и куски упираются в потолок: у этого выпуска
	вышло 14 реплик по минуте на 12,7 минуты речи, медиана 64 секунды. Внутрь
	такого блока не ткнёшь, чтобы перемотать, — ровно та стена без таймкодов,
	с которой боролись на пятом шаге.

	Правило то же, что применили к ep-86 и ep-88 (`MONOLOGUE_PAUSE_SEC`
	в script_align.py), и код тот же — второй нарезки не пишем.

	Условие срабатывания — один голос на весь выпуск. Разделение голосов при этом
	работало (так требует ТЗ, шаг 7): если бы в эссе оказалась вставка из интервью
	или реплика соведущей, голосов было бы два и сюда мы бы не зашли.
	"""
	voices = {r["speaker"] for r in transcript["replicas"]}
	if len(voices) != 1:
		return transcript

	wpath = words_path(guid)
	if not wpath.exists():
		return transcript

	speaker = voices.pop()
	before = len(transcript["replicas"])
	transcript = dict(transcript)
	transcript["replicas"] = replicas_from_words(load_words(wpath), speaker=speaker)
	transcript_path(guid).write_text(
		json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8"
	)
	print(f"монолог: реплики перерезаны по паузам, {before} → {len(transcript['replicas'])}")
	report.notes.append(
		f"{post['slug']}: один голос на весь выпуск — реплики перерезаны "
		f"по паузам ({before} → {len(transcript['replicas'])}), это бесплатно"
	)
	return transcript


def publish_result(guid, post, episode, transcript, report):
	"""Перенести результат прогона из рабочей папки в репозиторий."""
	TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
	WORDS_DIR.mkdir(parents=True, exist_ok=True)

	shutil.move(str(pipeline.OUTPUT_DIR / f"{guid}.json"), transcript_path(guid))
	produced_words = pipeline.OUTPUT_DIR / f"{guid}.words.json.gz"
	if produced_words.exists():
		shutil.move(str(produced_words), words_path(guid))

	transcript = resplit_if_monologue(guid, transcript, report, post)

	info = transcript.get("speakerInfo", {})
	report.done.append({
		"slug": post["slug"],
		"title": episode["title"],
		"minutes": episode["duration_sec"] / 60,
		"replicas": len(transcript["replicas"]),
		"cost": pipeline.format_estimate(pipeline.load_state().get(guid, {}).get("cost", {})),
		"speakers": ", ".join(transcript["speakers"].values()),
		"needs_check": any("?" in name for name in transcript["speakers"].values())
		or any(meta.get("needsName") for meta in info.values()),
	})
	print(f"→ src/content/transcripts/{guid}.json")


# --- Задача 2: подставить сценарий -----------------------------------------

def _report_script_problem(state, report, post, guid, signature, what, error):
	"""Сказать про беду со сценарием ОДИН раз, а не каждую ночь.

	Сопоставление бесплатное, поэтому робот перебирает сценарии каждый прогон.
	Но беда, которая сама не проходит (подложен чужой файл, файл не найден),
	без этой памяти давала бы новое письмо каждые сутки — и письма робота
	перестали бы читать вовсе. Признак — сам сценарий: поменяли файл или
	поле, признак изменился, и робот скажет про новую беду снова.
	"""
	entry = state.setdefault(guid, {})
	already = entry.get("scriptProblem") == signature
	entry["slug"] = post["slug"]
	entry["scriptProblem"] = signature
	entry["lastTry"] = now_iso()
	if already:
		report.notes.append(f"{post['slug']}: {what} (уже сообщал, повторно не пишу)")
		return
	report.failed.append({
		"slug": post["slug"],
		"title": post["slug"],
		"what": what,
		"error": error,
	})


def _forget_script_problem(state, guid):
	entry = state.get(guid)
	if entry and entry.pop("scriptProblem", None) is not None and not entry.get("attempts"):
		state.pop(guid, None)


def align_scripts(posts, state, report, args):
	for guid, post in posts.items():
		if not post["script"]:
			continue
		tpath = transcript_path(guid)
		if not tpath.exists():
			# Сценарий положили раньше, чем вышел выпуск, — это разрешено.
			# Сопоставится сам, как только появится расшифровка.
			continue

		script_file = resolve_script(post["script"])
		if script_file is None:
			_report_script_problem(
				state, report, post, guid,
				signature=f"missing:{post['script']}",
				what="файл сценария не найден",
				error=(
					f"В поле «Сценарий» стоит «{post['script']}», но такого файла "
					"в репозитории нет. Загрузите сценарий заново через админку."
				),
			)
			continue

		fingerprint = script_fingerprint(script_file)
		transcript = json.loads(tpath.read_text(encoding="utf-8"))
		alignment = transcript.get("alignment") or {}
		if transcript.get("source") == "aligned" and alignment.get("scriptHash") == fingerprint:
			# Уже сопоставлено с этим самым файлом. Заодно снимаем память
			# о прошлой беде: сюда мы попадаем и после того, как автор заменил
			# ошибочный сценарий на верный.
			_forget_script_problem(state, guid)
			continue

		wpath = words_path(guid)
		if not wpath.exists():
			# Не письмо, а строчка в логе: это не поломка, а известное свойство
			# архива, и чинится оно не автором, а переносом данных с сервера.
			report.notes.append(
				f"{post['slug']}: сценарий есть, но пословных данных нет "
				f"({wpath.relative_to(ROOT)}) — сопоставить нечем. "
				"Так у выпусков архива: их распознавали на сервере, и пословные "
				"данные остались там."
			)
			continue

		print(f"\n--- {post['slug']}: подставляю сценарий «{script_file.name}» ---")
		rec_words = load_words(wpath)
		replicas, stats, _stream, _dropped = align_episode(
			script_file, wpath, speaker=dominant_speaker(rec_words)
		)
		covered = stats["covered_ratio"]
		if covered < MIN_COVERED_RATIO:
			# Тот же порог, что у архива. Ниже него сценарий считается
			# разошедшимся с записью: подставлять нельзя, текст говорил бы одно,
			# а звук в этот момент другое.
			_report_script_problem(
				state, report, post, guid,
				signature=f"low:{fingerprint}",
				what="сценарий не подставлен, слишком расходится с записью",
				error=(
					f"Сценарий «{script_file.name}»: покрыто {covered*100:.1f} % "
					f"при пороге {MIN_COVERED_RATIO*100:.0f} %. Расшифровка оставлена "
					"как есть, ничего не испорчено.\nПохоже, это сценарий не от этого "
					"выпуска — проверьте поле «Сценарий» у поста."
				),
			)
			continue

		result = build_transcript(transcript, replicas, stats, script_file.name)
		result["alignment"]["scriptHash"] = fingerprint
		if not args.dry_run:
			tpath.write_text(
				json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
			)
			_forget_script_problem(state, guid)
		report.aligned.append({
			"slug": post["slug"],
			"script": script_file.name,
			"exact": stats["matched_ratio"] * 100,
			"covered": covered * 100,
			"replicas": len(replicas),
		})
		print(
			f"совпало {stats['matched_ratio']*100:.1f} %, покрыто {covered*100:.1f} %, "
			f"реплик {len(replicas)}"
		)


# --- Точка входа -----------------------------------------------------------

def main():
	sys.stdout.reconfigure(line_buffering=True)

	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
	                    help=f"сколько выпусков расшифровать за прогон (по умолчанию {DEFAULT_LIMIT})")
	parser.add_argument("--dry-run", action="store_true",
	                    help="показать, что робот сделал бы, ничего не тратя и не записывая")
	parser.add_argument("--retry-failed", action="store_true",
	                    help="снова взять выпуски, на которых робот уже отступился")
	parser.add_argument("--provider", default=providers.DEFAULT, choices=providers.names())
	parser.add_argument("--notify-file", help="куда записать текст уведомления (для GitHub Actions)")
	args = parser.parse_args()

	provider = providers.get(args.provider)
	# В GitHub Actions ключ приходит переменной окружения из секретов репозитория,
	# на своём компьютере — из .env рядом со скриптом (в репозиторий он не попадает).
	api_key = os.environ.get(provider.env_key) or pipeline.load_env(
		pipeline.WORK_DIR / ".env"
	).get(provider.env_key)

	posts = read_posts()
	state = load_state()
	report = Report()

	print(f"Постов с привязкой к выпуску: {len(posts)}. "
	      f"Расшифровок в репозитории: {len(list(TRANSCRIPTS_DIR.glob('*.json')))}.")

	try:
		episodes = pipeline.fetch_feed_items()
	except Exception as exc:  # noqa: BLE001
		# Недоступный RSS — не повод падать: сопоставление сценариев от сети
		# не зависит и должно отработать всё равно.
		print(f"RSS недоступен ({exc}) — в этот раз расшифровывать не буду.")
		episodes = []

	if episodes:
		if not api_key:
			print(f"Нет ключа {provider.env_key} — распознавать нечем.", file=sys.stderr)
		else:
			transcribe_new(episodes, posts, state, report, args, provider, api_key)

	align_scripts(posts, state, report, args)
	if not args.dry_run:
		save_state(state)

	report.print_summary()

	if args.notify_file and report.has_news and not args.dry_run:
		Path(args.notify_file).write_text(
			report.title() + "\n\n" + report.body(), encoding="utf-8"
		)
		print(f"Текст уведомления записан: {args.notify_file}")


if __name__ == "__main__":
	main()
