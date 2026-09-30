# tests/

Сквозные наборы, которые не принадлежат одному приложению. Каждый — пакет pnpm (кроме `arch` и `fixtures`) и входит в
`turbo run test`, если не указано иное. Unit-тесты лежат рядом с кодом (`*.spec.ts`), интеграционные тесты `apps/api` —
в `apps/api/test/integration` ([гайд](../docs/guides/integration-tests.md)).

| Набор | Что охраняет | Запуск |
|---|---|---|
| [`arch/`](arch/README.md) | границы слоёв и подключённость: фикстуры-нарушения обязаны падать (`run-fixture-check`), `runtime-connectivity` (всё написанное подключено), `suppression-justification` (подавления с обоснованием), `di-explicit-inject`, полнота шаблонов уведомлений | `pnpm test:arch` (входит в `pnpm verify`) |
| `invariants/` | сквозные инварианты домена по всей таблице сразу; первый — D-25: `paid_escrow` ⟹ есть записи `escrow_ledger` | `pnpm test:invariants`; нужны Postgres и Redis |
| `security/` | security-набор против реально поднятого API: SQLi, IDOR между тенантами, брутфорс OTP, rate-limit, утечки PII в логах | `pnpm test:security`; нужны Postgres и Redis |
| `e2e/` | Playwright-сценарии CUJ (`specs/*.pw.spec.ts`), помощники OTP/Telegram/axe | `pnpm test:e2e`; сценарии без заданных `E2E_*_URL` пропускаются с причиной |
| `fixtures/` | общие данные для E2E (файлы и JSON, не код); см. [README](fixtures/README.md) | — |

Правила: тест, не запустившийся из-за отсутствующей конфигурации, считается **непройденным** ([`AGENTS.md`](../AGENTS.md), правило 13);
падающий тест не скипают и не удаляют — чинят код (правило 3). `invariants` и `security` делят общую `dorutj_test`, поэтому идут
строго по одному файлу; при грязной БД `security` даёт известный красный (см. гайд).
