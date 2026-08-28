# DoruTJ — Модуль 24: Терминал фармацевта (Flutter, Android-планшет)

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `04-SCOPE-DECISION-PIVOT.md` > `03-ARCHITECT-DECISIONS.md` (D-*)
> > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> **ЗАКОН, не переоткрывается**: `docs/spec/10-domain-model.md` (сущности, VO, state machines, домен-ошибки),
> `docs/spec/11-database-schema.md` (таблицы, ENUM'ы, констрейнты), `docs/spec/12-api-conventions-auth-tenancy.md`
> (envelope, пагинация, идемпотентность, RBAC, WS-канал, коды ошибок). Этот документ **ссылается** на них
> и **дополняет** только там, где терминал фармацевта требует элемента, отсутствующего в перечисленных
> документах — каждое такое дополнение помечено `[РАСШИРЕНИЕ]` и вынесено в «## Дополнения к схеме БД».
>
> Покрывает: **CUJ-3** (Charter §6), **МОДУЛЬ 5 tz.log** («Мобильный модуль фармацевта / Pharmacy Tablet
> Terminal», tz.log строки 301-307), а также use cases, разделяемые с веб-кабинетом аптеки (R1-9,
> `04-SCOPE-DECISION-PIVOT.md` §3.1).
>
> Идентификаторы требований: **SRS-PHT-nnn**. Тестовые сценарии: **TC-PHT-nnn**. Каждое требование несёт
> метку релиза **[R1]**/**[R2]**/**[R3]** (см. «## Разбиение по релизам») и ссылку на источник.

---

## Глоссарий модуля

| Термин | Определение |
|---|---|
| Терминал фармацевта | Клиентское приложение сборки заказов аптеки. В R1 — веб-кабинет аптеки (`apps/admin`/выделенный раздел, React); в R2 — нативное Flutter-приложение `apps/pharmacy_mobile` на Android-планшете. Оба клиента говорят с ОДНИМ API-контрактом, описанным в части A. |
| Приёмка заказа (claim/accept) | Действие фармацевта, переводящее `order.status: paid_escrow → processing` (SRS-DOM-091) и мягко закрепляющее заказ за конкретным исполнителем на терминале (SRS-PHT-006, `[РАСШИРЕНИЕ]`, не путать с RBAC-скоупом `pharmacy`, который остаётся источником правды для авторизации). |
| Сборка (picking) | Процесс сканирования позиций заказа и подтверждения их наличия/соответствия перед упаковкой в сейф-пакет. |
| Частичная сборка | Ситуация, когда ≥1 позиция заказа не может быть укомплектована как заказано (нет в наличии, испорчена, истёк срок) — требует подтверждения клиентом изменённого состава и пересчёта суммы (D-10). |
| OTP вручения | 4-значный `OtpCode(purpose='delivery_handover')` (SRS-DOM-080), генерируется при завершении сборки; проверяется КУРЬЕРОМ при доставке клиенту (SRS-DOM-095) — терминал фармацевта только генерирует/показывает/регенерирует его, никогда не проверяет. |
| Сейф-пакет | Физическая упаковка с индикатором вскрытия, в которую опечатывается собранный заказ перед передачей курьеру (tz.log Модуль 5, упомянуто в SRS-DOM-094 «сейф-пакет опечатан»). Подтверждение опечатывания — булев флаг в запросе завершения сборки (SRS-PHT-024), физическая проверка не автоматизируется. |

---

## Разбиение по релизам

| Слой / возможность | Релиз | Обоснование (`04-SCOPE-DECISION-PIVOT.md`) |
|---|---|---|
| **Доменная state machine заказа, SLA-поля, OTP VO, барcode VO, ledger** (уже определены в `10-domain-model.md`) | **[R1]** (уже сдано) | Ядро, разделяемое ВСЕМИ клиентами сборки. |
| **API-контракт терминала** (Часть A целиком: эндпоинты приёма/сканирования/частичной сборки/передачи курьеру, WS-события, SLA-watchdog, RBAC-расширения, домен-расширения `order_items.fulfillment_status` и партийная замена) | **[R1]** | §2.2 пивота: «архитектура (слои, порты, tenant-скоуп, ledger) закладывается сразу и целиком — ретрофит дороже». Этот API — ЕДИНСТВЕННЫЙ способ сборки заказа в R1 (через веб-кабинет аптеки, R1-9), поэтому обязан существовать полностью, ещё до появления Flutter-клиента. |
| **Веб-реализация сборки** (`apps/admin`, раздел «Сборка заказов» аптеки) — тонкий клиент того же API-контракта части A | **[R1]** | R1-9: «Кабинет аптеки... входящие заказы, сборка, статусы... Заменяет Flutter-терминал в R1». Реализация UI на React — вне этого документа (см. отдельный документ веб-кабинета аптеки), но ОБЯЗАНА использовать ТЕ ЖЕ эндпоинты части A без изменений контракта (Charter §3.6). |
| **Flutter-реализация терминала** (`apps/pharmacy_mobile`, Часть B целиком: экраны, Cubit, `mobile_scanner`, офлайн-очередь `drift`, звук, wake lock, многопользовательский режим на планшете) | **[R2]** | `04-SCOPE-DECISION-PIVOT.md` R2-1: «Flutter-терминал фармацевта: Android-планшет, сканер штрихкодов, звуковое оповещение, SLA-таймер, выдача OTP курьеру». Блокер — не внешняя зависимость, а последовательность релизов: R1 проверяет продуктовую гипотезу дешёвым способом (веб), R2 добавляет специализированный планшетный UX **без единой правки backend** (Charter §3.6, «следствие для планирования»). |
| Реальная интеграция сканера с промышленным сканером-кольцом / Bluetooth HID (если понадобится сверх камеры) | **[R3]**, по факту запроса пилотных аптек | Не входит ни в один явный пункт R1/R2 пивота; открывается только при подтверждённом спросе (аналогично принципу §2.2 пивота — не строим неподтверждённый спрос). |

**Следствие для разработки**: тикеты части A открываются и сдаются В R1, до начала работы над частью B.
Часть B — чистая презентационная надстройка (Charter §3.6 п.1: «ноль бизнес-логики в клиенте»), которая
физически не может начаться раньше, чем часть A прошла `pnpm verify` и используется веб-кабинетом.

---

## 1. Область действия, слои и участники

**SRS-PHT-001** [Charter §3.6, `02` §1] Модуль реализуется в существующих backend-контекстах
`apps/api/src/modules/orders` (основной), `modules/inventory` (замена партии при сканировании),
`modules/delivery` (чтение статуса `DeliveryAssignment`, активируемого автоматически) — **новый backend-
модуль `pharmacy-terminal` не создаётся**: терминал — это presentation-поверхность (иной набор DTO/
эндпоинтов) над уже существующими use cases контекста `orders`, а не отдельный ограниченный контекст.
**[R1]**

**SRS-PHT-002** Слои (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1):

| Элемент | Слой | Модуль |
|---|---|---|
| `Order`, `OrderItem`, `PharmacyInventory`, `InventoryBatch`, `Barcode`, `ExpiryDate`, `OtpCode` — уже определены | `domain` | `orders`, `inventory` |
| `OrderItemFulfillmentStatus` (VO, `[РАСШИРЕНИЕ]`, см. §A.4) | `domain` | `orders` |
| `AcceptOrderUseCase`, `ScanOrderItemUseCase`, `ReportItemIssueUseCase`, `ProposePartialFulfillmentUseCase`, `ResolvePartialFulfillmentUseCase`, `CompletePickingUseCase`, `RegenerateHandoverOtpUseCase`, `ClaimOrderUseCase` | `application` | `orders` |
| `SlaWatchdogProcessor` (BullMQ, следит за `sla_deadline_at`) | `application`+`infrastructure` (job-обработчик) | `orders` (worker-процесс) |
| Drizzle-репозитории `OrdersRepository`, `OrderItemsRepository`, `InventoryBatchesRepository` | `infrastructure` | `orders`, `inventory` |
| `PharmacyTerminalController` (REST), `RealtimeGateway` (WS, уже существует, расширяется комнатой `pharmacy:{id}`) | `presentation` | `orders` |
| `apps/pharmacy_mobile` (Flutter) | внешний клиент (только presentation своего собственного приложения, обращается к тому же `presentation`-контракту API) | — |

**SRS-PHT-003** [Charter §3.6] Ни один расчёт (сумма, комиссия, допустимость истёкшего срока, переход
статуса, генерация/проверка OTP) не выполняется в `apps/pharmacy_mobile`. Клиент отправляет команды и
отображает состояние, полученное от сервера — идентично требованию к веб-кабинету. **[R1] (правило) / [R2] (соблюдение в реализации)**

**SRS-PHT-004** Роли, использующие модуль (RBAC-матрица `12-api-conventions...md` §4.1, дополняется §A.11
этого документа): `pharmacist` (основной оператор), `pharmacy_admin` (тот же набор действий в пределах
своей сети + просмотр очереди всех точек, `orders:read:pharmacy` уже допускает это), `super_admin`
(наблюдение через `platform:ops`, без права сканировать/завершать сборку чужой аптеки). **[R1]**

---

# Часть A — API-контракт (не зависит от клиента) [R1]

> Единственный контракт — REST/JSON (`packages/contracts`, Zod) + WS `/api/v1/realtime` (Charter §3.6 п.2/4).
> Все временные метки — ISO 8601 UTC (`12-api-conventions...md` §1.3). Все суммы — `Money`, дирамы, на
> границе `infrastructure` (`10-domain-model.md`, денежная конвенция). Формат ответа — envelope
> `{ data, meta? }` / `{ error }` (`12-api-conventions...md` §2).

## A.1 Очередь заказов терминала

**SRS-PHT-005** `GET /api/v1/orders?filter[pharmacyId]=<id>&filter[status][in]=paid_escrow,processing&sort=priority:asc&cursor=...&limit=20`
— список заказов аптеки, доступных для сборки. `sort=priority` — специальное значение (не поле БД
напрямую), резолвится сервером в `application` в:

1. Заказы `status='processing'` — по `sla_deadline_at ASC NULLS LAST` (ближе к просрочке — выше).
2. Заказы `status='paid_escrow'` (ещё не приняты) — по `created_at ASC` (FIFO), ПОСЛЕ группы 1.

`[РАСШИРЕНИЕ, ASSUMPTION]` Приоритет по типу товара (Rx выше ОТС и т.п.) НЕ вводится — данных,
обосновывающих такую сортировку, нет (`04-SCOPE-DECISION-PIVOT.md` §2.2: не строим то, что не подтверждено).
Единственный параметр приоритета — оставшееся время до нарушения SLA. **[R1]**

Given `pharmacy_admin` вызывает тот же эндпоинт без `filter[pharmacyId]`, When у него ≥2 точки в сети,
Then возвращаются заказы ВСЕХ точек сети, сгруппированные по `pharmacyId` в `meta.groupedBy` (не отдельный
эндпоинт — общий список с доп. метаданными для агрегированного вида в `pharmacy_admin` UI). **SRS-PHT-005a** **[R1]**

**SRS-PHT-006** Ответ включает на каждой позиции: `id, orderNumber, status, itemsCount, itemsTotalTjs,
paymentMethod, prescriptionRequired, slaDeadlineAt (nullable), assignedPharmacistId (nullable, [РАСШИРЕНИЕ]),
assignedPharmacistName (nullable), createdAt`. Поле `assignedPharmacistId` заполнено только для
`status='processing'` — используется клиентом для показа «в работе у Фарзоны М.» и блокировки повторного
приёма (§A.3). **[R1]**

## A.2 Принятие заказа в работу и блокировка (claim)

**SRS-PHT-007** `POST /api/v1/orders/:id/accept` — вызывает `AcceptOrderUseCase`, который: (1) проверяет
`OrdersPolicy.canAccept(actor, order)` — `actor.pharmacyId === order.pharmacyId` И `order.status='paid_escrow'`
(та же проверка, что и в домене SRS-DOM-091); (2) атомарно (транзакция БД, `SELECT ... FOR UPDATE` на
строку `orders`) переводит `order.startProcessing(actor.userId)`; (3) `[РАСШИРЕНИЕ]` записывает
`orders.assigned_pharmacist_id = actor.userId`; (4) публикует `OrderProcessingStartedEvent` (существующее,
несёт `slaDeadlineAt`) И `OrderClaimedEvent` (`[РАСШИРЕНИЕ]`, см. §A.9). Заголовок `Idempotency-Key`
ОБЯЗАТЕЛЕН (`[РАСШИРЕНИЕ]` к таблице SRS-API-009 — двойной тап «Принять» на планшете не должен создавать
двух параллельных попыток блокировки). **[R1]**

Given заказ `status='paid_escrow'`, `assigned_pharmacist_id IS NULL`, When фармацевт A вызывает `accept`,
Then `200 OK`, `data.slaDeadlineAt = now + pickup_sla_minutes` (из `tenant_settings`, дефолт 7 минут,
D-19), `data.assignedPharmacistId = A.id`. **SRS-PHT-008** **[R1]**

Given тот же заказ, When фармацевт B (тот же `pharmacy_id`) вызывает `accept` ПОСЛЕ того, как A уже
получил `200 OK` (SELECT FOR UPDATE сериализует конкурентные транзакции), Then B получает `409 CONFLICT`
с кодом `ORDER_ALREADY_CLAIMED` (`[РАСШИРЕНИЕ]` домен-ошибка `OrderAlreadyClaimedError`) и телом
`details: { assignedPharmacistId, assignedPharmacistName, claimedAt }`. **SRS-PHT-009** **[R1]**

**SRS-PHT-010** `[РАСШИРЕНИЕ]` «Перехват» заказа у коллеги (например, A отошёл от терминала посреди
сборки): `POST /api/v1/orders/:id/reclaim` — доступен ЛЮБОМУ `pharmacist` той же аптеки (RBAC-скоуп
`pharmacy`, не `owner` — соответствует `12-api-conventions...md` §4.1, где `orders:mark-picked-up` уже
скоупится на `pharmacy`, а не на конкретного сотрудника: значит физическая передача заказа между
сотрудниками ОДНОЙ аптеки — штатная ситуация, не требующая эскалации). Требует явного тела
`{ reason: 'colleague_unavailable' | 'shift_change' | 'other', note?: string }`. Обновляет только
`assigned_pharmacist_id`, НЕ трогает `sla_deadline_at` (таймер общий для аптеки, не для сотрудника) и НЕ
сбрасывает прогресс сканирования позиций. Публикует `OrderReclaimedEvent` (`[РАСШИРЕНИЕ]`). **[R1]**

## A.3 Сканирование и валидация позиции

**SRS-PHT-011** `POST /api/v1/orders/:id/items/:itemId/scan`, тело:
```json
{ "rawBarcode": "4601964000125", "manualEntry": false, "scannedBatchNumber": "L2409A", "scannedExpiryDate": "2027-03-01" }
```
`scannedBatchNumber`/`scannedExpiryDate` — опциональны (не все коробки читаются камерой на батч/срок,
часто это отдельная гравировка на упаковке без штрихкода) — если отсутствуют, валидация партии
пропускается и используется ИЗНАЧАЛЬНО зарезервированная по FEFO партия (`order_items.inventory_batch_id`)
без замены (см. SRS-PHT-014). `manualEntry: true` — фармацевт ввёл код вручную с клавиатуры (камера не
считала/сломана/грязный штрихкод) — тот же пайплайн валидации, дополнительно пишет
`order_items.scan_method='manual'` в аудит. `Idempotency-Key` обязателен. **[R1]**

**Пайплайн валидации** (`application/ScanOrderItemUseCase`, вызывает `domain`-сервисы, ничего не решает
сам — только оркестрирует):

1. `Barcode.parse(rawBarcode)` (существующий VO, SRS-DOM-074..076). Невалидная длина/контрольная
   цифра EAN-13, но `format='non_ean13'` — не ошибка, обрабатывается как `internal_sku` (как при
   входящей синхронизации, D-06).
2. `CatalogFacade.resolveMedicineByComposite(barcode, ...)` (существующий публичный метод фасада,
   SRS-DOM module boundaries) — резолвит `medicine_id`.
3. Given `resolvedMedicineId !== orderItem.medicineId`, Then `404 ORDER_ITEM_NOT_FOUND`
   (`[РАСШИРЕНИЕ]` `ItemNotInOrderError` — отсканирована коробка ДРУГОГО препарата, не входящего в эту
   позицию заказа). Позиция НЕ помечается как проблемная автоматически — фармацевт должен либо
   отсканировать верную коробку, либо явно вызвать `report-issue` (§A.4), если верной коробки физически
   нет. **SRS-PHT-012** **[R1]**
4. Given `orderItem.fulfillmentStatus !== 'pending'` (уже отсканирована или помечена unavailable), Then
   `409 ITEM_ALREADY_SCANNED` (`[РАСШИРЕНИЕ]` `ItemAlreadyScannedError`) — повторное сканирование той же
   позиции без явной отмены запрещено (защита от двойного списания партии при дребезге камеры).
   **SRS-PHT-013** **[R1]**
5. **Проверка партии.** Если `scannedBatchNumber` присутствует И отличается от партии, зарезервированной
   в `orderItem.inventoryBatchId`: вызывается `InventoryFacade` — `releaseReservation(oldBatchId, qty)` +
   `reserveForOrder(newBatchId, qty)` (существующие методы `PharmacyInventory`, SRS-DOM module methods),
   ТОЛЬКО если `newBatch.pharmacyInventoryId === orderItem.pharmacyInventoryId` (тот же товар, та же
   аптека) И `newBatch.expiryDate.isSellable(today) === true` (SRS-DOM-087, буфер 0 — ЖЁСТКОЕ правило,
   `[РАСШИРЕНИЕ] минимальный ненулевой буфер здесь НЕ применяется`, в отличие от возврата REQ-RET-3,
   который использует отдельный `hasMinimumRemainingShelfLife(30 дней)` — это ДРУГОЕ правило для ДРУГОГО
   сценария, не переносится сюда). Given партия просрочена, Then `422 EXPIRED_STOCK`
   (существующий `ExpiredStockError`, SRS-DOM-006/021) — позиция НЕ помечается scanned, фармацевт обязан
   либо найти другую партию, либо вызвать `report-issue`. Given в новой партии физически недостаточно
   `quantity` для `orderItem.quantity`, Then `422 BATCH_NOT_AVAILABLE` (`[РАСШИРЕНИЕ]`
   `BatchNotAvailableForSubstitutionError`). **SRS-PHT-014** **[R1]**
6. Успех: `orderItem.fulfillmentStatus = 'scanned_ok'`, `scannedBatchId`, `scannedAt = ClockPort.now()`,
   `scannedBy = actor.userId` (`[РАСШИРЕНИЕ]` поля, см. «Дополнения к схеме БД»). Ответ `200 OK` с
   обновлённой позицией. **SRS-PHT-015** **[R1]**

**SRS-PHT-016** Ручной ввод (fallback) — НЕ отдельный эндпоинт, а `manualEntry: true` в том же запросе
(DRY, `02` C15) — идентичный пайплайн валидации A.3 п.1-6, разница только в аудит-поле `scan_method`.
Клавиатурный ввод обязан пройти ТОТ ЖЕ `Barcode.parse()`, что и камера — нет отдельного, более мягкого
пути валидации для ручного ввода. **[R1]**

## A.4 Позиция физически недоступна — сообщение о проблеме

**SRS-PHT-017** `POST /api/v1/orders/:id/items/:itemId/report-issue`, тело:
```json
{ "reason": "out_of_stock" | "expired_on_shelf" | "damaged_packaging", "note": "необязательный комментарий" }
```
`Idempotency-Key` обязателен. Требует `orderItem.fulfillmentStatus === 'pending'` (нельзя пожаловаться на
уже отсканированную позицию — сначала эквивалент «отмены скана» через `super_admin`/`support_agent`,
вне терминала). Результат: `orderItem.fulfillmentStatus = 'unavailable'`, `itemIssueReason = reason`
(`[РАСШИРЕНИЕ]` поля). Если `reason='out_of_stock'` — дополнительно вызывается
`inventory.reconcileZeroStock(medicineId, batchId)` (существующий тип операции восстановления учёта,
инфраструктурный побочный эффект — расхождение между `stock_quantity` и физическим наличием уходит в
`inventory_sync_errors`-подобный лог для последующей ручной сверки аптекой, не блокирует ответ). **SRS-PHT-018** **[R1]**

**SRS-PHT-019** Given ≥1 позиция заказа помечена `unavailable` И фармацевт вызывает
`POST /api/v1/orders/:id/propose-partial-fulfillment` (следующий явный шаг — не автоматический, чтобы
фармацевт мог сначала попробовать найти замену партии), When все ОСТАЛЬНЫЕ позиции либо `scanned_ok`,
либо тоже `unavailable` (т.е. решение по каждой позиции принято), Then создаётся запись
`order_partial_fulfillment_requests` (`[РАСШИРЕНИЕ]`, см. схему) со `status='awaiting_customer'`,
`itemsSnapshot` (JSON: для каждой `unavailable`-позиции — `medicineName, quantity, reason`),
`itemsTotalBeforeDiram`, `itemsTotalAfterDiram` (пересчитан БЕЗ unavailable-позиций,
`Order.recalculateTotals()` — существующий метод), `refundAmountDiram = before - after`,
`expiresAt = now + partial_fulfillment_confirmation_timeout_minutes` (`[РАСШИРЕНИЕ]` в `tenant_settings`,
ASSUMPTION 10 минут). Публикуется `PartialFulfillmentProposedEvent` → WS `order.partial_fulfillment_proposed`
в комнату `customer:{customerId}` (клиенту показывается экран подтверждения — реализация вне этого
документа, относится к Customer Web App). Given найдена ≥1 позиция БЕЗ решения (`fulfillmentStatus='pending'`),
Then `422 BUSINESS_RULE_VIOLATION` (деталь `unresolvedItemIds`) — нельзя предложить частичную сборку,
пока не досканированы/не помечены все позиции. **SRS-PHT-020** **[R1]**

**SRS-PHT-021** Given `order_partial_fulfillment_requests.status='awaiting_customer'`, When клиент
подтверждает (эндпоинт клиентского приложения, вне scope этого документа, но домен-эффект специфицируется
здесь как источник правды): `ResolvePartialFulfillmentUseCase(confirmed=true)` — (1) статус запроса →
`confirmed`; (2) `Order.recalculateTotals()` фиксирует новый `items_total_tjs`; (3)
`EscrowLedger` — частичный рефанд разницы по стратегии **SRS-DOM-162** (D-10): если
`PaymentProvider.capabilities().supportsPartialRefund === false` (MVP-дефолт) И заказ оформлен с
раздельным биллингом — рефанд транзакции `items_total`; иначе — полный `refund()` +
`escrow_ledger.entry_type='adjustment'` на недополученную сумму (тот же путь, что и для дисптутов,
переиспользуется без дублирования кода); (4) `unavailable`-позиции физически исключаются из
дальнейшей проверки в §A.5 (не блокируют `complete-picking`); (5) событие
`PartialFulfillmentConfirmedEvent` → WS `order.partial_fulfillment_resolved` в `pharmacy:{pharmacyId}`
(разблокирует кнопку «Завершить сборку» на терминале, если она была заблокирована ожиданием, §A.5).
**SRS-PHT-022** **[R1]**

**SRS-PHT-023** Given клиент ОТКАЗЫВАЕТСЯ от изменённого состава (`confirmed=false`), Then весь заказ
переводится через существующий путь `order.cancel('customer_rejected_partial_fulfillment', customer)`
(SRS-DOM-093, полный рефанд, восстановление резерва ВСЕХ ещё зарезервированных позиций) — частичный
заказ без согласия клиента не существует. Given клиент НЕ отвечает до `expiresAt`
(`[РАСШИРЕНИЕ]`, ASSUMPTION-поведение по умолчанию — см. обоснование ниже), Then срабатывает
`PartialFulfillmentAutoConfirmedEvent`: система трактует молчание как согласие (`auto_confirmed_timeout`)
и выполняет тот же путь, что и явное подтверждение (SRS-PHT-022) — **не** отмену. Обоснование
(ASSUMPTION, подлежит валидации на реальных данных R1-15): блокировка сборки на неопределённый срок
удерживает SLA и физический товар в сейф-пакете дольше, а частичный возврат денег — обратимое,
беспроигрышное для клиента действие (получает меньше товара, но и меньше платит); отмена всего заказа
из-за недоступности одной позиции хуже для конверсии. **SRS-PHT-023a** **[R1]**

## A.5 Завершение сборки и передача курьеру

**SRS-PHT-024** `POST /api/v1/orders/:id/complete-picking`, тело `{ "sealConfirmed": true }`.
`Idempotency-Key` обязателен. Given `sealConfirmed !== true`, Then `400 SEAL_CONFIRMATION_REQUIRED`
(`[РАСШИРЕНИЕ]`) — физическая опечатка не проверяется автоматически, но явное подтверждение обязательно
как контрольная точка ответственности фармацевта (аудит-запись содержит `actor.userId` + `sealConfirmed`).
**SRS-PHT-025** **[R1]**

**SRS-PHT-026** Предусловия `CompletePickingUseCase` (проверяются ДО вызова `order.markPickedUp()`):

1. Все `order_items.fulfillmentStatus ∈ {'scanned_ok', 'unavailable'}` (ни одной `'pending'`) —
   иначе `422 BUSINESS_RULE_VIOLATION` (деталь `unresolvedItemIds`).
2. Given ≥1 позиция `'unavailable'`, ОБЯЗАН существовать `order_partial_fulfillment_requests` с
   `status ∈ {'confirmed', 'auto_confirmed_timeout'}` для ЭТОГО заказа — иначе `409
   PARTIAL_FULFILLMENT_PENDING` (`[РАСШИРЕНИЕ]` `PendingCustomerConfirmationError`): нельзя завершить
   сборку, пока клиент (или таймаут) не подтвердил изменённый состав.
3. Ни одна выбранная партия не просрочена НА МОМЕНТ вызова (повторная проверка `ExpiredStockError`,
   SRS-DOM-006 — защита от гонки «отсканировали корректно, но партия истекла за минуты ожидания
   подтверждения клиента»).

**SRS-PHT-027** Успех: вызывается `order.markPickedUp(handoverOtp)` (SRS-DOM-094) — генерация OTP
ЧЕРЕЗ `OtpGeneratorPort` (уже определённый порт, SRS-DOM-081, НЕ `Math.random()` в клиенте или домене),
`DeliveryAssignment` активируется (существующий побочный эффект), событие `OrderPickedUpEvent`.
Ответ `200 OK`: `{ data: { orderId, status: 'picked_up', handoverOtp: { code: '4821', expiresAt,
purpose: 'delivery_handover' } } }` — 4-значный код возвращается терминалу СРАЗУ в ответе (не требует
отдельного `GET`), для немедленного отображения на экране (§B «Экраны», HandoverOtpScreen). **[R1]**

## A.6 OTP вручения: доступ и повторная генерация

**SRS-PHT-028** `GET /api/v1/orders/:id/handover-otp` — повторный просмотр текущего действующего кода
(например, экран терминала был свёрнут/приложение перезапущено после `complete-picking`). Доступ:
`pharmacist`/`pharmacy_admin` своей аптеки, статус заказа `∈ {'picked_up'}` (после `delivered` код
недействителен и эндпоинт возвращает `404 HANDOVER_OTP_NOT_FOUND`, `[РАСШИРЕНИЕ]`, чтобы не светить
использованный код). **Каждый вызов пишется в `audit_log`** (`[РАСШИРЕНИЕ]`, обоснование: 4-значный код
— чувствительные данные платёжно-значимого действия; основной канал получения кода клиентом —
Telegram/push-уведомление напрямую клиенту (модуль `notifications`, D-23), терминал — ВСПОМОГАТЕЛЬНЫЙ
канал сверки/поддержки при сбое доставки уведомления клиенту, поэтому каждое обращение фиксируется).
**[R1]**

**SRS-PHT-029** `POST /api/v1/orders/:id/handover-otp/regenerate` — `[РАСШИРЕНИЕ]`
`RegenerateHandoverOtpUseCase`. Обоснование частоты использования: `handoverOtpTtlSeconds = 900`
(15 минут, SRS-DOM-080) СУЩЕСТВЕННО короче `delivery_sla_city_minutes = 240` (4 часа, D-19) — код
рутинно истекает до фактической встречи курьера с клиентом, регенерация является ОЖИДАЕМЫМ штатным
действием, а не аварийным edge case. Механизм: создаётся НОВАЯ строка `otp_codes` (append-only,
существующий паттерн аудита, не переиспользуется старая), `orders.handover_otp_id` и
`delivery_assignments.handover_otp_id` переключаются на новую запись — прежний код автоматически теряет
силу (проверка всегда идёт против ТЕКУЩЕГО FK, старая строка остаётся только для аудита). Rate-limit
(`[РАСШИРЕНИЕ]`, ASSUMPTION): `HANDOVER_OTP_MAX_REGENERATIONS_PER_ORDER = 20`,
`HANDOVER_OTP_REGENERATE_MIN_INTERVAL_SECONDS = 60`. Given лимит исчерпан, Then `429 RATE_LIMITED`.
Событие `HandoverOtpRegeneratedEvent` (`[РАСШИРЕНИЕ]`) → уведомление клиенту с новым кодом (модуль
`notifications`, не WS в комнату `pharmacy:*`, т.к. терминал уже видит новый код в ответе на этот же
запрос). Доступ: `pharmacist`/`pharmacy_admin` своей аптеки, `order.status='picked_up'`. **[R1]**

> Регенерация со стороны курьера (`apps/courier_mobile`, R2-2) — та же серверная операция под другим
> permission-скоупом (`courier`, назначен на `DeliveryAssignment`); полная RBAC-специфика курьерского
> клиента — предмет отдельного документа модуля курьера, здесь фиксируется только то, что механизм ОДИН
> (не дублируется реализацией под каждого клиента).

## A.7 SLA-таймер сборки

**SRS-PHT-030** [D-19, SRS-DOM-091] `sla_deadline_at = processing_started_at + tenant_settings.pickup_sla_minutes`
(дефолт 7 минут), рассчитывается и сохраняется СЕРВЕРОМ в момент `accept` (§A.2), возвращается клиенту
для отображения обратного отсчёта — клиент НЕ хранит и не пересчитывает дедлайн самостоятельно дольше,
чем до следующего `GET`/WS-обновления (защита от рассинхронизации часов планшета). **[R1]**

**SRS-PHT-031** Мягкая эскалация (без остановки сборки): `SlaWatchdogProcessor` (BullMQ delayed job,
поставлен в очередь В МОМЕНТ `accept` с `delay = pickup_sla_minutes`) при срабатывании проверяет: Given
`order.status` всё ещё `'processing'` (сборка не завершена), Then публикуется `SlaBreachedEvent` → WS
`ops.sla_breached` в комнату `platform:ops` (существующее событие/маршрут, `12-api-conventions...md` §6.3) —
видно `support_agent`/`super_admin` для ручного решения (связаться с аптекой, при системном паттерне
нарушений — операционное разбирательство с сетью). **На терминал фармацевта это событие НЕ пересылается**
(комната `platform:ops` не входит в набор комнат роли `pharmacist`, §A.9) — превышение 7 минут визуально
показывается терминалом САМОСТОЯТЕЛЬНО, локальным сравнением текущего времени с уже известным
`sla_deadline_at` (не требует новой серверной команды). **SRS-PHT-032** **[R1]**

**SRS-PHT-033** Жёсткий автоматический отказ: второй BullMQ-джоб, поставленный с
`delay = pickup_sla_minutes + pickup_sla_buffer_minutes` (7+5=12 минут по умолчанию) от
`processing_started_at`. Given по истечении этого срока `order.status` всё ещё `'processing'` (сборка
физически не завершена), Then вызывается `order.cancel('pickup_sla_exceeded', system)` — полный
`PaymentProvider.refund()`, `EscrowLedger.refund`, восстановление резерва ВСЕХ ещё не выданных партий,
событие `OrderAutoCancelledEvent` (существующее; трактуется здесь как реализация «просрочки после
принятия», аналогично по духу SRS-DOM-092, которая описывает просрочку ДО принятия — оба случая ведут
к одному и тому же терминальному эффекту «полный рефанд, `cancelled`», различается только исходный
статус `paid_escrow`/`processing`). **SRS-PHT-034** **[R1]**

**SRS-PHT-035 — Явный отказ от «переназначения на другую аптеку»** Доменная модель (`10-domain-model.md`)
НЕ поддерживает изменение `orders.pharmacy_id` после создания заказа: товар физически зарезервирован по
конкретным партиям КОНКРЕТНОЙ аптеки (`inventory_batches.pharmacy_inventory_id`), и ни одна
state-machine-таблица (`10-domain-model.md` §«State machines»/1) не содержит перехода, переносящего
активный заказ в другую аптеку. Поэтому просрочка SLA сборки заканчивается ТОЛЬКО эскалацией
(SRS-PHT-032) и, при исчерпании буфера, отменой с полным рефандом (SRS-PHT-034) — клиент, если хочет,
оформляет НОВЫЙ заказ в другой аптеке вручную (та же механика, что и для любого другого дешёвого аналога
в CUJ-1). Эта спецификация НЕ вводит межаптечное переназначение как отдельную фичу — это было бы
изменением `10-domain-model.md`, которое аналитик модуля не имеет права вносить без ADR архитектора
(«ЗАКОН, не переоткрывается», см. заголовок документа). **[R1]**

## A.8 Реалтайм-события терминала

**SRS-PHT-036** Терминал подключается к `wss://<host>/api/v1/realtime`, комната `pharmacy:{pharmacyId}`
(уже определена, `12-api-conventions...md` §6.2, роль `pharmacist`). Потребляемые события:

| WS-событие | Источник | Новое/существующее | Реакция терминала |
|---|---|---|---|
| `order.paid` | `OrderPaidEvent` | существующее | Новый заказ в очереди «Новые» → звуковое оповещение (§B.4), пуш в локальный список без перезагрузки экрана |
| `order.cancelled` | `OrderCancelledEvent`/`OrderAutoCancelledEvent` | существующее | Заказ убирается из активной сборки, если открыт экран сканирования — модальное уведомление «Заказ отменён» (§«Пограничные случаи») |
| `order.claimed` | `OrderClaimedEvent` | `[РАСШИРЕНИЕ]` | Заказ помечается «в работе у X» на устройствах ДРУГИХ фармацевтов той же аптеки, кнопка «Принять» становится недоступной |
| `order.reclaimed` | `OrderReclaimedEvent` | `[РАСШИРЕНИЕ]` | Обновление имени ответственного фармацевта в UI |
| `order.partial_fulfillment_resolved` | `PartialFulfillmentConfirmedEvent`/`PartialFulfillmentAutoConfirmedEvent`/rejection-путь | `[РАСШИРЕНИЕ]` | Разблокирует экран завершения сборки (снимает индикатор ожидания клиента) |

**SRS-PHT-037** [SRS-API-053] После реконнекта терминал ОБЯЗАН выполнить REST catch-up
(`GET /api/v1/orders?filter[pharmacyId]=...&filter[status][in]=paid_escrow,processing`) ДО повторной
подписки на комнату — правило уже установлено `12-api-conventions...md` §6.5, здесь фиксируется
обязательность для этого конкретного клиента (это единственный источник актуальной очереди после
разрыва, WS не восполняет пропущенные события). **[R1]**

## A.9 Многопользовательский режим — доменная сторона

**SRS-PHT-038** Разграничение ответственности: **аутентификация и разрешение действия** («этот
пользователь — `pharmacist` этой аптеки») — RBAC-скоуп `pharmacy` (`12-api-conventions...md` §4.1,
существующий, НЕ меняется этим документом: любой фармацевт аптеки МОЖЕТ вызвать `scan`/`complete-picking`
для любого заказа своей аптеки, независимо от того, кто его принял). **Блокировка «кто ведёт сборку
сейчас»** (`assigned_pharmacist_id`) — ЧИСТО UX-механизм предотвращения путаницы на разделяемом
устройстве/аптеке с несколькими терминалами, не мера безопасности — сервер НЕ отклоняет `scan`/
`report-issue`/`complete-picking` по признаку «вызвал не тот, кто принял заказ» (это создало бы
тупиковую ситуацию, если принявший фармацевт ушёл со смены без `reclaim`). Единственное жёсткое
ограничение — сам `accept` (SRS-PHT-009): нельзя ПРИНЯТЬ уже принятый заказ без `reclaim`. **[R1]**

## A.10 Идемпотентность и офлайн-совместимость эндпоинтов терминала

**SRS-PHT-039** `[РАСШИРЕНИЕ]` к таблице `12-api-conventions...md` §1.4 (SRS-API-009) — следующие
эндпоинты терминала ДОБАВЛЯЮТСЯ в список endpoint'ов с ОБЯЗАТЕЛЬНЫМ `Idempotency-Key`:

| Эндпоинт | Почему обязателен |
|---|---|
| `POST /orders/:id/accept` | Двойной тап на планшете в перчатках — частая ситуация; повторный вызов не должен создавать гонку блокировки |
| `POST /orders/:id/reclaim` | Аналогично |
| `POST /orders/:id/items/:itemId/scan` | Офлайн-очередь (§B.5) может отправить один и тот же скан дважды при нестабильной сети — повтор не должен второй раз списывать партию |
| `POST /orders/:id/items/:itemId/report-issue` | Аналогично, повтор не должен дублировать событие `unavailable` |
| `POST /orders/:id/propose-partial-fulfillment` | Двойной вызов не должен создать два конкурирующих запроса подтверждения |
| `POST /orders/:id/complete-picking` | Двойной тап не должен дважды сгенерировать/перезаписать OTP |
| `POST /orders/:id/handover-otp/regenerate` | Двойной тап не должен зря сжигать лимит регенераций |

Клиент офлайн-очереди (§B.5) генерирует `Idempotency-Key = uuid.v4()` В МОМЕНТ постановки действия в
очередь (не в момент фактической отправки) — так повторная попытка отправки того же элемента очереди
после обрыва связи использует ОДИН И ТОТ ЖЕ ключ (SRS-API-010 гарантирует детерминированный ответ).
**[R1] (контракт) / [R2] (соблюдение в клиенте)**

## A.11 Сводная таблица эндпоинтов

| Метод и путь | Роль | Idempotency-Key | Ключевые ошибки |
|---|---|---|---|
| `GET /orders?filter[pharmacyId]&filter[status][in]&sort=priority` | `pharmacist`, `pharmacy_admin` | — | `403 INSUFFICIENT_ROLE` |
| `GET /orders/:id` | `pharmacist` (own pharmacy), `pharmacy_admin` | — | `404 NOT_FOUND`, `403 FORBIDDEN` |
| `POST /orders/:id/accept` | `pharmacist` (own pharmacy) | Обязателен | `409 ORDER_ALREADY_CLAIMED`, `409 INVALID_STATE_TRANSITION`, `403 PHARMACY_SUSPENDED` |
| `POST /orders/:id/reclaim` | `pharmacist` (own pharmacy) | Обязателен | `409 INVALID_STATE_TRANSITION` |
| `POST /orders/:id/items/:itemId/scan` | `pharmacist` (own pharmacy) | Обязателен | `404 ORDER_ITEM_NOT_FOUND`, `409 ITEM_ALREADY_SCANNED`, `422 EXPIRED_STOCK`, `422 BATCH_NOT_AVAILABLE` |
| `POST /orders/:id/items/:itemId/report-issue` | `pharmacist` (own pharmacy) | Обязателен | `422 BUSINESS_RULE_VIOLATION` (позиция не `pending`) |
| `POST /orders/:id/propose-partial-fulfillment` | `pharmacist` (own pharmacy) | Обязателен | `422 BUSINESS_RULE_VIOLATION` (`unresolvedItemIds`) |
| `POST /orders/:id/complete-picking` | `pharmacist` (own pharmacy) | Обязателен | `400 SEAL_CONFIRMATION_REQUIRED`, `409 PARTIAL_FULFILLMENT_PENDING`, `422 EXPIRED_STOCK` |
| `GET /orders/:id/handover-otp` | `pharmacist`/`pharmacy_admin` (own pharmacy) | — | `404 HANDOVER_OTP_NOT_FOUND` |
| `POST /orders/:id/handover-otp/regenerate` | `pharmacist`/`pharmacy_admin` (own pharmacy) | Обязателен | `429 RATE_LIMITED` |
| `POST /orders/:id/cancel` | `pharmacist` (own pharmacy), `processing` только | Обязателен (существующий) | `409 INVALID_STATE_TRANSITION` |

---

# Часть B — Flutter-реализация `apps/pharmacy_mobile` [R2]

## B.1 Архитектура приложения

**SRS-PHT-040** Структура (feature-oriented, аналогично правилу React из `02` §5, адаптировано на Dart):

```
apps/pharmacy_mobile/lib/
├── app/            — точка входа, роутер (go_router), тема (высокая контрастность), DI (get_it)
├── features/
│   ├── auth/           — OTP-логин, смена пользователя на терминале
│   ├── order_queue/     — очередь заказов (A.1), сортировка/фильтр
│   ├── picking/          — экран сборки: сканирование, report-issue, partial-fulfillment wait
│   ├── handover/         — экран OTP вручения, регенерация
│   └── sync/             — офлайн-очередь, статус соединения (виден на всех экранах как баннер)
├── entities/        — OrderCard, OrderItemRow, ScanResultBadge — переиспользуемые виджеты представления
└── shared/
    ├── api/          — dio-клиент, сгенерированный из `docs/api/openapi.json` (`dorutj_api` пакет, Charter §3.2)
    ├── ws/           — обёртка `web_socket_channel`, реконнект (SRS-API-054), катч-ап (SRS-PHT-037)
    ├── offline_queue/ — drift-схема очереди действий (§B.5)
    └── audio/        — проигрывание звука оповещения (§B.4)
```

**SRS-PHT-041** Зависимости (`01-TECH-BASELINE.md` + дополнения этого модуля с обоснованием):
`flutter_bloc` (Cubit, состояние), `dio` (сеть, JWT/retry/requestId-перехватчики), `drift` (SQLite,
офлайн-очередь), `mobile_scanner` (камера-сканер), `web_socket_channel` (WS), `go_router` (роутинг),
`get_it` (DI). **Новый пакет, требующий однострочного обоснования в тикете (`01-TECH-BASELINE.md` правило
3)**: `wakelock_plus` — удержание экрана/CPU активными во время сборки и при ожидании звукового
оповещения (§B.4/B.8), отсутствует в зафиксированном baseline. **[R2]**

## B.2 Экраны и Cubit-состояния

**SRS-PHT-042** Экраны: `LoginScreen` (OTP), `OrderQueueScreen` (A.1, две секции: «Новые»/`paid_escrow`,
«В сборке»/`processing`), `PickingScreen` (список позиций + сканер), `PartialFulfillmentWaitScreen`
(показывается ПОСЛЕ `propose-partial-fulfillment`, пока клиент не ответил), `HandoverOtpScreen` (после
`complete-picking`), `SwitchUserScreen` (смена фармацевта на планшете). **[R2]**

**SRS-PHT-043** `OrderQueueCubit` — состояния: `Loading → Loaded(orders: [...], connectionStatus) →
Error(retryable)`. `Loaded` обновляется двумя путями: (1) REST-рефетч по pull-to-refresh/после реконнекта;
(2) точечный патч по WS-событию (`order.paid` → insert, `order.cancelled`/`order.claimed` (чужой) →
remove/update одного элемента, без полного рефетча — минимизирует моргание списка). **[R2]**

**SRS-PHT-044** `PickingCubit` — состояние-машина ОДНОГО заказа (диаграмма Cubit-состояний, НЕ путать с
серверной `order_status` — это UI-проекция комбинации серверного статуса + локального прогресса
сканирования):

```
InitialLoading
     │ GET /orders/:id
     ▼
Assembling(items: [...], slaDeadlineAt, secondsRemaining)
     │ scan(itemId) success        │ scan/report-issue error       │ report-issue(itemId)
     ▼                             ▼ (остаётся Assembling,          ▼
Assembling (обновлён item)         показывает inline-ошибку)   Assembling (item → unavailable)
     │
     │ все items решены, ≥1 unavailable
     ▼
ReadyToProposePartial ──POST propose-partial-fulfillment──> AwaitingCustomerConfirmation
     │ все items scanned_ok (без unavailable)                        │ WS order.partial_fulfillment_resolved
     ▼                                                                ▼
ReadyToComplete ◄──────────────────────────────────────────── ReadyToComplete
     │ POST complete-picking (sealConfirmed=true)
     ▼
Completed(handoverOtp)
```

Given `secondsRemaining <= 0` (SLA исчерпан, до буфера), Then состояние остаётся `Assembling`, но с
флагом `isOverdue=true` — UI переключает цветовую индикацию (красный) и звук эскалации (§B.4), СЕРВЕР
ничего не отменяет до истечения буфера (SRS-PHT-034). **SRS-PHT-045** **[R2]**

**SRS-PHT-046** `HandoverOtpCubit` — `Loaded(code, expiresAt, secondsRemaining) → Regenerating →
Loaded(newCode, ...)`. Локальный таймер обратного отсчёта; по достижении 0 UI показывает кнопку
«Обновить код» (не блокирует автоматически — фармацевт видит, что код истёк, дальнейшая регенерация —
явное действие, т.к. частая механическая регенерация «на всякий случай» тратит лимит SRS-PHT-029).
**[R2]**

## B.3 Сканирование (`mobile_scanner`)

**SRS-PHT-047** Камера открывается на `PickingScreen` при выборе позиции для сканирования (не постоянно
открытый общий сканер — снижает риск случайного скана не той позиции при нескольких открытых коробках
на столе одновременно; фармацевт явно выбирает строку `orderItem`, ЗАТЕМ сканирует). Распознанный
`rawBarcode` немедленно подставляется в `POST .../scan` (§A.3) — клиент НЕ выполняет собственную
предварительную валидацию контрольной цифры EAN-13 (это домен-логика, живёт на сервере, Charter §3.6 п.1) —
клиент лишь проверяет непустую строку перед отправкой. **[R2]**

**SRS-PHT-048** Ручной ввод — кнопка «Ввести код вручную» на `PickingScreen` открывает крупную
цифровую клавиатуру (тап-зоны ≥64dp, §B.8), заполняет то же поле `rawBarcode`, отправляется с
`manualEntry: true`. Активируется автоматически (баннер-предложение), если камера не считала штрихкод
3 раза подряд за 10 секунд (эвристика UX, не сетевой признак). **[R2]**

**SRS-PHT-049** Фонарик (`torch`) — переключатель на экране сканирования (частый сценарий: складское
помещение аптеки с плохим освещением, коробки в глубине полки). **[R2]**

## B.4 Звуковое оповещение

**SRS-PHT-050** Требования (tz.log Модуль 5 «Громкое звуковое оповещение при поступлении онлайн-заказа»):

| Параметр | Значение | Обоснование |
|---|---|---|
| Аудиоканал (Android `AudioAttributes`) | `USAGE_ALARM` (не `USAGE_NOTIFICATION`) | Устройство — выделенный терминал точки продаж, не личный телефон; звук обязан пробиваться через «Не беспокоить»/тихий режим ОС. Требует явного согласия на установке (диалог «Разрешить важные оповещения») — запрашивается на экране первого входа |
| Громкость | Программно устанавливается на `STREAM_ALARM` ≥ 80% при старте приложения (не наследует системный уровень тихого режима) | Планшет обычно лежит на прилавке, персонал может быть в другом помещении |
| Триггер | WS-событие `order.paid` в комнате `pharmacy:{pharmacyId}` (§A.8) | Существующее событие, не требует нового backend-элемента |
| Повтор | Каждые 5 секунд (`ASSUMPTION`), до 6 повторов (30 секунд) ИЛИ пока фармацевт не откроет карточку заказа (что раньше) | tz.log: «громкое... оповещение», не однократный «дзынь» |
| Отличие от других звуков | Отдельный аудио-ассет (`new_order_alert.mp3`, сирена/повторяющийся тон), отличный от звука завершения 1С-синхронизации (`sync_completed.mp3`, мягкий чайм) и звука истечения SLA (`sla_overdue_alert.mp3`, иной паттерн повтора — 1 раз при пересечении порога) | Персонал должен различать типы событий без взгляда на экран |
| При заблокированном экране | Foreground-сервис удерживает WS-соединение (см. §B.8, wake lock); при получении `order.paid` — `flutter_local_notifications` full-screen intent (`setShowWhenLocked` + `turnScreenOn`) включает экран поверх блокировки одновременно со звуком | Планшет обычно лежит с потухшим экраном между заказами |
| Настройка | Экран настроек: громкость (слайдер, но не ниже технического минимума 50%, чтобы нельзя было случайно выключить критичное оповещение), выбор мелодии из 3 предустановленных, тест-кнопка «Проверить звук» | Персонал должен иметь возможность подстроить, не имея возможности полностью заглушить |

**[R2]**

## B.5 Офлайн-очередь и синхронизация (`drift`)

**SRS-PHT-051** Схема таблицы `pending_actions` (drift, локальная SQLite):
`id (autoincrement), idempotencyKey (uuid, unique), endpoint, httpMethod, orderId, payloadJson, createdAt,
status ENUM('queued','sending','sent','failed'), retryCount, lastError`. Каждое мутирующее действие
терминала (§A.10) СНАЧАЛА пишется в эту таблицу и немедленно отражается в UI ОПТИМИСТИЧНО (например,
`scan` сразу красит позицию в «отсканировано» локально), ЗАТЕМ асинхронно отправляется. **[R2]**

**SRS-PHT-052** Порядок отправки — строго FIFO по `createdAt` В ПРЕДЕЛАХ ОДНОГО `orderId` (нельзя
отправить `complete-picking`, пока не подтверждена доставка более раннего `scan` того же заказа —
иначе сервер вернёт `409 BUSINESS_RULE_VIOLATION` из-за нерешённых позиций, и клиент должен ретраить
позже, что усложняет UX без выгоды). Между РАЗНЫМИ `orderId` порядок не важен — могут отправляться
параллельно. **[R2]**

**SRS-PHT-053** Retry — экспоненциальный backoff `1с, 2с, 4с, 8с, 16с, макс 30с` (тот же паттерн, что и
WS-реконнект, SRS-API-054, для единообразия). Given ответ `4xx` НЕ `429`/`5xx` (например, `422
EXPIRED_STOCK`, `404 ORDER_ITEM_NOT_FOUND`) — Then действие помечается `status='failed'`, НЕ ретраится
автоматически (повтор не исправит бизнес-ошибку), фармацевт видит уведомление и решает вручную
(пересканировать/сообщить о проблеме заново). Given `429`/`5xx`/сетевая ошибка — Then ретраится
автоматически по backoff. **SRS-PHT-054** **[R2]**

**SRS-PHT-055** По восстановлению сети: (1) REST catch-up текущего заказа (`GET /orders/:id`,
SRS-PHT-037) ДО отправки очереди — если сервер уже отражает более позднее состояние (например, коллега
на другом терминале уже завершил сборку, пока планшет был офлайн), клиент СВЕРЯЕТ локальную очередь с
актуальным состоянием и отбрасывает действия, ставшие неприменимыми (например, `scan` для уже
`scanned_ok` позиции — сервер всё равно вернул бы `409 ITEM_ALREADY_SCANNED`, лучше не тратить запрос);
(2) отправка оставшейся очереди по правилам §B.5.2. **[R2]**

## B.6 Поведение при потере сети посреди сборки

**SRS-PHT-056** UI-баннер «Нет соединения — действия сохраняются локально» появляется ПОСТОЯННО, пока
`dio`-запросы завершаются сетевыми ошибками ИЛИ WS-канал не в состоянии `auth_ok`. Сборка НЕ
блокируется: фармацевт продолжает сканировать, действия копятся в очереди (§B.5), локальное состояние
`PickingCubit` обновляется оптимистично. Кнопка «Завершить сборку» ОСТАЁТСЯ доступной локально, но
финальный `complete-picking` — как любое другое действие — уходит в очередь и подтверждается только
после реальной отправки; экран `HandoverOtpScreen` показывает `code` из ОПТИМИСТИЧНОГО локального
предсказания как «код будет действителен после подключения», с явным индикатором «не подтверждено
сервером», пока `sent`-статус действия не получен. **SRS-PHT-057** **[R2]**

Given SLA-таймер тем временем достигает нуля офлайн — Then локальный UI показывает `isOverdue=true`
(SRS-PHT-045), но фактическая server-side отмена (SRS-PHT-034) наступит только когда BullMQ-джоб
сработает НА СЕРВЕРЕ по серверным часам — состояние заказа при восстановлении связи может оказаться
УЖЕ `cancelled`, если буфер истёк, пока планшет был офлайн (см. «Пограничные случаи», TC-PHT). **SRS-PHT-058** **[R2]**

## B.7 Многопользовательский режим на планшете

**SRS-PHT-059** Планшет — общее устройство, каждый фармацевт входит СВОЕЙ учётной записью (OTP-логин,
`12-api-conventions...md` §3.1) — не одновременные окна, а последовательные сессии: активная смена
пользователя (`SwitchUserScreen`) требует выхода текущей сессии (JWT/refresh инвалидируются штатным
`POST /auth/logout`) и входа следующей. **Незавершённая офлайн-очередь (§B.5) НЕ привязана к
пользовательской сессии** — она принадлежит УСТРОЙСТВУ и продолжает отправляться от имени того
пользователя, который изначально поставил действие в очередь (сохранённый в момент постановки JWT
`actor.userId` для аудита), даже если к моменту фактической отправки на терминале уже вошёл другой
пользователь — сервер проверяет права по токену, приложенному к КОНКРЕТНОМУ запросу очереди, не по
текущей активной UI-сессии. **SRS-PHT-060** **[R2]**

**SRS-PHT-061** `OrderQueueScreen` отображает `assignedPharmacistName` (§A.1, SRS-PHT-006) — заказы,
принятые ДРУГИМ фармацевтом, показываются с бейджем «В работе: Фарзона М.» и недоступной кнопкой
«Принять» (сервер всё равно отклонит попытку — SRS-PHT-009 — но клиент прячет действие заранее для
понятного UX, не полагаясь на ошибку сервера как единственный источник обратной связи). Долгое нажатие
на такую карточку предлагает «Перехватить» (`reclaim`, SRS-PHT-010) с обязательным выбором причины.
**[R2]**

## B.8 Wake lock, тап-зоны, контраст, локализация

**SRS-PHT-062** Экран НЕ гаснет автоматически, пока открыт `PickingScreen` активного заказа с
`isOverdue=false` (частичный wake lock через `wakelock_plus`, снимается при уходе с экрана или
завершении/отмене заказа) — сборка требует постоянного визуального контроля таймера. Для звукового
оповещения о НОВОМ заказе при закрытом приложении используется отдельный foreground-сервис (§B.4), не
общий wake lock экрана. **[R2]**

**SRS-PHT-063** Тап-зоны — минимум 64×64dp (крупнее стандартного Android-минимума 48dp, `[РАСШИРЕНИЕ]`
ASSUMPTION) для всех интерактивных элементов `PickingScreen`/`OrderQueueScreen` — расчёт на работу в
медицинских перчатках. Контраст — не ниже WCAG 2.1 AA (Charter §5), тема терминала использует
УСИЛЕННЫЙ контраст (тёмный текст на светлом фоне, крупный шрифт статусов, без полагания только на
цвет — иконка + текст для `scanned_ok`/`unavailable`/`pending`). **[R2]**

**SRS-PHT-064** Локализация — `tj`/`ru` (Charter: дефолт `tj`, `en` не требуется для внутреннего
персонала аптеки согласно tz.log Модуль 5, вне явного требования — ограничение до 2 языков вместо 3
для этого клиента; `packages/i18n`/`GET /api/v1/i18n/:locale` — тот же источник строк, что и у веб-
клиентов, Charter §3.6 п.6). Переключатель языка — на `LoginScreen` и в настройках. **[R2]**

## B.9 Восстановление после kill процесса ОС

**SRS-PHT-065** Given Android завершает процесс приложения в фоне (нехватка памяти — частый случай на
бюджетных планшетах), When приложение перезапускается (пользователь возвращается на передний план ИЛИ
foreground-сервис перезапускает activity по получении WS-события), Then: (1) `drift`-очередь (§B.5)
персистентна на диске — НИ ОДНО ещё не отправленное действие не теряется; (2) активный экран
восстанавливается по последнему сохранённому `orderId` в `SharedPreferences`/`Hive` (не в drift —
это эфемерное UI-состояние, не бизнес-данные) — `PickingScreen` перезапрашивает `GET /orders/:id`
(REST catch-up) вместо восстановления из памяти, т.к. состояние заказа могло измениться, пока процесс
был мёртв (например, коллега продолжил сборку с другого терминала). JWT/refresh-токен — персистентны
через безопасное хранилище (`flutter_secure_storage`, `[РАСШИРЕНИЕ]` пакет, обоснование: хранение JWT
не должно жить в обычных SharedPreferences в открытом виде) — сессия НЕ требует повторного OTP-логина
после простого перезапуска процесса. **[R2]**

---

## Дополнения к схеме БД

> Все дополнения ниже — аддитивные (`ALTER TABLE ... ADD COLUMN`/новые таблицы), не меняют существующие
> имена/типы колонок `11-database-schema.md` (Charter §5: «расширения допускаются»). Каждое обосновано
> конкретным use case части A.

```sql
-- =====================================================================================
-- [РАСШИРЕНИЕ, модуль 24] orders — мягкая блокировка «кто ведёт сборку» (SRS-PHT-006/007/010/038)
-- =====================================================================================
ALTER TABLE orders
    ADD COLUMN assigned_pharmacist_id UUID REFERENCES users(id) ON DELETE SET NULL;
COMMENT ON COLUMN orders.assigned_pharmacist_id IS
    'UX-блокировка терминала (не RBAC-контроль — тот остаётся orders:*:pharmacy, SRS-PHT-038). '
    'Заполняется AcceptOrderUseCase/reclaim, НЕ проверяется как условие авторизации на scan/'
    'complete-picking. Модуль 24, SRS-PHT-007.';

-- =====================================================================================
-- [РАСШИРЕНИЕ, модуль 24] order_items — прогресс сканирования позиции (SRS-PHT-011..016)
-- =====================================================================================
CREATE TYPE order_item_fulfillment_status AS ENUM ('pending', 'scanned_ok', 'unavailable');

ALTER TABLE order_items
    ADD COLUMN fulfillment_status order_item_fulfillment_status NOT NULL DEFAULT 'pending',
    ADD COLUMN scanned_batch_id UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
    ADD COLUMN scanned_at TIMESTAMPTZ,
    ADD COLUMN scanned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN scan_method VARCHAR(10) CHECK (scan_method IN ('camera', 'manual') OR scan_method IS NULL),
    ADD COLUMN item_issue_reason VARCHAR(30)
        CHECK (item_issue_reason IN ('out_of_stock', 'expired_on_shelf', 'damaged_packaging') OR item_issue_reason IS NULL);
COMMENT ON COLUMN order_items.fulfillment_status IS
    'Прогресс физической сборки позиции терминалом (модуль 24). Не путать с order.status (уровень '
    'заказа). complete-picking (SRS-PHT-026) требует отсутствия pending среди позиций.';
COMMENT ON COLUMN order_items.scanned_batch_id IS
    'Партия, ФАКТИЧЕСКИ отсканированная при сборке — может отличаться от исходно зарезервированной по '
    'FEFO order_items.inventory_batch_id при замене партии (SRS-PHT-014, inventory.releaseReservation + '
    'reserveForOrder).';

-- =====================================================================================
-- [РАСШИРЕНИЕ, модуль 24] order_partial_fulfillment_requests — подтверждение частичной сборки (D-10, SRS-PHT-019..023)
-- =====================================================================================
CREATE TYPE partial_fulfillment_status AS ENUM (
    'awaiting_customer', 'confirmed', 'rejected', 'auto_confirmed_timeout'
);

CREATE TABLE order_partial_fulfillment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    proposed_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, -- фармацевт, вызвавший propose
    items_snapshot JSONB NOT NULL, -- [{ orderItemId, medicineName, quantity, reason }] недоступных позиций
    items_total_before_diram BIGINT NOT NULL,
    items_total_after_diram BIGINT NOT NULL,
    refund_amount_diram BIGINT NOT NULL,
    status partial_fulfillment_status NOT NULL DEFAULT 'awaiting_customer',
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    CONSTRAINT chk_partial_fulfillment_amounts CHECK (
        items_total_after_diram <= items_total_before_diram
        AND refund_amount_diram = items_total_before_diram - items_total_after_diram
    )
);
CREATE UNIQUE INDEX ux_partial_fulfillment_one_active
    ON order_partial_fulfillment_requests (order_id) WHERE status = 'awaiting_customer';
COMMENT ON TABLE order_partial_fulfillment_requests IS
    'Запрос подтверждения изменённого состава заказа клиентом (модуль 24, D-10/SRS-DOM-162 — '
    'стратегия частичного рефанда). Ровно один активный (awaiting_customer) запрос на заказ '
    '(ux_partial_fulfillment_one_active). auto_confirmed_timeout — см. SRS-PHT-023a.';

-- =====================================================================================
-- [РАСШИРЕНИЕ, модуль 24] tenant_settings — параметры терминала (SRS-PHT-019/029)
-- =====================================================================================
ALTER TABLE tenant_settings
    ADD COLUMN partial_fulfillment_confirmation_timeout_minutes INT NOT NULL DEFAULT 10,
    ADD COLUMN handover_otp_max_regenerations_per_order INT NOT NULL DEFAULT 20,
    ADD COLUMN handover_otp_regenerate_min_interval_seconds INT NOT NULL DEFAULT 60,
    ADD CONSTRAINT chk_tenant_settings_pht_ranges CHECK (
        partial_fulfillment_confirmation_timeout_minutes > 0
        AND handover_otp_max_regenerations_per_order > 0
    );
```

**Новые доменные ошибки** (расширение таблицы `10-domain-model.md` §«Доменные ошибки», модуль `orders`):

| Класс | HTTP | Код | SRS |
|---|---|---|---|
| `OrderAlreadyClaimedError` | 409 | `ORDER_ALREADY_CLAIMED` | SRS-PHT-009 |
| `ItemNotInOrderError` | 404 | `ORDER_ITEM_NOT_FOUND` | SRS-PHT-012 |
| `ItemAlreadyScannedError` | 409 | `ITEM_ALREADY_SCANNED` | SRS-PHT-013 |
| `BatchNotAvailableForSubstitutionError` | 422 | `BATCH_NOT_AVAILABLE` | SRS-PHT-014 |
| `SealConfirmationRequiredError` | 400 | `SEAL_CONFIRMATION_REQUIRED` | SRS-PHT-025 |
| `PendingCustomerConfirmationError` | 409 | `PARTIAL_FULFILLMENT_PENDING` | SRS-PHT-026 |
| `HandoverOtpNotFoundError` | 404 | `HANDOVER_OTP_NOT_FOUND` | SRS-PHT-028 |

**Новые доменные события** (расширение таблицы «Доменные события» `10-domain-model.md`):

| Событие | Payload | Публикует | Потребители |
|---|---|---|---|
| `OrderClaimedEvent` | `orderId, pharmacistId, claimedAt` | `orders` | WS `pharmacy:{id}` (SRS-PHT-036) |
| `OrderReclaimedEvent` | `orderId, previousPharmacistId, newPharmacistId, reason` | `orders` | WS `pharmacy:{id}` |
| `PartialFulfillmentProposedEvent` | `orderId, requestId, itemsSnapshot, refundAmountDiram, expiresAt` | `orders` | WS `customer:{id}`, notifications |
| `PartialFulfillmentConfirmedEvent` / `RejectedEvent` / `AutoConfirmedEvent` | `orderId, requestId, resolution` | `orders` | billing (рефанд), WS `pharmacy:{id}` |
| `HandoverOtpRegeneratedEvent` | `orderId, deliveryAssignmentId, regeneratedAt, regenerationsUsed` | `orders` | notifications (новый код клиенту) |

---

## Пограничные случаи и ошибки

**SRS-PHT-066 — Два фармацевта открыли один и тот же новый заказ одновременно** Given заказ
`status='paid_escrow'`, `assigned_pharmacist_id IS NULL`, When фармацевты A и B почти одновременно
нажимают «Принять» на РАЗНЫХ терминалах, Then БД-транзакция с `SELECT ... FOR UPDATE` сериализует
запросы — ровно один (например, A) успешно переводит заказ в `processing`; второй запрос (B) видит уже
изменённое состояние и получает `409 ORDER_ALREADY_CLAIMED` (SRS-PHT-009). Терминал B немедленно
получает WS `order.claimed` и убирает кнопку «Принять» ДАЖЕ если его REST-запрос ещё не долетел до
ответа (WS может обогнать REST-response по сети) — обработка идемпотентна: получение `order.claimed` для
заказа, который UI уже считает «в работе», не производит второго действия. **[R1/R2]**

**SRS-PHT-067 — Планшет офлайн 10 минут посреди сборки** Given фармацевт отсканировал 2 из 4 позиций,
после чего пропала сеть на 10 минут, When сеть восстанавливается, Then: (1) drift-очередь отправляет 2
накопленных `scan`-действия по FIFO (SRS-PHT-052) с исходными `Idempotency-Key`; (2) если за это время
`sla_deadline_at + buffer` истёк И сработал автоматический `OrderAutoCancelledEvent` (SRS-PHT-034) —
сервер отвечает на отложенные `scan`-запросы `409 INVALID_STATE_TRANSITION` (заказ уже `cancelled`),
клиент показывает модальное «Заказ отменён по истечении времени сборки, обратитесь к администратору» и
удаляет заказ из локальной очереди/UI, НЕ ретраит дальше. **[R1/R2]**

**SRS-PHT-068 — Заказ отменён клиентом во время сборки** Given фармацевт сканирует позиции, When клиент
отменяет заказ через свой канал (в пределах разрешённого `OrderPolicy.canCancel`, SRS-DOM-154 — доступно
до `picked_up`), Then сервер выполняет `order.cancel(...)`, событие `OrderCancelledEvent` → WS
`order.cancelled` в `pharmacy:{pharmacyId}`, терминал немедленно (если экран сборки открыт) показывает
блокирующий диалог «Заказ отменён клиентом» и делает `PickingScreen` недоступным для дальнейших действий
(следующий `scan`/`complete-picking`, если всё же отправлен из очереди, получит `409
INVALID_STATE_TRANSITION` и будет отброшен как в SRS-PHT-067). Товар, уже физически извлечённый
фармацевтом из полки для сборки, возвращается вручную (процесс вне API — организационная инструкция для
персонала, восстановление `stock_quantity` уже обеспечено доменной логикой `order.cancel()`, физическая
раскладка обратно на полку — не предмет автоматизации). **[R1/R2]**

**SRS-PHT-069 — Приложение убито системой Android посреди активной сборки** См. SRS-PHT-065 (§B.9):
локальная очередь (drift) переживает kill процесса; при перезапуске — REST catch-up `GET /orders/:id`
восстанавливает АКТУАЛЬНОЕ состояние с сервера (включая позиции, уже подтверждённые сервером ДО kill),
а не последнее локально отображавшееся. Позиции, находившиеся в очереди `queued`/`sending` НА МОМЕНТ
kill, но так и не подтверждённые сервером до перезапуска, — переотправляются штатным механизмом §B.5
после того же REST catch-up (что может привести к `409 ITEM_ALREADY_SCANNED`, если запрос ФАКТИЧЕСКИ
дошёл до сервера до kill, просто ответ не долетел до клиента — трактуется НЕ как ошибка пользователю:
`ITEM_ALREADY_SCANNED` при отправке из очереди тем же исполнителем, чья позиция уже `scanned_ok`,
приводит к молчаливому удалению элемента из очереди как «фактически выполнено», а не к
показу ошибки). **[R1/R2]**

**SRS-PHT-070 — Штрихкод не совпал с позицией заказа** Given фармацевт по ошибке сканирует коробку
другого препарата, Then `404 ORDER_ITEM_NOT_FOUND` (SRS-PHT-012), UI показывает конкретное название
отсканированного (резолвленного) препарата рядом с ожидаемым — снижает риск повторной ошибки вслепую;
позиция заказа остаётся `pending`, повторная попытка разрешена без ограничений (в отличие от
`ITEM_ALREADY_SCANNED`, это НЕ считается «использованной» попыткой). **[R1/R2]**

**SRS-PHT-071 — Товара физически нет, хотя `stock_quantity > 0`** (расхождение учёта и полки) —
обрабатывается через `report-issue(reason='out_of_stock')` (SRS-PHT-017/018), НЕ через попытку
подобрать штрихкод другого экземпляра — `reconcileZeroStock` асинхронно сигнализирует аптеке о
расхождении для последующей сверки остатков (вне реального времени этого запроса). **[R1/R2]**

**SRS-PHT-072 — Срок годности отсканированной партии недостаточен** Given `scannedExpiryDate <= today`,
Then `422 EXPIRED_STOCK` (существующий `ExpiredStockError`, переиспользуется, не дублируется новым
кодом) — позиция НЕ переходит в `scanned_ok`; фармацевт обязан найти другую партию (та же коробка,
другой `scannedBatchNumber`) или вызвать `report-issue(reason='expired_on_shelf')`, если альтернативной
непросроченной партии физически нет на полке. **[R1/R2]**

**SRS-PHT-073 — Клиент не отвечает на предложение частичной сборки, а SLA уже истекает** Given
`order_partial_fulfillment_requests.status='awaiting_customer'` И `sla_deadline_at` (для заказа в целом)
наступает РАНЬШЕ, чем `expires_at` запроса подтверждения, Then заказ продолжает жить в `processing`
(таймаут подтверждения — НЕ триггер отмены заказа сам по себе, только SRS-PHT-034 отменяет по
`processing`-таймеру) — оба таймера независимы; если общий SLA-буфер (7+5 мин) истекает раньше, чем
клиент/таймаут подтверждения частичной сборки (10 мин по умолчанию), заказ будет автоматически отменён
целиком (SRS-PHT-034) НЕЗАВИСИМО от незавершённого запроса подтверждения — `[РАСШИРЕНИЕ, ASSUMPTION]`
поэтому per-tenant конфигурация ДОЛЖНА держать `partial_fulfillment_confirmation_timeout_minutes <
pickup_sla_minutes + pickup_sla_buffer_minutes` (проверяется вручную при настройке тенанта, автоматической
кросс-констрейнт-проверки между двумя независимыми `tenant_settings`-полями не вводится — минимальная
инженерная сложность, `02` §C15). **[R1]**

**SRS-PHT-074 — Дубль скана из офлайн-очереди после того, как коллега уже отсканировал ту же позицию
на другом терминале** Given позиция уже `scanned_ok` (сканирована с ДРУГОГО устройства, пока первое было
офлайн), When отложенный `scan` из очереди первого устройства наконец отправляется, Then сервер отвечает
`409 ITEM_ALREADY_SCANNED`; клиент (SRS-PHT-069) трактует это НЕ как сбой, а как «уже выполнено кем-то
ещё» — элемент тихо помечается `sent` в очереди, UI не показывает ошибку пользователю (только фактическое
состояние позиции, подтянутое REST catch-up). **[R1/R2]**

**SRS-PHT-075 — Недоступность внешнего провайдера во время сборки** (например, `PaymentProvider` для
частичного рефанда, D-10) Given `ResolvePartialFulfillmentUseCase` вызывает
`PaymentProvider.refund()`/`partiallyRefund()` и провайдер недоступен (Charter §7, circuit breaker),
Then возвращается `503 PAYMENT_PROVIDER_UNAVAILABLE` (существующий `PaymentProviderUnavailableError`),
`order_partial_fulfillment_requests.status` ОСТАЁТСЯ `'confirmed'` (клиент уже согласился), но
СОЗДАЁТСЯ отложенная retry-задача (BullMQ, `outbox`-паттерн, существующий инфраструктурный механизм) —
`complete-picking` НЕ блокируется этим сбоем (сборка физически продолжается независимо от статуса
рефанда — иначе просроченный внешний провайдер держит заказ и товар заложником); финансовая
консистентность обеспечивается ретраем `outbox`, не синхронным ответом пользователю. **[R1]**

---

## Тестовые сценарии

| ID | Основание | Given | When | Then |
|---|---|---|---|---|
| TC-PHT-001 | SRS-PHT-008 | Заказ `paid_escrow`, свободен | `POST /orders/:id/accept` (фармацевт A, своя аптека) | `200 OK`, `status='processing'`, `slaDeadlineAt = now+7мин`, `assignedPharmacistId=A` |
| TC-PHT-002 | SRS-PHT-009 | Заказ уже принят A | `POST /orders/:id/accept` (фармацевт B, та же аптека) | `409 ORDER_ALREADY_CLAIMED`, `details.assignedPharmacistId=A` |
| TC-PHT-003 | SRS-PHT-010 | Заказ в работе у A | `POST /orders/:id/reclaim` (фармацевт B, `reason='shift_change'`) | `200 OK`, `assignedPharmacistId=B`, `slaDeadlineAt` НЕ изменился |
| TC-PHT-004 | SRS-PHT-012 | Позиция заказа — Парацетамол 500мг | `scan` со штрихкодом Ибупрофена | `404 ORDER_ITEM_NOT_FOUND`, позиция остаётся `pending` |
| TC-PHT-005 | SRS-PHT-013 | Позиция уже `scanned_ok` | Повторный `scan` той же позиции | `409 ITEM_ALREADY_SCANNED` |
| TC-PHT-006 | SRS-PHT-014 | `scannedBatchNumber` ссылается на партию с `expiry_date=today-1` | `scan` | `422 EXPIRED_STOCK`, позиция НЕ `scanned_ok` |
| TC-PHT-007 | SRS-PHT-014 | `scannedBatchNumber` — другая, валидная партия того же товара/аптеки с достаточным `quantity` | `scan` | `200 OK`, `scannedBatchId` обновлён, старая партия — `releaseReservation`, новая — `reserveForOrder` |
| TC-PHT-008 | SRS-PHT-018 | Позиция `pending` | `report-issue(reason='out_of_stock')` | `200 OK`, `fulfillmentStatus='unavailable'`, `itemIssueReason='out_of_stock'` |
| TC-PHT-009 | SRS-PHT-020 | Все позиции решены, ≥1 `unavailable` | `propose-partial-fulfillment` | `201`, создан `order_partial_fulfillment_requests(status='awaiting_customer')`, WS `order.partial_fulfillment_proposed` клиенту |
| TC-PHT-010 | SRS-PHT-020 | ≥1 позиция ещё `pending` | `propose-partial-fulfillment` | `422 BUSINESS_RULE_VIOLATION`, `details.unresolvedItemIds` непусто |
| TC-PHT-011 | SRS-PHT-022 | Запрос `awaiting_customer` | Клиент подтверждает | `status='confirmed'`, `items_total_tjs` уменьшен, `EscrowLedger` содержит запись частичного рефанда, WS `order.partial_fulfillment_resolved` терминалу |
| TC-PHT-012 | SRS-PHT-023 | Запрос `awaiting_customer` | Клиент отклоняет | Весь заказ → `cancelled`, полный рефанд, резерв всех позиций восстановлен |
| TC-PHT-013 | SRS-PHT-023a | Запрос `awaiting_customer`, `expires_at` наступил | BullMQ-джоб таймаута срабатывает | `status='auto_confirmed_timeout'`, эффект идентичен явному подтверждению (TC-PHT-011) |
| TC-PHT-014 | SRS-PHT-026 | 1 позиция `unavailable` без связанного `order_partial_fulfillment_requests` | `complete-picking(sealConfirmed=true)` | `409 PARTIAL_FULFILLMENT_PENDING` |
| TC-PHT-015 | SRS-PHT-025 | Все позиции решены корректно | `complete-picking(sealConfirmed=false)` | `400 SEAL_CONFIRMATION_REQUIRED` |
| TC-PHT-016 | SRS-PHT-027 | Все позиции `scanned_ok`, `sealConfirmed=true` | `complete-picking` | `200 OK`, `status='picked_up'`, `handoverOtp.code` — 4 цифры, `expiresAt = now+15мин` |
| TC-PHT-017 | SRS-PHT-028 | `status='picked_up'` | `GET handover-otp` | `200 OK`, запись в `audit_log` |
| TC-PHT-018 | SRS-PHT-028 | `status='delivered'` | `GET handover-otp` | `404 HANDOVER_OTP_NOT_FOUND` |
| TC-PHT-019 | SRS-PHT-029 | Код истёк (`now > expiresAt`) | `regenerate` | `200 OK`, новый `code` (≠ старому с вероятностью 9999/10000), старый код больше не проходит серверную проверку курьером |
| TC-PHT-020 | SRS-PHT-029 | 20 регенераций уже выполнено для заказа | `regenerate` (21-я) | `429 RATE_LIMITED` |
| TC-PHT-021 | SRS-PHT-032/034 | `processing`, `now = processing_started_at + 7мин01с` | Watchdog-джоб (мягкий) срабатывает | `SlaBreachedEvent` → WS `ops.sla_breached`, заказ ОСТАЁТСЯ `processing` |
| TC-PHT-022 | SRS-PHT-034 | `processing`, `now = processing_started_at + 12мин01с`, сборка не завершена | Watchdog-джоб (жёсткий) срабатывает | `status='cancelled'`, полный рефанд, `OrderAutoCancelledEvent` |
| TC-PHT-023 | SRS-PHT-066 | Заказ свободен, 2 терминала | Одновременный `accept` с A и B | Ровно один `200 OK`, второй `409 ORDER_ALREADY_CLAIMED` — НЕТ состояния «оба приняли» |
| TC-PHT-024 | SRS-PHT-067 | 2 действия в offline-очереди, `sla`-таймер истёк за время офлайна | Реконнект, отправка очереди | Оба запроса получают `409 INVALID_STATE_TRANSITION`, UI показывает «заказ отменён», очередь очищена |
| TC-PHT-025 | SRS-PHT-068 | Открыт `PickingScreen` | WS `order.cancelled` получен | Экран блокируется модальным диалогом, дальнейшие локальные действия недоступны |
| TC-PHT-026 | SRS-PHT-039 | Двойной тап «Принять» с одним и тем же `Idempotency-Key` (двойной рендер кнопки) | 2 идентичных запроса подряд | Второй получает СОХРАНЁННЫЙ ответ первого (SRS-API-010), НЕ второй вызов use case |
| TC-PHT-027 | SRS-PHT-050 | Приложение свёрнуто, экран заблокирован | WS `order.paid` получен | Full-screen intent включает экран, звук на `STREAM_ALARM` проигрывается ≥1 раз |
| TC-PHT-028 (негативный) | SRS-PHT-016 | `manualEntry=true`, введённая строка длиной 8 символов (не EAN-13) | `scan` | Обрабатывается как `internal_sku` (D-06), НЕ падает как ошибка формата — если резолвится в верный `medicine_id`, успех |
| TC-PHT-029 (негативный) | SRS-PHT-014 | Новая партия того же товара, но ДРУГОЙ аптеки (`pharmacy_inventory_id` не совпадает) | `scan` с чужой партией | `422 BATCH_NOT_AVAILABLE` — замена партии между аптеками запрещена |
| TC-PHT-030 (негативный) | SRS-PHT-005a | `pharmacy_admin` без `filter[pharmacyId]`, сеть из 3 точек | `GET /orders?...` | Ответ содержит заказы всех 3 точек, `meta.groupedBy` присутствует; заказы ЧУЖОЙ сети отсутствуют (тест на межтенантную/межсетевую изоляцию) |
