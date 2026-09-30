# @dorutj/testing-kit

Детерминированные тест-дублёры и данные для тестов: `FixedClockAdapter`, `SequentialTestIdGenerator`,
`FixedOtpGeneratorAdapter`, `createBuilder` (фабрики фикстур) и контракт сида E2E (`seed-contract.ts`: `SEED_USERS`,
`SEED_PHARMACIES`, `SEED_CHAINS`, `SEED_TENANTS`, `SEED_ANALOG_CLUSTER`). Публичный API — `src/index.ts`.

Подключается как `devDependency` тестов; в продуктовый код не импортируется. Реального времени и случайности в тестах нет —
только эти дублёры.

```bash
pnpm --filter @dorutj/testing-kit test
pnpm --filter @dorutj/testing-kit build
```
