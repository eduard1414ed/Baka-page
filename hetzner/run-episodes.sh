#!/bin/bash
# РОБОТ ВЫПУСКОВ НА HETZNER (задача 21).
#
# Перенос .github/workflows/sync-episodes.yml на сервер: GitHub Actions
# выключены пометкой «спам» (задача 20). ЛОГИКА НЕ ПЕРЕПИСАНА — зовутся ровно
# те же скрипты, в том же порядке, с теми же ключами. Изменился только тот,
# кто их запускает.
#
# Шаги, как в воркфлоу:
#   1. добор выпусков из RSS      (scripts/sync-episodes.mjs)
#   2. персонажи с обложек        (scripts/cover-cutout.mjs --new --write)
#   3. коммит и пуш этих двух
#   4. расшифровка речи           (scripts/transcribe/auto.py)   ← ПЛАТНО
#   5. коммит и пуш расшифровок
#   6. сообщение в телеграм
#
# ПОЧЕМУ ШАГ 4 НЕ ПЛАТИТ ДВАЖДЫ: auto.py решает, что делать, по наличию
# файла src/content/transcripts/<guid>.json В РЕПОЗИТОРИИ, а не по журналу
# на машине. Клон видит все уже оплаченные расшифровки, потому и пропускает их.
# Это тот самый способ, который переживает смену машины (урок про «за это уже
# платили?» в CLAUDE.md).

# ИМЕНА ПЕРЕМЕННЫХ ТОЛЬКО ЛАТИНСКИЕ. Русское имя bash не считает именем: строка
# ERRORS="" вида «ИТОГ_ОШИБКИ=""» выполняется как команда и падает, а «$ИТОГ_ОШИБКИ»
# в проверке разбирается как ЛИТЕРАЛ и никогда не пуст — робот рапортовал бы
# о поломке при каждом успешном заходе. Поймано на первом же прогоне 25.08.2026.

set -u
REPO=/root/baka-site
LOG_DIR=/root/baka-logs
NOTIFY=/root/baka-robot/notify.sh
STAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
mkdir -p /root/baka-state "$LOG_DIR"

# ─── ЗАМОК НА РЕПОЗИТОРИЙ ──────────────────────────────────────────────────
# Все роботы работают в ОДНОЙ папке /root/baka-site и лезут в git. Столкнутся
# два — и git отвечает «Cannot fast-forward to multiple branches», работа
# считается сбойной, а заказчик получает красное письмо о живом роботе.
# Поймано 25.08.2026: опросчик постов (ходит каждые 5 минут) влез ровно
# в ту секунду, когда забирались посты из телеграма.
#
# Ждём до получаса: лучше постоять в очереди, чем разойтись с чужим коммитом.
# Не дождались — молча уходим, следующий заход сделает ту же работу.
exec 9>/root/baka-state/repo.lock
if ! flock -w 1800 9; then
	echo "репозиторий занят другим роботом дольше получаса — пропускаю заход"
	exit 0
fi

LOG="$LOG_DIR/episodes-$(date -u '+%Y%m%d-%H%M%S').log"

# Всё, что печатают шаги, уходит и на экран, и в файл: разбирать сбой
# по пересказу невозможно.
exec > >(tee -a "$LOG") 2>&1

echo "=== РОБОТ ВЫПУСКОВ: $STAMP ==="

ERRORS=""
NEWS=""
fail() { ERRORS="${ERRORS}${1}\n"; echo "!!! $1"; }

cd "$REPO" || { "$NOTIFY" "🔴 <b>Робот выпусков</b>%0AНет папки $REPO — робот не начал работу."; exit 1; }

# --- свежая копия ----------------------------------------------------------
# Заказчик правит посты в админке; без pull робот работал бы по вчерашнему
# и мог бы завести черновик выпуска, который уже заведён руками.
echo "--- забираю свежие правки"
if ! git pull --ff-only 2>&1; then
	fail "git pull не прошёл — работаю по тому, что есть"
	git rebase --abort 2>/dev/null || true
fi

# --- 1. добор выпусков из RSS ---------------------------------------------
echo "--- добор выпусков из RSS"
if node scripts/sync-episodes.mjs; then
	echo "шаг 1 ок"
else
	fail "добор выпусков из RSS не отработал (RSS мог не ответить — следующий заход всё вернёт)"
fi

