# DoruTJ — Модуль 22: Шлюз синхронизации остатков (1С и альтернативные каналы)

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `04-SCOPE-DECISION-PIVOT.md` > `03-ARCHITECT-DECISIONS.md` (D-*)
> > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> **`docs/spec/10-domain-model.md`, `docs/spec/11-database-schema.md`, `docs/spec/12-api-conventions-auth-tenancy.md`
> — ЗАКОН.** Этот документ не переопределяет ни одной сущности/поля/статуса/кода ошибки из них —
> только ссылается (`SRS-DOM-*`, `SRS-DB-*`, `SRS-API-*`) и специфицирует use case/каналы/очередь/
> производительность на их основе. Новые поля, отсутствующие в §11, явно вынесены в раздел
> «Дополнения к схеме БД» с обоснованием.
>
> Покрывает: **CUJ-6** (Charter §6) и **МОДУЛЬ 4** `tz.log`.
> Идентификаторы требований этого документа: **SRS-INV-nnn**. Тестовые сценарии: **TC-INV-nnn**.
> Слои — по `02-CLEAN-ARCHITECTURE-AND-CODE.md`: **domain** (`modules/inventory/domain`),
> **application** (`modules/inventory/application`), **infrastructure** (`modules/inventory/infrastructure`),
> **presentation** (`modules/inventory/presentation`).

---

## 0. Разбиение по релизам

> Основание: `04-SCOPE-DECISION-PIVOT.md` §3 (R1-5), §4 (R2-3). Архитектурные основания этого модуля
> (порты, state machine, очередь, composite-матчинг, схема БД) закладываются **целиком в R1** —
> ретрофит мультиканальности и матчинга дороже, чем сделать сразу (`04` §2.2). Реальный адаптер 1С
> (CommerceML, mTLS для крупных сетей) — единственная часть, для которой внешняя зависимость
> (эндпоинты конкретной сети) реально блокирует R1.

| Функция | Релиз | Обоснование (`04-SCOPE-DECISION-PIVOT.md`) |
|---|---|---|
| `IngestInventoryBatchUseCase` (ядро, все инварианты, состояния) | **[R1]** | Общий use case для ЛЮБОГО канала — фундамент; ретрофит дороже (§2.2) |
| Канал REST push (JSON, `X-Pharmacy-API-Key`+HMAC) | **[R1]** | R1-5: «REST API с ключом» — явно в составе R1 |
| Канал ручной ввод в веб-кабинете аптеки | **[R1]** | R1-5/R1-9: кабинет аптеки — обязательная часть R1, работает без единого внешнего ключа |
| Канал импорт Excel/CSV | **[R1]** | R1-5: «работает с аптеками без автоматизации», не требует договора об интеграции |
| Composite-матчинг (D-06) + `catalog_match_queue` | **[R1]** | Требуется уже для Excel/ручного/REST-каналов R1, не только для 1С |
| Очередь BullMQ, идемпотентность, версионность, DLQ | **[R1]** | Инфраструктурная гарантия целостности данных — часть DoD R1 (`04` §3.2 п.2 `pnpm verify`) |
| Дельта-SLA 5 мин + ночная полная синхронизация 03:00 | **[R1]** | D-04 — целевой SLA не зависит от того, какой канал его достигает |
| Отчёт для аптеки (`inventory_sync_batches`/`errors` в кабинете) | **[R1]** | R1-9: кабинет аптеки — обязательная функция |
| Устаревание данных / пометка в UI / автоскрытие | **[R1]** | R1-4: «данные могут быть неактуальны» — второе защитимое отличие продукта (D3) |
| Порт `CommerceMlParserPort` (интерфейс + `MockCommerceMlParser`) | **[R1]** | Provider Pattern: порт закладывается сразу (Charter §3.3), реальный XML-парсер — R2 |
| Реальный CommerceML 2.05 XML-адаптер (полный парсер) | **[R2]** | R2-3: «Полный 1С-шлюз: CommerceML» — требует реальных выгрузок пилотных 1С-инсталляций для вычитки формата |
| `require_mtls` для крупных сетей (реальная проверка сертификата) | **[R2]** | Флаг и guard-условие существуют в R1 (D-11), но требует реального клиентского сертификата сети — операционная зависимость от конкретной интеграции |
| `InventoryReconciliationJob` (ежедневная сверка restock/full-sync) | **[R1], Should** | Не блокирует DoD R1 (SRS-DOM-170: «Should, не блокирует MVP»), но входит в R1-scope как инфраструктурная гарантия того же движка |

Всё остальное содержимое документа — требования уровня **[R1]**, если не помечено иначе явно.

---

## 1. Границы модуля

Контекст `inventory` (`10-domain-model.md` §«Ограниченные контексты»), публичный фасад
`InventoryFacade`. Модуль владеет: `PharmacyInventory`, `InventoryBatch` (domain), `InventorySyncBatch`
(domain, aggregate состояния приёма), не владеет: `Medicine`/`substances` (контекст `catalog`),
`catalog_match_queue` (контекст `moderation` — inventory только публикует `UnmatchedInventoryRowEvent`,
запись создаёт `moderation`, C.f. `10-domain-model.md` матрица взаимодействий, строка
`inventory → moderation [E]`).

```
modules/inventory/
├── domain/
│   ├── pharmacy-inventory.entity.ts       (SRS-DOM-018..024, уже определён в 10-domain-model.md)
│   ├── inventory-sync-batch.entity.ts     (SRS-DOM-145..150, state machine §7)
│   ├── inventory-batch-upsert-row.vo.ts   (одна нормализованная строка команды, §3)
│   └── errors/inventory.errors.ts         (переиспользует DomainError-иерархию 10-domain-model.md)
├── application/
│   ├── use-cases/
│   │   ├── ingest-inventory-batch.use-case.ts      — SRS-INV-010
│   │   ├── resolve-catalog-match-queue-item.use-case.ts — SRS-INV-041 (вызывается moderation, но
│   │   │                                                   retro-apply остатка — метод inventory)
│   │   └── run-nightly-full-sync-fanout.use-case.ts — SRS-INV-034
│   └── ports/
│       ├── pharmacy-inventory.repository.port.ts
│       ├── inventory-sync-queue.port.ts            (BullMQ producer, §6)
│       ├── excel-inventory-parser.port.ts          (§4.2)
│       ├── commerce-ml-parser.port.ts              ([R1] порт + Mock, [R2] реальный XML-парсер)
│       └── pharmacy-api-key-verification.port.ts   (переиспользуется из identity, см. `12` §3.6)
├── infrastructure/
│   ├── adapters/drizzle-pharmacy-inventory.repository.ts
│   ├── adapters/bullmq-inventory-sync-queue.adapter.ts
│   ├── adapters/xlsx-excel-inventory-parser.adapter.ts
│   ├── adapters/mock-commerce-ml-parser.adapter.ts  ([R1])
│   ├── adapters/commerce-ml-2-05-parser.adapter.ts  ([R2])
│   └── workers/inventory-sync-batch.processor.ts     (BullMQ worker, §6)
└── presentation/
    ├── controllers/inventory-batch-update.controller.ts   — REST-канал (§3)
    ├── controllers/inventory-manual-entry.controller.ts   — ручной ввод (§4.3)
    ├── controllers/inventory-excel-import.controller.ts   — Excel/CSV (§4.2)
    ├── controllers/inventory-sync-batches.controller.ts   — отчёт для аптеки (§8)
    └── guards/pharmacy-api-key.guard.ts                    — делегирует в `PharmacyApiKeyVerificationPort`
```

**SRS-INV-001** [`02` §1, D-12] Все четыре канала (REST push, Excel/CSV, ручной ввод, CommerceML)
строят из своего входного формата ОДИН И ТОТ ЖЕ `IngestInventoryBatchCommand` (application DTO,
не Zod-схема HTTP — Zod-схема живёт в `presentation`/`packages/contracts` и мапится в Command в
контроллере) и передают его в единственный `IngestInventoryBatchUseCase.execute(command)`. Никакой
канал не содержит собственной копии бизнес-правил матчинга/версионности/лимитов — это устраняло бы
гарантию D-12 «все каналы равноправны».

---

## 2. Контракт `POST /api/v1/inventory/batch-update`

Аутентификация — `pharmacy_system` (системный принципал), полный алгоритм проверки уже определён
в `12-api-conventions-auth-tenancy.md` §3.6 (**SRS-API-033**, ссылки на заголовки
`X-Pharmacy-API-Key`/`X-Pharmacy-Timestamp`/`X-Pharmacy-Nonce`/`X-Pharmacy-Signature`, окно
`PHARMACY_SIGNATURE_WINDOW_SECONDS=300`, mTLS-флаг `require_mtls`) — **не переопределяется здесь**,
только применяется как guard перед контроллером ниже.

### 2.1 Заголовки запроса

```
POST /api/v1/inventory/batch-update
Content-Type: application/json
X-Pharmacy-API-Key: sec_live_9f83a2c8e17b.a1b2c3d4e5f6...
X-Pharmacy-Timestamp: 1756289000
X-Pharmacy-Nonce: 7f3e9c2a-1b4d-4e8a-9c3f-6d2e8a1b4c9f
X-Pharmacy-Signature: 9c8b7a6f5e4d3c2b1a0f...
```

### 2.2 Тело запроса (Zod-схема, `packages/contracts/src/inventory/batch-update.schema.ts`)

**SRS-INV-002** [tz.log Модуль 4, REQ-SYNC-1/2/3, D-11] Схема:

