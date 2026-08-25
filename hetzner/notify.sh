#!/bin/bash
# Отправка сообщения в телеграм. Зовётся из run-episodes.sh.
#
# Токен и номер чата лежат в /root/baka-secrets/telegram.env — ВНЕ репозитория,
# права 600. Сюда они попадают переменными окружения, в командную строку
# не выносятся: она видна всем в списке процессов.
#
# Молчит и возвращает 0, если телеграм недоступен: уведомление не имеет права
# уронить работу, ради которой робот и запускался.

set -u
SECRETS=/root/baka-secrets/telegram.env
[ -r "$SECRETS" ] || { echo "notify: нет $SECRETS"; exit 0; }
set -a; . "$SECRETS"; set +a
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || { echo "notify: токен или чат не заданы"; exit 0; }

TEXT="$1"
curl -s --max-time 20 \
  -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d chat_id="${TELEGRAM_CHAT_ID}" \
  -d parse_mode="HTML" \
  -d disable_web_page_preview="true" \
  --data-urlencode text="$TEXT" \
  -o /tmp/notify-result.json -w '%{http_code}' > /tmp/notify-code 2>/dev/null

CODE=$(cat /tmp/notify-code 2>/dev/null || echo "нет")
if [ "$CODE" = "200" ]; then echo "notify: отправлено"; else echo "notify: телеграм ответил $CODE"; fi
exit 0
