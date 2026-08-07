"""Адаптер ElevenLabs Scribe. Форма модуля описана в providers/__init__.py."""

import requests

id = "elevenlabs"
label = "ElevenLabs Scribe (scribe_v2)"
env_key = "ELEVENLABS_API_KEY"

STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
MODEL_ID = "scribe_v2"

# Расход кредитов — измерен на живом выпуске 6 августа 2026: за аудио 24:29
# кабинет ElevenLabs показал ровно 650 кредитов и $0.143.
# Сходится с официальной таблицей цен (elevenlabs.io/pricing/api): план Creator
# включает 62,85 часа Scribe v2 при месячной квоте 100 000 кредитов,
# то есть 100000 / 62.85 = 1591 кредит на час. Два независимых способа
# дали одно число, поэтому цифре можно верить.
#
# Раньше здесь стояло 330 кредитов В МИНУТУ (то есть 19 800 в час) — цифра
# была взята из ниоткуда и завышала смету на архив в 12 раз, из-за чего
# весь этап чуть не переехал на другой сервис. Не менять эти константы
# «по памяти» — только по реальному списанию в кабинете.
CREDITS_PER_HOUR = 1591

# Цена часа на плане Creator. У остальных планов $0.22 — Creator единственный
# выбивается (elevenlabs.io/pricing/api, колонка Creator, проверено 7 августа 2026).
USD_PER_HOUR = 0.35

# Сколько часов Scribe v2 включено в подписку Creator за месяц (та же таблица).
# Всё, что сверх, идёт в usage based billing и выставляется в конце периода.
MONTHLY_INCLUDED_HOURS = 62.85


def estimate(duration_sec):
	hours = duration_sec / 3600
	return {
		"usd": round(hours * USD_PER_HOUR, 3),
		"credits": int(hours * CREDITS_PER_HOUR) + 1,
		"note": f"по цене плана Creator, ${USD_PER_HOUR}/час",
	}


def estimate_out_of_pocket(duration_sec):
	"""Сколько придётся доплатить сверх подписки, которая и так оплачена.

	Считает по ставке подписочных кредитов ($0.35/час). Точную ставку
	usage based billing за превышение ElevenLabs публично не раскрывает
	(статья справки закрыта), поэтому реальная доплата может оказаться
	до полутора раз выше — при сумме порядка десяти долларов это не критично,
	но обещать точную цифру нельзя.
	"""
	hours = duration_sec / 3600
	over_hours = max(0.0, hours - MONTHLY_INCLUDED_HOURS)
	return {
		"included_hours": min(hours, MONTHLY_INCLUDED_HOURS),
		"over_hours": over_hours,
		"usd": round(over_hours * USD_PER_HOUR, 2),
		"credits": int(over_hours * CREDITS_PER_HOUR) + 1 if over_hours else 0,
		"warning": (
			"Ставку за превышение квоты ElevenLabs публично не раскрывает — "
			"реальный счёт может оказаться до полутора раз выше."
		),
	}


def transcribe(audio_path, api_key, language="ru"):
	with open(audio_path, "rb") as f:
		files = {"file": (audio_path.name, f, "audio/mpeg")}
		data = {
			"model_id": MODEL_ID,
			"diarize": "true",
			"timestamps_granularity": "word",
			"language_code": language,
		}
		response = requests.post(
			STT_URL,
			headers={"xi-api-key": api_key},
			files=files,
			data=data,
			# Час: самый длинный выпуск в архиве — 94 минуты, а прошлый лимит
			# в 30 минут на таком мог не дожить до ответа.
			timeout=3600,
		)
	if response.status_code != 200:
		raise RuntimeError(f"ElevenLabs ответил {response.status_code}: {response.text[:500]}")
	payload = response.json()

	# Приводим ответ к общему виду: только слова, только нужные поля.
	# Служебные элементы (паузы, звуковые события) в реплики не идут.
	words = []
	for word in payload.get("words", []):
		if word.get("type") != "word":
			continue
		words.append(
			{
				"start": word["start"],
				"end": word["end"],
				"text": word["text"],
				"speaker": word.get("speaker_id", "speaker_0"),
			}
		)

	return {
		"words": words,
		"audio_duration_sec": payload.get("audio_duration_secs"),
		"raw": payload,
	}