```ts
const InventoryBatchItemSchema = z.object({
  barcode: z.string().max(64).optional(),           // сырая строка, EAN-13 или внутренний код
  internal_sku: z.string().min(1).max(100),          // обязателен — первичный ключ канала (REQ-SYNC-7)
  trade_name: z.string().min(1).max(255),
  dosage_form: z.string().max(100).optional(),       // для fuzzy-фильтра (D-06 шаг 3)
  dosage_strength: z.string().max(100).optional(),
  manufacturer_name: z.string().max(255).optional(),
  price_tjs: z.number().positive(),                  // конвертация в Money — infrastructure (§10-domain-model.md)
  stock_quantity: z.number().int().min(0),
  batch_number: z.string().max(100).optional(),      // отсутствует → генерируется `AUTO-{internal_sku}` (см. SRS-INV-006)
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // "YYYY-MM-DD", SRS-API-008
  op: z.enum(['upsert', 'delete']).default('upsert'), // REQ-SYNC-2
});

const InventoryBatchUpdateRequestSchema = z.object({
  batch_id: z.string().uuid(),                        // клиентский UUID — идемпотентность (REQ-SYNC-1)
  pharmacy_guid: z.string().uuid(),                    // = pharmacies.id
  sync_type: z.enum(['full', 'delta']),                // REQ-SYNC-3
  sync_timestamp: z.string().datetime(),               // ISO-8601 UTC, SRS-API-008; НЕ время приёма сервером
  full_sync_session_id: z.string().uuid().optional(),  // обязателен, если sync_type='full' И страниц > 1 (§7.2, доп. к схеме БД п.1)
  page_number: z.number().int().min(1).default(1),
  is_last_page: z.boolean().default(true),
  items: z.array(InventoryBatchItemSchema).min(1).max(1000), // REQ-SYNC-4
});
```

**SRS-INV-003** [REQ-SYNC-4, SRS-API-066] Лимиты: `items.length <= 1000` И размер тела `<= 5 MB`,
проверяется потоково по `Content-Length` ДО парсинга JSON целиком — превышение любого из двух →
`413 PAYLOAD_TOO_LARGE`, тело не буферизуется в память (Fastify `bodyLimit`, тот же механизм для
всех каналов, включая внутреннее разбиение Excel — §4.2).

**SRS-INV-004** [REQ-SYNC-1] `batch_id` генерируется КЛИЕНТОМ (1С/оператором Excel-загрузки/UI ручного
ввода), НЕ сервером — это отличает его от `Idempotency-Key` (`12` §1.4, который генерируется тем же
клиентом, но живёт в отдельной таблице `idempotency_keys` для человеческих мутаций). Для
`inventory/batch-update` идемпотентность реализована через `inventory_sync_batches.id = batch_id`
UNIQUE (SRS-DB, таблица §11 п.11), а не через общий механизм `Idempotency-Key` — специализированный
путь, т.к. батч физически ИМЕЕТ содержательный `batch_id` в контракте 1С (в отличие от произвольных
человеческих мутаций).

**SRS-INV-005** [REQ-SYNC-4] `sync_type='full'` с более чем 1000 позиций разбивается КЛИЕНТОМ на
несколько последовательных HTTP-вызовов, каждый — отдельный `batch_id`, объединённых одним
`full_sync_session_id` (см. «Дополнения к схеме БД» п.1); `page_number` — 1-based порядковый номер;
`is_last_page=true` на последней странице запускает шаг «обнуление отсутствующих позиций» (§7.4).
`sync_type='delta'` НЕ использует `full_sync_session_id`/`page_number` (всегда одна логическая
страница) — Zod-refine: `sync_type==='delta' → full_sync_session_id === undefined`, иначе
`400 VALIDATION_ERROR` (`details.field='full_sync_session_id'`).

**SRS-INV-006** [tz.log Модуль 4] `batch_number` опционален в контракте (некоторые 1С-конфигурации
не разбивают остаток на партии) — при отсутствии `IngestInventoryBatchUseCase` генерирует
синтетический `batch_number = "AUTO-{internal_sku}"`, что даёт ОДНУ партию на позицию (упрощённый
случай FEFO — партия сама себе единственный кандидат). Это не нарушает `UNIQUE(pharmacy_inventory_id,
batch_number)` (SRS-DB §6 группа B), т.к. `internal_sku` уникален в рамках аптеки/сети (REQ-SYNC-7).

### 2.3 Ответ

**SRS-INV-007** [REQ-SYNC-12] Приём — **немедленный ACK**, тяжёлая обработка асинхронна (BullMQ, §6).
HTTP-статус `202 Accepted` (не `200`/`201` — тело ещё не обработано):

```json
{
  "data": {
    "batchId": "3f2b1a8c-...",
    "status": "queued",
    "acceptedForProcessing": true
  }
}
```

**SRS-INV-008** [REQ-SYNC-9] Итоговый результат обработки батча (`completed_full_success` /
`completed_partial_success` / `failed_validation`) недоступен синхронно в ответе на `POST` (обработка
асинхронна) — клиент (1С/интеграция) обязан либо (а) поллить
`GET /api/v1/inventory-sync-batches/:batchId` (см. §8), либо (б) для REST/CommerceML-каналов —
подписаться на `inventory.sync_completed`/`inventory.sync_failed` через `WS /api/v1/realtime`,
комната `pharmacy:{pharmacyId}` (`12-api-conventions-auth-tenancy.md` строка WS-событий, уже
определена). Опрос — не чаще `RATE_LIMIT_1C_BATCH_PER_MIN` того же ключа (общий rate-limit применяется
и к `GET`-статусу, чтобы не создавать альтернативный путь обхода лимита).

**SRS-INV-009** [REQ-SYNC-1] Given `batch_id`, уже существующий в `inventory_sync_batches` (повторная
отправка — сетевой ретрай 1С), When `POST /inventory/batch-update` получает тот же `batch_id`, Then
`202`-ACK возвращается СРАЗУ с уже известным `status` (например, `"completed_partial_success"`, если
обработка уже завершилась) БЕЗ создания второй строки и БЕЗ повторной постановки в очередь
(`UNIQUE(id)` на `inventory_sync_batches` — конфликт перехватывается на уровне
`ON CONFLICT (id) DO NOTHING RETURNING *`, при пустом `RETURNING` — `SELECT` существующей строки).
Тело запроса при повторной отправке НЕ сверяется побайтово (в отличие от `Idempotency-Key`,
SRS-API-010) — 1С может слегка изменить порядок полей JSON при ретрае, это не должно приводить к
`409`; см. также SRS-DOM-168.

---

## 3. Единая команда и маппинг каналов (D-12)

**SRS-INV-010** `IngestInventoryBatchUseCase.execute(cmd: IngestInventoryBatchCommand)` —
application use case, единственная точка входа для всех каналов:

```ts
type IngestInventoryBatchCommand = Readonly<{
  batchId: string;                 // UUID, идемпотентность
  pharmacyId: string;              // UUID, уже резолвлен из pharmacy_guid ИЛИ из сессии кабинета
  channel: 'rest_api' | 'excel_import' | 'manual_entry' | 'commerce_ml';
  syncType: 'full' | 'delta';
  syncTimestamp: Date;             // из тела запроса/файла — НЕ Date.now() (SRS-DOM-022)
  fullSyncSessionId?: string;
  pageNumber: number;
  isLastPage: boolean;
  rows: readonly InventoryRowCommand[];
}>;

// Дискриминированное объединение — REST/Excel/CommerceML поставляют «сырую» строку, требующую
// composite-матчинга (§4); ручной ввод в кабинете — медикамент уже выбран через каталожный поиск,
// матчинг не нужен (см. SRS-INV-024).
type InventoryRowCommand =
  | { resolved: true; medicineId: string; priceDiram: bigint; quantity: number; expiryDate: string; batchNumber?: string; op: 'upsert' | 'delete' }
  | { resolved: false; rawBarcode?: string; internalSku: string; tradeName: string; dosageForm?: string;
      dosageStrength?: string; manufacturerName?: string; priceDiram: bigint; quantity: number;
      expiryDate: string; batchNumber?: string; op: 'upsert' | 'delete' };
```

### 3.1 Канал REST push (1С и сторонние ERP)

**SRS-INV-011** [tz.log Модуль 4, D-11] `InventoryBatchUpdateController` (presentation): guard
`PharmacyApiKeyGuard` → Zod-парсинг тела (§2.2) → маппер
`RestInventoryRequestToCommandMapper.toCommand(dto, principal)` строит `IngestInventoryBatchCommand`
с `channel='rest_api'`, `rows` все `resolved: false` (сырые строки 1С всегда требуют матчинга —
1С не знает внутренний `medicineId` DoruTJ). `Money.fromDbDecimalTjs` НЕ используется здесь — конвертация
`price_tjs → priceDiram` идёт напрямую из числа JSON через `Money.fromNumberTjs(n): Money` (тот же VO,
другой конструктор для входных DTO, не для чтения из БД).

### 3.2 Канал импорт Excel/CSV

**SRS-INV-012** [REQ-SYNC-15, Charter — «работает с аптеками без автоматизации»] Шаблон
`.xlsx`/`.csv`, скачиваемый из кабинета аптеки (`GET /api/v1/inventory-import-template`),
фиксированные колонки (порядок и названия заголовков — контракт, валидация по заголовку, не по
позиции столбца, чтобы аптека могла переставить столбцы в Excel без последствий):

| Колонка (заголовок) | Обязательна | Тип/формат | Маппинг на `InventoryRowCommand` |
|---|---|---|---|
| `Штрихкод (EAN-13)` | Нет | строка, ровно 13 цифр или пусто | `rawBarcode` |
| `Внутренний код (SKU)` | Да | строка ≤100 симв. | `internalSku` |
| `Торговое название` | Да | строка ≤255 симв. | `tradeName` |
| `Форма выпуска` | Нет | строка ≤100 симв. | `dosageForm` |
| `Дозировка` | Нет | строка ≤100 симв. | `dosageStrength` |
| `Производитель` | Нет | строка ≤255 симв. | `manufacturerName` |
| `Цена (TJS)` | Да | число, `> 0`, разделитель `.` | `priceDiram` (после `Money.fromNumberTjs`) |
| `Остаток (шт.)` | Да | целое, `>= 0` | `quantity` |
| `Партия` | Нет | строка ≤100 симв. | `batchNumber` |
| `Срок годности` | Да | **строго** `ДД.ММ.ГГГГ` (фиксированный формат шаблона) | `expiryDate` |

