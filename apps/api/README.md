# apps/api

Единственный входной HTTP-процесс продукта: NestJS 11 на Fastify. Модули по контекстам в `src/modules/`: admin, analytics, auth,
catalog, delivery, inventory, notifications, onboarding, orders, payments, returns, support, tenancy. Слои внутри модуля:
`domain → application → infrastructure/presentation` (правила — [`AGENTS.md`](AGENTS.md)).

## Запуск

```bash
cp .env.example .env               # dev-значения; схема — src/config/env.schema.ts
pnpm --filter @dorutj/api dev      # nest start --watch, порт 3000
curl -i http://localhost:3000/health
```

| Команда | Что делает |
|---|---|
| `pnpm --filter @dorutj/api test` | unit-тесты |
| `pnpm --filter @dorutj/api test:integration` | интеграционные тесты, нужны Postgres и Redis — [гайд](../../docs/guides/integration-tests.md) |
| `pnpm --filter @dorutj/api db:migrate` | миграции (`migrations/`), ролью-мигратором |
| `pnpm --filter @dorutj/api db:seed` | сид каталога |
| `pnpm --filter @dorutj/api openapi:generate` / `openapi:check` | генерация и проверка OpenAPI |

Требования — [`docs/spec/`](../../docs/spec/00-SRS-MASTER.md); решения — [`docs/architecture/decisions/`](../../docs/architecture/decisions/README.md).
