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

# Месячная квота аккаунта в кредитах. ВЗЯТО ИЗ ЛИЧНОГО КАБИНЕТА (Subscription →
# Credits used), а не со страницы цен: там для Creator указано 100 000 кредитов
# (это и есть те «62,85 часа Scribe v2»), а на этом аккаунте выдаётся 212 857.
# Не подгонять под страницу цен — сверяться с кабинетом.
MONTHLY_QUOTA_CREDITS = 212857

# ВАЖНО: квота общая на весь ElevenLabs, а не только на распознавание речи.
# Озвучка и прочие эксперименты едят те же кредиты, и скрипт про них не знает.
# Поэтому «сколько уже потрачено» надо брать из кабинета (--credits-used),
# иначе смета посчитает свободным то, что уже израсходовано на другое.


def estimate(duration_sec):
	hours = duration_sec / 3600
	return {
		"usd": round(hours * USD_PER_HOUR, 3),
		"credits": int(hours * CREDITS_PER_HOUR) + 1,
		"note": f"по цене плана Creator, ${USD_PER_HOUR}/час",
	}


def estimate_out_of_pocket(duration_sec, already_used_sec=0, used_credits=None):
	"""Сколько придётся доплатить сверх подписки, которая и так оплачена.

	`used_credits` — сколько кредитов уже съедено в этом платёжном периоде,
	по данным кабинета. Это самое честное число: оно учитывает и распознавание,
	и озвучку, и всё остальное. Если его не передали, считаем по `already_used_sec`
	(сколько аудио распознано по нашим записям) — но тогда чужие траты не видны
	и смета будет оптимистичнее реальности.
	"""
	need_credits = int(duration_sec / 3600 * CREDITS_PER_HOUR) + 1
	if used_credits is None:
		used_credits = int(already_used_sec / 3600 * CREDITS_PER_HOUR)
		source = "по нашим записям, без учёта озвучки и прочих трат"
	else:
		source = "по кабинету, с учётом всех трат"

	quota_left = max(0, MONTHLY_QUOTA_CREDITS - used_credits)
	over_credits = max(0, need_credits - quota_left)
	return {
		"need_credits": need_credits,
		"used_credits": used_credits,
		"quota_credits": MONTHLY_QUOTA_CREDITS,
		"quota_left_credits": quota_left,
		"source": source,
		"over_credits": over_credits,
		"over_hours": over_credits / CREDITS_PER_HOUR,
		"usd": round(over_credits / CREDITS_PER_HOUR * USD_PER_HOUR, 2),
		"warning": (
			"Квота общая на весь ElevenLabs — озвучка ест те же кредиты, "
			"и скрипт про них не знает. Точную цифру брать в кабинете "
			"(Subscription → Credits used) и передавать через --credits-used. "
			"Ставку за превышение ElevenLabs публично не раскрывает, так что при "
			"выходе за квоту реальный счёт может быть до полутора раз выше."
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