**SRS-INV-013** [REQ-SYNC-15] Given ячейка `Срок годности` НЕ соответствует `ДД.ММ.ГГГГ` (например,
Excel локализовал в `MM/DD/YYYY` при ручном редактировании файла, или ячейка отформатирована как
`ГГГГ-ММ-ДД`), When `XlsxExcelInventoryParserAdapter` разбирает файл, Then строка отклоняется с
`error_code='ambiguous_date_format'` (уже в enum `inventory_sync_row_error_code`, §11 п.163-166) —
парсер НЕ угадывает формат по эвристике (день/месяц могут быть оба ≤12 — неоднозначность реальна),
явная ошибка лучше молчаливой порчи даты.

**SRS-INV-014** [Charter §5 «работает с аптеками без автоматизации», масштаб файла] Файл может
содержать до `EXCEL_IMPORT_MAX_ROWS` строк (ASSUMPTION `20000`, ENV) — что превышает лимит одного
батча (1000, REQ-SYNC-4). `ExcelInventoryImportController` (presentation) НЕ отправляет файл целиком
в один `IngestInventoryBatchCommand` — парсит весь файл синхронно (быстрая операция, чтение файла, не
запись в БД), затем сам генерирует `N = ceil(rows/1000)` вызовов `IngestInventoryBatchUseCase.execute()`
с одним общим `fullSyncSessionId` (если аптека явно выбрала «Полная замена ассортимента» в UI —
`syncType='full'`) или `N` независимых `delta`-батчей (режим «Добавить/обновить», без обнуления
остального ассортимента) — выбор режима явный чекбокс в UI кабинета, не эвристика. Аптека видит ОДИН
прогресс-бар в кабинете, агрегирующий статусы всех `N` фоновых батчей по общему
`sourceUploadId` (клиентский UUID, генерируемый фронтом при старте загрузки, хранится в
`inventory_sync_batches` — см. «Дополнения к схеме БД» п.1, переиспользует `full_sync_session_id`
даже для delta-режима как группирующий, не только для full).

### 3.3 Ручной ввод в веб-кабинете аптеки

**SRS-INV-015** [D-12, R1-5] `InventoryManualEntryController`: два режима UI —
(а) **точечное редактирование** одной позиции (форма «Остаток и цена») — фармацевт/`pharmacy_admin`
ВЫБИРАЕТ медикамент из каталожного автокомплита (`GET /api/v1/medicines?search=...`, уже существующий
поисковый эндпоинт catalog-модуля — не специфицируется здесь), т.е. `medicineId` уже известен на
клиенте ДО отправки — строка приходит как `{ resolved: true, medicineId, ... }`, **composite-матчинг
не выполняется** (нет сырого текста для сопоставления — пользователь его уже произвёл интерфейсом
поиска); (б) **массовое редактирование по сетке** («таблица остатков своей аптеки») — те же строки
`resolved: true`, батч из K позиций одной HTTP-отправки (`K <= 1000`, тот же общий лимит §2.3, хотя
практически кабинет пагинирует сетку по 50-100 строк на экран — ограничение существует для защиты
API, не потому что UI когда-либо приблизится к 1000).

**SRS-INV-016** [D-12] Given фармацевт не находит медикамент в автокомплите (действительно новый для
каталога товар), When он использует отдельный пункт UI «Товара нет в списке — предложить новый»,
Then фронт вызывает НЕ `inventory/batch-update`, а отдельный (не специфицируемый в этом документе,
принадлежит контексту `catalog`/`moderation`) эндпоинт создания черновика `catalog_match_queue` с
`channel='manual_entry'` напрямую, минуя composite-матчинг (пользователь уже подтвердил «это новый
товар» осознанно — автоматический fuzzy-поиск был бы избыточен, раз человек уже искал и не нашёл).

### 3.4 Канал CommerceML 2.05 — **[R1: порт+Mock, R2: реальный парсер]**

**SRS-INV-017** [REQ-SYNC-17, Charter §3.3 Provider Pattern] `CommerceMlParserPort` (application) —
интерфейс `parse(xml: Buffer): CommerceMlParseResult`, ENV `COMMERCE_ML_PARSER_DRIVER`
(`mock` | `real`, по аналогии с остальными провайдерами Charter §3.3). **[R1]** реализован только
`MockCommerceMlParserAdapter` — детерминированно парсит фиксированный тестовый XML-фикстур
(структура CommerceML 2.05 `<КоммерческаяИнформация><Каталог>`/`<ПакетПредложений>`), достаточный для
E2E-теста контракта и для пилотных сетей, СОГЛАСНЫХ прислать реальный экспорт для вычитки формата.
**[R2]** `CommerceMl205ParserAdapter` — полный XML-парсер (`fast-xml-parser`), реализующий
маппинг `<Предложение><Ид>` → `internalSku`, `<Предложение><Цены><Цена><ЦенаЗаЕдиницу>` → `priceDiram`,
`<Предложение><Количество>` → `quantity`, штрихкод из `<Предложение><Штрихкод>` → `rawBarcode`.
Загрузка — `multipart/form-data` (файл XML), тот же лимит `10 MB` общего мультипарт-лимита
(SRS-API-066), НЕ 5 МБ батч-лимита (файл 1С может быть крупнее одного батча — парсер сам разбивает
результат на страницы ≤1000 позиций тем же механизмом, что и Excel §3.2).

**SRS-INV-018** [REQ-SYNC-17] Given XML не проходит XSD-валидацию структуры CommerceML 2.05 (битый
файл/неверная версия схемы), When `parse()` вызывается, Then `CommerceMlMalformedXmlError` (application,
маппится в `400 VALIDATION_ERROR` с `details.reason`) — батч НЕ создаётся вовсе (ошибка на уровне
файла, раньше появления `inventory_sync_batches` строки, в отличие от построчных ошибок §7.3).

---

## 4. Composite-матчинг товара (D-06)

Применяется ТОЛЬКО к строкам `resolved: false` (REST/Excel/CommerceML — §3). Реализация —
`application`-сервис `CompositeInventoryMatcherService`, вызывающий
`CatalogFacade.resolveMedicineByComposite(barcode, internalSku, pharmacyId, tradeName, dosageForm,
dosageStrength, manufacturerName)` (домен-модель, матрица взаимодействий, строка
`inventory → catalog [F]`).

### 4.1 Шаг 1 — валидация EAN-13

**SRS-INV-019** [D-06, SRS-DOM-074..076] `Barcode.parse(rawBarcode)` (VO, общий для `catalog` и
`inventory` — переиспользуется, не дублируется: см. `10-domain-model.md` §«Value Objects»/Barcode,
живёт в общем `libs/domain-kernel` или пакете, доступном обоим модулям как shared kernel, НЕ через
прямой импорт `catalog/domain/*` — иначе нарушение границ контекста, `02` §1.1). Результат:
`isValidEan13(): boolean`, `isInternalPrefix(): boolean` (префикс `'2'`), `format: 'ean13' |
'non_ean13'`. Строка БЕЗ `rawBarcode` вовсе (поле опционально в контракте §2.2) сразу переходит к
шагу 2 с `barcodeCandidate = null`.

**SRS-INV-020** [D-06] Классификация определяет, участвует ли штрихкод в шаге 2 как альтернативный
ключ:

| Условие | Участвует в точном матчинге по `medicines.barcode`? |
|---|---|
| `isValidEan13() === true` И `isInternalPrefix() === false` | Да — глобально уникальный код (`medicines.barcode UNIQUE`) |
| `isValidEan13() === true` И `isInternalPrefix() === true` (префикс `2`) | Нет — внутренний код продавца, не глобальный (D-06) |
| `isValidEan13() === false` (контрольная цифра не сошлась, либо длина ≠13) | Нет — сохраняется как есть для аудита (SRS-DOM-076/177), не блокирует строку |

### 4.2 Шаг 2 — точное совпадение

**SRS-INV-021** [D-06, REQ-SYNC-7] Порядок проверки (первое совпадение побеждает, дальнейшие критерии
не проверяются):

1. `pharmacy_sku_mapping WHERE pharmacy_id = :pharmacyId AND internal_sku = :internalSku` (кэш «однажды
   сматченного», SRS-DB §11 п.9) → если найдено, `medicineId` берётся ОТСЮДА, шаги 3/4 полностью
   пропускаются (это и есть смысл кэша — не повторять fuzzy на каждой синхронизации).
2. Если кэш пуст И штрихкод прошёл классификацию SRS-INV-020 как глобальный (`format='ean13'`,
   `isInternalPrefix()=false`): `medicines WHERE barcode = :rawBarcode` — точное совпадение.
3. Если оба условия выше не дали результата → шаг 3 (fuzzy).

**SRS-INV-022** [Примечание к D-06 — расхождение формулировки] Архитектурное решение D-06 буквально
называет ключ шага 2 `(chain_id, internal_sku)`; физическая реализация `pharmacy_sku_mapping`
(`11-database-schema.md` §11 п.9) использует `(pharmacy_id, internal_sku)` — **это не противоречие, а
согласованное уточнение**: `internal_sku` гарантированно уникален только в рамках ОДНОЙ 1С-инсталляции
(одной физической точки), не всей сети (два филиала одной сети нередко ведут независимую нумерацию
SKU) — `pharmacy_id`-скоуп строже и безопаснее `chain_id`-скоупа, полностью удовлетворяет намерению
D-06 («не дублировать fuzzy-проверку на повторных синхронизациях») на более консервативном уровне
детализации. Этот документ фиксирует `pharmacy_id` как окончательный ключ кэша, `11-database-schema.md`
не изменяется.

