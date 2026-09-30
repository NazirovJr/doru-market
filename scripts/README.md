# scripts/

Автоматизация репозитория, сгруппированная по назначению. Деплой-скрипты лежат в [`infra/deploy/`](../infra/README.md).

| Папка | Что там | Как запускать |
|---|---|---|
| `ci/` | проверки для CI и локально: `env-check.ts` (`.env.example` против Zod-схем), `size-check.ts` (бюджет бандла web), `docs-check.mjs` (ссылки на документы, пути в коде, длина `AGENTS.md`) и их спеки | `pnpm env:check`, `pnpm size-check`, `pnpm docs:check`; спеки — `pnpm test:env-check`, `test:size-check`, `test:docs-check` |
| `data/` | `generate-jwt-keys.cjs` (RS256-ключи для `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`), `generate-medicines-seed.cjs` (генератор сида каталога) | `node scripts/data/<файл>` |
| `local-model/` | обвязка исполнителя на локальной модели: `qwen-task.ps1`, `qwen-gate.ps1`, `qwen-loop.ps1`, `qwen-gate-daemon.ps1`, шаблон и задания в `tasks/`, профили `dsh/` | PowerShell, см. [гайд](../docs/process/local-models/qwen3-prompting-guide.md) |
| `coordinator/` | инструменты координатора волн: замок тяжёлых команд `heavy-run.ps1`, интеграционный прогон `itest.ps1` и сравнение `cmp.js`, `smoke-api.ps1`, `e2e-stack.ps1`, `union-merge.py` | [`docs/process/wave-protocol.md`](../docs/process/wave-protocol.md) |

Скрипты не хардкодят личные пути и секреты: корень репозитория берётся от расположения файла, остальное — параметры и
переменные окружения.
