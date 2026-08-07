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
  python3 pipeline.py --guid <guid>           обработать один выпуск
  python3 pipeline.py --guid <guid> --dry-run посчитать стоимость, ничего не отправлять
  python3 pipeline.py --estimate-archive      смета на весь архив, ничего не отправлять
  python3 pipeline.py --guid <guid> --provider soniox --out-suffix soniox
                                              прогнать другим сервисом, не затирая
                                              уже готовый транскрипт
"""

import argparse
import json
import re
import subprocess
import sys
import wave
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
EXCLUDE_TITLE_PARTS = ["эссе", "врата аниме"]

# Граница между мужским и женским голосом, Гц. Мужской обычно 85–180,
# женский 165–255 — диапазоны почти не пересекаются, что и делает способ
# надёжным при двух разнополых ведущих (см. Шаг 4 в ТЗ).
# Нужна не для того, чтобы определять пол, а чтобы поймать случай, когда
# в «ведущие» по объёму речи пролез гость: если оба главных голоса оказались
# по одну сторону границы, пара подозрительная.
VOICE_SPLIT_HZ = 165


def is_excluded(title):
	low = title.lower()
	return any(part in low for part in EXCLUDE_TITLE_PARTS)


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


def download_audio(url, dest):
	with requests.get(url, stream=True, timeout=120) as response:
		response.raise_for_status()
		with open(dest, "wb") as f:
			for chunk in response.iter_content(chunk_size=1 << 20):
				f.write(chunk)


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
	titles = []
	for entry in anime_index:
		for key in ("titleRu", "titleOriginal"):
			value = entry.get(key)
			if value:
				titles.append(value)

	suggestions = []
	for idx, replica in enumerate(replicas):
		words = re.findall(r"[А-Яа-яЁёA-Za-z0-9\-]+", replica["text"])
		for title in titles:
			title_word_count = len(title.split())
			for i in range(len(words) - title_word_count + 1):
				window = " ".join(words[i : i + title_word_count])
				ratio = SequenceMatcher(None, window.lower(), title.lower()).ratio()
				if min_ratio <= ratio < max_ratio:
					suggestions.append(
						{
							"replica_index": idx,
							"found": window,
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


def estimate_archive(episodes, provider, state):
	"""Смета на весь архив. В сеть не ходит, ничего не отправляет."""
	all_sec = sum(e["duration_sec"] for e in episodes)
	excluded = [e for e in episodes if is_excluded(e["title"])]
	work = [e for e in episodes if not is_excluded(e["title"])]
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
	args = parser.parse_args()

	provider = providers.get(args.provider)
	env = load_env(WORK_DIR / ".env")
	api_key = env.get(provider.env_key)

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
		estimate_archive(episodes, provider, state)
		return

	if not args.guid:
		print("Укажите --guid, --list или --estimate-archive", file=sys.stderr)
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
