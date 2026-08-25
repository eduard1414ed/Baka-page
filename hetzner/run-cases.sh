#!/bin/bash
# ПАДЕЖНЫЕ ФОРМЫ ТАЙТЛОВ (задача 21). Перенос .github/workflows/anime-cases.yml.
#
# Расписания у робота нет и не было: его зовут кнопкой. Два режима, как
# у воркфлоу:
#   run-cases.sh          — посчитать и прислать отчёт, НИЧЕГО НЕ ПИСАТЬ
#   run-cases.sh write    — применить посчитанное
#
# ПОЧЕМУ РАЗВЕДКА ОТДЕЛЬНО ОТ ЗАПИСИ: формы включаются на весь архив разом,
# и число упоминаний на страницах тайтлов подскакивает одним прыжком. Увидеть
# этот прыжок надо ДО него — так решено в ТЗ, и перенос этого не меняет.

set -u
set -o pipefail
MODE="${1:-dry}"
REPO=/root/baka-site
LOG_DIR=/root/baka-logs
NOTIFY=/root/baka-robot/notify.sh
mkdir -p /root/baka-state "$LOG_DIR"

exec 9>/root/baka-state/repo.lock
if ! flock -w 1800 9; then
	"$NOTIFY" "⏳ <b>Падежные формы</b>%0AРепозиторий занят другим роботом дольше получаса — заход пропущен."
	exit 0
fi

LOG="$LOG_DIR/cases-$(date -u '+%Y%m%d-%H%M%S').log"
exec > >(tee -a "$LOG") 2>&1
STAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
echo "=== ПАДЕЖНЫЕ ФОРМЫ ($MODE): $STAMP ==="

cd "$REPO" || exit 1
ERRORS=""
fail() { ERRORS="${ERRORS}${1}\n"; echo "!!! $1"; }

git pull --ff-only || fail "git pull не прошёл"

# Заслон: проверка склонения идёт ПЕРЕД работой. Упала — не считаем ничего,
# иначе кривые формы разъедутся по всему архиву разом.
echo "--- проверяю правила склонения"
if ! node scripts/anime-cases.test.mjs; then
	"$NOTIFY" "$(printf '🔴 <b>Падежные формы: заслон не пропустил</b>\n%s\n\nПроверка правил склонения не прошла — НИЧЕГО не посчитано и не записано.\nЖурнал: %s' "$STAMP" "$LOG")"
	echo "=== заслон не пропустил ==="
	exit 1
fi

if [ "$MODE" = "write" ]; then
	echo "--- считаю и ПРИМЕНЯЮ"
	node scripts/anime-cases.mjs --write || fail "пересчёт форм не отработал"
	git config user.name "baka-anime-bot"
	git config user.email "actions@users.noreply.github.com"
	git add src/content/anime 2>/dev/null
	if git diff --cached --quiet; then
		RESULT="Формы пересчитаны, но ничего не изменилось."
	else
		COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
		git commit -m "Пересчитать падежные формы тайтлов" || fail "коммит не прошёл"
		git pull --rebase --quiet origin main || fail "pull --rebase не прошёл"
		git push --quiet && RESULT="Обновлено карточек тайтлов: ${COUNT}." || fail "ПУШ НЕ ПРОШЁЛ"
	fi
else
	echo "--- считаю БЕЗ ЗАПИСИ (разведка)"
	node scripts/anime-cases.mjs || fail "пересчёт форм не отработал"
	RESULT="Это разведка: ничего не записано. Применить — кнопкой «Применить посчитанное»."
fi

REPORT=""
[ -s отчёт-падежи.txt ] && REPORT="$(head -c 600 отчёт-падежи.txt)"

if [ -n "$ERRORS" ]; then
	"$NOTIFY" "$(printf '🔴 <b>Падежные формы: не доделано</b>\n%s\n\n%b\nЖурнал: %s' "$STAMP" "$ERRORS" "$LOG")"
	echo "=== ИТОГ: С ОШИБКАМИ ==="; exit 1
fi
"$NOTIFY" "$(printf '🟢 <b>Падежные формы (%s)</b>\n%s\n\n%s\n\n%s' "$MODE" "$STAMP" "${RESULT:-}" "$REPORT")"
echo "=== ИТОГ: ГОТОВО ==="
find "$LOG_DIR" -name 'cases-*.log' -mtime +30 -delete 2>/dev/null
exit 0
