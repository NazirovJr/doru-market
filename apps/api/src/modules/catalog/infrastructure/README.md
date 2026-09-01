# `modules/catalog/infrastructure`

Слой **infrastructure** модуля `catalog` (EP-04, DTJ-090).

Содержит:
- Drizzle-схемы таблиц: `categories`, `substances`, `medicines`, `medicine_substances`
  (DTJ-091; сами файлы — в `apps/api/src/db/schema/` для переиспользования `drizzle-kit`,
  этот слой владеет адаптерами).
- Адаптеры портов: `CatalogRepositoryAdapter`, `AnalogOfferLookupAdapter`,
  `AnalogCandidatesAdapter`, `FuzzyMedicineMatcherAdapter` (DTJ-092, 097, 100, 101).
- Mappers: `medicine.mapper.ts`, `category.mapper.ts`, `substance.mapper.ts` (DTJ-092).
- `catalog.module.ts` (NestJS): DI-регистрация `{ provide: TOKEN, useClass: ... }`.

**Правило зависимостей (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1):**
- Реализует порты, объявленные в `../application/ports/*`.
- Может импортировать `domain/` (для типов и маппинга) и `application/` (для DI).
- Схема БД (`apps/api/src/db/schema/*`) живёт тут, в инфраструктуре; НЕ утекает в `domain/`
  или `application/` (проверяется `dependency-cruiser` правилом
  `no-db-schema-in-business-layers`).
- Может читать `pharmacy_inventory`/`pharmacies`/`pharmacy_chains` напрямую SQL только
  внутри `analog-offer-lookup.adapter.ts` (DTJ-101, требует ADR — TODO). Все остальные
  адаптеры — ТОЛЬКО на `medicines`/`substances`/`categories`/`medicine_substances`.