**SRS-INV-023** [REQ-SYNC-7] Given строка успешно сматчена ЛЮБЫМ путём (кэш, штрихкод ИЛИ fuzzy §4.3),
When `medicineId` определён, Then `pharmacy_sku_mapping` обновляется (`INSERT ... ON CONFLICT
(pharmacy_id, internal_sku) DO UPDATE SET medicine_id=..., matched_via=..., matched_at=now()`) —
следующая синхронизация того же `internal_sku` попадёт на шаг 2.1 напрямую.

### 4.3 Шаг 3 — trigram fuzzy

**SRS-INV-024** [D-06, REQ-SYNC-6, SRS-DB-018] Реализация — расширение готового SQL-запроса
`11-database-schema.md` §«Готовые SQL-запросы поиска» п.4 (`similarity(m.trade_name, :raw_trade_name)
>= 0.35`, порог `SRS-DB-018`), дополненное по буквальному тексту D-06 («по `trade_name`, `dosage_form`,
`dosage_strength`, `manufacturer_name`»):

```sql
SELECT
  m.id,
  similarity(m.trade_name, :raw_trade_name) AS trade_name_score,
  similarity(COALESCE(m.manufacturer_name, ''), COALESCE(:raw_manufacturer_name, '')) AS mfr_score,
  (0.7 * similarity(m.trade_name, :raw_trade_name)
   + 0.3 * similarity(COALESCE(m.manufacturer_name, ''), COALESCE(:raw_manufacturer_name, ''))) AS combined_score
FROM medicines m
WHERE (:raw_dosage_form IS NULL OR m.dosage_form_class = catalog_normalize_dosage_form_class(:raw_dosage_form))
  AND similarity(m.trade_name, :raw_trade_name) >= 0.35   -- SRS-DB-018, фильтр по первичному полю
ORDER BY combined_score DESC
LIMIT 5;
```

`catalog_normalize_dosage_form_class(text)` — уже существующий (catalog-модуль) маппер свободного
текста 1С в `dosage_form_class` enum (не специфицируется здесь, принадлежит catalog).

**SRS-INV-025** [D-06] Given топ-1 кандидат `combined_score >= 0.35`, When проверяется
`dosage_strength` кандидата через `Dosage.isEquivalentTo()` (VO, `10-domain-model.md` SRS-DOM-078)
против распарсенного `raw_dosage_strength`, Then НЕСОВПАДЕНИЕ дозировки отбрасывает кандидата
целиком (переход к следующему из топ-5), даже если текстовое сходство названия высокое — дозировка
не участвует в текстовом similarity-скоре, но является жёстким фильтром после ранжирования (разная
дозировка — разный товар, не «почти совпадение»).

**SRS-INV-026** [ASSUMPTION, `CATALOG_MATCH_AMBIGUITY_GAP` ENV, дефолт `0.05`] Given после фильтра
SRS-INV-025 остаётся ≥2 кандидата, When `combined_score` первого и второго кандидата отличаются МЕНЬШЕ
чем на `CATALOG_MATCH_AMBIGUITY_GAP`, Then матч признаётся НЕОДНОЗНАЧНЫМ — автоматический выбор не
производится, строка идёт в шаг 4 (очередь), даже если оба кандидата формально прошли порог `0.35`
(два похожих генерика с близкими названиями — типичный ложный авто-матч, который D-06 требует избегать
в первую очередь).

### 4.4 Шаг 4 — очередь ручной модерации

**SRS-INV-027** [D-06, REQ-SYNC-6] Given ни кэш, ни точный штрихкод, ни однозначный fuzzy-кандидат не
дали результата, When `IngestInventoryBatchUseCase` завершает обработку строки, Then публикуется
`UnmatchedInventoryRowEvent { pharmacyId, rawRowPayload, reason: 'no_candidate' | 'ambiguous' }` в
`outbox` (та же транзакция, что и запись `inventory_sync_errors` со строкой `error_code=
'unmatched_medicine'`, SRS-DOM-151 — гарантия единой транзакции outbox+целевая таблица) —
`moderation`-модуль (подписчик, вне этого документа) создаёт
`catalog_match_queue`. Дедупликация — по хешу `(pharmacyId, internalSku)` (уже определено в
`10-domain-model.md`): повторная синхронизация того же несопоставленного SKU НЕ плодит вторую запись
очереди, обновляет существующую (`raw_price_tjs`/`raw_stock_quantity`/`source_sync_timestamp` —
см. «Дополнения к схеме БД» п.3 — перезаписываются самыми свежими данными, только если
`source_sync_timestamp` новее уже сохранённого, тот же принцип staleness-guard, что и SRS-DOM-022).

**SRS-INV-028** [D-06, задача документа «новый, ранее невиданный товар»] Оператор каталога
(apps/admin, роль `super_admin`/специализированная — вне области этого документа) разрешает запись
`catalog_match_queue` одним из трёх исходов (`catalog_match_queue_status`, уже определён в §11):

| Резолюция | Что происходит с отложенным остатком/ценой |
|---|---|
| `matched` (сопоставлено с существующим `medicine_id`) | `ResolveCatalogMatchQueueItemUseCase` (application, `inventory`) вызывается moderation-модулем СИНХРОННО после установки `resolved_medicine_id`; читает `raw_stock_quantity`/`raw_expiry_date`/`raw_batch_number`/`source_sync_timestamp` (см. «Дополнения к схеме БД» п.3) и применяет их через `PharmacyInventory.applyDelta()` — ТОТ ЖЕ путь, что обычная строка батча, включая staleness-guard против `source_sync_timestamp` |
| `created_new` (создан черновик `Medicine` в catalog, `control_category='none'` по умолчанию — D-08) | То же самое ретроактивное применение, как выше, но с новым `medicineId` из только что созданного черновика; товар НЕ виден в поиске, пока `Medicine.publish()` не вызван catalog-модулем (SRS-DOM-013) — остаток технически записан, но недоступен для заказа до публикации |
| `rejected` (мусорная строка/полностью нерелевантный товар) | Остаток НЕ применяется никогда; строка остаётся зафиксированной только в `inventory_sync_errors` исторически |

**SRS-INV-029** [D-08] Ретроактивное применение (`matched`/`created_new`) НЕ меняет `control_category`
самостоятельно — новый черновик получает дефолт `'none'` (D-08); если оператор при курации подозревает
контролируемое вещество, это отдельное действие `medicine.proposeControlCategory()` (catalog-модуль,
вне этого документа, событие `NewControlCategoryCandidateEvent`), не связанное с фактом применения
остатка.

---

## 5. Очередь BullMQ

**SRS-INV-030** [Charter §3.1 отклонение №2, D-05] Очередь **`inventory-sync-queue`** (BullMQ ^6.3.0
поверх Redis 7, единственная зависимость по Charter). Job создаётся В ТОЙ ЖЕ транзакции БД, что и
вставка строки `inventory_sync_batches` (`status='queued'`) — через transactional outbox (переиспользует
существующий механизм `outbox`/`OutboxRelayWorker`, `10-domain-model.md` §«Доменные события», НЕ
отдельный ad-hoc продюсер, чтобы job не терялся при падении между коммитом БД и постановкой в Redis).

**SRS-INV-031** Структура job:

```ts
type InventorySyncJobData = Readonly<{
  batchId: string;          // = inventory_sync_batches.id — используется КАК jobId (идемпотентность)
  pharmacyId: string;
  channel: InventorySyncChannel;
  syncType: 'full' | 'delta';
}>;
// Job НЕ несёт сами строки items — только ссылку. Строки читаются воркером из
// inventory_sync_raw_items (см. «Дополнения к схеме БД» п.2) — не раздувает Redis payload до 5 МБ
// на job и переживает падение воркера между приёмом и обработкой (Postgres — источник истины).
```

**SRS-INV-032** [Идемпотентность] `jobId = batchId` (BullMQ deduplication по `jobId` внутри очереди) —
даже если `OutboxRelayWorker` публикует событие повторно (at-least-once delivery, SRS-DOM-152),
BullMQ отклоняет вторую постановку job с тем же `jobId`, пока первая не завершилась/не удалена.

**SRS-INV-033** [Конкурентность, D-05] Воркер (`apps/worker`) поднимает `Worker` с
`concurrency = INVENTORY_SYNC_WORKER_CONCURRENCY` (ASSUMPTION `10`, ENV) — до 10 батчей РАЗНЫХ аптек
обрабатываются параллельно. Батчи ОДНОЙ аптеки сериализуются: перед обработкой воркер берёт
`pg_advisory_xact_lock(hashtext(:pharmacyId))` (Postgres advisory lock в рамках транзакции обработки) —
второй параллельный job той же аптеки ждёт освобождения лока, что даёт строгий порядок применения
даже при гонке (доп. защита поверх staleness-guard SRS-DOM-022, а не замена ему — staleness-guard
защищает от логической гонки по данным, advisory lock — от физической гонки по строкам).

**SRS-INV-034** [Приоритеты] `priority` job (BullMQ, меньшее число = выше приоритет):
`rest_api`/`manual_entry` delta = `1` (интерактивный канал, пользователь ждёт результат), `excel_import`
delta = `5`, ЛЮБОЙ `sync_type='full'` (включая ночную фан-аут джобу §7.2) = `10` — полная синхронизация
объёмная и не находится на пути ожидания живого пользователя, не должна вытеснять свежие дельты
из очереди в час пик.

