#!/bin/bash
# ПРИМЕНИТЬ РЕШЕНИЯ ПО КАНДИДАТАМ (задача 21).
# Перенос .github/workflows/anime-candidates-apply.yml. Зовётся кнопкой.
#
# Порядок как в воркфлоу: две проверки-заслона, потом применение решений,
# потом пересборка списка кандидатов.

set -u
set -o pipefail
REPO=/root/baka-site
LOG_DIR=/root/baka-logs
NOTIFY=/root/baka-robot/notify.sh
mkdir -p /root/baka-state "$LOG_DIR"

exec 9>/root/baka-state/repo.lock
if ! flock -w 1800 9; then
	"$NOTIFY" "⏳ <b>Решения по кандидатам</b>%0AРепозиторий занят дольше получаса — заход пропущен."
	exit 0
fi

LOG="$LOG_DIR/apply-$(date -u '+%Y%m%d-%H%M%S').log"
exec > >(tee -a "$LOG") 2>&1
STAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
echo "=== ПРИМЕНЕНИЕ РЕШЕНИЙ: $STAMP ==="

cd "$REPO" || exit 1
ERRORS=""
fail() { ERRORS="${ERRORS}${1}\n"; echo "!!! $1"; }

git pull --ff-only || fail "git pull не прошёл"

# ДВА ЗАСЛОНА ПЕРЕД ЗАПИСЬЮ. Провалились — не применяем НИЧЕГО: кривое
# решение завело бы тайтл, которого не существует, и вычищать пришлось бы руками.
echo "--- проверяю правила отбора и применения"
if ! node scripts/anime-candidates.test.mjs || ! node scripts/candidates-screen.test.mjs; then
	"$NOTIFY" "$(printf '🔴 <b>Решения по кандидатам: заслон не пропустил</b>\n%s\n\nПроверки не прошли — НЕ ПРИМЕНЕНО НИЧЕГО.\nЖурнал: %s' "$STAMP" "$LOG")"
	echo "=== заслон не пропустил ==="
	exit 1
fi

echo "--- применяю решения"
APPLIED=0
if node scripts/anime-candidates-apply.mjs; then APPLIED=1; else fail "применение решений не отработало"; fi

echo "--- пересобираю список кандидатов"
node scripts/anime-candidates.mjs --write --no-ask || fail "пересборка списка не отработала"

git config user.name "baka-anime-bot"
git config user.email "actions@users.noreply.github.com"
git add src/content/anime public/anime src/data/animeCandidates.json 2>/dev/null
RESULT=""
if git diff --cached --quiet; then
	RESULT="Применять было нечего — решений не найдено."
else
	COUNT=$(git diff --cached --name-only -- src/content/anime | wc -l | tr -d ' ')
	git commit -m "Применить решения по кандидатам в тайтлы" || fail "коммит не прошёл"
	git pull --rebase --quiet origin main || fail "pull --rebase не прошёл"
	# ПОСЛЕДНЕЕ СЛОВО ПРИНАДЛЕЖИТ ЗАПИСИ: отчёт о применённом врёт, если пуш
	# не прошёл. Об этом отдельный урок в CLAUDE.md.
	if git push --quiet; then RESULT="Заведено карточек тайтлов: ${COUNT}."
	else fail "ПУШ НЕ ПРОШЁЛ — решения применены на сервере, но на GitHub не уехали"; fi
fi

if [ -n "$ERRORS" ]; then
	"$NOTIFY" "$(printf '🔴 <b>Решения по кандидатам: не доделано</b>\n%s\n\n%b\nЖурнал: %s' "$STAMP" "$ERRORS" "$LOG")"
	echo "=== ИТОГ: С ОШИБКАМИ ==="; exit 1
fi
"$NOTIFY" "$(printf '🟢 <b>Решения по кандидатам применены</b>\n%s\n\n%s' "$STAMP" "$RESULT")"
echo "=== ИТОГ: ГОТОВО ==="
find "$LOG_DIR" -name 'apply-*.log' -mtime +30 -delete 2>/dev/null
exit 0
