# `modules/catalog/domain`

Слой **domain** модуля `catalog` (EP-04, DTJ-090).

Содержит:
- Value Objects (импортируются из `@dorutj/domain-kernel` — пакет создан в DTJ-090).
- Сущности: `Medicine`, `MedicineSubstance` (DTJ-093).
- Доменные сервисы: `CategoryTreeService` (DTJ-094), `AnalogEquivalenceService` (DTJ-099).
- Доменные события: `MedicinePublishedEvent`, `NewControlCategoryCandidateEvent` (DTJ-093).
- Доменные ошибки: `MissingSubstancesError`, `InvalidMedicineStateError`,
  `ControlCategoryChangeRequiresModerationError` (DTJ-093).

**Правило зависимостей (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1):**
- НОЛЬ импортов фреймворков (`@nestjs/*`, `drizzle-orm`, `pg`, `ioredis`, `bullmq`, `fastify`,
  `zod`, `pino`, `axios`, `node:fs`, `node:http`).
- НОЛЬ импортов `application/`, `infrastructure/`, `presentation/`.
- Нет `Date.now()` / `Math.random()` / `process.env` — время и случайность через порты
  (см. §2.6).
- Контракт: `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.

Соседние слои:
- `../application/` — use cases (оркестрация, порты наружу).
- `../infrastructure/` — Drizzle-адаптеры, mappers.
- `../presentation/` — NestJS-контроллеры, DTO.
