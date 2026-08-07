# Транскрипты — резервная копия с сервера

Сюда складываются готовые расшифровки, снятые с Hetzner после каждой части
архива (`pipeline.py --export`). Это **вторая копия**: оригиналы живут на
сервере в `/root/baki-transcripts/output/`, а за них заплачено — держать
их в единственном экземпляре нельзя.

Намеренно **не** в `src/content/transcripts/`, хотя по `CLAUDE.md` жить им
в итоге там: этой полки ещё нет в `src/content.config.ts`, и появление
файлов может сломать сборку сайта. Переедут туда на шаге 5, вместе со схемой.
Astro эту папку не видит и в сборку не тянет.

## Что внутри

- `<guid>.json` — сам транскрипт: карта имён `speakers`, сведения о голосах
  `speakerInfo`, массив реплик с таймкодами.
- `<guid>.corrections.json` — предложения исправить названия аниме.
  Есть не у всех: при прогоне архива сверка названий не запускается,
  её дают отдельно (`--recheck-names`).
- `state.json` — что уже обработано, каким сервисом и почём.

## Как обновлять

```
ssh -i ~/.ssh/hetzner_baki root@167.233.251.252
cd /root/baki-transcripts && python3 pipeline.py --export /root/transcripts.tar.gz
```
затем со своего компьютера:
```
scp -i ~/.ssh/hetzner_baki root@167.233.251.252:/root/transcripts.tar.gz /tmp/
tar -xzf /tmp/transcripts.tar.gz -C transcripts/
```