**SRS-INV-035** [Retry/backoff, DLQ] `attempts: 5`, `backoff: { type: 'exponential', delay: 5000 }`
(5с, 10с, 20с, 40с, 80с — итого до ~155с до финального провала, укладывается в SLA 5 минут даже при
нескольких переотправках). Given 5-я попытка также падает (необработанное исключение инфраструктуры —
не бизнес-ошибка строки, та обрабатывается внутри одной попытки и НЕ считается провалом job, см. §7.3),
When BullMQ помечает job `failed` окончательно, Then `InventorySyncFailedJobHandler` (слушатель события
`failed` очереди) переводит `inventory_sync_batches.status = 'failed_validation'` (переиспользует
существующий терминальный статус, SRS-DOM-149 — обработка не завершилась НИЧЕМ, семантически
эквивалентно) с ОДНОЙ синтетической строкой `inventory_sync_errors(error_code='processing_failed',
error_detail=<последняя ошибка стека, без секретов>)` (новое значение enum — см. «Дополнения к схеме
БД» п.5) — батч НЕ зависает в `processing` бесконечно (нарушение SRS-DOM-150 иначе), `pharmacy_admin`
видит явную ошибку и алерт уходит on-call (Redis/BullMQ dashboard + `SlaBreachedEvent`-подобный алерт
canonical для операционных инцидентов, не пользовательский путь).

**SRS-INV-036** [Версионность — «старый батч не должен перезаписать новый»] Гарантия НЕ на уровне
очереди (порядок обработки job в BullMQ НЕ гарантирует порядок отправки — параллельные воркеры,
retry, разный сетевой джиттер 1С могут переставить порядок доставки), а на уровне ДАННЫХ:
`PharmacyInventory.applyDelta()` сравнивает `batchUpsert.sync_timestamp` со СТРОКОВЫМ
`inventory_batches.last_synced_at` конкретной партии (SRS-DOM-022, уже определено) — job, обработанный
позже физически, но несущий более СТАРЫЙ `sync_timestamp`, безопасно проигрывает сравнение и
помечается `skipped_stale`, а не перезаписывает свежие данные. Advisory lock (SRS-INV-033) устраняет
гонку записи в рамках одного `pharmacy_id`, staleness-guard устраняет гонку по семантике «что
новее» — комбинация обоих закрывает и физическую, и логическую версионность.

---

## 6. Дельта vs полная синхронизация

**SRS-INV-037** [D-04] `INVENTORY_DELTA_SLA_MINUTES` (уже определено, `tenant_settings`, дефолт `5`,
диапазон `1..15`) — целевой SLA для **дельта**-канала REST/CommerceML: время от `sync_timestamp`
(момент, зафиксированный в 1С) до применения строки в `pharmacy_inventory` (видимость в поиске) НЕ
должно превышать это значение при штатной нагрузке. Excel/ручной ввод НЕ подпадают под этот SLA
буквально (они не выгружаются автоматически каждые N минут — это дискретное действие человека),
но проходят ТУ ЖЕ очередь и обрабатываются с ТЕМ ЖЕ приоритетом относительно других delta-job (§5,
SRS-INV-034), т.е. фактическая задержка обработки сопоставима.

**SRS-INV-038** [D-04, tz.log Модуль 4] Ночная полная синхронизация — фан-аут джоба `apps/worker`
(`@nestjs/schedule` cron `0 3 * * *` в `Asia/Dushanbe` = `0 22 * * *` UTC без перехода на летнее
время) запускает `RunNightlyFullSyncFanoutUseCase`, которая для каждой `pharmacies` со `status='active'`
И `channel` в её `pharmacy_api_keys` (т.е. только для аптек, реально интегрированных по REST/CommerceML —
Excel/ручные аптеки не имеют «своей» автоматической ночной синхронизации, для них полная сверка
инициируется самим пользователем через кнопку «Обновить весь ассортимент» в кабинете) отправляет
ЗАПРОС `sync_type='full'` НЕ САМА, а публикует webhook-триггер на `one_c_endpoint` аптеки (поле уже
существует, §11 группа A) — 1С должна САМА инициировать полную выгрузку по этому триггеру (DoruTJ не
может «вытащить» данные из 1С активно, только попросить прислать; см. также REQ-SYNC-13 ниже).

**SRS-INV-039** [REQ-SYNC-13] Given несколько сотен аптек с `one_c_endpoint`, триггер полной
синхронизации распределяется по временным слотам, НЕ единомоментно в 03:00:00 — `sync_slot = hash(
pharmacy_guid) mod NIGHTLY_SYNC_WINDOW_MINUTES` (ASSUMPTION `NIGHTLY_SYNC_WINDOW_MINUTES=60`, т.е. окно
03:00–04:00), каждая аптека получает триггер в `03:00 + sync_slot` минут — детерминированно (хеш от
`pharmacy_guid`, не случайное число), что делает распределение воспроизводимым для тестов.

**SRS-INV-040** [REQ-SYNC-3, SRS-DOM-147] Определение «дельты» — ответственность КЛИЕНТА (1С),
не сервера: `sync_type='delta'` означает «эти конкретные позиции изменились с прошлой синхронизации»
(1С сама трекает изменения через свой журнал регистрации), сервер НЕ вычисляет дельту самостоятельно
сравнением снапшотов. Единственное серверное отличие delta/full — обработка позиций, ОТСУТСТВУЮЩИХ в
выгрузке (§7.4 ниже).

**SRS-INV-041** [REQ-SYNC-3] Обработка позиций, «пропавших» из полного снапшота: Given
`is_last_page=true` для `sync_type='full'` (одностраничный ИЛИ последняя страница
`full_sync_session_id`), When все страницы применены без ожидающих в очереди, Then выполняется
шаг «обнуление отсутствующих позиций» —

```sql
UPDATE inventory_batches ib
SET quantity = 0, last_synced_at = :fullSyncTimestamp
FROM pharmacy_inventory pi
WHERE ib.pharmacy_inventory_id = pi.id
  AND pi.pharmacy_id = :pharmacyId
  AND ib.last_synced_at < :fullSyncTimestamp   -- КРИТИЧНО: не трогает партии, обновлённые ПОЗЖЕ
                                                 -- момента полного снапшота (см. SRS-INV-042)
  AND ib.batch_number NOT IN (:touchedBatchNumbersInThisFullSync)
  AND ib.quantity > 0;
```

Партии, чей `internal_sku` НЕ встретился ни на одной странице этого `full_sync_session_id`, получают
`quantity = 0` (товар физически закончился/снят с продажи в 1С), но строка НЕ удаляется физически
(аудит/история — тот же принцип, что просроченные партии, SRS-DB-020).

**SRS-INV-042** [Гонка: full-снапшот против дельты, пришедшей "во время ночи"] Условие
`ib.last_synced_at < :fullSyncTimestamp` в запросе выше — ЗАЩИТА от сценария: дельта по конкретному
`internal_sku` пришла ПОСЛЕ того момента, который зафиксирован как `sync_timestamp` полного снапшота
(например, 1С отправила `full`-выгрузку с `sync_timestamp=03:00:00`, но пока страницы физически letели
по сети/стояли в очереди, в 03:02 пришла отдельная REST-дельта с `sync_timestamp=03:02:00` по той же
позиции) — такая партия УЖЕ имеет `last_synced_at=03:02:00 > 03:00:00`, зануление её пропускает (SQL
`WHERE` выше её не заденет), несмотря на то, что она физически отсутствовала в самом full-снапшоте
(снапшот просто «устарел» на 2 минуты раньше, чем 1С его собрала). Это тот же принцип, что и
SRS-DOM-170 (гонка возврат/full-sync), применённый здесь к гонке дельта/full.

---

## 7. Отчёт для аптеки

**SRS-INV-043** [REQ-SYNC-10] `GET /api/v1/inventory-sync-batches?cursor=...&limit=20&sort=receivedAt:desc
&filter[pharmacyId]=...` (курсорная пагинация, `12-api-conventions-auth-tenancy.md` §1.1, SRS-API-004) —
доступен роли `pharmacy_admin` (своя сеть, `inventory:read`, permission-матрица `12` §4) в
`apps/admin`. Список отображает: `channel`, `syncType`, `status`, `totalRows`/`acceptedRows`/
`rejectedRows`, `receivedAt`, `completedAt`, `sourceUploadId` (для Excel — группировка N батчей одной
загрузки, §3.2).

**SRS-INV-044** [REQ-SYNC-9] `GET /api/v1/inventory-sync-batches/:batchId/errors` — построчные ошибки
конкретного батча (`inventory_sync_errors`), каждая строка: `rowIndex`, `rawRow` (исходный JSON —
позволяет аптеке увидеть, ЧТО именно она отправила), `errorCode`, `errorDetail`, локализованное
сообщение (маппинг `errorCode → i18n`, тот же принцип, что `error.message` в §2 `12-api-conventions`).

**SRS-INV-045** [REQ-SYNC-9, UX исправления] Кабинет аптеки не предоставляет «исправление прямо в
таблице ошибок» для REST/CommerceML-канала (1С — источник истины, исправление происходит на стороне
1С и переотправкой строки следующим батчем) — но ДЛЯ Excel-канала кабинет предлагает «Скачать отчёт об
ошибках» (тот же файл-шаблон §3.2, но только отклонённые строки + столбец `Причина ошибки`), который
аптека правит и загружает повторно как НОВЫЙ батч (не патч старого — `failed_validation`/
`completed_partial_success` батчи терминальны, SRS-DOM-150).

**SRS-INV-046** [REQ-SYNC-10, роль] `catalog_match_queue`, созданная ЭТИМ модулем (через
`UnmatchedInventoryRowEvent`), видна аптеке ТОЛЬКО в виде счётчика «N позиций ожидают проверки
каталогом» на её собственной странице истории синхронизаций (без доступа к самой очереди —
`catalog_match_queue` целиком принадлежит `moderation`/`super_admin`, RBAC `inventory:read` не даёт
доступа к чужому ресурсу) — это информационный индикатор, не рабочий инструмент аптеки.

---

## 8. Устаревание данных

