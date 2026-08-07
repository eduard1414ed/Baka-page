#!/usr/bin/env python3
"""Транскрипция выпусков подкаста. Работает на Hetzner (см. тз/05-транскрипты.md) —
качает по одному выпуску из RSS, отправляет на распознавание, сразу удаляет аудио,
определяет ведущих по высоте голоса, предлагает исправления искажённых названий
аниме (не применяет их сама).

Сам сервис распознавания сюда не зашит: он подключается модулем из папки
providers/ (форма модуля описана в providers/__init__.py). Всё, что делает этот
файл, от выбранного сервиса не зависит.

Использование:
  python3 pipeline.py --list                  показать выпуски и статус обработки
  python3 pipeline.py --estimate-archive --of 4
                                              смета и разбивка архива на 4 части
  python3 pipeline.py --run --part 1 --of 4   прогнать первую часть архива
  python3 pipeline.py --guid <guid>           обработать один выпуск
  python3 pipeline.py --guid <guid> --dry-run посчитать стоимость, ничего не отправлять
  python3 pipeline.py --recheck-names         заново сверить названия аниме по готовым
                                              транскриптам — бесплатно, без распознавания
  python3 pipeline.py --export транскрипты.tar.gz
                                              упаковать готовое, чтобы забрать с сервера
  python3 pipeline.py --guid <guid> --provider soniox --out-suffix soniox
                                              прогнать другим сервисом, не затирая
                                              уже готовый транскрипт

Долгий прогон надо запускать так, чтобы он пережил закрытие ноутбука:

  nohup python3 pipeline.py --run --part 1 --of 4 --yes > part1.log 2>&1 &

После этого можно спокойно отключаться, а смотреть, как идёт дело:
  tail -f part1.log
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tarfile
import time
import traceback
import wave
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import requests

import providers

FEED_URL = "https://cloud.mave.digital/33503"
ANIME_INDEX_URL = "https://baka-page.eduard1414ed.workers.dev/anime-index.json"

WORK_DIR = Path(__file__).resolve().parent
STATE_FILE = WORK_DIR / "state.json"
OUTPUT_DIR = WORK_DIR / "output"
TMP_DIR = WORK_DIR / "tmp"

# Основной способ — по высоте голоса (Шаг 4 в тз/05-транскрипты.md).
HOST_MALE = "Эд"
HOST_FEMALE = "Ксюша"

# Выпуски, которые НЕ надо распознавать: у них есть готовый точный сценарий,
# автор подгружает его сам. По ТЗ (шаг 2) их путь другой — выравнивание готового
# текста по звуку, а не распознавание. Из архива распознавания они исключены,
# из проекта — нет.
#
# Сравнение по куску названия, без учёта регистра. «эссе» заодно ловит
# «Мини-эссе», отдельное правило не нужно.
#
# «врата аниме» — обязательно целой фразой. По одному слову «врата» под нож
# попал бы выпуск «Врата Штейна | Как разделить сериал на две части…» — это
# разбор аниме Steins;Gate, а не рубрика, и распознавать его надо.
EXCLUDE_TITLE_PARTS = ["эссе", "врата аниме", "трейлер подкаста"]

# Отдельный список — для названий, которые надо сверять целиком, а не куском.
# «Опенинг» — служебная запись в RSS на 18 секунд, речи там нет. Куском это
# слово брать нельзя: под нож попал бы, например, будущий выпуск
# «Опенинги. Зачем в аниме нужны музыкальные заставки?».
EXCLUDE_EXACT_TITLES = ["опенинг"]


def is_excluded(title):
	low = title.strip().lower()
	if low in EXCLUDE_EXACT_TITLES:
		return True
	return any(part in low for part in EXCLUDE_TITLE_PARTS)

# Граница между мужским и женским голосом, Гц. Мужской обычно 85–180,
# женский 165–255 — диапазоны почти не пересекаются, что и делает способ
# надёжным при двух разнополых ведущих (см. Шаг 4 в ТЗ).
# Нужна не для того, чтобы определять пол, а чтобы поймать случай, когда
# в «ведущие» по объёму речи пролез гость: если оба главных голоса оказались
# по одну сторону границы, пара подозрительная.
VOICE_SPLIT_HZ = 165


def load_env(path):
	env = {}
	if path.exists():
		for line in path.read_text().splitlines():
			line = line.strip()
			if not line or line.startswith("#") or "=" not in line:
				continue
			key, value = line.split("=", 1)
			env[key.strip()] = value.strip()
	return env


def fetch_feed_items():
	xml = requests.get(FEED_URL, timeout=30).text
	items = re.findall(r"<item>(.*?)</item>", xml, re.S)
	episodes = []
	for block in items:
		title_match = re.search(r"<title>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))</title>", block, re.S)
		title = (title_match.group(1) or title_match.group(2)).strip() if title_match else "?"
		guid_match = re.search(r"<guid[^>]*>(.*?)</guid>", block)
		guid = guid_match.group(1).strip() if guid_match else None
		audio_match = re.search(r'<enclosure[^>]*url="([^"]+)"', block)
		audio_url = audio_match.group(1) if audio_match else None
		dur_match = re.search(r"<itunes:duration>(.*?)</itunes:duration>", block)
		raw_dur = dur_match.group(1).strip() if dur_match else "0"
		if raw_dur.isdigit():
			duration_sec = int(raw_dur)
		else:
			parts = [int(p) for p in raw_dur.split(":")]
			duration_sec = 0
			for part in parts:
				duration_sec = duration_sec * 60 + part
		link_match = re.search(r"<link>(.*?)</link>", block)
		link = link_match.group(1).strip() if link_match else None
		if guid and audio_url:
			episodes.append(
				{
					"guid": guid,
					"title": title,
					"audio_url": audio_url,
					"duration_sec": duration_sec,
					"link": link,
				}
			)
	return episodes


def load_state():
	if STATE_FILE.exists():
		return json.loads(STATE_FILE.read_text())
	return {}


def save_state(state):
	STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2))


def download_audio(url, dest, attempts=3):
	"""Скачать аудио, пережив короткий обрыв связи.

	Файлы по 40–90 МБ, а прогон идёт часами — рано или поздно сеть моргнёт.
	Без повторов один такой обрыв ронял бы весь выпуск.
	"""
	for attempt in range(1, attempts + 1):
		try:
			with requests.get(url, stream=True, timeout=120) as response:
				response.raise_for_status()
				with open(dest, "wb") as f:
					for chunk in response.iter_content(chunk_size=1 << 20):
						f.write(chunk)
			return
		except Exception as exc:
			if dest.exists():
				dest.unlink()
			if attempt == attempts:
				raise
			pause = 5 * attempt
			print(f"  не скачалось ({exc}); повтор {attempt + 1} из {attempts} через {pause} сек")
			time.sleep(pause)


def check_disk_space(episodes, min_free_mb=1500):
	"""Хватит ли места на диске. Требование из CLAUDE.md — на сервере всего 40 ГБ.

	Одновременно на диске лежит только один выпуск: mp3 (~2 МБ на минуту)
	и его копия в wav 16 кГц моно для замера голоса (~1.9 МБ на минуту).
	Считаем по самому длинному выпуску в списке.
	"""
	longest_min = max(e["duration_sec"] for e in episodes) / 60
	need_mb = longest_min * 4
	free_mb = shutil.disk_usage(WORK_DIR).free / (1024 * 1024)
	print(
		f"Место на диске: свободно {free_mb/1024:.1f} ГБ, "
		f"самый длинный выпуск потребует ~{need_mb:.0f} МБ (mp3 + копия для замера голоса)"
	)
	if free_mb < max(need_mb * 2, min_free_mb):
		raise RuntimeError(
			f"Мало места на диске: свободно {free_mb:.0f} МБ, "
			f"нужно хотя бы {max(need_mb * 2, min_free_mb):.0f} МБ. "
			"Освободите место и запустите снова."
		)


# --- Сборка реплик из слов ---------------------------------------------

def build_replicas(words):
	"""Склеивает подряд идущие слова одного спикера в реплики.

	На вход идёт нормализованный список от провайдера (см. providers/__init__.py),
	поэтому эта функция одинакова для любого сервиса распознавания.
	"""
	replicas = []
	current = None
	for word in words:
		speaker = word["speaker"]
		if current is None or current["speaker"] != speaker:
			if current is not None:
				replicas.append(current)
			current = {
				"speaker": speaker,
				"start": word["start"],
				"end": word["end"],
				"text": word["text"],
			}
		else:
			current["end"] = word["end"]
			current["text"] += word["text"] if word["text"] in ",.!?;:…" else " " + word["text"]
	if current is not None:
		replicas.append(current)
	return replicas


# --- Определение ведущих по высоте голоса --------------------------------

def convert_to_wav16k(mp3_path, wav_path):
	subprocess.run(
		["ffmpeg", "-y", "-i", str(mp3_path), "-ac", "1", "-ar", "16000", str(wav_path)],
		check=True,
		stdout=subprocess.DEVNULL,
		stderr=subprocess.DEVNULL,
	)


def load_wav_mono16(wav_path):
	with wave.open(str(wav_path), "rb") as wf:
		sr = wf.getframerate()
		frames = wf.readframes(wf.getnframes())
	samples = np.frombuffer(frames, dtype=np.int16)
	return samples, sr


def estimate_pitches(samples, sr, fmin=70, fmax=400):
	frame_len = int(sr * 0.04)
	hop = int(sr * 0.02)
	pitches = []
	for start in range(0, max(0, len(samples) - frame_len), hop):
		frame = samples[start : start + frame_len].astype(np.float64)
		frame -= frame.mean()
		if np.max(np.abs(frame)) < 200:  # тишина/шум на уровне 16-битного сэмпла
			continue
		corr = np.correlate(frame, frame, mode="full")
		corr = corr[len(corr) // 2 :]
		if corr[0] <= 0:
			continue
		min_lag = int(sr / fmax)
		max_lag = min(int(sr / fmin), len(corr) - 1)
		if max_lag <= min_lag:
			continue
		segment = corr[min_lag:max_lag]
		peak_idx = int(np.argmax(segment))
		peak_val = segment[peak_idx]
		confidence = peak_val / corr[0]
		if confidence < 0.3:
			continue
		lag = peak_idx + min_lag
		pitches.append(sr / lag)
	return pitches


def speaker_pitch(samples, sr, segments, cap_seconds=120):
	pitches = []
	used_seconds = 0.0
	for seg in segments:
		if used_seconds >= cap_seconds:
			break
		start_i = max(0, int(seg["start"] * sr))
		end_i = min(len(samples), int(seg["end"] * sr))
		if end_i <= start_i:
			continue
		pitches.extend(estimate_pitches(samples[start_i:end_i], sr))
		used_seconds += seg["end"] - seg["start"]
	if len(pitches) < 20:
		return None
	return float(np.median(pitches))


def assign_speaker_names(replicas, wav_samples, sr):
	"""Раздать голосам номера и имена.

	Возвращает четыре вещи:
	  slug   — как голос назвал сервис -> наш номер (speaker_0, speaker_1, …).
	           Нумеруем сами, по объёму речи, чтобы формат не зависел от того,
	           как спикеров обозначил конкретный сервис распознавания.
	  names  — наш номер -> имя. Это и есть карта, которую потом правят руками:
	           поменял имя в одной строке — поменялось во всём выпуске.
	  info   — что известно про каждый голос: ведущий или гость, чем определён,
	           высота голоса, сколько говорил, нужно ли вписать имя вручную.
	  notes  — что показать на экране после прогона.
	"""
	by_speaker = {}
	for r in replicas:
		by_speaker.setdefault(r["speaker"], []).append(r)

	durations = {
		sid: sum(r["end"] - r["start"] for r in segs) for sid, segs in by_speaker.items()
	}
	ranked = sorted(durations, key=lambda sid: durations[sid], reverse=True)
	slug = {sid: f"speaker_{i}" for i, sid in enumerate(ranked)}

	# Высоту меряем у всех голосов, не только у ведущих: для гостей она
	# ничего не решает автоматически, но помогает вам понять, кто где,
	# когда будете вписывать имена руками.
	pitches = {sid: speaker_pitch(wav_samples, sr, by_speaker[sid]) for sid in ranked}

	names = {}
	notes = []
	main_two = ranked[:2]

	if len(main_two) == 2 and all(pitches[sid] is not None for sid in main_two):
		lower = min(main_two, key=lambda sid: pitches[sid])
		higher = max(main_two, key=lambda sid: pitches[sid])
		names[slug[lower]] = HOST_MALE
		names[slug[higher]] = HOST_FEMALE
		hosts_method = "pitch"

		# Ведущими считаются два самых разговорчивых голоса. В выпуске с гостями
		# это может подвести: если гость-мужчина наговорил больше Ксюши, в пару
		# попадут два мужских голоса и гостю достанется её имя. Ловим это по
		# тому, что оба голоса оказались по одну сторону границы.
		split_ok = pitches[lower] < VOICE_SPLIT_HZ <= pitches[higher]
		hosts_reliable = split_ok
		notes.append(
			f"Определено по высоте голоса: {slug[lower]} -> {HOST_MALE} "
			f"({pitches[lower]:.0f} Гц), {slug[higher]} -> {HOST_FEMALE} "
			f"({pitches[higher]:.0f} Гц)"
		)
		if not split_ok:
			names[slug[lower]] = f"{HOST_MALE}?"
			names[slug[higher]] = f"{HOST_FEMALE}?"
			hosts_method = "pitch-ambiguous"
			notes.append(
				f"ВНИМАНИЕ: оба главных голоса лежат по одну сторону границы "
				f"{VOICE_SPLIT_HZ} Гц, то есть похожи по полу. Скорее всего, в пару "
				"ведущих попал гость, который много говорил. ИМЕНА НУЖНО ПРОВЕРИТЬ "
				"РУКАМИ (отмечены знаком ?)."
			)
	elif len(main_two) == 2:
		# Запасной способ — по объёму речи, если измерение высоты не удалось.
		names[slug[main_two[0]]] = f"{HOST_MALE}?"
		names[slug[main_two[1]]] = f"{HOST_FEMALE}?"
		hosts_method = "volume"
		hosts_reliable = False
		notes.append(
			"Не удалось надёжно измерить высоту голоса — имена расставлены "
			"по объёму речи, ЭТО НУЖНО ПРОВЕРИТЬ РУКАМИ (отмечено знаком ?)."
		)
	elif len(main_two) == 1:
		names[slug[main_two[0]]] = f"{HOST_MALE}/{HOST_FEMALE}?"
		hosts_method = "single"
		hosts_reliable = False
		notes.append("В выпуске обнаружен только один голос — определить пару не удалось.")
	else:
		hosts_method = "none"
		hosts_reliable = False

	for extra_idx, sid in enumerate(ranked[2:], start=1):
		names[slug[sid]] = "Гость" if extra_idx == 1 else f"Гость {extra_idx}"

	if len(ranked) > 2:
		notes.append(
			f"Гостей в выпуске: {len(ranked) - 2}. Имена им скрипт не придумывает — "
			"впишите сами, поправив карту speakers в файле транскрипта."
		)

	info = {}
	for i, sid in enumerate(ranked):
		is_host = i < 2
		info[slug[sid]] = {
			"role": "host" if is_host else "guest",
			# Чем определили: высотой голоса, объёмом речи или просто порядком.
			"detectedBy": hosts_method if is_host else "order",
			"pitchHz": round(pitches[sid]) if pitches[sid] is not None else None,
			"speechSeconds": round(durations[sid], 1),
			# Ради этого флага всё и затевалось: по нему интерфейс на сайте
			# поймёт, у кого имя ещё нужно вписать или проверить руками.
			"needsName": (not is_host) or not hosts_reliable,
		}

	return slug, names, info, notes


# --- Исправление искажённых названий аниме -------------------------------

def fetch_anime_index():
	req = Request(ANIME_INDEX_URL, headers={"User-Agent": "baki-transcribe/1.0"})
	with urlopen(req, timeout=30) as resp:
		return json.loads(resp.read().decode("utf-8"))


def find_anime_corrections(replicas, anime_index, min_ratio=0.72, max_ratio=0.97):
	"""Найти в тексте искажённые названия тайтлов.

	Ничего не исправляет — только складывает предложения, решение за автором
	(так требует ТЗ, шаг 2).

	Сравнение нечёткое и поэтому дорогое: каждое название прикладывается к
	каждому куску каждой реплики. Чтобы это не превратилось в часы на архиве,
	когда в справочнике станет много тайтлов, здесь три ускорения:
	  * названия переводятся в нижний регистр один раз, а не на каждое сравнение;
	  * SequenceMatcher создаётся один на название — он кэширует разбор второй
	    строки, и менять достаточно только первую;
	  * до точного сравнения отсекаем заведомо непохожее по длине и по дешёвой
	    оценке сверху (real_quick_ratio/quick_ratio никогда не занижают ответ,
	    поэтому если уж они меньше порога — точный расчёт тем более не пройдёт).
	Результат при этом ровно тот же, что и у прямого перебора.
	"""
	titles = []
	for entry in anime_index:
		for key in ("titleRu", "titleOriginal"):
			value = entry.get(key)
			if value:
				titles.append(value)

	prepared = []
	for title in titles:
		low = title.lower()
		matcher = SequenceMatcher(None, "", low, autojunk=False)
		# Если длины отличаются сильнее, чем на эту величину, отношение
		# заведомо ниже порога — считать точно уже незачем.
		max_len_gap = len(low) * (1 - min_ratio) / min_ratio + 1
		prepared.append((title, low, len(low.split()), matcher, max_len_gap))

	suggestions = []
	for idx, replica in enumerate(replicas):
		words = re.findall(r"[А-Яа-яЁёA-Za-z0-9\-]+", replica["text"])
		lowered = [w.lower() for w in words]
		for title, low, word_count, matcher, max_len_gap in prepared:
			for i in range(len(words) - word_count + 1):
				window = " ".join(lowered[i : i + word_count])
				if abs(len(window) - len(low)) > max_len_gap:
					continue
				matcher.set_seq1(window)
				if matcher.real_quick_ratio() < min_ratio:
					continue
				if matcher.quick_ratio() < min_ratio:
					continue
				ratio = matcher.ratio()
				if min_ratio <= ratio < max_ratio:
					suggestions.append(
						{
							"replica_index": idx,
							"found": " ".join(words[i : i + word_count]),
							"suggested": title,
							"similarity": round(ratio, 2),
						}
					)
	return suggestions


# --- Основной сценарий -----------------------------------------------------

def format_estimate(est):
	parts = []
	if est.get("usd") is not None:
		parts.append(f"${est['usd']}")
	if est.get("credits") is not None:
		parts.append(f"{est['credits']} кредитов")
	line = ", ".join(parts) if parts else "цена неизвестна"
	if est.get("note"):
		line += f" ({est['note']})"
	return line


def process_episode(episode, provider, api_key, dry_run=False, out_suffix=None):
	est = provider.estimate(episode["duration_sec"])

	print(f"Выпуск: {episode['title']}")
	print(f"Длительность: {episode['duration_sec']//60}:{episode['duration_sec']%60:02d}")
	print(f"Сервис: {provider.label}")
	print(f"Ориентировочная стоимость: {format_estimate(est)}")

	if dry_run:
		return None

	TMP_DIR.mkdir(parents=True, exist_ok=True)
	OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

	mp3_path = TMP_DIR / f"{episode['guid']}.mp3"
	wav_path = TMP_DIR / f"{episode['guid']}.wav"

	try:
		print("Скачиваю аудио...")
		download_audio(episode["audio_url"], mp3_path)

		print(f"Отправляю на распознавание в {provider.label} (может занять несколько минут)...")
		result = provider.transcribe(mp3_path, api_key)

		print("Готовлю копию для измерения высоты голоса...")
		convert_to_wav16k(mp3_path, wav_path)
		wav_samples, sr = load_wav_mono16(wav_path)

		replicas = build_replicas(result["words"])
		# Пустой ответ — это сбой, а не результат. Раньше такой выпуск молча
		# сохранялся с нулём реплик и помечался сделанным: повторный запуск
		# его пропускал, и пропажа обнаруживалась только глазами.
		if not replicas:
			raise RuntimeError(
				"сервис вернул пустой результат — ни одного слова. "
				"Возможно, в файле нет речи или он не скачался целиком."
			)

		slug, speaker_names, speaker_info, notes = assign_speaker_names(replicas, wav_samples, sr)

		print("Ищу известные тайтлы для проверки названий...")
		anime_index = fetch_anime_index()
		corrections = find_anime_corrections(replicas, anime_index)

		# Имя спикера в реплики НЕ вписываем — только номер голоса. Имена лежат
		# отдельной картой speakers, поэтому переименовать гостя (или поменять
		# ведущих местами) можно правкой одной строки, без повторного
		# распознавания. Так требует и модель данных в CLAUDE.md.
		transcript = {
			"source": "recognized",
			"provider": provider.id,
			"episodeGuid": episode["guid"],
			"episodeTitle": episode["title"],
			"speakers": speaker_names,
			"speakerInfo": speaker_info,
			"replicas": [
				{
					"start": round(r["start"], 2),
					"end": round(r["end"], 2),
					"speaker": slug[r["speaker"]],
					"text": r["text"].strip(),
				}
				for r in replicas
			],
		}

		# Длительность по данным сервиса точнее, чем itunes:duration из RSS
		# (тот пишется вручную и иногда врёт) — считаем стоимость по ней.
		actual_sec = result.get("audio_duration_sec") or episode["duration_sec"]
		actual = provider.estimate(actual_sec)

		stem = episode["guid"] if not out_suffix else f"{episode['guid']}.{out_suffix}"
		out_path = OUTPUT_DIR / f"{stem}.json"
		out_path.write_text(json.dumps(transcript, ensure_ascii=False, indent=2))

		corrections_path = OUTPUT_DIR / f"{stem}.corrections.json"
		corrections_path.write_text(json.dumps(corrections, ensure_ascii=False, indent=2))

		state = load_state()
		state[episode["guid"]] = {
			"title": episode["title"],
			"status": "done",
			"provider": provider.id,
			"audioSeconds": round(actual_sec),
			"cost": actual,
			"transcriptFile": str(out_path),
		}
		save_state(state)

		print("\n--- Итог ---")
		print(f"Реплик: {len(transcript['replicas'])}")
		print("Голоса:")
		for sid, name in speaker_names.items():
			meta = speaker_info[sid]
			pitch = f"{meta['pitchHz']} Гц" if meta["pitchHz"] is not None else "высота не измерена"
			mark = "  <- вписать/проверить имя" if meta["needsName"] else ""
			print(
				f"  {sid}: {name} ({meta['role']}, {pitch}, "
				f"говорил {meta['speechSeconds']/60:.1f} мин){mark}"
			)
		for n in notes:
			print(f"  {n}")
		print(f"Фактическая длительность по данным сервиса: {actual_sec/60:.1f} мин")
		print(f"Стоимость: {format_estimate(actual)}")
		print(f"Найдено предложений исправить название: {len(corrections)}")
		print(f"Файл транскрипта: {out_path}")
		print(f"Файл с предложениями по названиям: {corrections_path}")

		return transcript
	finally:
		for p in (mp3_path, wav_path):
			if p.exists():
				p.unlink()


def work_list(episodes):
	"""Выпуски, которые вообще подлежат распознаванию, в порядке из RSS."""
	return [e for e in episodes if not is_excluded(e["title"])]


def split_into_parts(work, parts):
	"""Разбить список на части примерно равные ПО ДЛИТЕЛЬНОСТИ, не по числу.

	Считаем по длительности, потому что деньги берут за часы аудио: так каждая
	часть стоит примерно одинаково, даже если выпуски очень разной длины
	(в архиве есть и 8 минут, и 94).

	Делим всегда весь список работ, а не только необработанное. Поэтому
	«часть 2» — это всегда одни и те же выпуски, сколько бы вы уже ни прогнали.
	Иначе после первого прогона границы частей поехали бы.
	"""
	total = sum(e["duration_sec"] for e in work)
	if total <= 0 or parts <= 1:
		return [list(work)]
	target = total / parts
	chunks = [[] for _ in range(parts)]
	acc = 0.0
	for ep in work:
		idx = min(int(acc / target), parts - 1)
		chunks[idx].append(ep)
		acc += ep["duration_sec"]
	return chunks


def select_part(episodes, part, of):
	work = work_list(episodes)
	if not of:
		return work
	if not 1 <= part <= of:
		raise ValueError(f"--part должен быть от 1 до {of}")
	return split_into_parts(work, of)[part - 1]


def run_archive(episodes, provider, api_key, state, part=None, of=None, assume_yes=False):
	"""Прогнать пачку выпусков подряд, продолжая с места обрыва."""
	selected = select_part(episodes, part, of)
	pending = [e for e in selected if state.get(e["guid"], {}).get("status") != "done"]
	done_already = len(selected) - len(pending)

	where = f"часть {part} из {of}" if of else "весь архив"
	print(f"Сервис: {provider.label}")
	print(f"Задание: {where}")
	print(f"Выпусков в задании: {len(selected)}, уже сделано: {done_already}")

	if not pending:
		print("Всё из этого задания уже обработано, делать нечего.")
		return

	pending_sec = sum(e["duration_sec"] for e in pending)
	print(f"К обработке сейчас: {len(pending)}, суммарно {pending_sec/3600:.1f} ч аудио")
	print(f"Ориентировочная стоимость: {format_estimate(provider.estimate(pending_sec))}")
	print()
	check_disk_space(pending)
	print()

	if not assume_yes:
		if not sys.stdin.isatty():
			print(
				"Запуск не из терминала (например, через nohup), а подтверждения нет.\n"
				"Добавьте --yes, если действительно хотите запустить и потратить деньги.",
				file=sys.stderr,
			)
			sys.exit(1)
		answer = input("Запускаем? Это тратит деньги. [y/N] ").strip().lower()
		if answer not in ("y", "yes", "д", "да"):
			print("Отменено, ничего не потрачено.")
			return

	started = time.time()
	ok, failed = [], []
	for i, episode in enumerate(pending, start=1):
		print()
		print("=" * 70)
		print(f"[{i} из {len(pending)}]  {datetime.now():%H:%M:%S}")
		try:
			process_episode(episode, provider, api_key)
			ok.append(episode)
		except KeyboardInterrupt:
			print("\nОстановлено вручную. Сделанное сохранено, продолжить можно тем же запуском.")
			break
		except Exception as exc:
			# Один сбойный выпуск не должен ронять весь прогон: помечаем его
			# и идём дальше. При следующем запуске он попадёт в очередь снова.
			failed.append((episode, exc))
			print(f"  ОШИБКА на этом выпуске: {exc}")
			traceback.print_exc(file=sys.stdout)
			state = load_state()
			state[episode["guid"]] = {
				"title": episode["title"],
				"status": "failed",
				"provider": provider.id,
				"error": str(exc)[:300],
				"failedAt": datetime.now().isoformat(timespec="seconds"),
			}
			save_state(state)

	spent_sec = sum(e["duration_sec"] for e in ok)
	print()
	print("=" * 70)
	print(f"ИТОГ ЗАДАНИЯ ({where})")
	print(f"Готово: {len(ok)}, с ошибкой: {len(failed)}")
	print(f"Обработано аудио: {spent_sec/3600:.1f} ч")
	print(f"Потрачено ориентировочно: {format_estimate(provider.estimate(spent_sec))}")
	print(f"Заняло времени: {(time.time() - started)/60:.0f} мин")
	if failed:
		print()
		print("Не получилось (попадут в очередь при следующем запуске):")
		for episode, exc in failed:
			print(f"  {episode['title']} — {exc}")


def recheck_names(min_ratio=0.72):
	"""Заново сверить названия аниме по уже сохранённым транскриптам.

	Отдельная команда, потому что сверка и распознавание не связаны:
	распознавание стоит денег и делается один раз, а сверка бесплатная
	и работает по готовым файлам. Значит справочник тайтлов можно пополнять
	сколько угодно и когда угодно, а потом просто перепроверить всё заново —
	не переплачивая за повторное распознавание.
	"""
	files = [
		f for f in sorted(OUTPUT_DIR.glob("*.json"))
		if not f.name.endswith(".corrections.json")
	] if OUTPUT_DIR.exists() else []
	if not files:
		print("В папке результатов нет транскриптов.", file=sys.stderr)
		sys.exit(1)

	print("Беру свежий список тайтлов с сайта...")
	anime_index = fetch_anime_index()
	print(f"Тайтлов в справочнике: {len(anime_index)}")
	print(f"Транскриптов к проверке: {len(files)}")
	print(f"Порог похожести: {min_ratio}")
	print()

	total = 0
	for f in files:
		data = json.loads(f.read_text())
		replicas = data.get("replicas", [])
		suggestions = find_anime_corrections(replicas, anime_index, min_ratio=min_ratio)
		out = f.with_suffix(".corrections.json")
		out.write_text(json.dumps(suggestions, ensure_ascii=False, indent=2))
		total += len(suggestions)
		print(f"  {data.get('episodeTitle', f.stem)[:55]:<55} {len(suggestions):>4} предложений")

	print()
	print(f"Всего предложений: {total}")
	print(
		"Ничего в транскриптах не изменено — это только список на ваше решение.\n"
		"Если предложений слишком много и среди них мусор (падежи, похожие "
		"названия), поднимите порог: --min-similarity 0.85"
	)


def export_transcripts(dest):
	"""Упаковать готовые транскрипты в один архив, чтобы забрать с сервера.

	Результат прогона существует в единственном экземпляре на сервере,
	а за него заплачено — копию надо снимать сразу.
	"""
	files = sorted(OUTPUT_DIR.glob("*.json")) if OUTPUT_DIR.exists() else []
	if not files:
		print("В папке результатов пусто — нечего упаковывать.", file=sys.stderr)
		sys.exit(1)
	dest = Path(dest)
	dest.parent.mkdir(parents=True, exist_ok=True)
	with tarfile.open(dest, "w:gz") as tar:
		for f in files:
			tar.add(f, arcname=f.name)
		if STATE_FILE.exists():
			tar.add(STATE_FILE, arcname=STATE_FILE.name)
	size_mb = dest.stat().st_size / (1024 * 1024)
	print(f"Упаковано файлов: {len(files)} (плюс state.json)")
	print(f"Архив: {dest}  ({size_mb:.1f} МБ)")
	print("Заберите его с сервера, например:")
	print(f"  scp root@СЕРВЕР:{dest} .")


def estimate_archive(episodes, provider, state, of=None):
	"""Смета на весь архив. В сеть не ходит, ничего не отправляет."""
	all_sec = sum(e["duration_sec"] for e in episodes)
	excluded = [e for e in episodes if is_excluded(e["title"])]
	work = work_list(episodes)
	pending = [e for e in work if state.get(e["guid"], {}).get("status") != "done"]

	excluded_sec = sum(e["duration_sec"] for e in excluded)
	total_sec = sum(e["duration_sec"] for e in work)
	pending_sec = sum(e["duration_sec"] for e in pending)

	print(f"Сервис: {provider.label}")
	print(f"Всего выпусков в RSS: {len(episodes)}, суммарно {all_sec/3600:.1f} ч")
	print(
		f"Исключено (готовый сценарий): {len(excluded)}, "
		f"суммарно {excluded_sec/3600:.1f} ч — "
		f"по словам в названии: {', '.join(EXCLUDE_TITLE_PARTS)}"
	)
	print(f"К распознаванию: {len(work)}, суммарно {total_sec/3600:.1f} ч")
	print(f"Уже обработано: {len(work) - len(pending)}")
	print(f"Осталось обработать: {len(pending)}, суммарно {pending_sec/3600:.1f} ч")
	print()
	print(f"Стоимость по прайсу, весь архив: {format_estimate(provider.estimate(total_sec))}")
	print(f"Стоимость по прайсу, остаток:    {format_estimate(provider.estimate(pending_sec))}")

	# У сервиса может быть месячная квота, уже оплаченная подпиской, — тогда
	# «стоимость по прайсу» выше не равна тому, что придётся доплатить.
	if hasattr(provider, "estimate_out_of_pocket"):
		pocket = provider.estimate_out_of_pocket(pending_sec)
		print()
		print("Сколько реально доплачивать (остаток, за один платёжный период):")
		print(f"  внутри месячной квоты: {pocket['included_hours']:.1f} ч — уже оплачено подпиской")
		print(f"  сверх квоты:           {pocket['over_hours']:.1f} ч = {pocket['credits']} кредитов")
		print(f"  ДОПЛАТА:               ${pocket['usd']}")
		if pocket.get("warning"):
			print()
			print(f"  {pocket['warning']}")

	if of:
		print()
		print(f"Разбивка на {of} части (запускать по одной, в любом порядке):")
		for n, chunk in enumerate(split_into_parts(work, of), start=1):
			chunk_sec = sum(e["duration_sec"] for e in chunk)
			left = [e for e in chunk if state.get(e["guid"], {}).get("status") != "done"]
			left_sec = sum(e["duration_sec"] for e in left)
			mark = "готово" if not left else f"осталось {len(left)}"
			print(
				f"  часть {n}: {len(chunk):>3} выпусков, {chunk_sec/3600:.1f} ч, "
				f"{format_estimate(provider.estimate(chunk_sec))} — {mark}"
			)
			if left and left_sec != chunk_sec:
				print(f"            к обработке сейчас {left_sec/3600:.1f} ч")


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--guid", help="guid выпуска из RSS")
	parser.add_argument("--list", action="store_true", help="показать список выпусков и статус")
	parser.add_argument("--dry-run", action="store_true", help="только посчитать стоимость")
	parser.add_argument(
		"--estimate-archive", action="store_true", help="смета на весь архив, без отправки"
	)
	parser.add_argument(
		"--provider",
		default=providers.DEFAULT,
		choices=providers.names(),
		help=f"сервис распознавания (по умолчанию {providers.DEFAULT})",
	)
	parser.add_argument(
		"--out-suffix",
		help="приписка к имени файла результата — чтобы сравнить два сервиса, не затирая",
	)
	parser.add_argument(
		"--force",
		action="store_true",
		help="распознать выпуск, даже если он исключён (есть готовый сценарий)",
	)
	parser.add_argument("--run", action="store_true", help="прогнать пачку выпусков подряд")
	parser.add_argument("--part", type=int, help="какую часть архива прогнать (с --of)")
	parser.add_argument("--of", type=int, help="на сколько частей разбить архив")
	parser.add_argument(
		"--yes", action="store_true", help="не спрашивать подтверждения (нужно для nohup)"
	)
	parser.add_argument("--export", metavar="ФАЙЛ", help="упаковать готовые транскрипты в tar.gz")
	parser.add_argument(
		"--recheck-names",
		action="store_true",
		help="заново сверить названия аниме по готовым транскриптам (бесплатно)",
	)
	parser.add_argument(
		"--min-similarity",
		type=float,
		default=0.72,
		help="порог похожести при сверке названий (0.72 по умолчанию, выше — меньше мусора)",
	)
	args = parser.parse_args()

	if args.part and not args.of:
		parser.error("--part без --of не имеет смысла: укажите, на сколько частей делим")
	if args.run and args.of and not args.part:
		parser.error("укажите --part: какую именно часть прогонять")

	provider = providers.get(args.provider)
	env = load_env(WORK_DIR / ".env")
	api_key = env.get(provider.env_key)

	if args.export:
		export_transcripts(args.export)
		return

	if args.recheck_names:
		recheck_names(min_ratio=args.min_similarity)
		return

	episodes = fetch_feed_items()
	state = load_state()

	if args.list:
		for ep in episodes:
			if is_excluded(ep["title"]):
				status = "исключён"
			else:
				status = state.get(ep["guid"], {}).get("status", "не обработан")
			print(f"{ep['duration_sec']//60:>4}:{ep['duration_sec']%60:02d}  [{status:12}]  {ep['title']}  ({ep['guid']})")
		return

	if args.estimate_archive:
		estimate_archive(episodes, provider, state, of=args.of)
		return

	if args.run:
		if not api_key:
			print(f"Не найден {provider.env_key} в .env", file=sys.stderr)
			sys.exit(1)
		run_archive(
			episodes, provider, api_key, state,
			part=args.part, of=args.of, assume_yes=args.yes,
		)
		return

	if not args.guid:
		print(
			"Укажите, что делать: --list, --estimate-archive, --run или --guid",
			file=sys.stderr,
		)
		sys.exit(1)

	episode = next((e for e in episodes if e["guid"] == args.guid), None)
	if not episode:
		print(f"Выпуск с guid {args.guid} не найден в RSS", file=sys.stderr)
		sys.exit(1)

	if is_excluded(episode["title"]) and not args.force:
		print(
			f"Выпуск «{episode['title']}» исключён из распознавания: у него есть\n"
			f"готовый сценарий (сработало по слову из списка: {', '.join(EXCLUDE_TITLE_PARTS)}).\n"
			"Если всё-таки нужно распознать именно его — добавьте --force.",
			file=sys.stderr,
		)
		sys.exit(1)

	# Повторно за уже сделанное не платим. Но если явно просят другой сервис
	# или другое имя файла — это осознанное сравнение, пропускать не надо.
	already = state.get(episode["guid"], {})
	repeat_on_purpose = args.out_suffix or (
		already.get("provider") and already["provider"] != provider.id
	)
	if already.get("status") == "done" and not args.dry_run and not repeat_on_purpose:
		print("Этот выпуск уже обработан, пропускаю (см. state.json).")
		return

	if not api_key and not args.dry_run:
		print(f"Не найден {provider.env_key} в .env", file=sys.stderr)
		sys.exit(1)

	process_episode(
		episode, provider, api_key, dry_run=args.dry_run, out_suffix=args.out_suffix
	)


if __name__ == "__main__":
	main()
