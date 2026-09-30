# infra/

Всё, что собирает, запускает и выкатывает продукт; кода приложений здесь нет.

## docker/

| Файл | Назначение |
|---|---|
| `docker-compose.yml` | dev-стек: `postgres`, `redis`, `minio`, `migrate`, `seed`, `api`, `worker`, `web`, `admin`, `nginx`, `certbot` |
| `docker-compose.prod.yml` | prod-оверрайд поверх базового файла |
| `docker-compose.test.yml` | эфемерный оверлей для integration/e2e: данные в tmpfs, эфемерные порты |
| `Dockerfile.api`, `Dockerfile.web` | образы (контекст сборки — корень репозитория) |
| `nginx/` | конфигурация nginx и SPA-fallback |
| `postgres-init/` | `01-test-database.sql` создаёт роль `test` и БД `dorutj_test`; применяется только на пустом volume |
| `secrets/` | `db_password.txt` — пароль Postgres для compose (лежит в репозитории; вне разработки подставляй свой секрет) |

```bash
pnpm docker:up      # docker compose -f infra/docker/docker-compose.yml up -d
pnpm docker:down
docker compose -f infra/docker/docker-compose.yml -f infra/docker/docker-compose.test.yml up -d   # тестовый оверлей
```

Compose-файлы — barrel ([`AGENTS.md`](../AGENTS.md), правило 8): правятся только добавлением строк. Контейнеры создаются из основной
копии репозитория, не из worktree агента (bind-mount путей worktree ломается после его удаления).

## deploy/

`rolling-deploy.sh <IMAGE_TAG>` — миграции, затем `api` и `worker` без простоя; `rollback.sh` — откат;
`backup-restore-drill.sh` — учебное восстановление из бэкапа; `lib/common.sh` — общие функции. Порядок первого релиза —
[`docs/runbooks/production-readiness.md`](../docs/runbooks/production-readiness.md).
