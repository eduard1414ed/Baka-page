#!/bin/bash
# РОБОТЫ, КОТОРЫЕ РАНЬШЕ ЗАПУСКАЛИСЬ «НА ПУШ» В ПОСТЫ (задача 21).
#
# На GitHub их будило событие push с фильтром paths: src/content/posts/**.
# На сервере такого события нет, поэтому мы СПРАШИВАЕМ САМИ раз в 5 минут:
# не появилось ли новых коммитов, тронувших посты.
#
# Кого будим (порядок как на GitHub, но последовательно — они пишут в один
# репозиторий и параллельно подрались бы за пуш):
#   1. scripts/sync-anime.mjs        добор тайтлов по меткам в постах
#   2. scripts/anime-candidates.mjs  кандидаты в тайтлы из черновиков
#   3. scripts/telegram-photos.mjs   картинки помеченных постов
#
# ЗАЩИТА ОТ ПЕТЛИ. Роботы сами коммитят в посты, и их же коммит разбудил бы
# их снова — бесконечно. Поэтому коммиты, автор которых наши боты, за новость
# не считаются. Спасает не только это: каждый робот идемпотентен и на своей
# работе второй раз ничего не делает, — но крутиться вхолостую каждые пять
# минут всё равно ни к чему.
#
# ОТМЕТКА «ДОКУДА ДОШЛИ» ДВИГАЕТСЯ ПОСЛЕДНИМ ДЕЙСТВИЕМ, после удачной работы.
# Сдвинь её раньше — сбой посреди работы означал бы, что коммит считается
# разобранным, а он не разобран, и никто об этом уже не узнает.

set -u
REPO=/root/baka-site
STATE_DIR=/root/baka-state
STATE="$STATE_DIR/last-posts-commit"
LOG_DIR=/root/baka-logs
NOTIFY=/root/baka-robot/notify.sh
BOTS='baka-anime-bot|baka-tg-photos-bot|baka-episodes-bot'
mkdir -p "$STATE_DIR" "$LOG_DIR"

cd "$REPO" || exit 1

git fetch --quiet origin main 2>/dev/null || exit 0
NEW=$(git rev-parse origin/main)
LAST=$(cat "$STATE" 2>/dev/null || echo "")

# Первый запуск: отметки нет. Ничего не разбираем — только запоминаем точку,
# иначе робот полез бы перебирать всю историю репозитория.
if [ -z "$LAST" ]; then
	echo "$NEW" > "$STATE"
	echo "первый запуск: запомнил точку $NEW, работы нет"
	exit 0
fi

[ "$NEW" = "$LAST" ] && exit 0

# Тронуты ли посты вообще
CHANGED=$(git diff --name-only "$LAST".."$NEW" -- src/content/posts 2>/dev/null | head -1)
if [ -z "$CHANGED" ]; then
	echo "$NEW" > "$STATE"
	echo "новые коммиты есть, но постов не трогали"
	exit 0
fi

# Есть ли среди новых коммитов хоть один НЕ от наших ботов
HUMAN=$(git log --format='%an' "$LAST".."$NEW" 2>/dev/null | grep -vE "^($BOTS)$" | head -1)
if [ -z "$HUMAN" ]; then
	echo "$NEW" > "$STATE"
	echo "посты менялись, но только нашими же роботами — будить некого"
	exit 0
fi

LOG="$LOG_DIR/posts-$(date -u '+%Y%m%d-%H%M%S').log"
exec > >(tee -a "$LOG") 2>&1
STAMP=$(date -u '+%Y-%m-%d %H:%M UTC')
echo "=== РОБОТЫ ПОСТОВ: $STAMP ==="
echo "разбираю $LAST..$NEW (автор новостей: $HUMAN)"

ERRORS=""
NEWS=""
fail() { ERRORS="${ERRORS}${1}\n"; echo "!!! $1"; }

