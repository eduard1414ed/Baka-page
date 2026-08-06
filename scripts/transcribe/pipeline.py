#!/usr/bin/env python3
"""Транскрипция выпусков подкаста через ElevenLabs Scribe. Работает на Hetzner
(см. тз/05-транскрипты.md) — качает по одному выпуску из RSS, отправляет на
распознавание, сразу удаляет аудио, определяет ведущих по высоте голоса,
предлагает исправления искажённых названий аниме (не применяет их сама).

Использование:
  python3 pipeline.py --list                 показать выпуски и статус обработки
  python3 pipeline.py --guid <guid>           обработать один выпуск
  python3 pipeline.py --guid <guid> --dry-run посчитать стоимость, ничего не отправлять
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

FEED_URL = "https://cloud.mave.digital/33503"
ANIME_INDEX_URL = "https://baka-page.eduard1414ed.workers.dev/anime-index.json"
STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
CREDITS_PER_MINUTE = 330

WORK_DIR = Path(__file__).resolve().parent
STATE_FILE = WORK_DIR / "state.json"
OUTPUT_DIR = WORK_DIR / "output"
TMP_DIR = WORK_DIR / "tmp"

# Основной способ — по высоте голоса (Шаг 4 в тз/05-транскрипты.md).
HOST_MALE = "Эд"
HOST_FEMALE = "Ксюша"


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


def call_elevenlabs_stt(audio_path, api_key):
	with open(audio_path, "rb") as f:
		files = {"file": (audio_path.name, f, "audio/mpeg")}
		data = {
			"model_id": "scribe_v2",
			"diarize": "true",
			"timestamps_granularity": "word",
			"language_code": "ru",
		}
		response = requests.post(
			STT_URL,
			headers={"xi-api-key": api_key},
			files=files,
			data=data,
			timeout=1800,
		)
	if response.status_code != 200:
		raise RuntimeError(f"ElevenLabs ответил {response.status_code}: {response.text[:500]}")
	return response.json()


# --- Сборка реплик из слов ---------------------------------------------

def build_replicas(words):
	replicas = []
	current = None
	for word in words:
		if word.get("type") != "word":
			continue
		speaker = word.get("speaker_id", "speaker_0")
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
	by_speaker = {}
	for r in replicas:
		by_speaker.setdefault(r["speaker"], []).append(r)

	durations = {
		sid: sum(r["end"] - r["start"] for r in segs) for sid, segs in by_speaker.items()
	}
	ranked = sorted(durations, key=lambda sid: durations[sid], reverse=True)

	speaker_map = {}
	notes = []

	main_two = ranked[:2]
	pitches = {}
	for sid in main_two:
		pitches[sid] = speaker_pitch(wav_samples, sr, by_speaker[sid])

	if len(main_two) == 2 and all(pitches[sid] is not None for sid in main_two):
		lower = min(main_two, key=lambda sid: pitches[sid])
		higher = max(main_two, key=lambda sid: pitches[sid])
		speaker_map[lower] = HOST_MALE
		speaker_map[higher] = HOST_FEMALE
		notes.append(
			f"Определено по высоте голоса: {lower} -> {HOST_MALE} "
			f"({pitches[lower]:.0f} Гц), {higher} -> {HOST_FEMALE} ({pitches[higher]:.0f} Гц)"
		)
	elif len(main_two) == 2:
		# Запасной способ — по объёму речи, если измерение высоты не удалось.
		by_volume = sorted(main_two, key=lambda sid: durations[sid], reverse=True)
		speaker_map[by_volume[0]] = f"{HOST_MALE}?"
		speaker_map[by_volume[1]] = f"{HOST_FEMALE}?"
		notes.append(
			"Не удалось надёжно измерить высоту голоса — имена расставлены "
			"по объёму речи, ЭТО НУЖНО ПРОВЕРИТЬ РУКАМИ (отмечено знаком ?)."
		)
	elif len(main_two) == 1:
		sid = main_two[0]
		speaker_map[sid] = f"{HOST_MALE}/{HOST_FEMALE}?"
		notes.append("В выпуске обнаружен только один голос — определить пару не удалось.")

	for extra_idx, sid in enumerate(ranked[2:], start=1):
		name = "Гость" if extra_idx == 1 else f"Гость {extra_idx}"
		speaker_map[sid] = name
		notes.append(f"{sid} -> {name} (третий и далее голос, имя нужно вписать вручную)")

	return speaker_map, notes, durations, pitches


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

def process_episode(episode, api_key, dry_run=False):
	minutes = episode["duration_sec"] / 60
	estimated_credits = int(minutes * CREDITS_PER_MINUTE) + 1

	print(f"Выпуск: {episode['title']}")
	print(f"Длительность: {episode['duration_sec']//60}:{episode['duration_sec']%60:02d}")
	print(f"Ориентировочно кредитов: {estimated_credits}")

	if dry_run:
		return None

	TMP_DIR.mkdir(parents=True, exist_ok=True)
	OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

	mp3_path = TMP_DIR / f"{episode['guid']}.mp3"
	wav_path = TMP_DIR / f"{episode['guid']}.wav"

	try:
		print("Скачиваю аудио...")
		download_audio(episode["audio_url"], mp3_path)

		print("Отправляю на распознавание в ElevenLabs (может занять несколько минут)...")
		result = call_elevenlabs_stt(mp3_path, api_key)

		print("Готовлю копию для измерения высоты голоса...")
		convert_to_wav16k(mp3_path, wav_path)
		wav_samples, sr = load_wav_mono16(wav_path)

		replicas = build_replicas(result.get("words", []))
		speaker_map, notes, durations, pitches = assign_speaker_names(replicas, wav_samples, sr)

		print("Ищу известные тайтлы для проверки названий...")
		anime_index = fetch_anime_index()
		corrections = find_anime_corrections(replicas, anime_index)

		transcript = {
			"source": "recognized",
			"episodeGuid": episode["guid"],
			"episodeTitle": episode["title"],
			"speakers": speaker_map,
			"replicas": [
				{
					"start": round(r["start"], 2),
					"end": round(r["end"], 2),
					"speaker": speaker_map.get(r["speaker"], r["speaker"]),
					"text": r["text"].strip(),
				}
				for r in replicas
			],
		}

		out_path = OUTPUT_DIR / f"{episode['guid']}.json"
		out_path.write_text(json.dumps(transcript, ensure_ascii=False, indent=2))

		corrections_path = OUTPUT_DIR / f"{episode['guid']}.corrections.json"
		corrections_path.write_text(json.dumps(corrections, ensure_ascii=False, indent=2))

		actual_minutes = result.get("audio_duration_secs", episode["duration_sec"]) / 60
		actual_credits = int(actual_minutes * CREDITS_PER_MINUTE) + 1

		state = load_state()
		state[episode["guid"]] = {
			"title": episode["title"],
			"status": "done",
			"creditsUsed": actual_credits,
			"transcriptFile": str(out_path),
		}
		save_state(state)

		print("\n--- Итог ---")
		print(f"Реплик: {len(transcript['replicas'])}")
		print(f"Спикеры: {speaker_map}")
		for n in notes:
			print(f"  {n}")
		print(f"Потрачено кредитов: {actual_credits}")
		print(f"Найдено предложений исправить название: {len(corrections)}")
		print(f"Файл транскрипта: {out_path}")
		print(f"Файл с предложениями по названиям: {corrections_path}")

		return transcript
	finally:
		for p in (mp3_path, wav_path):
			if p.exists():
				p.unlink()


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--guid", help="guid выпуска из RSS")
	parser.add_argument("--list", action="store_true", help="показать список выпусков и статус")
	parser.add_argument("--dry-run", action="store_true", help="только посчитать кредиты")
	args = parser.parse_args()

	env = load_env(WORK_DIR / ".env")
	api_key = env.get("ELEVENLABS_API_KEY")

	episodes = fetch_feed_items()
	state = load_state()

	if args.list:
		for ep in episodes:
			status = state.get(ep["guid"], {}).get("status", "не обработан")
			print(f"{ep['duration_sec']//60:>4}:{ep['duration_sec']%60:02d}  [{status:12}]  {ep['title']}  ({ep['guid']})")
		return

	if not args.guid:
		print("Укажите --guid или --list", file=sys.stderr)
		sys.exit(1)

	episode = next((e for e in episodes if e["guid"] == args.guid), None)
	if not episode:
		print(f"Выпуск с guid {args.guid} не найден в RSS", file=sys.stderr)
		sys.exit(1)

	if episode["guid"] in state and state[episode["guid"]]["status"] == "done" and not args.dry_run:
		print("Этот выпуск уже обработан, пропускаю (см. state.json).")
		return

	if not api_key and not args.dry_run:
		print("Не найден ELEVENLABS_API_KEY в .env", file=sys.stderr)
		sys.exit(1)

	process_episode(episode, api_key, dry_run=args.dry_run)


if __name__ == "__main__":
	main()
