#!/bin/bash
# ЗАБОР НОВЫХ ПОСТОВ КАНАЛА (задача 21).
#
# Перенос .github/workflows/telegram-fetch.yml. Логика не менялась: зовётся
# тот же scripts/telegram-fetch.mjs с теми же ключами. Расписание прежнее —
# 4 раза в сутки (02, 08, 14, 20 UTC).
#
# ОЧЕРЕДЬ ТЕЛЕГРАМА ВЫДАЁТСЯ РОВНО ОДИН РАЗ, и потому у бота должна быть одна
# программа-читатель. Здесь свой бот (@bakaparcerbot), у уведомлений — другой
# (@baka_hetzner_bot). Читай их один бот — посты начали бы молча пропадать.
#
# Очередь скрипт НЕ подтверждает в тот же заход: подтверждение идёт следующим
# разом и только до разобранного. Свались робот посреди работы — телеграм
# отдаст те же посты снова.

set -u
set -o pipefail

REPO=/root/baka-site
LOG_DIR=/root/baka-logs
NOTIFY=/root/baka-robot/notify.sh
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

LOG="$LOG_DIR/telegram-$(date -u '+%Y%m%d-%H%M%S').log"
exec > >(tee -a "$LOG") 2>&1
STAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
echo "=== ЗАБОР ПОСТОВ КАНАЛА: $STAMP ==="

cd "$REPO" || { "$NOTIFY" "🔴 <b>Забор постов</b>%0AНет папки $REPO"; exit 1; }

ERRORS=""
fail() { ERRORS="${ERRORS}${1}\n"; echo "!!! $1"; }

git pull --ff-only || fail "git pull не прошёл — работаю по тому, что есть"

if node scripts/telegram-fetch.mjs --write --notify=notify-tg.md; then
	echo "забор отработал"
else
	fail "забор постов не отработал (телеграм мог не ответить — следующий заход через 6 часов доберёт)"
fi

git config user.name "baka-telegram-bot"
git config user.email "actions@users.noreply.github.com"

# Пути — те же, что перечислял старый воркфлоу.
git add src/content/posts public/images/uploads src/data/telegramFeed.mjs 2>/dev/null
NEWS=""
if git diff --cached --quiet; then
	echo "новых постов в канале нет"
else
	COUNT=$(git diff --cached --name-only -- src/content/posts | wc -l | tr -d ' ')
	git commit -m "Забрать новые посты из телеграма" || fail "коммит не прошёл"
	git pull --rebase --quiet origin main || fail "pull --rebase перед пушем не прошёл"
	if git push --quiet; then
		echo "запушено, новых файлов постов: $COUNT"
		NEWS="📥 забрано новых постов: ${COUNT}"
	else
		fail "ПУШ НЕ ПРОШЁЛ — посты забраны, но на GitHub не уехали"
	fi
fi

DETAILS=""
[ -s notify-tg.md ] && DETAILS="$(head -c 600 notify-tg.md)"

if [ -n "$ERRORS" ]; then
	"$NOTIFY" "$(printf '🔴 <b>Забор постов не доделан</b>\n%s\n\n%b\nЖурнал: %s' "$STAMP" "$ERRORS" "$LOG")"
	echo "=== ИТОГ: С ОШИБКАМИ ==="
	exit 1
elif [ -n "$NEWS" ]; then
	"$NOTIFY" "$(printf '🟢 <b>Новые посты из канала</b>\n%s\n\n%s\n\nОни лежат в черновиках — публикуете вы.\n%s' "$STAMP" "$NEWS" "$DETAILS")"
	echo "=== ИТОГ: ЕСТЬ НОВОЕ ==="
else
	echo "=== ИТОГ: новостей нет ==="
fi

find "$LOG_DIR" -name 'telegram-*.log' -mtime +30 -delete 2>/dev/null
exit 0