git pull --ff-only --quiet || { fail "git pull не прошёл"; }

git config user.name "baka-anime-bot"
git config user.email "actions@users.noreply.github.com"

commit_and_push() {  # $1 сообщение, $2… пути
	local msg="$1"; shift
	# Пути — ТЕ ЖЕ, что перечисляли старые воркфлоу, и без -A: коммит обязан
	# содержать ровно то, что заявляет заголовком, а не всё, что подвернулось
	# рядом в папке.
	git add "$@" 2>/dev/null
	if git diff --cached --quiet; then return 1; fi
	git commit -m "$msg" || { fail "коммит «$msg» не прошёл"; return 1; }
	git pull --rebase --quiet origin main || fail "pull --rebase перед пушем не прошёл"
	if git push --quiet; then echo "запушено: $msg"; return 0; fi
	fail "ПУШ НЕ ПРОШЁЛ: $msg"
	return 1
}

# --- 1. добор тайтлов -----------------------------------------------------
echo "--- добор тайтлов из постов"
if node scripts/sync-anime.mjs; then
	commit_and_push "Добрать тайтлы из новых постов" src/content/anime public/anime \
		&& NEWS="${NEWS}🎬 добраны новые тайтлы\n"
else
	fail "добор тайтлов не отработал"
fi

# --- 2. кандидаты в тайтлы ------------------------------------------------
# Не роняет прогон: это подсказка для человека, а не обязательная работа.
echo "--- кандидаты в тайтлы из черновиков"
if node scripts/anime-candidates.mjs --write --only-drafts --max-ask 60; then
	commit_and_push "Кандидаты в тайтлы: разобраны новые фразы из черновиков" src/data/animeCandidates.json \
		&& NEWS="${NEWS}📝 обновлён список кандидатов\n"
else
	fail "разбор кандидатов не отработал"
fi

# --- 3. картинки телеграма ------------------------------------------------
# ВАЖНО: на сервере экспорт лежит МЕСТНО (/srv/telegram-export), поэтому
# --export=, а не --remote=. Ключа tgexport и похода по SSH больше нет вовсе:
# робот и хранилище теперь на одной машине.
EXPORT_DIR=$(ls -d /srv/telegram-export/ChatExport_* 2>/dev/null | sort | tail -1)
echo "--- картинки помеченных постов (экспорт: ${EXPORT_DIR:-НЕ НАЙДЕН})"
if [ -n "$EXPORT_DIR" ]; then
	if node scripts/telegram-photos.mjs --export="$EXPORT_DIR" --write; then
		commit_and_push "Забрать картинки постов из телеграма" src/content/posts public/images/uploads \
			&& NEWS="${NEWS}🖼 привезены картинки постов\n"
	else
		fail "забор картинок не отработал"
	fi
else
	fail "папка экспорта телеграма не найдена в /srv/telegram-export"
fi

# --- итог -----------------------------------------------------------------
# Отметка двигается ТОЛЬКО если не было ошибок: иначе эти коммиты разберутся
# заново на следующем заходе.
if [ -n "$ERRORS" ]; then
	"$NOTIFY" "$(printf '🔴 <b>Роботы постов не доделали работу</b>\n%s\n\n%b\nЖурнал: %s' "$STAMP" "$ERRORS" "$LOG")"
	echo "=== ИТОГ: С ОШИБКАМИ, отметку не двигаю ==="
	exit 1
fi

echo "$NEW" > "$STATE"
if [ -n "$NEWS" ]; then
	"$NOTIFY" "$(printf '🟢 <b>Роботы постов: есть новое</b>\n%s\n\n%b' "$STAMP" "$NEWS")"
	echo "=== ИТОГ: ЕСТЬ НОВОЕ ==="
else
	echo "=== ИТОГ: роботы отработали, нового не нашли ==="
fi

find "$LOG_DIR" -name 'posts-*.log' -mtime +30 -delete 2>/dev/null
exit 0
