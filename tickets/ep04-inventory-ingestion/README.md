# EP-05 — Приём остатков по трём каналам R1 (composite-матчинг, очередь, отчёты об ошибках)

> Диапазон ID: **DTJ-140 .. DTJ-170** (использовано 31 из 40 зарезервированных, DTJ-171..179 —
> резерв на укрупнение/дробление внутри диапазона, не выходить за границы).
> Каталог тикетов: `tickets/ep04-inventory-ingestion/`.
> Источники (по убыванию приоритета): `docs/04-SCOPE-DECISION-PIVOT.md` (R1-5/R1-4/R1-9) →
> `docs/03-ARCHITECT-DECISIONS.md` (D-04, D-05, D-06, D-08, D-11, D-12) →
> `docs/02-CLEAN-ARCHITECTURE-AND-CODE.md` → `docs/01-TECH-BASELINE.md` →
> `docs/spec/22-module-inventory-sync-1c.md` (SRS-INV-001..062) + `docs/spec/10-domain-model.md`
> (SRS-DOM-018..024, 145..152, 168..170) + `docs/spec/11-database-schema.md` (SRS-DB-*) +
> `docs/spec/12-api-conventions-auth-tenancy.md` (SRS-API-033/034, permission-матрица §4).

## Что покрывает эпик

Три равноправных канала приёма остатков (D-12), сходящихся в один use case
`IngestInventoryBatchUseCase`: REST push с HMAC-ключом (1С/сторонние ERP), импорт Excel/CSV, ручной
ввод в кабинете аптеки (`apps/pharmacy`, scaffolding которого — часть этого эпика). Плюс:
composite-матчинг товара (D-06), очередь BullMQ с идемпотентностью/версионностью/DLQ, ночная полная
синхронизация, отчёты об ошибках для аптеки, порт CommerceML (R1: интерфейс+мок, реальный XML-
парсер — R2, не в этом диапазоне), нагрузочный тест на целевые 500 item-events/сек (D-05).

**Явно вне зоны EP-05** (упоминается в module 22, но принадлежит другим эпикам): создание/курация
записей `catalog_match_queue` (владение `moderation`), CRUD-эндпоинты `pharmacy_api_keys`
(`POST/GET/PATCH .../api-keys`, владение `onboarding`/`admin`, SRS-ADM-043..046), реальный
CommerceML 2.05 XML-парсер (R2), обязательный mTLS для конкретных сетей (операционная задача, не
код R1).

## Порядок выполнения (волны внутри эпика, топологический по `depends_on`)

```
Волна А (фундамент, можно параллелить между собой после DTJ-140):
  DTJ-140 (scaffold)
    ├─▶ DTJ-141 (DB core schema) ──▶ DTJ-142 (DB extensions, кросс-модульная координация)
    ├─▶ DTJ-143 (PharmacyInventory entity)
    ├─▶ DTJ-144 (InventorySyncBatch entity + state machine)
    ├─▶ DTJ-145 (VO + errors)
    ├─▶ DTJ-159 (Excel template endpoint) ──▶ DTJ-160 (Excel parser)
    ├─▶ DTJ-165 (CommerceML port + mock, независимая ветка)
    └─▶ DTJ-166 (apps/pharmacy scaffold)

Волна Б (composite-матчинг и очередь, после ядра):
  DTJ-141 + DTJ-145 ──▶ DTJ-146 (matching шаги 1-2) ──▶ DTJ-147 (matching шаги 3-4)
  DTJ-141 + DTJ-144 ──▶ DTJ-153 (BullMQ producer)
  DTJ-142 + DTJ-143 ──▶ DTJ-149 (ResolveCatalogMatchQueueItemUseCase)

Волна В (ядро ингеста — самый крупный тикет эпика):
  DTJ-143+144+145+146+147 ──▶ DTJ-148 (IngestInventoryBatchUseCase)

Волна Г (воркер и завершение full-sync):
  DTJ-148 + DTJ-153 + DTJ-141 ──▶ DTJ-154 (BullMQ worker, advisory lock, COPY) ──▶ DTJ-155 (DLQ handler)
  DTJ-144 + DTJ-148 ──▶ DTJ-151 (zero-out missing lots) ──▶ DTJ-152 (session watchdog)
  DTJ-141 + DTJ-144 ──▶ DTJ-150 (nightly fanout)

Волна Д (presentation — три канала параллельно):
  DTJ-142 ──▶ DTJ-156 (PharmacyApiKeyGuard)
  DTJ-140+144+156+141 ──▶ DTJ-157 (POST batch-update) ──▶ DTJ-158 (GET статус)
  DTJ-157+160 ──▶ DTJ-161 (POST excel-import) ──▶ DTJ-164 (excel error report, после DTJ-163)
  DTJ-140+148 ──▶ DTJ-162 (POST manual-entry)
  DTJ-144+157 ──▶ DTJ-163 (GET sync-batches list+errors)

Волна Е (фронтенд apps/pharmacy, после готовности своих backend-эндпоинтов):
  DTJ-166+162 ──▶ DTJ-167 (экран точечного ввода)
  DTJ-166+161+159+164 ──▶ DTJ-168 (экран массовой сетки + Excel-импорт)
  DTJ-166+163 ──▶ DTJ-169 (экран истории синхронизаций)

Волна Ж (нагрузочный тест — после того, как весь путь REST→очередь→воркер работает):
  DTJ-154+157 ──▶ DTJ-170 (k6)
```

