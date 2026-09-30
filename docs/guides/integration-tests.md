# Интеграционные тесты apps/api

Интеграционные спеки лежат в `apps/api/test/integration/**` (`*.spec.ts`), гоняются реальными Postgres и Redis и **не входят**
в `pnpm test` / `turbo run test`. Зелёный `turbo run test` без этого прогона ничего не доказывает про БД, очереди и HTTP-контур.
Конфигурация — [`apps/api/vitest.integration.config.ts`](../../apps/api/vitest.integration.config.ts): файлы идут строго по
одному (`fileParallelism: false`, `pool: forks`) — они делят таблицы без изоляции схемы; таймаут теста 30 с; алиас `@test/*`
указывает на общую тестовую обвязку `apps/api/test`.

## Что нужно

- **Postgres** dev-кластера (compose-сервис `postgres`, порт 5432). Тестовая БД `dorutj_test` и роль `test` создаются скриптом
  [`infra/docker/postgres-init/01-test-database.sql`](../../infra/docker/postgres-init/01-test-database.sql) — автоматически
  только на пустом volume; на существующем — `psql -f` тем же файлом.
- **Тестовый Redis на порту 6380** (тот же пароль, что у compose-Redis: переменная `REDIS_PASSWORD`, дефолт в
  `infra/docker/docker-compose.yml`). **Порт 6379 не использовать никогда:** на нём может работать Redis другого проекта,
  а интеграционные спеки чистят БД Redis. Дефолт `REDIS_URL` в `vitest.integration.config.ts` смотрит на 6379 — поэтому
  `REDIS_URL` всегда задаётся явно: `redis://:<REDIS_PASSWORD>@localhost:6380/<номер БД>`. Каждый параллельный исполнитель
  берёт свой номер БД Redis; dev-API и тесты не делят одну БД Redis (воркеры BullMQ dev-API крадут задачи у тестов).
- **Роли Postgres.** Миграции — только ролью-мигратором `dorutj_migrator` (у роли `test` нет `CREATEROLE`, а миграция
  `0031_app_role_privileges` создаёт `app_role`). Приложение в тестах ходит ролью `test`, которой выдан `app_role`
  (`GRANT app_role TO test`) — так проверяются те же права, что в проде.

Пароли не хардкодятся в отчётах и коммитах: значения — из `.env.example` и `docker-compose.yml`, в логах не печатаются.

## Запуск

Из `apps/api`, с переменными окружения `DATABASE_URL` (по умолчанию `postgres://test:test@localhost:5432/dorutj_test`) и
`REDIS_URL` (см. выше):

```bash
# один файл или несколько
npx vitest run --config vitest.integration.config.ts test/integration/orders/<файл>.spec.ts
# весь набор
pnpm --filter @dorutj/api test:integration
```

Тяжёлые прогоны идут через замок ([wave-protocol.md §4](../process/wave-protocol.md)): `scripts/coordinator/heavy-run.ps1`.

## Своя БД для тикета с миграцией

Drizzle применяет миграцию, только если её `when` в `apps/api/migrations/meta/_journal.json` больше максимума уже применённых.
В общей `dorutj_test` параллельные исполнители сбивают этот порядок, и чужая миграция молча пропускается. Поэтому тикет с
миграцией работает на своей базе:

1. Создать БД ролью-мигратором: `CREATE DATABASE dorutj_test_<тикет> OWNER test` (через `psql` в контейнере Postgres).
2. Мигрировать **дважды** (проверка идемпотентности), из `apps/api`, с `DATABASE_URL` на `dorutj_migrator` и эту БД:
   `npx tsx src/infrastructure/database/migrate.ts` (это же `pnpm --filter @dorutj/api db:migrate`).
3. `GRANT app_role TO test` в этой БД.
4. Спеки и полную проверку гонять с `DATABASE_URL=postgres://test:test@localhost:5432/dorutj_test_<тикет>`.

Номер миграции и `when` назначает координатор. Общую `dorutj_test` не мигрируют вручную — её пересоздаёт `itest.ps1`.

## Известные классы падений окружения

Набор частично красный **до** любой ветки; перед разбором падения сверься с этим списком.

| Класс | Симптом | Что делать |
|---|---|---|
| Права `TRUNCATE` | `permission denied for table …` при `TRUNCATE … CASCADE` из спеков под ролью `test` | известный красный, свой спек не должен на него опираться |
| Неидемпотентные фикстуры auth-харнесса | спека чистит `users`, а FK из чужих `orders` не даёт удалить (`delete users` при оставшихся заказах) | на свежей БД зелёный; грязная общая БД даёт красный |
| Общая БД копит мусор | `checkout-race-conditions` с жёстко заданным tenant id; `@dorutj/security/otp-bruteforce` на общей `dorutj_test` | свежая БД или своя БД тикета |
| Зависимость от порядка | `catalog/analogs` красный в наборе, зелёный отдельно | прогнать файл отдельно; не чинить чужой |
| Redis dev-окружения | воркеры чужого API крадут задачи BullMQ | своя БД Redis, не БД dev-API |

Свои спеки обязаны быть зелёными. Упавший чужой спек не чинят — в отчёт идут его имя и текст ошибки.

## Сравнение прогонов: itest + cmp

Число падений мало что говорит, поэтому полный набор сравнивают с эталоном **по именам тестов**:

- [`scripts/coordinator/itest.ps1`](../../scripts/coordinator/itest.ps1) `-Tag <тег>` — пересоздаёт `dorutj_test`, мигрирует
  ролью-мигратором, выдаёт `app_role` роли `test`, чистит **только БД 0** тестового Redis (`FLUSHDB`, не `FLUSHALL`), гоняет
  весь набор и пишет отчёт `itest-<тег>.json` в каталог эталонов (`-BaselineDir` / `ITEST_BASELINE_DIR`).
- [`scripts/coordinator/cmp.js`](../../scripts/coordinator/cmp.js) `<тег> <эталон>…` — печатает падения, которых нет ни в одном
  эталоне. Упавший в `beforeAll` файл учитывается отдельно (`<file failed>`): vitest помечает все его тесты пропущенными.

Новое падение — регресс, пока не доказано иное; порядок разбора — [wave-protocol.md §7](../process/wave-protocol.md).