# --- 2. персонажи с обложек -----------------------------------------------
# continue-on-error в воркфлоу: за расшифровку следующего шага плачены деньги,
# и падение картинок не имеет права её отменить.
echo "--- персонажи с новых обложек"
if node scripts/cover-cutout.mjs --new --write --notify=notify-covers.md; then
	echo "шаг 2 ок"
else
	fail "вырезание персонажей не отработало (выпуск получит обычную обложку)"
fi

# --- 3. коммит и пуш ------------------------------------------------------
git config user.name "baka-episodes-bot"
git config user.email "actions@users.noreply.github.com"

git add src/content/posts public/episodes src/data/episodeCovers.mjs 2>/dev/null
git add -A public/cutout src/data/coverCutouts.mjs src/data/coverCutoutLog.mjs 2>/dev/null

if git diff --cached --quiet; then
	echo "новых выпусков и обложек нет"
else
	if git diff --cached --name-only | grep -q '^src/content/posts/'; then
		MSG="Добавить черновики новых выпусков из RSS"
		NEWS="${NEWS}📄 заведены черновики новых выпусков\n"
	else
		MSG="Вырезать персонажей с новых обложек"
		NEWS="${NEWS}🖼 вырезаны персонажи с новых обложек\n"
	fi
	git commit -m "$MSG" || fail "коммит не прошёл"
	git pull --rebase origin main || fail "pull --rebase перед пушем не прошёл"
	if git push; then echo "запушено: $MSG"; else fail "ПУШ НЕ ПРОШЁЛ — работа сделана, но на GitHub не уехала"; fi
fi

# --- 4. расшифровка -------------------------------------------------------
# ПЛАТНЫЙ ШАГ. Ключ приходит переменной окружения из systemd (EnvironmentFile),
# в командной строке не появляется.
echo "--- расшифровка новых выпусков"
if python3 scripts/transcribe/auto.py --limit 2 --notify-file notify.md; then
	echo "шаг 4 ок"
else
	fail "расшифровка не доделана (уже готовое не пропало — за него заплачено, и коммитится оно ниже)"
fi

# --- 5. коммит и пуш расшифровок -----------------------------------------
# Всегда, даже после сбоя выше: за готовое заплачено, второй раз платить нельзя.
git add -A src/content/transcripts transcripts 2>/dev/null
if git diff --cached --quiet; then
	echo "расшифровок не прибавилось"
else
	git commit -m "Расшифровать новые выпуски" || fail "коммит расшифровок не прошёл"
	git pull --rebase origin main || fail "pull --rebase перед пушем расшифровок не прошёл"
	if git push; then
		echo "запушены расшифровки"
		NEWS="${NEWS}🎙 добавлены расшифровки\n"
	else
		fail "ПУШ РАСШИФРОВОК НЕ ПРОШЁЛ — они лежат на сервере, но не на GitHub"
	fi
fi

# --- 6. сказать в телеграм ------------------------------------------------
DETAILS=""
[ -s notify.md ] && DETAILS="$(head -c 700 notify.md)"
[ -z "$DETAILS" ] && [ -s notify-covers.md ] && DETAILS="$(head -c 700 notify-covers.md)"

if [ -n "$ERRORS" ]; then
	"$NOTIFY" "$(printf '🔴 <b>Робот выпусков не доделал работу</b>\n%s\n\n<b>Что не вышло:</b>\n%b\n<b>Что делать:</b> можно ничего — робот ходит каждое утро и доделает. Журнал: %s' "$STAMP" "$ERRORS" "$LOG")"
	echo "=== ИТОГ: С ОШИБКАМИ ==="
	exit 1
elif [ -n "$NEWS" ]; then
	"$NOTIFY" "$(printf '🟢 <b>Робот выпусков: есть новое</b>\n%s\n\n%b\n%s' "$STAMP" "$NEWS" "$DETAILS")"
	echo "=== ИТОГ: ЕСТЬ НОВОЕ ==="
else
	"$NOTIFY" "$(printf '⚪️ <b>Робот выпусков: сходил, новостей нет</b>\n%s\n\nВсе выпуски из RSS уже есть постами.' "$STAMP")"
	echo "=== ИТОГ: НОВОСТЕЙ НЕТ ==="
fi

# Журналы старше 30 дней не нужны: место на сервере считаное.
find "$LOG_DIR" -name 'episodes-*.log' -mtime +30 -delete 2>/dev/null
exit 0