## Список тикетов

| ID | Заголовок | Слой | Оценка | Зависит от |
|---|---|---|---|---|
| DTJ-140 | Scaffolding модуля inventory (4 слоя) + барабанный файл контрактов | infrastructure | L | — |
| DTJ-141 | Drizzle-схема и baseline-миграция основных таблиц inventory | infrastructure | M | 140 |
| DTJ-142 | Миграция расширений схемы (Дополнения §10 модуля 22) | infrastructure | S | 141 |
| DTJ-143 | Domain-сущность PharmacyInventory (FEFO, инварианты) | domain | M | 140 |
| DTJ-144 | Domain-агрегат InventorySyncBatch + state machine | domain | M | 140 |
| DTJ-145 | VO InventoryBatchUpsertRow + каталог ошибок | domain | S | 140 |
| DTJ-146 | CompositeInventoryMatcherService — штрихкод/кэш/точное совпадение | application | M | 141, 145 |
| DTJ-147 | CompositeInventoryMatcherService — fuzzy/неоднозначность/очередь | application | M | 146 |
| DTJ-148 | IngestInventoryBatchUseCase — единая точка входа | application | L | 143, 144, 145, 146, 147 |
| DTJ-149 | ResolveCatalogMatchQueueItemUseCase | application | S | 142, 143 |
| DTJ-150 | RunNightlyFullSyncFanoutUseCase + cron 03:00 | application | M | 141, 144 |
| DTJ-151 | FullSyncCompletionService — обнуление отсутствующих позиций | application | M | 144, 148 |
| DTJ-152 | Watchdog зависших full-sync сессий | application | S | 151 |
| DTJ-153 | BullMQ-продюсер через transactional outbox | infrastructure | S | 141, 144 |
| DTJ-154 | InventorySyncBatchProcessor — воркер, advisory lock, COPY | infrastructure | L | 148, 153, 141 |
| DTJ-155 | Обработчик исчерпания retry — failed_validation | infrastructure | S | 154 |
| DTJ-156 | PharmacyApiKeyGuard — HMAC-аутентификация (D-11) | presentation | M | 142 |
| DTJ-157 | POST /inventory/batch-update — REST-контроллер | presentation | M | 140, 144, 156, 141 |
| DTJ-158 | GET /inventory-sync-batches/:batchId — статус для 1С | presentation | XS | 157 |
| DTJ-159 | GET /inventory-import-template — шаблон Excel/CSV | presentation | S | 140 |
| DTJ-160 | XlsxExcelInventoryParserAdapter | infrastructure | M | 140, 159 |
| DTJ-161 | POST /inventory-excel-import — контроллер загрузки | presentation | M | 157, 160 |
| DTJ-162 | POST /inventory-manual-entry — точечный/массовый ввод | presentation | M | 140, 148 |
| DTJ-163 | GET /inventory-sync-batches + /:id/errors — отчёт кабинета | presentation | S | 144, 157 |
| DTJ-164 | GET .../error-report — скачивание отчёта Excel-ошибок | presentation | S | 160, 163 |
| DTJ-165 | CommerceMlParserPort + MockCommerceMlParserAdapter (R1) | infrastructure | S | 140 |
| DTJ-166 | Scaffolding apps/pharmacy — shell, роутер, авторизация | frontend | L | 140 |
| DTJ-167 | Экран /inventory — точечное редактирование | frontend | M | 166, 162 |
| DTJ-168 | Экран /inventory — массовая сетка + Excel-импорт UI | frontend | L | 166, 161, 159, 164 |
| DTJ-169 | Экран /inventory/sync-history | frontend | M | 166, 163 |
| DTJ-170 | k6-нагрузочный тест (D-05, 500/сек, burst 2000/сек) | tests | M | 154, 157 |

