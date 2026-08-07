# Рабочие файлы прогона расшифровок

Здесь остались только служебные файлы. **Сами расшифровки переехали
в `src/content/transcripts/`** — со схемой в `src/content.config.ts`,
сайт их читает и показывает на странице выпуска (тз/05, шаг 5).

## Что внутри

- `<guid>.corrections.json` — предложения исправить названия аниме.
  Есть не у всех: при прогоне архива сверка названий не запускается,
  её дают отдельно (`--recheck-names`). Сайт эти файлы не читает.
- `state.json` — что уже обработано, каким сервисом и почём.

Формат у обоих не такой, как у расшифровки, поэтому в
`src/content/transcripts/` их класть нельзя — сборка упадёт на схеме.

## Как обновлять после нового прогона

На сервере:
```
ssh -i ~/.ssh/hetzner_baki root@167.233.251.252
cd /root/baki-transcripts && python3 pipeline.py --export /root/transcripts.tar.gz
```
На своём компьютере — распаковать во временную папку и разложить по двум
местам: расшифровки к остальным, служебное сюда.
```
scp -i ~/.ssh/hetzner_baki root@167.233.251.252:/root/transcripts.tar.gz /tmp/
mkdir -p /tmp/tr && tar -xzf /tmp/transcripts.tar.gz -C /tmp/tr

# служебное — сюда
mv /tmp/tr/state.json /tmp/tr/*.corrections.json transcripts/
# расшифровки — в контент сайта
mv /tmp/tr/*.json src/content/transcripts/
```

Оригиналы живут на сервере в `/root/baki-transcripts/output/`, но держать их
в единственном экземпляре нельзя — за них заплачено. Вторая копия — git.