**SRS-INV-047** [D-04, REQ-SYNC-16] `pharmacy_inventory.last_synced_at` (денормализация, поддерживается
триггером `trg_recompute_fefo`, SRS-DB-021 — уже определено) — единственный источник «насколько
свежи данные» для presentation-слоя.

**SRS-INV-048** [D-04, R1-4 «данные могут быть неактуальны»] Given
`now() - pharmacy_inventory.last_synced_at > INVENTORY_DELTA_SLA_MINUTES` (для аптек REST/CommerceML)
ИЛИ `now() - last_synced_at > INVENTORY_MANUAL_STALE_HOURS` (ASSUMPTION `72`, ENV, REQ-SYNC-16 — для
Excel/ручных аптек, у которых нет автоматического цикла — 5-минутный SLA для них бессмысленен),
When позиция отображается в поиске/на карте/в карточке товара, Then UI показывает явную пометку
(`badge`, i18n-ключ `inventory.staleWarning`, НЕ хардкод строки — Charter §5) «Данные могут быть
неактуальны» БЕЗ скрытия позиции — честная деградация, не молчаливое исчезновение (соответствует
R1-4 буквально).

**SRS-INV-049** [REQ-SYNC-16] Given `now() - last_synced_at > INVENTORY_MANUAL_STALE_HOURS` (72 часа —
явно, а не просто предупреждение), When позиция ранжируется в результатах поиска (`ORDER BY` §11
готовые SQL-запросы), Then её приоритет сортировки ПОНИЖАЕТСЯ (не скрывается из выдачи вовсе —
`stock_quantity > 0` остаётся единственным жёстким фильтром видимости) — реализуется добавлением
множителя ранжирования: `effective_rank = rank * (CASE WHEN stale THEN 0.5 ELSE 1.0 END)` на уровне
запроса каталога (принадлежит catalog-модулю технически, но правило источника данных — inventory).

**SRS-INV-050** [D-16, безопасность денег] Полное АВТОМАТИЧЕСКОЕ скрытие остатка (жёсткое исключение
из `stock_quantity`, а не просто понижение ранга) применяется ТОЛЬКО когда `PharmacyAccount.status !=
'active'` (onboarding-модуль, REQ-ONBOARD-15 — уже определено: `InventoryFacade` продолжает ПРИНИМАТЬ
данные для `suspended`, `OnboardingFacade.isVisibleInSearch(pharmacyId)` фильтрует ТОЛЬКО видимость) —
устаревание само по себе (даже месяцы без синхронизации) не блокирует ингест новых данных и не
удаляет позицию физически, это чисто presentation-уровневая деградация UX, отделённая от лицензионного
статуса аптеки.

---

## 9. Производительность (D-05)

**SRS-INV-051** [D-05] Целевые показатели: **500 item-events/сек устойчиво, burst до 2000/сек**,
измеряется агрегированно по item-строкам (не HTTP-запросам — REQ-SYNC-4/`RATE_LIMIT_1C_BATCH_PER_MIN`
уже ограничивает частоту HTTP-вызовов на аптеку до 20/мин, пропускная способность достигается
БАТЧИРОВАНИЕМ до 1000 строк за вызов, а не построчными HTTP-запросами — `20 батчей/мин × 1000 строк =
20000 строк/мин ≈ 333 строк/сек на ОДНУ аптеку`, целевые 500/сек устойчиво — суммарно по всем
одновременно синхронизирующимся аптекам, не на одну).

**SRS-INV-052** [Без N+1] Обработка одного батча (`InventorySyncBatchProcessor`, воркер) выполняет
ФИКСИРОВАННОЕ малое число SQL-обращений НЕЗАВИСИМО от `items.length` (до 1000):

1. Одним запросом — резолв `pharmacy_sku_mapping` для ВСЕХ `internal_sku` батча разом
   (`WHERE pharmacy_id = :id AND internal_sku = ANY(:skus)`), не по одному на строку.
2. Для несматченных кэшем строк — один запрос fuzzy-кандидатов ПАКЕТНО (через временную
   таблицу входных строк + `LATERAL JOIN`, не цикл `for item of items`).
3. Один `COPY` (см. SRS-INV-053) для загрузки нормализованных строк во временную таблицу.
4. Один `INSERT ... ON CONFLICT DO UPDATE` для `pharmacy_inventory` (создание отсутствующих
   агрегатов) — set-based, не по одному `INSERT` на позицию.
5. Один `INSERT ... ON CONFLICT (pharmacy_inventory_id, batch_number) DO UPDATE` для
   `inventory_batches` — set-based upsert партий, staleness-guard (`WHERE excluded.last_synced_at >
   inventory_batches.last_synced_at`) встроен В САМ `ON CONFLICT`, не отдельным циклом сравнений
   в application-коде.
6. Триггер `trg_recompute_fefo` (уже определён, SRS-DB-021) пересчитывает денормализацию
   ПОСТРОЧНО как `AFTER`-триггер — единственное намеренное исключение из «без построчной обработки»,
   т.к. пересчёт FEFO логически неотделим от конкретной строки `pharmacy_inventory`; это дешёвая
   агрегатная операция (`SUM`/`ORDER BY ... LIMIT 1` по индексу `ix_inventory_batches_fefo`, уже
   определённому, §11), не N+1 в смысле «N дополнительных SQL к внешним сервисам».

**SRS-INV-053** [`pg` COPY, `01-TECH-BASELINE.md` — `pg ^8.23.0`] Загрузка нормализованных строк во
временную таблицу — через `pg-copy-streams`/встроенный `COPY ... FROM STDIN (FORMAT binary)` драйвера
`pg`, НЕ через `N` отдельных `INSERT` внутри цикла и НЕ через один гигантский
`INSERT INTO ... VALUES (...), (...), ...` с 1000 групп значений (валиден, но `COPY` на порядок
быстрее для ≥100 строк по эмпирике PostgreSQL) — `CREATE TEMP TABLE stage_inventory_rows (...) ON
COMMIT DROP` в начале транзакции обработки батча, `COPY stage_inventory_rows FROM STDIN`, далее шаги
4-5 выше читают ИЗ этой временной таблицы.

**SRS-INV-054** [Нагрузочный тест] `tests/load/inventory-sync.k6.js` (Charter §3.1 — k6, уже в
стеке) — сценарий: `N` виртуальных «аптек» (валидные API-ключи из seed), каждая отправляет батчи по
1000 строк с интервалом, подобранным для совокупного целевого RPS; ассерты — p95 времени ACK
(`202`, §2.3) `< 300ms` (Charter §7 NFR — тот же порог, что и обычный API), И отдельно — p95 времени
от `received_at` до `completed_at` (полный цикл обработки в очереди) `< INVENTORY_DELTA_SLA_MINUTES ×
60` секунд при целевой нагрузке 500/сек.

---

## 10. Дополнения к схеме БД

> Ни одно из полей `11-database-schema.md` не переопределяется. Ниже — ТОЛЬКО добавления, каждое
> с конкретным техническим обоснованием, почему существующих полей недостаточно.

**1. `inventory_sync_batches`** — добавить:

```sql
ALTER TABLE inventory_sync_batches
    ADD COLUMN full_sync_session_id UUID NULL,
    ADD COLUMN page_number INT NOT NULL DEFAULT 1,
    ADD COLUMN is_last_page BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN source_upload_id UUID NULL, -- группировка N батчей одной Excel-загрузки (§3.2)
    ADD CONSTRAINT chk_sync_batches_session_only_for_full
        CHECK (sync_type = 'full' OR full_sync_session_id IS NULL);

CREATE INDEX ix_inventory_sync_batches_session ON inventory_sync_batches (full_sync_session_id)
    WHERE full_sync_session_id IS NOT NULL;
```

Обоснование: REQ-SYNC-4 требует пагинацию полного снапшота (≤1000 позиций/запрос), но «обнуление
отсутствующих позиций» (REQ-SYNC-3) логически применимо только к ПОЛНОМУ снапшоту целиком, а не к
одной его странице — без группирующего идентификатора и признака последней страницы шаг §7.4
(SRS-INV-041) физически невозможно реализовать корректно.

**2. Новая таблица `inventory_sync_raw_items`**:

```sql
CREATE TABLE inventory_sync_raw_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES inventory_sync_batches(id) ON DELETE CASCADE,
    row_index INT NOT NULL,
    raw_row JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_raw_item_row UNIQUE (batch_id, row_index)
);
COMMENT ON TABLE inventory_sync_raw_items IS
    'Промежуточное хранилище исходного payload батча (REQ-SYNC-12: HTTP-приёмник ACK-ает немедленно,
     тяжёлая обработка асинхронна) — воркер BullMQ перечитывает строки отсюда по batchId вместо того,
     чтобы нести до 5 МБ данных в самом job Redis. Hard-delete по той же TTL-политике, что
     inventory_sync_batches (SRS-DB-004) — не аудиторская таблица.';
```

Обоснование: BullMQ job (SRS-INV-031) намеренно не несёт `items` — при 1000 строк/5 МБ на батч и
`concurrency=10` это раздувает память Redis и усложняет восстановление после падения воркера
посередине обработки (Postgres, не Redis, остаётся единственным источником истины для payload).

**3. `catalog_match_queue`** — добавить:

```sql
ALTER TABLE catalog_match_queue
    ADD COLUMN raw_stock_quantity INT,
    ADD COLUMN raw_expiry_date DATE,
    ADD COLUMN raw_batch_number VARCHAR(100),
    ADD COLUMN source_batch_id UUID REFERENCES inventory_sync_batches(id) ON DELETE SET NULL,
    ADD COLUMN source_sync_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW();
```