## Кросс-эпиковые зависимости (за пределами диапазона DTJ-140..170)

- **EP-04 (Каталог)** — `CatalogFacade.findMedicineIdsByBarcodes`/`findFuzzyCandidates` (DTJ-146/
  147), `GET /medicines?search=` для автокомплита (DTJ-167). Формально владение поиском —
  EP-06, стартующий ПОСЛЕ EP-05 по графу волн `00-EPICS.md` — см. риск в DTJ-167.
- **EP-01 (Фундамент)** — `OutboxRelayWorker`/`outbox`-механизм (DTJ-147, 153), `Clock`/
  `IdGenerator`-порты, `DomainError`-иерархия, `@RateLimit`/`@Roles`/`RolesGuard`/
  `TenantScopeGuard`, `packages/contracts/src/{errors,permissions}.ts`, `pino redact`-паттерны.
- **EP-02 (Tenancy guard)** — `TenantScopeGuard` на всех presentation-эндпоинтах кабинета.
- **EP-03/EP-15 (Онбординг/Admin)** — `pharmacy_api_keys` базовая таблица и её CRUD-эндпоинты
  (SRS-ADM-043..046), `pharmacies.one_c_endpoint`/`status`.
- **moderation-эпик (номер не входит в известный диапазон)** — `catalog_match_queue` полноценное
  владение (создание записей по `UnmatchedInventoryRowEvent`, курация). EP-05 читает/точечно
  дополняет эту таблицу через узкие read/write-порты (DTJ-142 п.3, DTJ-149, DTJ-163) — см.
  координационные риски в этих тикетах.

## Известные открытые вопросы (эскалировать архитектору/Tech Lead ДО или в начале волны 4)

1. **Механизм шаринга кода `apps/api` ↔ `apps/worker`** (DTJ-140) — как именно `apps/worker`
   импортирует провайдеры/процессоры из `apps/api/src/modules/inventory`. Блокирует DTJ-154.
2. **Именование маршрутов `apps/pharmacy`** (DTJ-166) — `docs/spec/30-ux-screens-and-flows.md`
   описывает экраны под префиксом `/admin/...`, хотя `apps/pharmacy` — отдельное приложение по
   `01-TECH-BASELINE.md`. Решение зафиксировано в DTJ-166 (свой неймспейс без `/admin`), но требует
   подтверждения перед стартом DTJ-167/168/169.
3. **RBAC ручного ввода**: `pharmacist` vs только `pharmacy_admin`/`super_admin` для
   `inventory:ingest` — module 22 (SRS-INV-015) и permission-матрица `12` (§4) расходятся; решение
   зафиксировано в пользу `12` (DTJ-159/161/162), см. «Технический контекст» DTJ-162.
4. **Реальная отправка webhook'а на `one_c_endpoint`** (DTJ-150) — не специфицирована как отдельный
   компонент ни одним документом; тикет ограничен публикацией доменного события.
5. **Готовность `0013_onboarding.sql` (`pharmacy_api_keys`) и таблицы `catalog_match_queue`** к
   волне 4 (DTJ-141/142) — от этого зависит, кто физически создаёт `catalog_match_queue` первым.

## Пропущенные/отсутствующие SRS-ссылки

Ни одного придуманного `SRS-*`-идентификатора в тикетах эпика нет — все ссылки проверены по
факту существования в `docs/spec/10-domain-model.md`, `11-database-schema.md`,
`12-api-conventions-auth-tenancy.md`, `22-module-inventory-sync-1c.md`. Разделы «Дополнения к
схеме БД» модуля 22 (DTJ-142) и REST-эндпоинты SRS-ADM-043..046 (module 27, за пределами этого
диапазона) — единственные места, где нормативность документа обсуждается явно в тикетах (см.
«Технический контекст» DTJ-142/DTJ-156).