Обоснование: существующие колонки (`raw_trade_name`, `raw_dosage_form`, `raw_dosage_strength`,
`raw_manufacturer_name`, `raw_price_tjs`) достаточны для МАТЧИНГА (D-06 шаг 3), но не содержат
данных, необходимых для РЕТРОАКТИВНОГО применения остатка при резолюции очереди (SRS-INV-028) —
`stock_quantity`/`expiry_date`/`batch_number` нужны для вызова `PharmacyInventory.applyDelta()` в
момент, когда `medicine_id` наконец известен; `source_sync_timestamp` обязателен, чтобы staleness-guard
(SRS-DOM-022) продолжал работать даже для отложенного (иногда на дни) применения — иначе резолюция
недельной давности могла бы перезаписать более свежие данные, пришедшие за это время другим путём.

**4. `pharmacy_api_keys`** — сделать `pharmacy_id` необязательным, добавить `chain_id`:

```sql
ALTER TABLE pharmacy_api_keys
    ALTER COLUMN pharmacy_id DROP NOT NULL,
    ADD COLUMN chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE,
    ADD CONSTRAINT chk_pharmacy_api_keys_exactly_one_scope
        CHECK ((pharmacy_id IS NOT NULL AND chain_id IS NULL) OR (pharmacy_id IS NULL AND chain_id IS NOT NULL));
```

Обоснование: REQ-SYNC-18 явно требует возможности привязать ключ/`one_c_endpoint` к целой сети
(центральная 1С-инсталляция сети шлёт данные за все точки одним ключом), не только к одной аптеке —
текущее определение (`pharmacy_id NOT NULL`) исключает этот сценарий. При `chain_id`-скоупе шаг
проверки ключа (SRS-API-033) ДОПОЛНИТЕЛЬНО проверяет: `pharmacies WHERE id = :pharmacy_guid AND
chain_id = :key.chain_id` — `pharmacy_guid` тела запроса (§2.2) обязан принадлежать этой сети, иначе
`403 CROSS_TENANT_ACCESS_DENIED`-подобная ошибка на уровне application (конкретный код —
`PHARMACY_NOT_IN_CHAIN_SCOPE`, добавляется в `ErrorCode` enum рядом с существующими
`PHARMACY_*`-кодами `12-api-conventions-auth-tenancy.md` §2.1).

**5. `inventory_sync_row_error_code`** — добавить значение enum:

```sql
ALTER TYPE inventory_sync_row_error_code ADD VALUE 'processing_failed';
-- отдельная миграция ВНЕ транзакции (SRS-DB-009, ограничение PostgreSQL на ALTER TYPE ADD VALUE)
```

**[ИЗМЕНЕНО]** Этот путь не реализован: `CREATE TYPE inventory_sync_row_error_code` не существует
ни в одной применённой миграции, поэтому и `ALTER TYPE` (миграция `0015b`, DTJ-142 п.5) удалён —
применять его было не к чему. Код ошибки строки живёт в TS-юнионе
`InventorySyncRowError['errorCode']`
(`apps/api/src/modules/inventory/application/ports/inventory-sync-batch.repository.port.ts`);
`'processing_failed'` добавляется туда же, а таблица `inventory_sync_errors` (когда появится с
DTJ-145) должна использовать `VARCHAR` + `CHECK` по конвенции `0012_inventory_foundation.sql`, не
pg ENUM — ограничение PostgreSQL из обоснования ниже как раз и есть причина отказа от enum.

Обоснование: SRS-INV-035 — батч, чей BullMQ job исчерпал все retry из-за инфраструктурного сбоя (не
ошибки данных строки), обязан достичь одного из уже существующих терминальных статусов
(`failed_validation`, SRS-DOM-149/150 — фиксированная state machine, новый статус не добавляется), но
существующие коды `inventory_sync_row_error_code` (`invalid_barcode`, `ambiguous_date_format` и т.д.)
описывают ТОЛЬКО ошибки данных, ни один не подходит семантически для «обработка не завершилась по
причине сбоя воркера» — без этого значения `pharmacy_admin` увидел бы батч с `rejected_rows=0` и
`accepted_rows=0`, но статус `failed_validation` без объяснения причины.

---

## 11. Пограничные случаи и ошибки

**SRS-INV-055 — Дубль батча (сетевой ретрай 1С)** [REQ-SYNC-1, SRS-DOM-168] Given 1С повторяет
`POST /inventory/batch-update` с идентичным `batch_id` (TCP-таймаут на стороне 1С, ответ `202` не
дошёл), When второй запрос обрабатывается, Then `202` с уже известным `status` возвращается
немедленно, бизнес-логика не выполняется повторно, вторая строка `inventory_sync_batches` не создаётся
(SRS-INV-009).

**SRS-INV-056 — Частично невалидный батч** [REQ-SYNC-9] Given батч из 1000 строк, 12 из которых
проваливают матчинг/валидацию (например, 8 `unmatched_medicine`, 3 `invalid_price`, 1
`ambiguous_date_format`), When обработка завершена, Then 988 строк применены к `pharmacy_inventory`
успешно, `status='completed_partial_success'`, `accepted_rows=988`, `rejected_rows=12`, 12 строк
`inventory_sync_errors` с соответствующими `error_code` — ни одна валидная строка не блокируется
из-за соседних невалидных (REQ-SYNC-9 буквально).

**SRS-INV-057 — Аптека без лицензии / приостановлена** [REQ-ONBOARD-15] Given `pharmacies.status =
'suspended'` (например, `license_expired`), When та же аптека продолжает слать батчи (1С не знает о
приостановке — это административное решение DoruTJ, не техническая ошибка на стороне аптеки), Then
`IngestInventoryBatchUseCase` ПРИНИМАЕТ и обрабатывает батч штатно (`InventoryFacade` не проверяет
`onboarding`-статус на этапе ингеста, REQ-ONBOARD-15 буквально) — остатки обновляются в БД, но
`OnboardingFacade.isVisibleInSearch(pharmacyId) === false` скрывает их из поиска/карты на уровне
catalog-запросов; кабинет аптеки видит собственный обновлённый остаток (не UX-заглушку) с баннером
«Аптека приостановлена — обновления не видны покупателям».

**SRS-INV-058 — Ключ отозван** [D-11, SRS-API-034] Given `pharmacy_api_keys.revoked_at <= now()`
(истёк grace-период ротации или явный отзыв), When батч приходит со старым ключом, Then шаг 2
алгоритма §3.6 `12-api-conventions-auth-tenancy.md` (`WHERE key_prefix=:keyId AND revoked_at IS NULL`)
не находит активную строку → `401 PHARMACY_API_KEY_INVALID` — батч НЕ создаётся вовсе (отклонение на
уровне guard, до контроллера, `inventory_sync_batches` строка не появляется, значит и в отчёте §8
этот инцидент не виден аптеке напрямую — только в серверных логах/метриках guard'а, что приемлемо:
компрометированный/отозванный ключ не должен producировать пользовательский сигнал для потенциального
атакующего).

**SRS-INV-059 — Часы клиента 1С сбиты (сильно вперёд/назад)** [D-11, SRS-API-033 шаг 5] Given
`X-Pharmacy-Timestamp` расходится с серверным `now()` больше чем на `PHARMACY_SIGNATURE_WINDOW_SECONDS`
(300с) — например, у аптеки не настроен NTP и локальные часы 1С отстают на 20 минут, When любой батч
отправляется, Then КАЖДЫЙ запрос отклоняется `401 PHARMACY_TIMESTAMP_OUT_OF_WINDOW` ДО того, как
дело доходит до бизнес-логики (транспортный guard) — систематический сбой виден в мониторинге как
рост доли `401` для конкретного `pharmacyId`; операционная рекомендация (не техническое решение) —
`pharmacy_admin` кабинета видит диагностический баннер «Синхронизация не проходит: проверьте
системное время сервера 1С» при обнаружении такого паттерна ошибок за последние `N` попыток (реализуется
как отдельная read-модель на access-логах guard'а, не блокирует эту спецификацию).

**SRS-INV-060 — Конкурентная запись по одному товару** [SRS-INV-033] Given два батча одной аптеки
(например, REST-дельта и ручное редактирование в кабинете ТОЙ ЖЕ позиции) обрабатываются
конкурентно двумя воркерами, When оба пытаются захватить `pg_advisory_xact_lock(hashtext(pharmacyId))`,
Then второй ждёт освобождения первого (не откатывается с ошибкой) — после освобождения он применяет
свои изменения НАД уже применёнными первым, с обычным staleness-guard по `sync_timestamp`; если оба
батча несут РАЗНЫЙ `sync_timestamp` для одного и того же `internal_sku`, побеждает тот, чей
`sync_timestamp` позже, независимо от порядка физического исполнения (детерминированный исход гонки).

**SRS-INV-061 — Batch с `sync_type='full'`, но `is_last_page` так и не пришла** [REQ-SYNC-3] Given
1С заявила многостраничный full-снапшот (`full_sync_session_id=X`, 5 страниц ожидается по её внутренней
логике), но 5-я страница (`is_last_page=true`) не приходит вовсе (сбой сети/сети 1С), When проходит
`FULL_SYNC_SESSION_TIMEOUT_MINUTES` (ASSUMPTION `60`, ENV) с момента получения ПОСЛЕДНЕЙ полученной
страницы этой сессии, Then фоновая job (`apps/worker`, cron каждые 10 минут) помечает сессию
«зависшей» — зануление отсутствующих позиций (§7.4) НЕ выполняется вовсе (данные о том, какие позиции
реально пропали, неполны — лучше НЕ обнулять по неполным данным, чем ошибочно занулить существующий
товар), алерт `pharmacy_admin`+on-call «Полная синхронизация не завершена, обнуление отсутствующих
позиций пропущено» — уже полученные страницы (1-4) свои строки применили штатно, только шаг
зануления отменяется для этой конкретной сессии.

**SRS-INV-062 — Отсутствие сети у сервера DoruTJ в момент, когда 1С шлёт батч** [Charter §7
отказоустойчивость] Given API временно недоступен (деплой/инцидент), When 1С получает `5xx`/таймаут
соединения на `POST /inventory/batch-update`, Then ответственность за ретрай — на стороне 1С
(стандартная практика интеграций push-типа, вне контроля DoruTJ) — сервер со своей стороны гарантирует
только то, что ЛЮБОЙ успешно принятый (`202`) батч будет обработан (транзакционный outbox, SRS-INV-030);
недоставленные во время простоя батчи 1С обязана повторить (тот же `batch_id`, обрабатывается как
SRS-INV-055) — рекомендация для документации интеграции 1С (не код): экспоненциальный ретрай на
стороне 1С-конфигурации, до 24 часов.

---

## 12. Тестовые сценарии

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| TC-INV-001 | SRS-INV-009/SRS-DOM-168 | Батч `batch_id=X` уже `completed_partial_success` | Повторный `POST` с тем же `batch_id`, чуть другой порядок полей JSON | `202` с сохранённым статусом, вторая строка `inventory_sync_batches` не создана |
| TC-INV-002 | SRS-INV-003 | Тело запроса 6 МБ | `POST /inventory/batch-update` | `413 PAYLOAD_TOO_LARGE` до полного парсинга JSON |
| TC-INV-003 | SRS-INV-003 | `items.length = 1001` | `POST` | `400 VALIDATION_ERROR`, `details.field='items'` |
| TC-INV-004 | SRS-INV-005 | `sync_type='delta'`, `full_sync_session_id` передан | `POST` | `400 VALIDATION_ERROR`, `details.field='full_sync_session_id'` |
| TC-INV-005 | SRS-INV-006 | Строка без `batch_number` | Обработка | `inventory_batches.batch_number = 'AUTO-{internal_sku}'` |
| TC-INV-006 | SRS-INV-013 | Ячейка `Срок годности` = `15/03/2028` (неоднозначный формат) | Импорт Excel | Строка отклонена `error_code='ambiguous_date_format'`, остальные строки файла обработаны |
| TC-INV-007 | SRS-INV-015 | Ручной ввод, медикамент выбран автокомплитом | `POST` через кабинет | Composite-матчинг НЕ вызывается (`resolved: true` напрямую) |
| TC-INV-008 | SRS-INV-020/SRS-DOM-075 | `barcode='2001234567890'` (префикс `2`), совпадает с чужим `medicines.barcode` внутреннего кода другой сети | Матчинг | Штрихкод НЕ используется как ключ — переход к `internal_sku`/fuzzy, ложный кросс-сетевой матч не происходит |
| TC-INV-009 | SRS-INV-021 п.1 | `pharmacy_sku_mapping` уже содержит `(pharmacyId, 'SKU-042') → medicineId=M1` | Батч с той же парой, но другим `trade_name` (переименован в 1С) | `medicineId=M1` берётся из кэша, fuzzy НЕ выполняется, несмотря на изменившееся название |
| TC-INV-010 | SRS-INV-024/SRS-DB-018 | `raw_trade_name='Цитрамон П'`, ближайший кандидат `similarity=0.28` | Fuzzy-матчинг | Ниже порога `0.35` → нет кандидата, строка в `catalog_match_queue` |
| TC-INV-011 | SRS-INV-025 | Кандидат с `combined_score=0.9`, но `dosage_strength` не эквивалентна (`Dosage.isEquivalentTo()=false`) | Фильтр после ранжирования | Кандидат отброшен несмотря на высокий текстовый score |
| TC-INV-012 | SRS-INV-026 | Топ-1 `score=0.40`, топ-2 `score=0.38` (разница `0.02 < 0.05`) | Резолюция | Матч признан неоднозначным → `catalog_match_queue`, авто-выбор НЕ происходит |
| TC-INV-013 | SRS-INV-027 | Тот же несопоставленный `(pharmacyId, internalSku)` приходит повторно в следующей дельте | Обработка | Существующая запись `catalog_match_queue` обновляется (`raw_price_tjs` и т.д.), вторая запись НЕ создаётся |
| TC-INV-014 | SRS-INV-028 | Оператор резолвит `catalog_match_queue` как `matched` | `ResolveCatalogMatchQueueItemUseCase` | Отложенный `stock_quantity`/`expiry_date`/`batch_number` применяются к `pharmacy_inventory` тем же путём, что обычная строка батча |
| TC-INV-015 | SRS-INV-032 | Job с `jobId=batchId` уже в очереди (не завершён) | `OutboxRelayWorker` публикует повторно (at-least-once) | BullMQ отклоняет вторую постановку — job не дублируется |
| TC-INV-016 | SRS-INV-033 | Два батча одной аптеки обрабатываются параллельно двумя воркерами | Оба пытаются взять `pg_advisory_xact_lock` | Второй блокируется до завершения первого — нет параллельной записи по одной аптеке |
| TC-INV-017 | SRS-INV-034 | В очереди одновременно: 1 delta REST-job, 1 ночная full-job | Воркер выбирает следующий job | Delta-job (priority=1) обрабатывается раньше full-job (priority=10) |
| TC-INV-018 | SRS-INV-035 | Job падает 5 раз подряд (симулированное исключение инфраструктуры) | BullMQ `failed`-событие после 5-й попытки | `status='failed_validation'`, `inventory_sync_errors` содержит `error_code='processing_failed'`, батч не завис в `processing` |
| TC-INV-019 | SRS-INV-036/SRS-DOM-022 | Job B (новый `sync_timestamp`) обработан ФИЗИЧЕСКИ раньше job A (старый `sync_timestamp`, доставлен с задержкой) | Job A обрабатывается ПОСЛЕ job B | Job A помечает свои строки `skipped_stale`, не перезаписывает данные job B |
| TC-INV-020 | SRS-INV-041 | Full-снапшот, `internal_sku='SKU-777'` отсутствует ни на одной из его страниц | `is_last_page=true` завершает обработку | Партия `SKU-777` получает `quantity=0`, строка не удалена физически |
| TC-INV-021 | SRS-INV-042 | Full-снапшот `sync_timestamp=03:00:00`; отдельная REST-дельта того же SKU с `sync_timestamp=03:02:00` применена РАНЬШЕ шага зануления | Шаг зануления full-синхронизации выполняется | Партия с `last_synced_at=03:02:00` НЕ обнуляется (условие `ib.last_synced_at < :fullSyncTimestamp` её исключает) |
| TC-INV-022 | SRS-INV-048/049 | `last_synced_at` старше `INVENTORY_DELTA_SLA_MINUTES` для REST-аптеки | Отображение в поиске | Позиция видна с пометкой устаревания, не скрыта; ранг понижен множителем `0.5` при превышении `INVENTORY_MANUAL_STALE_HOURS` |
| TC-INV-023 | SRS-INV-057/REQ-ONBOARD-15 | `pharmacies.status='suspended'` | Батч 1С продолжает приходить | Батч обработан штатно (остаток обновлён в БД), но не виден в публичном поиске |
| TC-INV-024 | SRS-INV-058 | `pharmacy_api_keys.revoked_at` в прошлом | `POST /inventory/batch-update` со старым ключом | `401 PHARMACY_API_KEY_INVALID`, батч не создан |
| TC-INV-025 | SRS-INV-059 | `X-Pharmacy-Timestamp` расходится с сервером на 20 минут | `POST` | `401 PHARMACY_TIMESTAMP_OUT_OF_WINDOW` на каждом запросе аптеки, пока часы не синхронизированы |
| TC-INV-026 | SRS-INV-061 | Full-сессия из 5 ожидаемых страниц, 5-я не пришла за `FULL_SYNC_SESSION_TIMEOUT_MINUTES` | Фоновая проверка зависших сессий | Сессия помечена «зависшей», зануление НЕ выполняется, страницы 1-4 остаются применёнными, алерт создан |
| TC-INV-027 | «Дополнения к схеме БД» п.4 (REQ-SYNC-18) | `pharmacy_api_keys.chain_id` заполнен (ключ сети), запрос с `pharmacy_guid`, НЕ принадлежащим этой сети | `POST` | Отклонено (`PHARMACY_NOT_IN_CHAIN_SCOPE`), батч не создан |
| TC-INV-028 | SRS-INV-052/053 | Батч из 1000 строк | Обработка воркером | Число SQL-запросов к БД константно (не растёт линейно с числом строк) — проверяется через `EXPLAIN`/счётчик запросов в интеграционном тесте |
| TC-INV-029 | SRS-INV-054 (k6) | 500 виртуальных item-events/сек устойчиво в течение 5 минут | Нагрузочный прогон | p95 `202`-ACK `< 300мс`; p95 время до `completed_*` `< INVENTORY_DELTA_SLA_MINUTES × 60` сек |
| TC-INV-030 | SRS-INV-018 | XML CommerceML не проходит XSD-валидацию | Загрузка через `[R2]` парсер | `400 VALIDATION_ERROR`, батч не создаётся вовсе (ошибка раньше уровня строк) |

---

**Итог**: документ вводит **62 требования `SRS-INV-001..062`** и **30 тестовых сценариев
`TC-INV-001..030`**, специфицирующих модуль синхронизации остатков полностью на основе `10-domain-model.md`
(`PharmacyInventory`/`InventorySyncBatch` уже определены там, не переопределяются), `11-database-schema.md`
(5 точечных дополнений к схеме, каждое обосновано) и `12-api-conventions-auth-tenancy.md` (аутентификация
1С переиспользуется буквально, не дублируется). Все каналы ingestion (REST/Excel/ручной ввод/CommerceML)
и вся архитектурная основа (очередь, матчинг, версионность) — **[R1]**, единственная часть, отложенная
до **[R2]** — реальный XML-парсер CommerceML 2.05 и обязательный mTLS для конкретных крупных сетей
(`04-SCOPE-DECISION-PIVOT.md` §4).
