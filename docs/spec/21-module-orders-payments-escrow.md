# DoruTJ — Модуль Orders + Payments: заказы, платежи, Escrow-ledger, выплаты, возвраты и споры

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `04-SCOPE-DECISION-PIVOT.md` > `03-ARCHITECT-DECISIONS.md` (D-*)
> > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> **`docs/spec/10-domain-model.md` (SRS-DOM-*), `11-database-schema.md` (SRS-DB-*),
> `12-api-conventions-auth-tenancy.md` (SRS-API-*) — ЗАКОН.** Этот документ их НЕ переопределяет —
> только ссылается и добавляет use-case/API/операционный уровень поверх уже зафиксированных
> инвариантов, таблиц и конвенций. Любое расхождение — через ADR, не молчаливую правку.
>
> Покрывает: **CUJ-2** (заказ + Escrow), **CUJ-4** (доставка + capture), **МОДУЛЬ 3 tz.log**
> (Alif Mobi/DC Next + Escrow-защита). Бounded contexts (`10-domain-model.md` §«Ограниченные
> контексты»): **orders**, **payments**, частично **returns**, **disputes** (в части их взаимодействия
> с деньгами/резервом остатка — полная спецификация ролей/тикетов вне денежного аспекта закреплена за
> отдельным SRS «Disputes/Support», если такой заводится Tech Lead'ом отдельно).
>
> Идентификаторы требований этого документа:
> **SRS-ORD-nnn** (корзина/checkout/жизненный цикл заказа/отмены/таймауты),
> **SRS-PAY-nnn** (PaymentProvider/эскроу-ledger/вебхуки/payout),
> **SRS-RET-nnn** (возвраты, денежный и складской аспект),
> **SRS-DISP-nnn** (споры, денежный аспект).
> Каждое требование несёт метку релиза **[R1]/[R2]/[R3]** (см. §«Разбиение по релизам») и ссылку на
> источник (`REQ-*`, `D-*`, `CUJ-*`, `SRS-DOM-*`, `SRS-DB-*`, `SRS-API-*`, `§ТЗ`).

---

## Разбиение по релизам

> Основание: `04-SCOPE-DECISION-PIVOT.md` §3–§5. Принцип: архитектура (порты, ledger, state machines,
> tenant-скоуп) закладывается **целиком в R1** — ретрофит дороже; реальные внешние интеграции (банк)
> откладываются, т.к. заблокированы контрагентом, а не инженерной сложностью.

| Область этого документа | R1 | R2 | R3 | Почему |
|---|---|---|---|---|
| Корзина (мультиаптечная, TTL-резерв, пересчёт, Rx-блокировка) | ✅ полностью | — | — | Ядро продукта (R1-7), внешних блокеров нет |
| Checkout (валидации, расчёт стоимости, адрес/ориентир) | ✅ полностью | — | — | R1-7 |
| `payment_method='cash_courier'` как реальный путь для пользователя | ✅ | — | — | R1-8: единственный включённый способ оплаты в проде R1 (D-16 лимиты) |
| `PaymentProvider` порт + `MockBankProvider` (детерминированный) | ✅ построено и покрыто тестами | — | — | R1-8: «архитектура целиком сразу»; используется в dev/E2E независимо от реальных банков |
| `AlifMobiProvider` / `DcNextProvider` — реальные адаптеры, включение как реальный способ оплаты для пользователя | порт+контракт готовы, адаптер написан по публичным данным, но выключен фиче-флагом | — | ✅ включается после договора с банком (sandbox/ключи) | Заблокировано внешней стороной (банк), не инженерной командой (Pivot §2.2, §5) |
| Escrow-ledger (двойная запись, полный план счетов, инварианты) | ✅ построено и покрыто тестами (через Mock) | — | ✅ реальные деньги через реальный банк | R1-8; для `cash_courier` ledger НЕ используется (REQ-PAY-14) — актуален для банковских методов, которые в R1 выключены для реальных пользователей |
| Вебхук банка, HMAC, идемпотентность, реконсиляция | ✅ построено и покрыто тестами (Mock-провайдер проходит тот же код-путь) | — | ✅ реальные вебхуки Alif/DC | Тот же принцип: порт готов, реальный трафик — R3 |
| Payout аптеке (`payout_schedule`, T+1, заморозка спором) | ✅ модель, расчёт, отчёт аптеке построены и тестируются | — | ✅ реальный банковский перевод (`BankPayoutTransferPort` реальный адаптер) | Расчёт/учёт — не блокирован; физическое перечисление денег банком — блокировано договором |
| B2B-биллинг комиссии за `cash_courier` (`platform_billing_invoices`) | ✅ | — | — | Единственный реальный источник комиссии платформы в R1, раз ledger для cash не используется |
| Возвраты (`order_returns`, restock, courier return fee) | ✅ полностью | — | — | Не заблокировано внешней стороной |
| Возврат денег при `cash_courier` (наличные, без ledger) | ✅ | — | — | REQ-RET-10 |
| Возврат денег при банковской оплате (`PaymentProvider.refund`) | порт+Mock готовы и тестируются | — | ✅ реальный рефанд через банк | Как и вся банковская ветка |
| Раздельный биллинг items/delivery (D-10, стратегия частичного рефанда) | ✅ архитектура и домен реализованы независимо от банка | — | ✅ реально применяется, когда включены банковские методы | Стратегия — доменное решение, не зависит от наличия реального банка |
| Споры (`order_disputes`, заморозка payout, роли, SLA) | ✅ полностью (может применяться и к `cash_courier`-заказам через `platform_billing_invoices`-корректировку) | — | — | D-24, независимо от способа оплаты |
| Отмены заказа (все ветви) | ✅ полностью | — | — | Не заблокировано |
| Таймауты (неоплаченный/несобранный/недоставленный) | ✅ полностью (неоплаченный таймаут практически не срабатывает в R1-проде, т.к. `cash_courier` минует `pending_payment`-ожидание; логика готова для R3) | — | — | Архитектура целиком |
| Фискальный чек (`FiscalReceiptProvider`) на оплаченный заказ | Порт + `MockFiscalProvider`, чек НЕ обязателен к реальной фискализации | — | ✅ реальная фискализация | D-18, регламент ККМ не получен |
| Courier payout / earnings (полная модель компенсации) | ✅ таблицы и джобы существуют, используются модулем Delivery — здесь только точка интеграции (`DeliveryCompletedEvent`) | — | — | Не в периметре ЭТОГО документа (см. §0.2) |

---

## 0. Область действия и соглашения

### 0.1 Что специфицирует этот документ

Полный денежный и заказный контур: от добавления товара в корзину до выплаты аптеке и закрытия
спора. Включает: `cart`/`cart_items`, `orders`/`order_items`, `escrow_ledger`, `payout_schedule`,
`platform_fee`, `payment_operations`, `order_returns` (денежный/складской аспект),
`order_disputes`/`dispute_status_history` (денежный аспект), `platform_billing_invoices`
(B2B-комиссия за `cash_courier`).

### 0.2 Что НЕ специфицирует этот документ (принадлежит другим SRS-модулям)

- Полная механика курьера (назначение, геотрекинг, компенсация `courier_earnings`/`courier_payouts`,
  `tenant_courier_payout_rules`) — модуль **Delivery/Courier**. Здесь используется только как
  потребитель `DeliveryCompletedEvent`/`OrderDeliveredEvent` и как источник `courier_return_fee_diram`.
- Полный конвейер AI-рецептов (OCR, `composite_confidence`, `prescription_status` внутренние переходы)
  — модуль **Prescriptions/AI**. Здесь Rx-инвариант потребляется как чёрный ящик через
  `PrescriptionsFacade.isVerifiedFor(customerId, medicineIds)`.
- Онбординг/верификация аптек (`pharmacy_chains`/`pharmacies` жизненный цикл) — модуль
  **Onboarding/Moderation**. Здесь потребляется как `OnboardingFacade.isPharmacyActive(pharmacyId)`.
- Каталог/поиск/подбор аналогов — модуль **Catalog/Search**. Здесь потребляется как
  `CatalogFacade.getMedicineSnapshot(ids)`.
- Роли/тикеты поддержки вне денежного аспекта (`support_tickets` UI, SLA-нотификации, каналы) —
  упомянуты только там, где они атомарно порождают `order_disputes` (REQ-DISPUTE-2).

### 0.3 Слои (напоминание `02-CLEAN-ARCHITECTURE-AND-CODE.md`)

Все use case классы этого документа живут в `apps/api/src/modules/orders/application/use-cases/*`
и `apps/api/src/modules/payments/application/use-cases/*` (returns/disputes — в своих модулях, но
затрагивающие деньги операции реализованы как вызовы `PaymentsFacade` из `application`-слоя
`returns`/`disputes`, никогда напрямую в `infrastructure`). Порты — `application/ports/*.port.ts`.
Адаптеры (Drizzle-репозитории, `PaymentProvider`-реализации, BullMQ-продюсеры) — `infrastructure/`.
Контроллеры/WS-gateway — `presentation/`, тонкие мапперы DTO↔domain через `application`.

---

## 1. Корзина (Cart)

> Cart — НЕ доменный агрегат (`10-domain-model.md`, комментарий к таблице `cart`): простое хранилище
> выбора товара в `application`/`infrastructure`. Бизнес-инварианты (сплит по аптекам, Rx-блокировка,
> резерв остатка) реализованы **use case'ами**, не методами несуществующей domain-сущности `Cart`.

### 1.1 Мультиаптечная корзина

**SRS-ORD-001** [R1] [Charter схема `cart_items.pharmacy_id`, REQ-UX-4] Каждая строка `cart_items`
привязана к КОНКРЕТНОЙ `(medicine_id, pharmacy_id)` — одна и та же позиция каталога может
одновременно лежать в корзине от разных аптек как РАЗНЫЕ строки (`UNIQUE(cart_id, medicine_id,
pharmacy_id)`, уже в схеме). Клиент видит цену и остаток ИМЕННО той аптеки, из карточки которой товар
добавлен — не агрегированную/среднюю цену.

**SRS-ORD-002** [R1] [REQ-UX-4, SRS-DOM-002] `GET /api/v1/cart` возвращает корзину, УЖЕ
сгруппированную по `pharmacy_id` (`meta.pharmacyGroups: [{ pharmacyId, pharmacyName, items[],
subtotalDiram, distanceMeters }]`), явно показывая пользователю, что оформление породит N отдельных
заказов — ДО перехода к оплате (REQ-UX-4: сплит виден ДО оплаты, не как сюрприз на экране успеха).

**SRS-ORD-003** [R1] `AddCartItemUseCase(cartId, medicineId, pharmacyId, quantity)`: если товар с
`control_category ∈ {psychotropic, narcotic}`, use case возвращает `ControlledSubstanceNotOrderableError`
немедленно на добавление в корзину (SRS-DOM-157) — товар не может попасть в корзину вовсе, не только
в заказ (более раннее выявление ошибки для UX, тот же инвариант, что и на `Order.create()`).

**SRS-ORD-004** [R1] [REQ-SAFETY-1, SRS-DOM-175] `AddCartItemUseCase`, Given в корзине уже есть товар
с пересекающимся множеством `substances` (проверка через `CatalogFacade.getSubstanceSet(medicineId)`),
When добавляется новый товар с непустым пересечением, Then use case эмитирует
`CartWarningEvent(type='duplicate_substance', existingMedicineId, newMedicineId)` — добавление РАЗРЕШЕНО,
клиент видит предупреждение, не блокировку (не доменная ошибка).

### 1.2 Резервирование остатка и его TTL

> Домен резервирует остаток ЖЁСТКО только при `Order.create()` (`PharmacyInventory.reserveForOrder()`,
> SRS-DOM-021, физическая мутация `inventory_batches.quantity`). До этого момента корзина работает с
> ЖИВЫМ (не зафиксированным) остатком. Ниже — механизм МЯГКОГО (soft) UX-резерва на уровне корзины,
> который НЕ мутирует `inventory_batches` и НЕ дублирует доменную резервацию — он существует
> ТОЛЬКО чтобы дать пользователю честный «придержано для вас N:SS» таймер при малом остатке и
> смягчить гонку между несколькими покупателями, целящимися в последние единицы популярного товара.

**SRS-ORD-005** [R1] [РАСШИРЕНИЕ этого SRS, обоснование выше — отсутствует в `10-domain-model.md`/
`11-database-schema.md`, требует подтверждения архитектором как ADR при переносе в тикет] Мягкий
резерв реализован в Redis, НЕ в PostgreSQL: ключ `cart:hold:{pharmacyId}:{medicineId}:{cartItemId}`,
значение — зарезервированное количество, `EXPIRE CART_HOLD_TTL_SECONDS` (ENV, ASSUMPTION `900` — 15
минут). Продлевается (`EXPIRE` заново) при каждом успешном `PATCH` количества этой строки корзины и
при каждом `GET /api/v1/cart`, если клиент явно передал `?extendHold=true` (открытие экрана корзины
пользователем продлевает холд, фоновый поллинг — нет, чтобы не резервировать бесконечно за пассивного
клиента).

**SRS-ORD-006** [R1] «Доступно к заказу» для отображения в каталоге/корзине =
`stock_quantity (SRS-DOM-019) − Σ(активные, ещё не истёкшие cart:hold по этому (pharmacyId,
medicineId), ИСКЛЮЧАЯ холд текущего cartItemId, если пользователь смотрит свою же корзину)`. Расчёт —
`application`-сервис `AvailabilityCalculator`, не домен (домен ничего не знает о Redis-холдах,
`02` §2.6: домен чист от инфраструктуры).

**SRS-ORD-007** [R1] Given `cart:hold` истёк (TTL прошёл), Then строка `cart_items` НЕ удаляется
автоматически — товар остаётся в корзине, но его «доступно к заказу» пересчитывается уже БЕЗ учёта
истёкшего холда (могло уйти к другому покупателю). Следующий `GET /api/v1/cart` показывает актуальную
доступность и, если она упала ниже `cart_items.quantity`, — предупреждение (см. 1.3). Истечение
мягкого холда НЕ бросает ошибку — это ожидаемое штатное поведение, не инцидент.

**SRS-ORD-008** [R1] Мягкий холд — ИСКЛЮЧИТЕЛЬНО advisory (UX). Единственная АВТОРИТЕТНАЯ проверка
остатка — `InventoryFacade.reserveStock(items)` внутри `Order.create()` (жёсткая мутация
`inventory_batches.quantity`, атомарно в транзакции создания заказа). Если Redis временно недоступен,
`AvailabilityCalculator` деградирует до чтения ТОЛЬКО `stock_quantity` без вычета холдов (fail-open по
UX-слою, не по авторитетному слою — checkout всё равно проверит остаток реально, см. SRS-ORD-024).

**SRS-ORD-009** [R1] `cart`/`cart_items` (не путать с холдом остатка) сама корзина хранится в
PostgreSQL без TTL-резервации количества и удаляется отдельной операционной TTL-джобой по
неактивности (`SRS-DB-004`: hard delete, ASSUMPTION `CART_ABANDONED_TTL_DAYS = 30`) — это про очистку
брошенных корзин, НЕ про резерв остатка (два независимых временных окна: 15 минут холда vs 30 дней
хранения самой корзины).

### 1.3 Пересчёт при изменении цены/остатка

**SRS-ORD-010** [R1] [REQ-SYNC-8] `cart_items` НЕ хранит снэпшот цены — `GET /api/v1/cart` каждый раз
JOIN'ит ЖИВУЮ FEFO-цену/остаток из `pharmacy_inventory` (SRS-DOM-020). Цена в корзине — ВСЕГДА
актуальная на момент просмотра, никогда не «замороженная» до checkout (снэпшот `unit_price_tjs`
происходит только в `order_items` при `Order.create()`, SRS-DOM-003).

**SRS-ORD-011** [R1] Given цена товара в корзине изменилась с момента последнего просмотра клиентом
(сравнение по `price_tjs` в ответе предыдущего `GET`, переданному клиентом обратно как
`If-Match-Price` заголовок ИЛИ клиентским кэшем — сравнение делает ФРОНТЕНД, не API), When клиент
открывает корзину повторно, Then UI показывает баннер «цена изменилась» (presentation-слой, не
доменная ошибка) — API-контракт лишь гарантирует, что возвращаемая цена всегда актуальна.

**SRS-ORD-012** [R1] Given `cart_items.quantity > доступный остаток` (после вычета чужих холдов,
SRS-ORD-006) на момент `GET /api/v1/cart`, Then ответ включает `meta.warnings: [{ cartItemId,
type: 'insufficient_stock', availableQuantity }]` — количество в корзине НЕ обрезается автоматически
сервером (обрезка молча искажает намерение пользователя); фронтенд обязан показать предупреждение и
предложить скорректировать перед checkout.

**SRS-ORD-013** [R1] `PATCH /api/v1/cart/items/:id { quantity }`: Given новое `quantity <= 0`, Then
эквивалентно `DELETE` строки (домен `cart_items.chk_cart_items_quantity_positive` не допускает
`quantity <= 0` как персистентное значение — use case удаляет строку, а не пишет невалидное число).

### 1.4 Правила блокировки Rx-позиций

**SRS-ORD-014** [R1] [REQ-REG-2, SRS-DOM-004; полный конвейер верификации — модуль Prescriptions/AI,
§0.2] Товар с `is_prescription_required = true` МОЖЕТ находиться в корзине без привязанного рецепта —
корзина не проверяет Rx-статус на добавление (мягкий UX: пользователь видит бейдж «требуется рецепт»,
не блокировку добавления). Блокировка происходит НА CHECKOUT (§2), не на добавление в корзину.

**SRS-ORD-015** [R1] `CheckoutUseCase` (см. §2.1) вызывает `PrescriptionsFacade.isVerifiedFor(customerId,
[medicineIds Rx-позиций])`. Given хотя бы одна Rx-позиция в выбранном для checkout наборе НЕ покрыта
`verified`-рецептом, Then ЭТА позиция автоматически ИСКЛЮЧАЕТСЯ из текущей попытки оформления (остаётся
в корзине), а не блокирует весь checkout целиком — если после исключения в выбранной группе (по
аптеке) остаются non-Rx или уже покрытые Rx-позиции, заказ по этой аптеке оформляется без исключённых
строк; если группа становится пустой — заказ по этой аптеке просто не создаётся. Ответ `POST
/api/v1/orders` включает `meta.excludedItems: [{ cartItemId, reason: 'PRESCRIPTION_NOT_VERIFIED' }]`.

**SRS-ORD-016** [R1] Given ВСЕ позиции ВСЕХ групп по всем аптекам оказались исключены (корзина состояла
только из непокрытых Rx-товаров), Then `POST /api/v1/orders` возвращает `422
NO_ORDERABLE_ITEMS` (новый код этого документа, §«Ошибки») вместо создания пустого набора заказов —
явная ошибка лучше, чем `200` с `orders: []`.

---

## 2. Оформление заказа (Checkout)

### 2.1 Полный флоу

**SRS-ORD-017** [R1] Эндпоинт: `POST /api/v1/orders`. Заголовок `Idempotency-Key` ОБЯЗАТЕЛЕН
(SRS-API-009) — используется как `checkout_attempt_id` (SRS-DOM-166: ключ идемпотентности ПОПЫТКИ, не
заказа). Тело:

```json
{
  "cartItemIds": ["uuid", "..."],
  "deliveryAddressId": "uuid",
  "deliveryLandmark": "текст, опционально — переопределяет landmark сохранённого адреса на разовый",
  "paymentMethod": "cash_courier | alif_mobi | dc_next",
  "prescriptionIds": ["uuid", "..."]
}
```

`cartItemIds` — явный список выбранных строк корзины (не «вся корзина по умолчанию»): позволяет
оформить только часть корзины за один заход, остальное оставить на потом (REQ-UX-18-совместимо с
последующим повторным заказом).

**SRS-ORD-018** [R1] Пошаговый флоу `CheckoutUseCase.execute(cmd)` внутри `unitOfWork.run()`:

1. Загрузить строки `cart_items` по `cartItemIds`, проверить принадлежность текущему `customerId`
   (или `session_token` для гостя — см. SRS-ORD-020) — иначе `403 FORBIDDEN`.
2. Проверить `OnboardingFacade.isPharmacyActive(pharmacyId)` для КАЖДОЙ затронутой аптеки — не активна
   → эта аптека целиком исключается из текущей попытки (аналогично Rx-исключению, SRS-ORD-015),
   `meta.excludedItems` пополняется причиной `PHARMACY_SUSPENDED`.
3. `SplitCartByPharmacyUseCase.execute(items)` группирует оставшиеся строки по `pharmacy_id` →
   `N` групп (SRS-DOM-002).
4. Для КАЖДОЙ группы, атомарно в рамках ОДНОЙ транзакции на группу (не одна транзакция на весь
   checkout — падение одной аптеки не должно откатывать уже готовые заказы других аптек этого же
   запроса, см. SRS-ORD-019):
   a. `PrescriptionsFacade.isVerifiedFor(...)` — исключить непокрытые Rx-строки (SRS-ORD-015).
   b. `CatalogFacade.getMedicineSnapshot(medicineIds)` — получить `unitPrice`/`isPrescriptionRequired`/
      `controlCategory` АКТУАЛЬНЫЕ на этот момент (не из корзины — корзина могла устареть между
      `GET /api/v1/cart` и `POST /api/v1/orders`).
   c. `InventoryFacade.reserveStock(pharmacyId, items)` — жёсткая мутация. Недостаточно →
      `InsufficientStockError` для ЭТОЙ группы (см. SRS-ORD-023 про частичный успех).
   d. `TenancyFacade.resolveCommissionRate(tenantId, chainId, category)` на каждую позицию
      (SRS-DOM-160) — снэпшот `commission_bps`/`platform_fee_diram`.
   e. Расчёт стоимости (§2.2).
   f. `Order.create(cmd)` — конструктор проверяет ВСЕ инварианты SRS-DOM-002..012 (Rx, control_category,
      total, COD-лимит, статус аптеки).
   g. Given `paymentMethod = 'cash_courier'`: синхронно `order.confirm()` переводит заказ в статус
      **`confirmed`** (НЕ `markPaidEscrow`, НЕ `paid_escrow` — D-25) В ТОЙ ЖЕ транзакции (см. §2.4).
   h. Given `paymentMethod ∈ {'alif_mobi','dc_next'}`: заказ остаётся `pending_payment`,
      `PaymentsFacade.createInvoice(orderId, amountDiram, idempotencyKey=derivedAttemptId)`
      вызывается ПОСЛЕ commit транзакции создания заказа (см. SRS-ORD-025 — не в одной транзакции с
      `Order.create()`, чтобы сетевой таймаут провайдера не откатывал уже созданный заказ).
   i. Запись в `outbox` (`OrderCreatedEvent`/`OrderPaidEvent` для cash) — SRS-DOM-151.
5. Собрать массив результатов групп (успех/ошибка по каждой) → ответ.

**SRS-ORD-019** [R1] Given одна из `N` групп падает с доменной ошибкой (например,
`InsufficientStockError` для аптеки Б), Then ЗАКАЗЫ ОСТАЛЬНЫХ ГРУПП (А, В), успешно созданные СВОИМИ
транзакциями, ОСТАЮТСЯ созданными — `POST /api/v1/orders` возвращает `207`-подобный составной ответ
(HTTP-статус тела `200`, т.к. Charter §5 не использует `207 Multi-Status` — вместо этого единый
конверт с массивом результатов):

```json
{
  "data": {
    "orders": [ { "id": "...", "pharmacyId": "A", "status": "paid_escrow", "...": "..." } ],
    "failedGroups": [ { "pharmacyId": "B", "error": { "code": "INSUFFICIENT_STOCK", "message": "..." } } ]
  },
  "meta": { "excludedItems": [ ... ] }
}
```

Клиент видит: что оформилось, что нет и почему — не «всё или ничего» на уровне корзины из нескольких
аптек (частичный сбой одной аптеки не должен рушить весь чек-аут пользователя).

**SRS-ORD-020** [R1] [Charter §3.4, гостевая корзина] Checkout БЕЗ аутентификации (гостевая корзина по
`session_token`) НЕ разрешён — `POST /api/v1/orders` требует `Authorization: Bearer <JWT>` всегда
(деньги/заказ обязаны быть привязаны к `customer_id`). Гостевая корзина (`cart.session_token`)
существует только до OTP-логина; при логине `MergeGuestCartUseCase` переносит `cart_items` на
`customer_id` (не создаёт дубликат корзины).

### 2.2 Расчёт стоимости

**SRS-ORD-021** [R1] [D-03, SRS-DOM-003, SRS-DOM-008/009] Формула на группу (одна аптека → один
заказ):

```
order_item.total_price_tjs   = order_item.unit_price_tjs × order_item.quantity          (SRS-DOM invariant)
order_item.platform_fee_diram = round(order_item.unit_price_tjs × quantity × commission_bps / 10000)  (в дирамах, D-03)
items_total_tjs               = Σ(order_item.total_price_tjs) по заказу
delivery_fee_tjs              = DeliveryFacade.calculateFee(pharmacyGeoPoint, deliveryGeoPoint)  -- REQ-DELIV-1: базовая ставка + ставка/км × haversine (SRS-DOM-073), НЕ часть этого модуля — вызов через порт
total_amount_tjs              = items_total_tjs + delivery_fee_tjs                        (SRS-DOM-003, БД-constraint chk_orders_total_matches_sum)
```

Комиссия платформы считается ИСКЛЮЧИТЕЛЬНО от `items_total`, никогда от `delivery_fee_tjs`
(SRS-DOM-009, REQ-MON-5) — формула комиссии не принимает `delivery_fee` параметром.

**SRS-ORD-022** [R1] Округление комиссии — банковское округление до целого дирама на КАЖДУЮ позицию
`order_item` отдельно (не на сумму заказа целиком), чтобы `Σ(platform_fee_diram по items)` не
расходилась построчно при аудите конкретной позиции — приемлемая погрешность ≤1 дирам на позицию за
счёт округления, не накапливаемая ошибка на весь заказ.

**SRS-ORD-023** [R1] Given цена/остаток изменились между `GET /api/v1/cart` (что видел пользователь) и
фактическим `POST /api/v1/orders` (шаг 4b выше, живой снэпшот каталога), Then заказ создаётся по
АКТУАЛЬНОЙ цене на момент checkout (не по цене, которую пользователь видел раньше) — сервер никогда не
доверяет цене от клиента (SRS-DOM-003: сумма не принимается от клиента). Если актуальная итоговая
сумма отличается от суммы, которую клиент ПОДТВЕРДИЛ на экране (клиент передаёт `expectedTotalDiram` в
теле запроса опционально), Then Given `expectedTotalDiram` передан И отличается от вычисленного >
`PRICE_DRIFT_TOLERANCE_DIRAM` (ASSUMPTION `0` — точное совпадение), Then эта ГРУППА (аптека) не
оформляется, возвращается `409 PRICE_OR_STOCK_CHANGED` в `failedGroups` с актуальной ценой в
`details.actualTotalDiram` — клиент обязан явно повторить запрос без `expectedTotalDiram` или с
обновлённым значением (защита от «тихого» списания по неожиданной для пользователя сумме).

### 2.3 Выбор адреса, ориентира и способа оплаты

**SRS-ORD-024** [R1] [REQ-GEO-3] `deliveryAddressId` ссылается на `user_addresses` (существующий
сохранённый адрес) ИЛИ тело содержит разовый инлайн-адрес
`{ addressText, landmarkText, latitude, longitude }` без сохранения в `user_addresses` — оба пути
валидны, `GeoPoint.create()` (SRS-DOM-072) валидирует координаты. `deliveryLandmark`, если передан
отдельно от `deliveryAddressId`, ПЕРЕЗАПИСЫВАЕТ (для этого заказа) `landmark_text` сохранённого
адреса без изменения самого сохранённого адреса (одноразовое уточнение «сегодня ориентир другой»).

**SRS-ORD-025** [R1] [D-16, SRS-DOM-007, SRS-DOM-156] Выбор `paymentMethod` валидируется ДВАЖДЫ:
(1) `PolicyResult.isCodAllowed(order)` — `cash_courier` запрещён для Rx-заказов ИЛИ
`total_amount_diram > tenantSettings.codLimitDiram` (дефолт 50000 дирам = 500 TJS); (2) [РАСШИРЕНИЕ
этого SRS] `paymentMethod ∈ tenantSettings.enabledPaymentMethods` (новое поле, см. §«Дополнения к
схеме БД») — в R1 дефолт `{'cash_courier'}` для ВСЕХ тенантов, банковские методы недоступны для
выбора реальным пользователем до включения фичи-флага (R3). Нарушение (1) →
`422 COD_FORBIDDEN_FOR_RX`/`COD_LIMIT_EXCEEDED` (уже определены, `10-domain-model.md`). Нарушение (2)
→ `422 PAYMENT_METHOD_NOT_ENABLED` (новый код).

**SRS-ORD-026** [R1] `prescriptionIds` в теле запроса — явный список рецептов, которые клиент
ЗАЯВЛЯЕТ как покрывающие Rx-позиции этого checkout (UI подставляет автоматически из уже загруженных
верифицированных рецептов клиента). Отсутствие `prescriptionIds` не блокирует checkout целиком — Rx-
позиции без покрытия просто исключаются (SRS-ORD-015), это ПОДСКАЗКА `PrescriptionsFacade`, не
обязательное поле.

### 2.4 `cash_courier`: синхронный переход в `confirmed` (D-25, статус вместо эскроу-обманки)

> **Пересмотрено архитектором 27.08.2026 (D-25).** Версия, ранее стоявшая в этом параграфе
> (синхронный переход `cash_courier` в `paid_escrow` при `Order.create()`), **ОТКЛОНЕНА** и полностью
> заменена ниже. Причина отказа: `paid_escrow` — статус, который по всей системе интерпретируется как
> финансовый факт «деньги захолдированы платформой» (см. §11 «Где лежат деньги»); присваивать его
> заказу, для которого сознательно НЕ создаётся ни одной записи `escrow_ledger`/`payout_schedule`
> (условие, которое старая версия параграфа сама же оговаривала), означает, что статус лжёт о
> финансовом состоянии заказа. Любой отчёт/дашборд/выборка `WHERE status='paid_escrow'` молча включил
> бы наличные заказы с нулевым эскроу; любой разработчик, читающий `paid_escrow`, обоснованно
> предположил бы существование ledger-записей — и написал бы код, падающий или считающий неверную
> сумму. Нарушение §2 `02-CLEAN-ARCHITECTURE-AND-CODE.md`: сущность обязана защищать инварианты, а не
> имитировать их.

**SRS-ORD-027** [R1] [D-25, уточняет SRS-DOM-089/091 для `payment_method='cash_courier'` — требует
добавления значения `confirmed` в `order_status` в `10-domain-model.md`/`11-database-schema.md`,
тикет фазы Tech Lead, см. D-25 п.«Обязательные правки»] Для `cash_courier` не существует внешнего
платёжного провайдера, который прислал бы вебхук — оплата физически происходит в момент
`markDelivered()` (SRS-DOM-040, `recordCash`), а не банковское событие. Поэтому:

1. `Order.create()` для `cash_courier` СИНХРОННО, в ТОЙ ЖЕ транзакции, вызывает `order.confirm()` сразу
   после конструирования — заказ НИКОГДА не наблюдается извне в статусе `pending_payment`, если
   `payment_method='cash_courier'` (переход происходит до того, как HTTP-ответ покидает сервер).
   Результирующий статус — **`confirmed`**, НЕ `paid_escrow`. `payment_transaction_id` — `NULL` (нет
   внешней транзакции, не будет никогда для этого заказа).
2. `confirmed` означает буквально: «заказ подтверждён и готов к принятию аптекой; денежных
   обязательств платформы перед аптекой ещё не возникло» — рабочий статус (готовность к сборке), а
   не финансовый эскроу-факт. `escrow_ledger`/`payout_schedule` НЕ создаются вовсе при этом переходе
   (REQ-PAY-14, см. §4.6) — и не создаются НИКОГДА для этого заказа, что теперь СОГЛАСУЕТСЯ со
   статусом, а не противоречит ему.
3. Путь наличного заказа целиком: `confirmed → processing` (`pharmacist`, условия/эффекты идентичны
   SRS-DOM-091 — старт SLA-таймера сборки, `OrderProcessingStartedEvent`) `→ picked_up → delivered`.
   `paid_escrow` НЕ встречается на этом пути ни на одном шаге.
4. Симметричная ветвь отмены: `confirmed → cancelled` — система/`super_admin`, по истечении
   `pickup_sla + pickup_sla_buffer` без принятия фармацевтом (условие идентично SRS-DOM-092), БЕЗ
   вызова рефанда (возвращать нечего — наличные ещё не собраны) и только `InventoryFacade.
   releaseStock(items)`. Подробности и денежный эффект — §10.2 (SRS-ORD-035/036, обновлены под
   `confirmed`).
5. Запрещённые переходы (дополняют SRS-DOM-102, правка в `10-domain-model.md`): `confirmed →
   paid_escrow` и `paid_escrow → confirmed` в обе стороны — эти два статуса описывают взаимно
   исключающие финансовые истории одного и того же заказа (наличные vs эскроу), переход между ними
   не имеет доменного смысла ни в одном направлении.

**SRS-ORD-027a** [R1] [D-25 п.4, НОВЫЙ ИНВАРИАНТ, обязателен к покрытию тестом] `order.status ===
'paid_escrow' ⟺ для заказа существуют записи escrow_ledger` (как минимум `hold_created`). Ранее (при
отклонённой версии этого параграфа) инвариант был непроверяем, т.к. синхронный `cash_courier →
paid_escrow` его нарушал by design — заказ был `paid_escrow`, а `escrow_ledger` пуст. Введение
`confirmed` как ОТДЕЛЬНОГО статуса делает эту ложь в модели структурно невозможной: `paid_escrow`
достижим только через `HandlePaymentWebhookUseCase` (§5.1, SRS-PAY-018), который атомарно, в ОДНОЙ
транзакции, пишет и статус, и `EscrowLedger.recordHold()` — расхождение исключено на уровне
единственной точки записи. Тест — `EscrowInvariantSpec`: для КАЖДОГО заказа в БД проверяет
эквивалентность в обе стороны (см. новый TC в разделе «Тестовые сценарии»).

**SRS-ORD-028** [R1] Given `payment_method ∈ {'alif_mobi','dc_next'}`, Then поведение НЕ меняется
относительно `10-domain-model.md`: заказ остаётся `pending_payment` до подписанного вебхука
(SRS-DOM-089), `payment_transaction_id` заполняется только вебхуком, статус, достижимый из
`pending_payment` по этому пути, — ИСКЛЮЧИТЕЛЬНО `paid_escrow`, никогда `confirmed` (`confirmed`
достижим только из `cash_courier`-ветки §2.4, non-cash никогда в него не попадает).

---

## 3. `PaymentProvider` — порт и провайдеры

### 3.1 Полный интерфейс порта

**SRS-PAY-001** [R1] [Charter §3.3, D-02, D-10, REQ-PAY-10] Порт объявлен в
`apps/api/src/modules/payments/application/ports/payment-provider.port.ts`:

```typescript
export interface PaymentProviderCapabilities {
  readonly providerName: 'alif_mobi' | 'dc_next' | 'mock_bank';
  readonly supportsHoldCapture: boolean;   // D-02: банковский hold/capture, а не программный ledger
  readonly supportsPartialRefund: boolean; // D-10: если false — раздельный биллинг items/delivery
  readonly maxInvoiceValidityMinutes: number; // окно, в течение которого QR/deeplink валиден
}

export interface CreateInvoiceCommand {
  readonly orderId: OrderId;
  readonly amountDiram: bigint;
  readonly currency: 'TJS';
  readonly idempotencyKey: string;         // = checkout_attempt_id-производная (SRS-DOM-166)
  readonly description: string;            // "Заказ DTJ-260827-00001"
  readonly customerPhone: PhoneNumber;
}

export interface InvoiceRef {
  readonly providerRef: string;            // ID счёта на стороне банка
  readonly qrPayload: string;               // содержимое QR / deeplink URI (REQ-UX-16: QR — первый способ)
  readonly expiresAt: Date;
}

export interface PaymentStatusSnapshot {
  readonly providerRef: string;
  readonly status: 'pending' | 'paid' | 'failed' | 'expired';
  readonly amountDiram: bigint;
  readonly paidAt: Date | null;
}

export interface RefundRef {
  readonly providerRefundRef: string;
  readonly amountDiram: bigint;
  readonly status: 'pending' | 'succeeded' | 'failed';
}

export interface PaymentProvider {
  capabilities(): PaymentProviderCapabilities;
  createInvoice(cmd: CreateInvoiceCommand): Promise<Result<InvoiceRef, PaymentProviderError>>;
  getStatus(providerRef: string): Promise<Result<PaymentStatusSnapshot, PaymentProviderError>>;
  refund(providerRef: string, idempotencyKey: string): Promise<Result<RefundRef, PaymentProviderError>>;
  partialRefund(
    providerRef: string, amountDiram: bigint, idempotencyKey: string
  ): Promise<Result<RefundRef, PaymentProviderError>>; // бросает NotSupportedByProviderError, если !supportsPartialRefund
  // Опциональны (REQ-PAY-10) — эскроу НЕ зависит от их наличия, вызываются только если supportsHoldCapture:
  capturePreauth?(providerRef: string, amountDiram: bigint): Promise<Result<CaptureRef, PaymentProviderError>>;
  voidPreauth?(providerRef: string): Promise<Result<void, PaymentProviderError>>;
}
```

**SRS-PAY-002** [R1] `getStatus()` — ИСКЛЮЧИТЕЛЬНО для реконсиляции (§5.6) и диагностики
(`GET /api/v1/orders/:id/payment-status`, роль `super_admin`/владелец заказа). Он НИКОГДА не вызывается
для смены `order.status` — единственный путь смены статуса оплаты остаётся вебхук (§5.1,
категорический запрет). Опрос `getStatus()` в цикле как замена вебхука — архитектурное нарушение,
блокирующее замечание код-ревью.

**SRS-PAY-003** [R1] `refund()`/`partialRefund()`/`createInvoice()` ПРИНИМАЮТ явный `idempotencyKey`
(REQ-PAY-8) — реализация адаптера обязана либо передать его провайдеру нативно (если банк
поддерживает идемпотентные вызовы), либо самостоятельно защититься локальной таблицей
`payment_operations` (UNIQUE на `idempotency_key`, уже в схеме) ПЕРЕД сетевым вызовом — «проверить
локально, затем вызвать провайдера» порядок обязателен, чтобы повторный вызов с тем же ключом никогда
не достиг сети провайдера дважды.

### 3.2 `MockBankProvider` [R1]

**SRS-PAY-004** [R1] [Charter §3.3, DoD п.7 «без единого внешнего API-ключа»] `MockBankProvider`
(`infrastructure/adapters/payments/mock-bank.provider.ts`) — детерминированный, без сети:

- `capabilities()`: `{ providerName: 'mock_bank', supportsHoldCapture: false, supportsPartialRefund:
  false, maxInvoiceValidityMinutes: 15 }` — НАМЕРЕННО отражает реалистичные (по research 03)
  ограничения Alif/DC, чтобы тесты реально проверяли ветку «раздельный биллинг» (D-10), а не
  оптимистичный случай, который в проде недостижим.
- `createInvoice()`: немедленно создаёт `payment_operations(operation_type='create_bill',
  status='pending')`, возвращает `providerRef = 'mock_inv_' + uuid()`, `qrPayload = 'mock://pay/' +
  providerRef` (используется E2E-тестами/Playwright как узнаваемый маркер, не реальный QR-стандарт).
- Given `MOCK_BANK_AUTO_PAY_DELAY_MS` (ENV, ASSUMPTION `2000`) `> 0`: планирует (BullMQ delayed job)
  САМ ОТПРАВЛЯЕТ HTTP-запрос на `POST /api/v1/payments/webhook` этого же инстанса API с
  `X-Payment-Provider: mock_bank`, подписанным ТЕМ ЖЕ HMAC-кодом, что использовал бы реальный банк
  (см. §5.2) — гоняет РЕАЛЬНЫЙ код-путь верификации подписи в dev/E2E, не байпас. Given
  `MOCK_BANK_AUTO_PAY_DELAY_MS = 0`: авто-вебхук выключен, оплата симулируется только явным dev-only
  эндпоинтом (ниже) — нужно для тестов, проверяющих именно состояние `pending_payment`.
- Dev-only эндпоинт (доступен, только если `PAYMENT_DRIVER=mock_bank` И `NODE_ENV !== 'production'`):
  `POST /api/v1/dev/mock-bank/simulate-payment { providerRef, outcome: 'paid'|'failed' }` — триггерит
  тот же вебхук вручную, для управляемых Playwright-сценариев (CUJ-2).
- `refund()`/`partialRefund()`: `partialRefund` возвращает `NotSupportedByProviderError`
  (`capabilities().supportsPartialRefund === false`) — вызывающий код (домен, D-10) обязан были
  заранее выбрать стратегию раздельного биллинга, а не полагаться на провайдера. `refund()` —
  синхронно успешен, эмулирует `refund_confirmed`-вебхук с тем же `MOCK_BANK_AUTO_PAY_DELAY_MS`.

**SRS-PAY-005** [R1] `MOCK_BANK_WEBHOOK_SECRET` (ENV, генерируется при первом запуске dev-окружения,
`.env.example` содержит плейсхолдер) — используется ТЕМ ЖЕ HMAC-алгоритмом, что и реальные адаптеры
(§5.2), чтобы код верификации подписи был ОДИН для всех провайдеров (полиморфизм по `providerName`,
не отдельная ветка `if (isMock)` в обработчике вебхука — иначе mock перестаёт быть честной проверкой
контракта, Charter §2 DoD п.6).

### 3.3 `AlifMobiProvider` / `DcNextProvider` [R3, порт и заготовка адаптера — R1]

**SRS-PAY-006** [R1 — заготовка адаптера и конфигурация; R3 — реальное включение] Поскольку ни один
банк РТ не публикует техническую документацию API для мерчантов (research 03, дайджест п.3), точные
имена заголовков/полей вебхука и `createInvoice`-контракта Alif/DC — **ASSUMPTION**, смоделированы по
публично доступной документации Alifpay (Узбекистан) как БЛИЖАЙШИЙ референс, НЕ гарантированно
идентичны реальному контракту Alif Bank TJ. Реализация:
`infrastructure/adapters/payments/alif-mobi.provider.ts` / `dc-next.provider.ts` существуют,
компилируются, покрыты unit-тестами на предполагаемом контракте, но НЕ подключаются к реальному
production-трафику до получения реального контракта банка (R3) — переключение `PAYMENT_DRIVER=alif_mobi`
в проде заблокировано на уровне `tenant_settings.enabledPaymentMethods` (SRS-ORD-025), а не удалением
кода.

**SRS-PAY-007** [R3] `capabilities()` ASSUMPTION для реальных банков: `supportsHoldCapture: false`
(research 03 §2.5: hold у Alifpay привязан к токену карты, недоступен для QR-инвойса без сохранённой
карты — сценарий DoruTJ), `supportsPartialRefund: false` (research 08-3 §7.2, REQ-RET-6) — ЭТО И ЕСТЬ
причина, по которой раздельный биллинг items/delivery (D-10, §7.5) — не гипотетический, а
единственный рабочий путь частичного возврата в проде.

**SRS-PAY-008** [R1, архитектура; R3, реальные значения] Точный контракт `createInvoice`/webhook-схема
Alif/DC подлежит уточнению по факту получения реального договора/sandbox (D-01/D-24 открытые вопросы
владельца продукта) — вносится через ADR, не молчаливой правкой адаптера; интерфейс порта (§3.1)
спроектирован достаточно абстрактно, чтобы не потребовать изменения `application`-слоя при уточнении.

### 3.4 Выбор провайдера

**SRS-PAY-009** [R1] `ENV PAYMENT_DRIVER ∈ {'mock_bank','alif_mobi','dc_next'}` — единственный
переключатель на уровне DI (`{ provide: PAYMENT_PROVIDER_TOKEN, useClass: ... }` в
`payments.module.ts`), не влияет на `application`/`domain` код (Charter §3.3 Provider Pattern). ОДНА
инсталляция API обслуживает ОДИН `PAYMENT_DRIVER` глобально (не per-tenant в R1 — White-Label
per-tenant мерчант-креды/провайдер, `tenant_settings.merchant_credentials_ref`, реализуются как
дополнительный параметр адаптера, но сам ВЫБОР класса адаптера — не per-tenant в R1, только per-ENV;
per-tenant выбор ПРОВАЙДЕРА, не только кредов, — открытый вопрос R3 White-Label, зафиксирован как
ASSUMPTION).

---

## 4. Escrow-ledger — двойная запись

> Полный набор инвариантов (`SRS-DOM-031..035`), таблица (`escrow_ledger`), типы проводок
> (`escrow_entry_type`) и агрегат (`EscrowLedger`) уже определены как ЗАКОН в `10-domain-model.md`/
> `11-database-schema.md`. Этот раздел добавляет: полный план счетов (бухгалтерская интерпретация),
> явную формулу инварианта, механизм ПРОВЕРКИ (не только формулировку) и API/use-case уровень.

### 4.1 План счетов

> Концептуальный, не отдельная SQL-таблица счетов — `escrow_ledger.entry_type` уже кодирует счёт,
> ниже — читаемая интерпретация для разработчика/бухгалтера.

| Счёт (концептуальный) | `entry_type` | `direction` | Когда возникает | Что означает |
|---|---|---|---|---|
| **Клиентские средства на удержании** (эскроу) | `hold_created` | `debit` (деньги «зашли» в контур эскроу со стороны клиента) | Вебхук `PAID_HOLD` (§5.3) | Клиент оплатил, деньги физически на счету банка-эквайера, юридически удержаны платформой до вручения (D-17: ledger учётный, не расчётный) |
| **Доход платформы (комиссия)** | `platform_fee_captured` | `credit` | `delivered`, атомарно с `captured_to_pharmacy` (SRS-DOM-032) | Комиссия платформы признана заработанной |
| **Кредиторская задолженность перед аптекой** | `captured_to_pharmacy` | `credit` | `delivered`, та же транзакция | Сумма, причитающаяся аптеке (ещё не выплаченная физически — это делает `payout_schedule`, §6) |
| **Возврат клиенту (полный)** | `refunded_to_customer` | `credit` (списание с контура эскроу обратно клиенту) | `resolveRefundFull`/авто-рефанд по таймауту | Полная сумма `hold_created` возвращается клиенту через `PaymentProvider.refund()` |
| **Возврат клиенту (частичный)** | `partially_refunded` | `credit` | `resolveRefundPartial`/`OrderReturn` частичный возврат | Часть суммы возвращается, остаток продолжает путь к payout |
| **Корректировка (пост-факту)** | `adjustment` | `debit` ИЛИ `credit` (см. `EscrowLedgerEntry.direction`) | `resolveAdjustment` (только после `payout_schedule.status='paid'`, SRS-DOM-063) | Взаимозачёт против уже выплаченной аптеке суммы, зачитывается в СЛЕДУЮЩИЙ payout (SRS-DOM-163) |

**SRS-PAY-010** [R1] [SRS-DOM-033, REQ-MON-3] Формула инварианта (буквально, для реализации
`EscrowLedger.isBalanced()`):

```
Σ(amount WHERE entry_type='hold_created')
  ==
Σ(amount WHERE entry_type='platform_fee_captured')
  + Σ(amount WHERE entry_type='captured_to_pharmacy')
  + Σ(amount WHERE entry_type IN ('refunded_to_customer','partially_refunded'))
  + Σ(amount WHERE entry_type='adjustment' AND direction='credit')
  − Σ(amount WHERE entry_type='adjustment' AND direction='debit')
```

на группировке `GROUP BY order_id` — считается ТОЛЬКО для заказов, где хотя бы ОДНА запись
`hold_created` существует (для `cash_courier`-заказов `escrow_ledger` пуст целиком — не участвует в
этой проверке вовсе, см. §4.6).

### 4.2 Единственная точка мутации ledger

**SRS-PAY-011** [R1] [SRS-DOM-031] `EscrowLedger`-репозиторий (`infrastructure/repositories/
escrow-ledger.repository.ts`) экспонирует ТОЛЬКО `append(entry): Promise<void>` и READ-методы
(`findByOrderId`, `sumByType`). Метода `update`/`delete` НЕ существует в публичном интерфейсе
репозитория (компиляционная гарантия, не только договорённость) — дублируется операционной гарантией
на уровне роли БД (`REVOKE UPDATE, DELETE`, SRS-DB-024/030).

**SRS-PAY-012** [R1] `CaptureEscrowUseCase.execute(orderId)` — единственный вызывающий код для
`platform_fee_captured` + `captured_to_pharmacy`: подписан на `OrderDeliveredEvent`
(`delivery → payments`, SRS-DOM бounded-context матрица), НЕ вызывается напрямую ни из какого
контроллера. Идемпотентен по `orderId` (Given записи уже существуют для этого `orderId`, When событие
доставлено повторно (at-least-once, SRS-DOM-152), Then no-op — проверка через `processed_events`
таблицу ПЕРЕД вызовом домена, SRS-DB `processed_events`).

### 4.3 Верификация инварианта (не только формула — механизм)

**SRS-PAY-013** [R1] [REQ-PAY-9] `EscrowReconciliationJob` (BullMQ repeatable, cron
`RECONCILIATION_CRON` ASSUMPTION `'0 3 * * *'` — 03:00 Asia/Dushanbe, после ночной 1С-синхронизации,
не одновременно с ней, чтобы не конкурировать за ресурсы БД): для каждого `order_id`, имеющего хотя бы
одну запись `escrow_ledger` за истекшие сутки, выполняет запрос из §4.1 и, Given результат `≠ 0`, Then
создаёт `audit_log(category='ledger_adjustment', metadata={ orderId, discrepancyDiram })` +
`support_tickets(channel='system_auto', category='payment_issue', is_escrow_blocking=false)` (REQ-
DISPUTE-17) — job НЕ пытается исправить расхождение автоматически (финансовые расхождения требуют
человеческого расследования, `super_admin`), только алертит.

**SRS-PAY-014** [R1] Метрика `escrow_ledger_imbalance_count` (Prometheus-совместимый counter,
Charter §7 «наблюдаемость») инкрементируется на каждое обнаруженное расхождение — используется как
операционный алерт (`>0` за сутки — страница дежурному, не молчаливый лог).

### 4.4 Use case'ы, работающие с ledger

**SRS-PAY-015** [R1] Полный список use case'ов модуля `payments` (по одному классу на сценарий,
`02` §3.1):

| Use case | Триггер | Действие |
|---|---|---|
| `CreatePaymentInvoiceUseCase` | После commit `Order.create()` для non-cash | `PaymentProvider.createInvoice()`, сохраняет `payment_operations` |
| `HandlePaymentWebhookUseCase` | `POST /api/v1/payments/webhook` | HMAC-проверка, идемпотентность, `order.markPaidEscrow()`, `EscrowLedger.recordHold()` |
| `CaptureEscrowUseCase` | `OrderDeliveredEvent` | `EscrowLedger.captureOnDelivery()`, создание `payout_schedule(status='pending')` |
| `RefundOrderUseCase` | Отмена/возврат/спор | `PaymentProvider.refund()`/`partialRefund()`, `EscrowLedger.refund()`/`partiallyRefund()` |
| `AdjustLedgerUseCase` | `resolveAdjustment` (спор после payout) | `EscrowLedger.adjust()`, помечает следующий payout к вычету |
| `EscrowReconciliationJob` | Cron | См. SRS-PAY-013 |
| `PayoutSchedulerJob` | Cron | См. §6 |

### 4.5 API поверх ledger

**SRS-PAY-016** [R1] `GET /api/v1/orders/:id/ledger` — роль `super_admin` (полностью) или
`pharmacy_admin` своей сети (только записи `captured_to_pharmacy`/`platform_fee_captured`,
относящиеся к её payout, БЕЗ деталей `hold_created`/провайдерских ссылок — политика видимости, не
guard). Ответ — упорядоченный по `created_at` список записей, `meta.isBalanced: boolean` (вызов
`isBalanced()` на лету для этого заказа, не дожидаясь ночной джобы).

### 4.6 `cash_courier` — явное исключение

**SRS-PAY-017** [R1] [REQ-PAY-14, REQ-RET-10, REQ-DELIV-4] Для `payment_method='cash_courier'` НИ
ОДНА запись `escrow_ledger`/`payout_schedule` НЕ создаётся НИКОГДА, на всём жизненном цикле заказа
(`confirmed → processing → picked_up → delivered`, §2.4), включая отмену/возврат/спор — комиссия
платформы за такие заказы взимается ОТДЕЛЬНО через `platform_billing_invoices` (B2B, §6.5), не через
ledger. `CaptureEscrowUseCase`/`RefundOrderUseCase` проверяют `order.paymentMethod === 'cash_courier'`
первым шагом и переходят в НЕТ-ОП с логированием (не ошибка — это ожидаемая ветка, не дефект),
делегируя дальнейшую судьбу наличных `delivery_assignments.cash_collected_diram`/`cash_change_diram`
(уже в схеме, домен `delivery`).

**SRS-PAY-017a** [R1] [D-25 п.8] Физический факт получения наличных курьером фиксируется В МОМЕНТ
вручения — там же, где он реально происходит, — а не отдельным финансовым событием этого модуля:

1. Курьер вызывает `assignment.recordCash(collectedDiram, changeDiram)` (SRS-DOM-040,
   `delivery_assignments.cash_collected_diram`/`cash_change_diram` — то же поле, которое D-25
   называет `courier_cash_collected`) ДО `markDelivered()`; конструктор проверяет `collectedDiram −
   changeDiram === order.totalAmountDiram` (`CashAmountMismatchError` при расхождении) — платформа не
   доверяет курьеру на слово, сумма арифметически привязана к сумме заказа.
2. Только после успешного `recordCash()` разрешён `assignment.markDelivered(otp)` → `order.status =
   'delivered'` (SRS-DOM-095/039) — тот же переход `picked_up → delivered`, что и для non-cash
   заказов; ветвление по `payment_method` НЕ создаёт отдельного статуса заказа на этом шаге.
3. **Ledger-проводки, создаваемые этим событием: НИ ОДНОЙ.** `escrow_ledger` остаётся пустым для
   этого `order_id` (SRS-PAY-017) — `recordCash()`/`markDelivered()` НЕ вызывают `EscrowLedger.
   append()` ни в каком виде; `CaptureEscrowUseCase`, подписанный на тот же `OrderDeliveredEvent`,
   проверяет `paymentMethod === 'cash_courier'` первым шагом и НЕТ-ОП (SRS-PAY-017). Единственный
   финансовый след операции — сама запись `delivery_assignments.cash_collected_diram`/
   `cash_change_diram` (домен `delivery`, вне периметра этого документа, §0.2) и последующее
   агрегирование комиссии через `platform_billing_invoices` (§6.5, SRS-PAY-036) — НЕ через
   `escrow_ledger`.

---

## 5. Вебхуки банка

### 5.1 Категорический запрет

**SRS-PAY-018** [R1] [Charter §5, REQ-PAY-1, ужесточено D-25] `order.markPaidEscrow()`/`EscrowLedger.
recordHold()` НЕ вызываются НИ ИЗ ОДНОГО другого места в кодовой базе, кроме
`HandlePaymentWebhookUseCase`. Исключение из этого запрета — **ОДНО, и только одно**:
`AdminPaymentOverrideUseCase` (роль `super_admin`, обязательный `reason`, запись
`audit_log(category='payment_override')`) — используется ТОЛЬКО для ручного расследованного случая
(например, банк подтвердил оплату по телефону поддержки, а вебхук технически не дошёл из-за сбоя
маршрутизации на стороне банка); каждый вызов `AdminPaymentOverrideUseCase` дополнительно эмитирует
алерт дежурному (не тихая операция, несмотря на легитимность). Любой ДРУГОЙ путь смены статуса оплаты
(прямой `UPDATE orders SET status='paid_escrow'`, вызов домена из контроллера в обход вебхука, ручной
SQL) — блокирующее нарушение на код-ревью, дефект НЕЗАВИСИМО от того, работает ли фича.

**`cash_courier` ПЕРЕСТАЛ БЫТЬ вторым исключением (D-25).** До D-25 синхронный переход
`cash_courier`-заказа при `Order.create()` фактически был ВТОРЫМ путём, минующим вебхук — параграф
§2.4 явно называл его «расширением», требующим ADR. После D-25 такой необходимости больше нет:
`cash_courier` НЕ вызывает `order.markPaidEscrow()`/`EscrowLedger.recordHold()` вовсе — он вызывает
`order.confirm()` в статус **`confirmed`** (§2.4, SRS-ORD-027), который лежит СНАРУЖИ state machine
`pending_payment ⇄ paid_escrow` целиком. Формулировка запрета этого пункта (SRS-PAY-018) поэтому НЕ
ослабляется и не нуждается в упоминании `cash_courier` как оговорки — `paid_escrow` для наличных
заказов недостижим структурно (запрещённый переход `confirmed → paid_escrow`, §2.4 п.5), а не только
по соглашению кода. Единственное исключение из категорического запрета остаётся ровно одно —
`AdminPaymentOverrideUseCase`.

### 5.2 Эндпоинт и проверка подписи

**SRS-PAY-019** [R1] Эндпоинт: `POST /api/v1/payments/webhook` (единственный, не параметризован по
провайдеру в пути — SRS-API-037: у системного принципала `bank_webhook` жёстко один маршрут).
Обязательный заголовок `X-Payment-Provider: alif_mobi | dc_next | mock_bank` — определяет, какой
`BankWebhookVerifierPort`-адаптер обрабатывает тело. Given значение заголовка не зарегистрировано ни
одним адаптером, Then `400 WEBHOOK_PROVIDER_UNKNOWN` (новый код) — тело НЕ обрабатывается вовсе.

**SRS-PAY-020** [R1] [REQ-PAY-2] Порядок обработки — HMAC-проверка ВСЕГДА ДО десериализации бизнес-
полей тела (парсинг JSON бизнес-схемой Zod происходит ПОСЛЕ подтверждения подписи, не до):

1. Прочитать `rawBody` (сырые байты, до JSON.parse — подпись покрывает байты, как они пришли по
   проводу, тот же принцип, что §3.6 API-конвенций для 1С).
2. Резолвить `BankWebhookVerifierPort` по `X-Payment-Provider`.
3. `verifier.verify(rawBody, headers)` → `Result<VerifiedWebhookPayload, InvalidWebhookSignatureError>`.
   Несовпадение → `401 INVALID_WEBHOOK_SIGNATURE` — ЛОГИРУЕТСЯ как `audit_log`-подозрительное событие
   (потенциальная попытка подделки), но НЕ создаёт `support_ticket` автоматически (частота ложных
   срабатываний от сканеров/ботов слишком высока для авто-эскалации; агрегированная метрика — да).
4. Только после успеха шага 3 — `JSON.parse(rawBody)` + Zod-валидация схемы `PaymentWebhookPayload`
   (`packages/contracts`).

**SRS-PAY-021** [R1] `VerifiedWebhookPayload` (единый внутренний формат ПОСЛЕ адаптер-специфичного
парсинга, до бизнес-обработки):

```typescript
interface VerifiedWebhookPayload {
  readonly bankEventId: string;       // уникальный ID события на стороне банка — ключ идемпотентности
  readonly providerRef: string;       // ID счёта/операции, созданного через createInvoice()/refund()
  readonly type: 'payment_confirmed' | 'payment_failed' | 'refund_confirmed' | 'refund_failed';
  readonly amountDiram: bigint;
  readonly occurredAt: Date;          // время события НА СТОРОНЕ БАНКА (для сортировки out-of-order)
}
```

Точная схема HMAC/заголовков КАЖДОГО реального банка — ASSUMPTION адаптера (§3.3, R3); формат
`VerifiedWebhookPayload` — единственное, что видит `HandlePaymentWebhookUseCase`, независимо от банка
(изоляция бизнес-логики от банк-специфичного формата — цель Provider Pattern).

### 5.3 Идемпотентность

**SRS-PAY-022** [R1] [REQ-PAY-3, SRS-DOM-164] `payment_operations.idempotency_key` для входящего
вебхука = `bankEventId`. `HandlePaymentWebhookUseCase`:

```
BEGIN
  INSERT INTO payment_operations (idempotency_key, ...) VALUES (:bankEventId, ...)
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id;
  Given ничего не вставлено (конфликт) → COMMIT, вернуть 200 OK немедленно, business-логика НЕ
    выполняется повторно (уже обработано ранее).
  Given вставлено → выполнить бизнес-логику (markPaidEscrow/recordHold и т.д.) В ЭТОЙ ЖЕ транзакции.
COMMIT
```

**SRS-PAY-023** [R1] Ответ `200 OK` возвращается В ТЕЧЕНИЕ окна ретраев банка (~1 час, REQ-PAY-3) —
конкретно: синхронно в течение HTTP-запроса, т.к. вся бизнес-логика (`markPaidEscrow` + `recordHold`)
— быстрая транзакционная операция БД, не требующая внешних вызовов (никакого исходящего сетевого
вызова из обработчика вебхука, кроме записи в `outbox` — событие публикуется АСИНХРОННО воркером,
SRS-DOM-151). Уведомления/дальнейшая логика — через подписчиков `OrderPaidEvent`, не блокируют ответ
банку.

### 5.4 Защита от replay

**SRS-PAY-024** [R1] Replay-защита — ДВУХУРОВНЕВАЯ: (1) UNIQUE-констрейнт на `idempotency_key`
(SRS-PAY-022, защищает от повторной ОБРАБОТКИ); (2) адаптер-специфичная защита на уровне ТРАНСПОРТА
(например, `X-Bank-Timestamp` окно ±5 минут + одноразовый `X-Bank-Nonce` в Redis с `SET NX EX`, тот же
паттерн, что и 1С §3.6 API-конвенций) — там, где банк передаёт такие заголовки. Given банк НЕ
предоставляет timestamp/nonce в вебхуке (после уточнения реального контракта, R3), Then уровень (1)
— единственная и ДОСТАТОЧНАЯ защита (идемпотентность по `bankEventId` покрывает и повтор, и replay
атакующего, у которого нет валидного `bankEventId` без знания HMAC-секрета).

### 5.5 Порядок обработки при out-of-order доставке

**SRS-PAY-025** [R1] Given `refund_confirmed`-вебхук приходит РАНЬШЕ соответствующего
`payment_confirmed` (гипотетическая гонка бank-side маршрутизации), Then `HandlePaymentWebhookUseCase`
для типа `refund_confirmed`/`refund_failed` ищет существующую строку `payment_operations
(operation_type IN ('refund','partial_refund'), provider_ref=:providerRef, status='pending')` — Given
строка НЕ найдена (наш собственный `refund()`-вызов ещё не зарегистрирован либо вообще не
инициировался), Then вебхук трактуется как «неизвестный платёж» (§5.6), НЕ создаёт спекулятивную
запись ledger.

**SRS-PAY-026** [R1] Given ДВА вебхука для РАЗНЫХ `orderId` приходят конкурентно (SRS-DOM-165), Then
каждый обрабатывается в своей транзакции с `SELECT ... FOR UPDATE` на строку `orders`/
`payout_schedule` СВОЕГО заказа — построчная блокировка, не создаёт узкое место для несвязанных
заказов (уже задокументировано в domain-model, здесь — подтверждение на уровне API-обработчика: один
HTTP-воркер Fastify обрабатывает вебхуки параллельно, без глобального мьютекса на весь эндпоинт).

**SRS-PAY-027** [R1] Given `payment_confirmed` приходит ПОСЛЕ того, как заказ уже был отменён клиентом
(`order.status = 'cancelled'`, оплата пришла с опозданием после того, как клиент/система уже отменили
заказ по таймауту — гонка между авто-отменой и медленным банком), Then `HandlePaymentWebhookUseCase`
НЕ переводит отменённый заказ обратно в `paid_escrow` (SRS-DOM-102: запрещён любой переход `→
paid_escrow`, кроме как из `pending_payment`; `cancelled` терминален) — вместо этого немедленно
инициирует ПОЛНЫЙ АВТОМАТИЧЕСКИЙ РЕФАНД той же суммы (`RefundOrderUseCase` с причиной
`late_payment_after_cancellation`), т.к. деньги банк уже удержал у клиента за заказ, которого
эффективно нет. Записывается `escrow_ledger.hold_created` + немедленно `refunded_to_customer` (обе
записи — для сохранения аудиторского следа, что деньги прошли через контур, а не «потерялись»), и
`support_tickets(category='payment_issue', is_escrow_blocking=false)` для видимости оператору.

### 5.6 Неизвестный платёж

**SRS-PAY-028** [R1] Given `providerRef` в вебхуке НЕ соответствует НИ ОДНОЙ строке
`payment_operations` (ни созданной нашим `createInvoice()`, ни нашим `refund()`), Then обработчик: (1)
НЕ создаёт никакой записи `escrow_ledger`/`payout_schedule`, НЕ меняет статус ни одного заказа; (2)
пишет `audit_log(category='payment_override' — ближайшая существующая категория для аномалий этого
типа, metadata={ providerRef, bankEventId, rawPayloadHash })`; (3) создаёт
`support_tickets(channel='system_auto', category='payment_issue', is_escrow_blocking=false,
description='unknown providerRef in webhook')`; (4) возвращает `200 OK` (не `404`/`400`) — банк не
должен бесконечно ретраить событие, которое мы физически не можем связать с заказом; расследование —
ручное, по `support_ticket`.

### 5.7 Реконсиляция расхождений

**SRS-PAY-029** [R1] См. §4.3 (`EscrowReconciliationJob`) — реконсиляция ledger-инварианта. ОТДЕЛЬНО:
Given `PaymentProvider.getStatus(providerRef)` (если провайдер предоставляет такой API, ASSUMPTION —
не факт для реальных TJ-банков, research 03) возвращает `status='paid'` для `providerRef`, у которого
локально `payment_operations.status='pending'` дольше `WEBHOOK_MISSING_THRESHOLD_MINUTES` (ASSUMPTION
`30`), Then еженедельная (или чаще, ASSUMPTION дефолт ежедневно) `PaymentStatusPollingJob` (Should, не
блокирует MVP — деградация по этому пункту не роняет продукт, т.к. основной путь — вебхук) создаёт
`support_tickets(category='payment_issue')` с пометкой «вебхук потенциально не доставлен» — джоба
`getStatus()` НИКОГДА сама не переводит заказ в `paid_escrow` (см. категорический запрет, §5.1),
только алертит человека, который решает — включая ручной `AdminPaymentOverrideUseCase`.

---

## 6. Payout — расписание, заморозка, комиссия, отчёт

### 6.1 Расписание T+1

**SRS-PAY-030** [R1] [D-19, REQ-PAY-6] `PayoutSchedulerJob` (BullMQ repeatable, cron ASSUMPTION
`'0 * * * *'` — ежечасно, достаточно для T+1-гранулярности без избыточной нагрузки): `UPDATE
payout_schedule SET status='due', due_at=NOW() WHERE status='pending' AND EXISTS (SELECT 1 FROM orders
WHERE orders.id=payout_schedule.order_id AND orders.delivered_at + (tenant_settings.hold_period_days ||
' days')::interval <= NOW())` — снэпшот `hold_period_days` берётся из `tenant_settings` НА МОМЕНТ
`delivered` (уже в схеме — `payout_schedule.hold_period_days`, зафиксирован при создании строки, не
пересчитывается при последующем изменении настройки тенанта, консистентно с SRS-DOM-008 принципом
снэпшота).

**SRS-PAY-031** [R1] `payout_schedule` СОЗДАЁТСЯ (не только обновляется) внутри `CaptureEscrowUseCase`
(§4.4) сразу при `delivered`, СО статусом `pending` (не `due`) и `hold_period_days` = снэпшот текущего
значения `tenant_settings`. Переход `pending → due` — исключительно `PayoutSchedulerJob` (система,
временной триггер, SRS-DOM-103 — единственный state machine переход, ДОПУСТИМО управляемый временем
по дизайну, D-19).

### 6.2 Заморозка при споре

**SRS-PAY-032** [R1] [D-24, REQ-DISPUTE-4] См. `10-domain-model.md` SRS-DOM-058/105 — заморозка уже
полностью специфицирована как атомарный побочный эффект `OrderDispute.open()`. Здесь — ГАРАНТИЯ
ИЗОЛЯЦИИ payout-джобы: `PayoutSchedulerJob`/`PayoutExecutionJob` (§6.3) выбирают строго
`WHERE status='due'` — `disputed`-строки физически НЕ попадают в выборку БЕЗ дополнительного
`WHERE status != 'disputed'` (сам факт другого значения `status` исключает их, это подчёркнуто явно
как гарантия ПРОСТОТЫ, а не как отдельная проверка, которую легко забыть — REQ-DISPUTE-4).

### 6.3 Физическое исполнение payout

**SRS-PAY-033** [R1, модель и учёт; R3, реальный перевод] Порт `BankPayoutTransferPort`
(`application/ports/bank-payout-transfer.port.ts`):

```typescript
interface BankPayoutTransferPort {
  transferBatch(payouts: readonly { payoutScheduleId, pharmacyMerchantRef, amountDiram }[]):
    Promise<Result<{ batchRef: string }, TransferError>>;
}
```

- `MockBankPayoutTransferProvider` [R1]: немедленно (или с задержкой `MOCK_PAYOUT_DELAY_MS`)
  переводит все переданные строки в подтверждённые, тестируется в E2E.
- Реальный адаптер [R3]: batch-перевод на мерчант-счета аптек через API банка-эквайера — не
  реализован до получения контракта.
- В R1-проде (где `payout_schedule` практически не заполняется, т.к. `cash_courier` не создаёт таких
  строк, §4.6, а банковские методы выключены, §2.3): `PayoutExecutionJob` находит НОЛЬ строк `due` —
  это ОЖИДАЕМОЕ состояние, не ошибка. Если тестовый/демо-тенант всё же прогоняет банковские заказы
  через `MockBankProvider`, `PayoutExecutionJob` переводит `due → paid` через
  `MockBankPayoutTransferProvider` полностью автоматически — весь путь тестируется без реального
  банка.

**SRS-PAY-034** [R1] `due → paid` (SRS-DOM-109) происходит ТОЛЬКО после подтверждения
`BankPayoutTransferPort.transferBatch()` (успех) — при частичном сбое батча (часть строк переведена,
часть — нет, если адаптер это различает) переводятся в `paid` только подтверждённые строки, остальные
остаются `due` для следующего прогона джобы (не помечаются `paid` оптимистично).

### 6.4 Удержание комиссии

**SRS-PAY-035** [R1] См. §4.1/§4.4 — комиссия удерживается ОДНОЙ транзакцией с `captured_to_pharmacy`
в момент `delivered` (SRS-DOM-032, REQ-MON-2), НЕ в момент физического payout. `payout_schedule.
commission_diram` — СНЭПШОТ суммы, уже списанной в `escrow_ledger.platform_fee_captured` на этот
заказ (`Σ(order_items.platform_fee_diram)`), не пересчитывается заново.

### 6.5 B2B-биллинг комиссии для `cash_courier`

**SRS-PAY-036** [R1] [REQ-MON-6, `platform_billing_invoices`] Поскольку `cash_courier` не порождает
`escrow_ledger`/`payout_schedule` (§4.6), комиссия платформы за такие заказы взимается ОТДЕЛЬНЫМ B2B-
циклом: ежедневная джоба `CashCommissionAggregationJob` для каждой `pharmacy_chains`, имеющей хотя бы
один `orders(payment_method='cash_courier', status='delivered', deleted_at IS NULL)` за истёкшие
сутки, upsert'ит СТРОКУ `platform_billing_invoices(invoice_type='cash_courier_commission',
status='draft')` за ТЕКУЩИЙ расчётный период (неделя, `period_start`=начало текущей недели), добавляя
`Σ(order_items.platform_fee_diram)` этих заказов к `subtotal_diram`. В конце периода (воскресенье
23:59 `Asia/Dushanbe`, ASSUMPTION) — переход `draft → issued`, `due_at = issued_at + 7 дней`
(REQ-MON-6), `vat_diram` = `subtotal_diram × 0.14` (НДС 14% отдельной строкой, REQ-MON-9, требует
подтверждения налоговым консультантом — помечено ASSUMPTION в самой схеме).

**SRS-PAY-037** [R1] [REQ-MON-7] Просрочка `due_at + grace_period` (ASSUMPTION `GRACE_PERIOD_DAYS=3`)
без оплаты инвойса → `UPDATE pharmacy_chains SET is_active=false` (авто-блокировка приёма НОВЫХ
заказов ВСЕЙ сети — уже существующие `confirmed`/`paid_escrow`/`processing`/`picked_up` заказы этой
сети НЕ прерываются, тот же принцип, что и `PharmacySuspendedEvent` REQ-ONBOARD-13/SRS-DOM-161, применённый
здесь по причине `unpaid_invoice` — уже существующее значение `pharmacy_suspension_reason` ENUM).
Снятие — ТОЛЬКО `super_admin`, ручное подтверждение оплаты инвойса вне системы (банковский перевод
сети → DoruTJ, не обратно).

### 6.6 Отчёт для аптеки

**SRS-PAY-038** [R1] `GET /api/v1/pharmacy-accounts/:id/payouts` (роль `pharmacy_admin` своей
сети/`pharmacist`-только-чтение своей аптеки/`super_admin`) — курсорный список `payout_schedule` этой
аптеки с полями `orderId, orderNumber, grossAmountDiram, commissionDiram, netAmountDiram, status,
dueAt, paidAt`. Фильтр `filter[status][in]=due,paid` (SRS-API-007). Экспорт — `GET
/api/v1/pharmacy-accounts/:id/payouts/export?format=csv` (роль `pharmacy_admin`/`super_admin`) —
Content-Type `text/csv`, используется для сверки бухгалтерией аптеки (R1: единственный практический
способ «дать аптеке знать, сколько ей причитается» до реального банковского перевода — R3).

**SRS-PAY-039** [R1] `GET /api/v1/pharmacy-accounts/:id/billing-invoices` — то же для
`platform_billing_invoices` (B2B cash-комиссия), роль `pharmacy_admin` своей сети/`super_admin`.

---

## 7. Возвраты (Return) — денежный и складской аспект

> `return_status` state machine, `order_returns` таблица и все инварианты (SRS-DOM-052..056,
> D-09/REQ-RET-1..13) — ЗАКОН, полностью определены в `10-domain-model.md`/`11-database-schema.md`.
> Этот раздел добавляет use case/API уровень и финансовую матрицу «вина → исход».

### 7.1 Ветви до и после вручения

**SRS-RET-001** [R1] [SRS-DOM-096, D-09] Ветвь ДО вручения (`picked_up → return_in_progress`):
инициируется КУРЬЕРОМ/диспетчером при `refused_at_door`/`undeliverable` — эндпоинт
`POST /api/v1/order-returns { orderId, reason: 'refused_at_door'|'undeliverable' }`, роль `courier`
(назначенный на эту доставку)/диспетчер (`pharmacy_admin` своего флота/`super_admin`). Товар физически
уже у курьера — курьерский рейс возврата НЕ требует нового назначения на «сбор» (в отличие от
пост-доставочного возврата, ниже) — курьер просто едет обратно в аптеку с уже имеющимся товаром,
`OrderReturn.markInTransit(courierId)` вызывается СРАЗУ (тот же `courierId`), минуя отдельный шаг
диспетчеризации.

**SRS-RET-002** [R1] [SRS-DOM-098, REQ-RET-12] Ветвь ПОСЛЕ вручения (`delivered → return_in_progress`):
инициируется КЛИЕНТОМ в пределах `tenant_settings.dispute_window_hours` (переиспользуется то же окно,
что и споры, D-19 — REQ-RET-12 явно связывает эти окна) — `POST /api/v1/order-returns { orderId,
reason }`, роль `customer` (свой заказ). Требует НОВОГО назначения курьера на «обратный забор»
(`DeliveryFacade.assignReturnCourier(returnId)`, любой доступный курьер, не обязательно тот же, кто
доставлял).

**SRS-RET-003** [R1] Given `reason='undelivered'` подан клиентом (курьер утверждает «доставлено», но
клиент не получал), Then это НЕ обычный `OrderReturn` — это ПРЯМОЕ основание для `OrderDispute`
(`DisputesFacade.linkPostDeliveryClaim`, уже в матрице взаимодействий) — оспаривается сам факт
доставки, товар физически не может «вернуться» (клиент утверждает, что его и не было). `order_returns`
для этой причины НЕ создаётся; создаётся `support_tickets(category='order_not_received',
is_escrow_blocking=true)` → `order_disputes`.

### 7.2 Финансовая матрица «вина → исход»

**SRS-RET-004** [R1] [REQ-RET-5, domain-слой Orders, явная таблица правил — НЕ if/else россыпью]
`ReturnFinancialOutcomeResolver` (`application/policies/return-financial-outcome.policy.ts`), таблица
правил:

| `return_reason` | Кто «виноват» | Возврат `items_total` | Возврат `delivery_fee` | Курьеру `courier_return_fee_diram` |
|---|---|---|---|---|
| `defect`, `wrong_item`, `damaged_packaging` | Аптека | Полный | Полный (клиент не должен платить за доставку бракованного товара) | `>0` (REQ-RET-7, всегда) |
| `expired_or_near_expiry` | Аптека | Полный | Полный | `>0` |
| `undelivered` | Курьер (не как «вина деньгами» — обрабатывается спором, SRS-RET-003) | — (не эта таблица) | — | — |
| `refused_at_door` | Клиент (передумал) | Полный (товар физически не использован) | БЕЗ возврата (доставка совершена фактически, груз довезён до двери) | `>0` |
| `undeliverable` | Нейтрально (адрес недостижим, не вина клиента/аптеки) | Полный | БЕЗ возврата (курьер физически проехал маршрут) | `>0` |
| `customer_dispute_post_delivery` | Определяется РАССЛЕДОВАНИЕМ (`pharmacist`-чек-лист на `returned_to_pharmacy`) | По итогам чек-листа: полный, если подтверждён брак; НЕТ возврата, если возврат отклонён (`return_rejected`) | Как выше | `>0` независимо от итога (REQ-RET-7) |

**SRS-RET-005** [R1] [REQ-RET-7] `courier_return_fee_diram > 0` НАЧИСЛЯЕТСЯ ВСЕГДА при создании
возвратного рейса (`OrderReturn.markInTransit()`), НЕЗАВИСИМО от исхода `return_confirmed`/
`return_rejected` — курьер физически проехал маршрут в любом случае, это не платёж за успех, а
компенсация за рейс. Сумма — `DeliveryFacade.calculateReturnFee(...)` (та же формула, что обычная
доставка, применённая к обратному маршруту — деталь реализации Delivery-модуля, не этого документа).

### 7.3 Стратегия рефанда при отсутствии partial refund (D-10)

**SRS-RET-006** [R1] [D-10, REQ-RET-6, SRS-DOM-162] Given `PaymentProvider.capabilities()
.supportsPartialRefund === false` (MVP-дефолт для ВСЕХ провайдеров, §3.2/3.3) И заказ оформлялся с
предварительно применённым раздельным биллингом (см. ниже), Then частичный возврат `items_total`
реализуется как ПОЛНЫЙ `refund()` ОДНОЙ из двух независимо проведённых транзакций (`items`-транзакция
ИЛИ `delivery`-транзакция), а НЕ как `partialRefund()` вызов, которого провайдер не поддерживает.

**SRS-RET-007** [R1] [РАСШИРЕНИЕ, реализует SRS-DOM-066 `Money.allocate()` на уровне checkout] Given
раздельный биллинг ВКЛЮЧЁН (флаг `tenant_settings.useSplitBilling`, ASSUMPTION по умолчанию `true` для
non-cash методов, см. «Дополнения к схеме БД»), Then `CreatePaymentInvoiceUseCase` вызывает
`PaymentProvider.createInvoice()` ДВАЖДЫ — один раз на `items_total_tjs`, один раз на
`delivery_fee_tjs` — ДВА независимых `providerRef`/`payment_operations` на ОДИН `order_id` (различаются
`operation_type` контекстом, тело `payment_operations` расширяется полем-меткой `billing_component:
'items'|'delivery'`, см. «Дополнения к схеме БД»). ОБЕ транзакции должны получить `PAID_HOLD`-вебхук
для перехода заказа в `paid_escrow` — Given одна прошла, а другая — нет, в течение
`PAYMENT_WINDOW_MINUTES` (§10.1), заказ считается неоплаченным целиком (частичная оплата двух
раздельных инвойсов — не валидное промежуточное состояние заказа), уже полученная сумма
автоматически возвращается.

**SRS-RET-008** [R1] Given раздельный биллинг ВЫКЛЮЧЕН (простой путь, единственный `createInvoice()`
на `total_amount_tjs`, применяется, если оператор решил не усложнять MVP-флоу для одного из
адаптеров), Then частичный возврат — РЕЗЕРВНАЯ стратегия (SRS-DOM-162 «резервная стратегия»): ПОЛНЫЙ
(100%) `refund()` всей суммы + аналитическая запись `escrow_ledger.entry_type='adjustment'` на
НЕДОПОЛУЧЕННУЮ сумму (т.е. клиент получает назад больше, чем «должен» был бы при истинном частичном
возврате, разница фиксируется как учётная корректировка, не физически довзыскивается с клиента —
юридическое обоснование одностороннего довзыскания с клиента отсутствует, проще полностью вернуть и
зафиксировать разницу в учёте для сверки с аптекой при следующем payout).

**SRS-RET-009** [R1] Выбор между SRS-RET-007 (раздельный биллинг) и SRS-RET-008 (резервная стратегия)
— ДОМЕННОЕ решение `CheckoutUseCase` в момент оформления (SRS-DOM-162: «дизайн-решение фиксируется на
уровне `CheckoutUseCase`, не адаптера»), записывается на заказ (`orders.billing_strategy` — новое
поле, см. «Дополнения к схеме БД») в момент создания — НЕ пересчитывается позже, чтобы возврат всегда
знал, по какой стратегии проводилась ОПЛАТА этого конкретного заказа (даже если тенант впоследствии
поменял флаг `useSplitBilling`).

### 7.4 Интеграция возврата с restock

**SRS-RET-010** [R1] Уже полностью специфицировано в SRS-DOM-023/053/054, REQ-RET-3/4/8 — этот
документ лишь фиксирует ТОЧКУ вызова: `ReturnConfirmedEvent` (returns → inventory, [E]) триггерит
`InventoryFacade.restock(...)`, идемпотентно по `order_id`. Данный модуль (Orders/Payments) НЕ вызывает
`restock` напрямую — только ПОДПИСАН на `ReturnConfirmedEvent`/`ReturnRejectedEvent` для запуска
СВОЕГО действия — рефанда (SRS-RET-006..009).

### 7.5 API возвратов

**SRS-RET-011** [R1] Полный список эндпоинтов (роли — RBAC-матрица §4 `12-api-conventions...md`,
дублируется здесь для полноты этого модуля):

| Эндпоинт | Роль | Действие |
|---|---|---|
| `POST /api/v1/order-returns` | `customer`(свой заказ)/`courier`(по назначению)/`super_admin` | `OrderReturn.request()` |
| `POST /api/v1/order-returns/:id/mark-in-transit` | диспетчер/система | `markInTransit(courierId)` |
| `POST /api/v1/order-returns/:id/confirm` | `pharmacist` своей аптеки | `confirmReceived(pharmacistId, checklist)` — включает `packagingIntact`, `checklistNotes` в теле |
| `POST /api/v1/order-returns/:id/reject` | `pharmacist` своей аптеки | `reject(reason)` |
| `POST /api/v1/order-returns/:id/admin-override` | `pharmacy_admin` своей сети/`super_admin` | `adminOverride(actor, reason)` — обязателен `Idempotency-Key` (SRS-API-009) |
| `POST /api/v1/order-returns/:id/retry-transit` | диспетчер | `retryTransit(courierId)` |
| `GET /api/v1/order-returns/:id` | владелец заказа/`pharmacist` своей аптеки/`super_admin` | чтение |

---

## 8. Споры (Dispute) — денежный аспект

> Полная state machine, инварианты, RBAC (`disputes:resolve-*`) и SLA-механика уже определены в
> `10-domain-model.md` (SRS-DOM-057..063) и `12-api-conventions-auth-tenancy.md` (RBAC-матрица §4.1).
> Этот раздел фиксирует use case/API уровень, специфичный для взаимодействия спора с деньгами
> (`escrow_ledger`/`payout_schedule`), что является предметом ИМЕННО этого документа (Orders/Payments).

### 8.1 Открытие и атомарная заморозка

**SRS-DISP-001** [R1] Эндпоинт создания: `POST /api/v1/support-tickets { orderId, channel, category,
description }` (роль по RBAC — `customer` свой заказ, `support_agent`, `super_admin`; НЕ
`pharmacy_admin`/`pharmacist` своей же сети по этому заказу — REQ-DISPUTE-10 не разрешает даже
СОЗДАНИЕ тикета от их лица против собственной сети в этом контексте, только сигнал через отдельный
внутренний канал вне денежного эскалационного пути). `category` из `support_ticket_category` (уже в
схеме) детерминирует `is_escrow_blocking`:

| `category` | `is_escrow_blocking` (дефолт, редактируется `support_agent` при триаже) |
|---|---|
| `order_not_received`, `payment_issue`, `order_item_damaged_or_expired`, `order_quality_defect` | `true` |
| `courier_conduct`, `other` | `false` |

**SRS-DISP-002** [R1] [SRS-DOM-058, REQ-DISPUTE-2/4] Given `is_escrow_blocking=true` на создании,
Then `OpenDisputeUseCase.execute()` внутри ОДНОЙ транзакции: (1) `INSERT support_tickets`; (2) `INSERT
order_disputes(status='open')`; (3) `PaymentsFacade.holdPayout(orderId, disputeId)` →
`UPDATE payout_schedule SET status='disputed', held_by_dispute_id=:disputeId WHERE order_id=:orderId
AND status='due'` — Given `payout_schedule.status` уже `'paid'` (пост-payout случай), Then шаг (3) НЕ
бросает ошибку, а устанавливает `order_disputes.requires_adjustment = true` (новое поле, см.
«Дополнения к схеме БД») — путь `resolveAdjustment` вместо блокировки (SRS-DOM-063).

**SRS-DISP-003** [R1] Given `payout_schedule.status = 'pending'` (заказ доставлен, но
`hold_period_days` ещё не истёк — платить рано в любом случае), Then открытие спора всё равно
переводит его в `disputed` НЕМЕДЛЕННО (не дожидаясь перехода в `due`) — предотвращает гонку «спор
открыли на 2 минуты позже, чем джоба перевела `pending → due → paid`» (более консервативная
блокировка: заморозить сразу, а не полагаться на то, что `due`-переход ещё не наступил).

### 8.2 Роли

**SRS-DISP-004** [R1] Полная RBAC-матрица для действий спора уже в `12-api-conventions...md` §4.1
(строки `disputes:*`) — здесь резюме денежного порога: `support_agent` может закрыть спор БЕЗ денег
(`resolve-reject`) или с ПОЛНЫМ возвратом НИЖЕ порога `dispute_auto_refund_threshold_dirams`
(ASSUMPTION `15000` дирам = 150 TJS, ОВ.23 research) — частичный возврат и корректировки после
payout — ИСКЛЮЧИТЕЛЬНО `super_admin` (REQ-DISPUTE-9, жёсткий запрет `support_agent` независимо от
суммы для `resolve-refund-partial`/`resolve-adjustment`).

**SRS-DISP-005** [R1] `dispute_auto_refund_threshold_dirams` — `tenant_settings`-поле (см. «Дополнения
к схеме БД»), не глобальная константа — per-tenant настройка риска, редактируется `super_admin` в
`apps/admin` без деплоя (согласуется с Charter §3.4 принципом конфигурации без кода).

### 8.3 SLA

**SRS-DISP-006** [R1] См. SRS-DOM-130/131/REQ-DISPUTE-14/15 — полностью специфицировано в domain-
модели (пауза в `awaiting_customer`, эскалация приоритета по просрочке). Дополнение этого документа:
`resolution_due_at` при `open()` = `opened_at + tenant_settings.dispute_resolution_sla_hours`
(ASSUMPTION `48`, новое поле — НЕ путать с `dispute_window_hours`, которое ограничивает, СКОЛЬКО
времени у КЛИЕНТА есть на открытие спора после `delivered`, а не сколько времени у поддержки на его
разрешение).

### 8.4 Терминальные статусы и `resolution_reason`

**SRS-DISP-007** [R1] Полностью специфицировано (SRS-DOM-060, REQ-DISPUTE-13, БД-constraint
`chk_order_disputes_terminal_requires_reason`) — три независимых рубежа защиты (domain, БД, API-
валидация тела запроса `Zod`-схемой, где `resolutionReason` — обязательное непустое поле для ВСЕХ
`POST /api/v1/disputes/:id/resolve-*` эндпоинтов). Эндпоинты:

| Эндпоинт | Роль | Денежный эффект |
|---|---|---|
| `POST /api/v1/disputes/:id/resolve-reject` | `support_agent`(не своя сеть)/`super_admin` | `payout_schedule.disputed → due` (SRS-DOM-106) |
| `POST /api/v1/disputes/:id/resolve-refund-full` | `support_agent`(< порога)/`super_admin` | `EscrowLedger.refund()` полностью, `payout_schedule → reversed` |
| `POST /api/v1/disputes/:id/resolve-refund-partial` | `super_admin` только | `EscrowLedger.partiallyRefund(amount)`, `payout_schedule.amount -= amount` |
| `POST /api/v1/disputes/:id/resolve-adjustment` | `super_admin` только, ТОЛЬКО если `payout_schedule.status='paid'` | `escrow_ledger.adjustment`, зачёт в следующий payout |
| `POST /api/v1/disputes/:id/confirm-tenant-refund` | `pharmacy_admin` тенанта заказа | Разблокирует `close()` для White-Label (SRS-DOM-062) — не в R1 продовом контуре (White-Label UI — R3), но эндпоинт/политика реализуются в R1 архитектурно |

**SRS-DISP-008** [R1] Каждый вызов ЛЮБОГО `resolve-*`-эндпоинта требует `Idempotency-Key`
(SRS-API-009 таблица уже включает `POST /api/v1/disputes/:id/resolve-*`) — двойной клик
администратора не должен списать деньги дважды.

### 8.5 Спор для `cash_courier`-заказа

**SRS-DISP-009** [R1] [РАСШИРЕНИЕ, не противоречит domain-model — уточняет применение SRS-DOM-058 для
случая, когда `payout_schedule` не существует] Given спор открыт по заказу с `payment_method=
'cash_courier'` (эскроу-леджера/payout-строки для него нет, §4.6), Then шаг «заморозить payout»
(SRS-DISP-002 пункт 3) — НЕТ-ОП (нечего замораживать), спор существует и обрабатывается ИСКЛЮЧИТЕЛЬНО
как операционная эскалация (качество, порядок вручения, поведение курьера) без денежного действия
через `EscrowLedger`. Given резолюция спора требует ВОЗВРАТА денег клиенту за `cash_courier`-заказ, Then
это НЕ `PaymentProvider.refund()` (нет платежа через провайдера) — единственный путь: физический
возврат наличных курьером (`ReturnFinancialOutcomeResolver`, §7.2) ЛИБО ручная компенсация
`super_admin` вне системы (запись `audit_log`, не автоматизировано в R1).

---

## 9. Отмены заказа

**SRS-ORD-029** [R1] [SRS-DOM-154, REQ-DELIV-5] Единый вход: `POST /api/v1/orders/:id/cancel { reason
}`. `OrderPolicy.canCancel(order, actor)`:

| Статус заказа | Кто может отменить | Что происходит с деньгами | Что происходит с резервом остатка |
|---|---|---|---|
| `pending_payment` (только non-cash — `cash_courier` в этот статус не попадает, §2.4) | `customer` (свой заказ) | Ничего не платилось ещё (если `createInvoice` уже вызван, но не оплачен — провайдер-специфичная отмена счёта, best-effort, не критично, т.к. неоплаченный счёт просто истекает сам) | `InventoryFacade.releaseStock(items)` — немедленно, полностью |
| `confirmed` (только `cash_courier` — D-25, §2.4) | `customer`, `pharmacist`/`pharmacy_admin` своей аптеки (ручная отмена); система/`super_admin` (авто по `pickup_sla+buffer`, см. §10.2) | НИЧЕГО — рефанд НЕ вызывается ни при каком акторе: наличные физически ещё не собраны курьером, возвращать нечего (D-25 п.3) | `releaseStock(items)` полностью |
| `paid_escrow` (только non-cash — `cash_courier` в этот статус структурно не попадает, §2.4 п.5) | `customer`, `pharmacist`/`pharmacy_admin` своей аптеки | `RefundOrderUseCase` — полный `PaymentProvider.refund()`, `EscrowLedger.refund()` | `releaseStock(items)` полностью |
| `processing` (достигнут из `confirmed` ИЛИ из `paid_escrow` — источник статуса роли не играет, играет `payment_method`) | `pharmacist`, `customer` (до `picked_up`) | Non-cash: полный `PaymentProvider.refund()`/`EscrowLedger.refund()`; cash: ничего (деньги ещё не собраны) | `releaseStock(items)` полностью |
| `picked_up` | — (см. SRS-DOM-154: canCancel=false) | — | — |
| `delivered`/терминальные | — (не отмена — это `OrderReturn`/`OrderDispute`, §7/§8) | — | — |
| ЛЮБОЙ, но причина `fraud_or_safety`/`license_revoked` каскадом | `super_admin` (`ForceCancelIncompleteOrdersUseCase`, SRS-DOM-161/REQ-ONBOARD-14) | Non-cash: полный `PaymentProvider.refund()` для ВСЕХ незавершённых заказов аптеки одним пакетным действием; cash (`confirmed`/`processing`): ничего — тот же принцип, что и одиночная отмена | `releaseStock(items)` для каждого |

**SRS-ORD-030** [R1] `reason` — свободный текст ДЛЯ клиента, но система маппит на канонический
`orders.cancel_reason` (VARCHAR(100), уже в схеме) из ограниченного набора значений (`enum`
на уровне Zod-схемы контракта, не свободная строка в БД): `customer_changed_mind`,
`found_cheaper_elsewhere`, `pharmacy_suspended`, `payment_timeout`, `pickup_sla_timeout`,
`fraud_or_safety_force_cancel`, `license_revoked_force_cancel`, `late_payment_after_cancellation` (см.
SRS-PAY-027) — свободный текст клиента (если есть) уходит в `audit_log.metadata`, не в саму колонку
статуса (не путать неструктурированный ввод со структурированной причиной, используемой для
аналитики/метрик, R1-15 — «воронка» продуктовых метрик нуждается в чистом enum, не в тексте).

**SRS-ORD-031** [R1] Given `pharmacist`/`pharmacy_admin` инициирует отмену `confirmed`/`paid_escrow`/
`processing`-заказа СВОЕЙ аптеки (например, реально закончился товар, которого 1С ещё не отразила), Then это
разрешено БЕЗ дополнительного согласования от `super_admin` (в отличие от `admin_return_override`/
`admin_payment_override`, которые требуют super_admin) — доверенное действие персонала аптеки в
пределах своей операционной ответственности, обязательный `reason` всё равно фиксируется (audit).

---

## 10. Таймауты

### 10.1 Неоплаченный заказ

**SRS-ORD-032** [R1, архитектура готова; практически срабатывает только когда включены банковские
методы — R3] [РАСШИРЕНИЕ, требует ADR-подтверждения при передаче в разработку, см. §2.4] `tenant_
settings.payment_window_minutes` (новое поле, ASSUMPTION `15`, см. «Дополнения к схеме БД»).
`orders.payment_window_expires_at` = `created_at + payment_window_minutes` — устанавливается ТОЛЬКО
для `payment_method ∈ {'alif_mobi','dc_next'}` (для `cash_courier` — `NULL`, синхронный переход,
§2.4). `UnpaidOrderTimeoutJob` (BullMQ repeatable, ASSUMPTION каждые `2` минуты — короче окна TTL,
чтобы не задерживать освобождение резерва больше, чем на пару минут сверх заявленного окна): `SELECT
* FROM orders WHERE status='pending_payment' AND payment_window_expires_at <= NOW()` →
`order.cancel(reason='payment_timeout', actor=SYSTEM)` для каждой строки, releaseStock (SRS-ORD-029
таблица, строка `pending_payment`).

**SRS-ORD-033** [R1] Given `createInvoice()` уже вернул `InvoiceRef` клиенту (QR показан), но клиент
так и не оплатил до истечения `payment_window_expires_at`, Then авто-отмена НЕ пытается отменить сам
инвойс на стороне банка (best-effort уведомление банку, если провайдер это поддерживает, — не
блокирует локальную отмену) — инвойс просто становится невалидным по истечении
`InvoiceRef.expiresAt` (провайдер-специфичное поведение, `maxInvoiceValidityMinutes` из
`capabilities()`, синхронизировано с `payment_window_minutes`, чтобы оба окна не расходились —
`payment_window_minutes <= maxInvoiceValidityMinutes` проверяется при конфигурации тенанта, нарушение
— ошибка валидации настроек в `apps/admin`, не рантайм-инцидент).

**SRS-ORD-034** [R1] Given банк ВСЁ ЖЕ присылает `payment_confirmed` ПОСЛЕ авто-отмены по таймауту —
см. SRS-PAY-027 (уже покрыто: немедленный авто-рефанд, не реанимация заказа).

### 10.2 Несобранный заказ

**SRS-ORD-035** [R1] Таймер и условие — ОДИН и тот же для обеих ветвей (`pickup_sla +
pickup_sla_buffer` истёк без принятия фармацевтом, дефолт 7+5=12 минут), но ИСХОДНЫЙ статус и
денежный эффект расходятся по `payment_method`:

- **Non-cash** (`payment_method ∈ {'alif_mobi','dc_next'}`): переход `paid_escrow → cancelled`,
  полностью специфицирован в `10-domain-model.md` (SRS-DOM-092, REQ-PAY-5). Дополнение этого
  документа — денежный эффект: `RefundOrderUseCase` полный рефанд (деньги были собраны через эскроу,
  должны вернуться), `EscrowLedger.refund()`.
- **`cash_courier`**: переход `confirmed → cancelled` (D-25, §2.4 п.4 — НЕ `paid_escrow → cancelled`,
  т.к. наличный заказ никогда не был `paid_escrow`). Денежный эффект: НИЧЕГО не рефандится (наличные
  никогда не собирались курьером) — `RefundOrderUseCase` НЕ вызывается вовсе (в отличие от non-cash
  ветки, здесь нет транзакции, которую нужно бы откатывать); только `InventoryFacade.releaseStock`
  и уведомление клиенту. `escrow_ledger` остаётся пустым, как и на всём остальном жизненном цикле
  этого заказа (§4.6).

**SRS-ORD-036** [R1] `OrderAutoCancelledEvent` (уже в глоссарии доменных событий, SRS-DOM таблица) —
эмитируется для ОБОИХ переходов (`paid_escrow → cancelled` И `confirmed → cancelled`), с полем
`fromStatus`, различающим их. Этот модуль подписывается на событие для запуска `RefundOrderUseCase`,
если применимо (проверка `paymentMethod !== 'cash_courier'` — идемпотентная проверка перед вызовом
`PaymentProvider.refund()`, т.к. для cash `payment_transaction_id` в любом случае `NULL`, вызов
провайдера был бы бессмысленным и упал бы с ошибкой валидации на пустой `providerRef`); Given
`fromStatus='confirmed'`, Then обработчик — гарантированный НЕТ-ОП по построению (`cash_courier` —
единственный способ оказаться в `confirmed`, а для него проверка `paymentMethod !== 'cash_courier'`
уже отсекает вызов рефанда), не просто "маловероятный" путь.

### 10.3 Недоставленный заказ

**SRS-ORD-037** [R1] [D-19, `tenant_settings.delivery_sla_city_minutes`/`delivery_sla_remote_minutes`,
уже в схеме] Просрочка `delivery_sla` (считается от `picked_up_at`) НЕ отменяет заказ и НЕ рефандит
автоматически (доставка физически может ещё состояться, отмена «под товаром в пути» создала бы
хаос с курьером) — единственное автоматическое действие: `SlaBreachedEvent` (уже в доменных событиях)
→ `support_tickets(channel='system_auto', category='order_not_received', is_escrow_blocking=true)`
(REQ-DISPUTE-16, уже задокументировано в domain-модели) → атомарно `order_disputes(status='open')`
(§8.1) → `payout_schedule` (если существует, non-cash) замораживается — деньги остаются под защитой,
пока человек (`support_agent`/`super_admin`) не разберётся, что случилось с доставкой, вместо
преждевременного одностороннего решения системой.

**SRS-ORD-038** [R1] `SlaBreachedEvent` для `delivery_sla` эмитируется ОДНОКРАТНО на превышение
(идемпотентность по `(entityType='order', entityId=orderId)` — повторный прогон джобы-детектора не
плодит дублирующиеся тикеты для одного и того же нарушения, см. также §12 «Пограничные случаи»).

---

## 11. Где лежат деньги — таблица по статусам

> «Где физически лежат деньги» ≠ «что говорит `order.status`» — таблица явно разводит эти два
> измерения, т.к. деньги реально всегда на счету банка-эквайера (D-17, ledger учётный) или у курьера
> в виде наличных, НИКОГДА не «в DoruTJ» в юридическом смысле.

| `order.status` | `payment_method` | Физическое расположение денег | `escrow_ledger` состояние | `payout_schedule.status` |
|---|---|---|---|---|
| `pending_payment` | non-cash | У клиента (счёт создан, не оплачен) | пусто | не существует |
| `pending_payment` | cash | Недостижимо (§2.4 — синхронный переход СРАЗУ в `confirmed`, минуя `pending_payment`) | — | — |
| `confirmed` | cash (ЕДИНСТВЕННЫЙ способ достижения этого статуса, D-25) | У клиента (наличные ещё не переданы) | пусто (§4.6) — и НЕ будет создано никогда для этого заказа | не существует |
| `confirmed` | non-cash | Недостижимо — non-cash никогда не проходит через `confirmed` (§2.4, SRS-ORD-028) | — | — |
| `paid_escrow`/`processing` | non-cash | На счету банка-эквайера, юридически удержаны платформой (D-17) | `hold_created` | не существует ещё (создаётся при `delivered`) |
| `paid_escrow` | cash | Недостижимо структурно — запрещённый переход `confirmed → paid_escrow` (§2.4 п.5, инвариант SRS-ORD-027a) | — | — |
| `processing` | cash (достигнут из `confirmed`, не из `paid_escrow`) | У клиента (наличные ещё не переданы) | пусто (§4.6) | не существует |
| `picked_up` | non-cash | Как выше (эквайер, held) | `hold_created` | не существует |
| `picked_up` | cash | У клиента | пусто | не существует |
| `delivered` (сразу после capture) | non-cash | Формально «выделены» аптеке в учёте, физически всё ещё на счету эквайера до реального payout | `hold_created` + `platform_fee_captured` + `captured_to_pharmacy` | `pending` |
| `delivered` | cash | У курьера (собраны при вручении, `delivery_assignments.cash_collected_diram`) | пусто | не существует (комиссия — B2B-инвойс, §6.5) |
| `delivered`, `hold_period_days` истёк | non-cash | Ожидает банковского перевода на мерчант-счёт аптеки | без изменений | `due` |
| `delivered`, payout исполнен | non-cash | На мерчант-счёте аптеки (её собственность) | без изменений | `paid` |
| `delivered`, спор открыт ДО payout | non-cash | Заморожено на счету эквайера — payout НЕ уходит аптеке | без изменений | `disputed` |
| `delivered`, спор открыт ПОСЛЕ payout | non-cash | Уже на счету аптеки — DoruTJ не может физически изъять | + `adjustment` | остаётся `paid`, зачёт в следующем цикле |
| `cancelled` (до payout) с рефандом | non-cash | Возвращены клиенту | + `refunded_to_customer` | `reversed` (если существовал) |
| `refunded` (возврат после доставки) | non-cash | Возвращены клиенту (частично/полностью) | + `refunded_to_customer`/`partially_refunded` | `reversed` или сумма уменьшена |
| Любой статус | cash | Наличные у курьера до передачи в кассу аптеки (вне системы DoruTJ — операционный процесс аптеки/курьера, не ledger) | пусто всегда | не существует никогда |

---

## Дополнения к схеме БД

> Ниже — поля/значения, ОТСУТСТВУЮЩИЕ в `11-database-schema.md`, необходимые для реализации этого
> модуля. Каждое — явное расширение существующих таблиц (не новая параллельная сущность, кроме
> отдельно оговорённых), обоснование — почему поле нужно ИМЕННО здесь. **Требуют подтверждения
> архитектором (ADR) перед тем, как Tech Lead заведёт по ним тикет** — обозначения [РАСШИРЕНИЕ]
> в тексте выше указывают на конкретные пункты.
>
> **Не перечислено ниже (не относится к этому документу):** добавление значения `confirmed` в
> `CREATE TYPE order_status` — уже РЕШЕНО (D-25) и назначено отдельными тикетами на
> `10-domain-model.md` (enum, ASCII-диаграмма state machine, строки переходов `confirmed →
> processing`/`confirmed → cancelled`, дополнение запрещённых переходов SRS-DOM-102) и
> `11-database-schema.md` (`ALTER TYPE order_status ADD VALUE 'confirmed'`, отдельной миграцией). Этот
> документ (§2.4) ссылается на итоговое поведение `confirmed`, но не определяет сам enum — эти файлы
> ЗАКОН (см. шапку документа).

| Таблица | Новое поле | Тип | Обоснование |
|---|---|---|---|
| `tenant_settings` | `enabled_payment_methods` | `payment_method[] NOT NULL DEFAULT ARRAY['cash_courier']::payment_method[]` | SRS-ORD-025: R1 включает только `cash_courier` для реальных пользователей; банковские методы включаются per-tenant при готовности (R3) без деплоя кода — конфигурация, не фича-флаг в коде (Charter §3.4 принцип) |
| `tenant_settings` | `payment_window_minutes` | `INT NOT NULL DEFAULT 15` | SRS-ORD-032: окно ожидания оплаты non-cash заказа до авто-отмены — отсутствует в базовой схеме (там есть `hold_period_days`/SLA сборки/доставки, но не SLA самой оплаты) |
| `tenant_settings` | `use_split_billing` | `BOOLEAN NOT NULL DEFAULT true` | SRS-RET-007/008/009: включает/выключает стратегию раздельного биллинга items/delivery (D-10) — доменное решение должно быть конфигурируемо per-tenant, т.к. решение зависит от того, какой банк обслуживает тенанта |
| `tenant_settings` | `dispute_auto_refund_threshold_dirams` | `BIGINT NOT NULL DEFAULT 15000` | SRS-DISP-005: порог, ниже которого `support_agent` может самостоятельно оформить полный рефанд без эскалации `super_admin` — ASSUMPTION ОВ.23 research, должен быть настраиваем, не глобальной константой в коде |
| `tenant_settings` | `dispute_resolution_sla_hours` | `INT NOT NULL DEFAULT 48` | SRS-DISP-006: SLA на РАЗРЕШЕНИЕ уже открытого спора — отличается по смыслу от уже существующего `dispute_window_hours` (окно на ОТКРЫТИЕ спора клиентом) |
| `orders` | `payment_window_expires_at` | `TIMESTAMPTZ NULL` | SRS-ORD-032: момент авто-отмены неоплаченного заказа; `NULL` для `cash_courier` (не применимо) |
| `orders` | `billing_strategy` | `VARCHAR(20) NOT NULL DEFAULT 'single_invoice'` (`'single_invoice' \| 'split_items_delivery'`) | SRS-RET-009: снэпшот стратегии биллинга НА МОМЕНТ оформления — не должен зависеть от последующего изменения `tenant_settings.use_split_billing` (тот же принцип снэпшота, что и `commission_bps`, SRS-DOM-008) |
| `payment_operations` | `billing_component` | `VARCHAR(10) NULL` (`'items' \| 'delivery' \| NULL`) | SRS-RET-007: при раздельном биллинге на ОДИН `order_id` заводятся ДВЕ строки `payment_operations` для `createBill` — нужен признак, к какой части заказа относится каждая, иначе `refund()` частичной суммы не сможет выбрать правильный `providerRef` |
| `order_disputes` | `requires_adjustment` | `BOOLEAN NOT NULL DEFAULT false` | SRS-DISP-002: помечает спор, открытый ПОСЛЕ payout (`payout_schedule.status='paid'`), чтобы UI/policy сразу направляли оператора к `resolveAdjustment`, а не к `resolveRefundFull/Partial`, которые для этого случая недопустимы (SRS-DOM-063) |

Все перечисленные поля — **аддитивные** `ALTER TABLE ... ADD COLUMN ... DEFAULT ...` (не ломают
существующие данные/индексы), соответствуют `SRS-DB-009`-стилю миграций (отдельный файл на добавление
поля к enum-зависимым типам не требуется — здесь только простые типы/новый `payment_method[]`, который
не требует `ALTER TYPE`, т.к. использует уже существующий enum `payment_method` как элемент массива).

---

## Пограничные случаи и ошибки

**SRS-ORD-039** [R1] **Двойной клик на «Оформить заказ»** Given клиент дважды нажимает кнопку
оформления (двойной тап/повтор сети), When фронтенд НЕ успел отключить кнопку между кликами и
отправляет два HTTP-запроса `POST /api/v1/orders` с ОДНИМ И ТЕМ ЖЕ `Idempotency-Key`, Then второй
запрос, пришедший, пока первый ещё обрабатывается, получает `409 IDEMPOTENCY_KEY_CONFLICT`
(SRS-API-010) — НЕ создаёт второй набор заказов; после завершения первого — повторный запрос с тем же
ключом и телом получает СОХРАНЁННЫЙ ответ (тот же массив `orders`).

**SRS-ORD-040** [R1] **Остаток закончился МЕЖДУ резолвом группы и `InventoryFacade.reserveStock()`**
Given два конкурентных checkout-запроса от разных пользователей целятся в последнюю единицу одного
товара одной аптеки, When оба доходят до шага 4c (SRS-ORD-018) почти одновременно, Then
`PharmacyInventory.reserveForOrder()` выполняется под `SELECT ... FOR UPDATE` на строку
`inventory_batches` (тот же паттерн, что SRS-DB-044) — один запрос резервирует успешно, второй
получает `InsufficientStockError` для СВОЕЙ группы (не всего checkout, если это одна из N аптек,
SRS-ORD-019).

**SRS-PAY-040** [R1] **Вебхук приходит для заказа, который уже был удалён/`deleted_at` проставлен**
Given `orders.deleted_at IS NOT NULL` (юридическое soft-delete, крайне редкий кейс — заказы обычно не
удаляются, только отменяются/рефандятся, SRS-DB-004), When вебхук ссылается на такой `order_id`, Then
обработчик трактует это КАК неизвестный платёж (§5.6) — soft-deleted заказ не является валидной целью
для смены статуса, несмотря на существование строки в БД.

**SRS-PAY-041** [R1] **`MockBankProvider` недоступен из-за сбоя самого приложения (не сеть — тот же
процесс)** Given `createInvoice()` бросает необработанное исключение (баг адаптера, не таймаут), When
`CheckoutUseCase` вызывает `PaymentsFacade.createInvoice()` ПОСЛЕ commit заказа (SRS-ORD-018 шаг 4h),
Then заказ уже создан и НЕ откатывается (транзакция заказа независима от вызова провайдера, §2.1) —
клиент видит созданный заказ в `pending_payment` БЕЗ `payment_transaction_id` и БЕЗ отображаемого
QR/deeplink; фронтенд предлагает «Повторить попытку оплаты» (`POST /api/v1/orders/:id/retry-payment`,
новый идемпотентный эндпоинт, дергающий `CreatePaymentInvoiceUseCase` повторно для существующего
заказа) — заказ НЕ считается потерянным.

**SRS-PAY-042** [R1] **Реконсиляция обнаруживает расхождение, а `super_admin` ничего не делает
неделями** Given `LedgerImbalanceError`-алерт не обработан, When `EscrowReconciliationJob` прогоняется
повторно на СЛЕДУЮЩИЕ сутки для ТОГО ЖЕ `order_id` (расхождение никуда не делось), Then НЕ создаётся
дублирующийся `support_ticket` — джоба проверяет наличие уже ОТКРЫТОГО тикета
`category='payment_issue'` для этого `order_id` за последние `RECONCILIATION_DEDUP_DAYS` (ASSUMPTION
`7`) и, если найден, только обновляет `audit_log`-метаданные (счётчик повторных обнаружений), не
плодит тикеты.

**SRS-RET-012** [R1] **Клиент запрашивает возврат ПОСЛЕ истечения `dispute_window_hours`**
Given `now() > delivered_at + tenant_settings.dispute_window_hours`, When `POST /api/v1/order-returns`
с `reason='customer_dispute_post_delivery'`, Then `422 RETURN_WINDOW_EXPIRED` (новый код) — окно
жёсткое, не продлевается автоматически; `super_admin` может создать возврат вручную ВНЕ окна через
отдельный административный путь (`admin_return_override` создаёт запись напрямую, минуя обычный
`request()` со своей проверкой окна — REQ-RET-9 уже разрешает `pharmacy_admin`/`super_admin`
переопределение квалификации, распространяем ту же логику на окно времени).

**SRS-DISP-010** [R1] **Спор открыт, ПОКА уже идёт `OrderReturn` по тому же заказу** Given
`order_returns` уже существует в нетерминальном статусе для `order_id`, When создаётся
`support_tickets(is_escrow_blocking=true)` для ТОГО ЖЕ заказа, Then `OrderDispute.open()` разрешён (не
блокируется существованием возврата — это РАЗНЫЕ агрегаты, могут сосуществовать, например «возврат
из-за брака» + «спор о качестве обслуживания курьера» одновременно) — единственное жёсткое
ограничение — не более ОДНОГО нетерминального `OrderDispute` (SRS-DOM-057), не связь с `OrderReturn`.

**SRS-ORD-041** [R1] **Тенант приостановлен (`is_active=false` из-за неоплаченного B2B-инвойса,
§6.5) ПОКА у клиента есть товар в корзине этой сети** Given `pharmacy_chains.is_active=false`, When
клиент пытается `POST /api/v1/orders` с товаром аптеки этой сети, Then `OnboardingFacade.
isPharmacyActive()` возвращает `false` — та же ветка, что и SRS-ORD-018 шаг 2 (аптека исключается из
checkout, `meta.excludedItems` с причиной `PHARMACY_SUSPENDED`), НЕЗАВИСИМО от того, вызвана ли
приостановка регуляторной причиной (Onboarding-модуль) или неуплаченным B2B-инвойсом (этот модуль,
§6.5) — единая точка проверки, единое поведение для клиента.

---

## Тестовые сценарии

> Формат `TC-ORD-nnn`/`TC-PAY-nnn`/`TC-RET-nnn`/`TC-DISP-nnn`. Unit — без БД (домен уже покрыт
> `TC-DOM-*`); ниже преимущественно **интеграционные** (Vitest+Testcontainers PostgreSQL+Redis) и
> **E2E** (Playwright, помечено явно), т.к. этот документ специфицирует use case/API/оркестрацию, не
> голые доменные инварианты.

| TC | Проверяет | Given | When | Then |
|---|---|---|---|---|
| **TC-ORD-001** (E2E, CUJ-2') | Полный флоу оплаты наличными | Каталог с ≥1 медикаментом в наличии, аутентифицированный клиент | Добавление в корзину → `POST /api/v1/orders` с `paymentMethod='cash_courier'` | Ответ содержит заказ со `status='confirmed'` СРАЗУ (без промежуточного наблюдаемого `pending_payment`, БЕЗ прохождения через `paid_escrow`), `payment_transaction_id=null`; `escrow_ledger`/`payout_schedule` — ноль строк для этого `order_id` |
| TC-ORD-001a | `confirmed → processing` (наличные) | Заказ `cash_courier` в `confirmed` (см. TC-ORD-001) | `pharmacist` своей аптеки принимает заказ | `status='processing'`, SLA-таймер сборки стартовал (как для non-cash SRS-DOM-091), `escrow_ledger` по-прежнему пуст |
| TC-ORD-001b | `confirmed → cancelled` без рефанда (D-25) | Заказ `cash_courier` в `confirmed`, `pickup_sla + pickup_sla_buffer` истёк, фармацевт не принял | `PickupSlaTimeoutJob` (аналог для `confirmed`, см. SRS-ORD-035) | `status='cancelled'`, `cancel_reason='pickup_sla_timeout'`; `RefundOrderUseCase`/`PaymentProvider.refund()` НЕ вызывается ни разу (проверка мока — ноль вызовов); `escrow_ledger` остаётся пустым; `InventoryFacade.releaseStock` вызван |
| TC-ORD-001c | Инвариант `paid_escrow ⟺ escrow_ledger` (SRS-ORD-027a) | В БД одновременно: заказ А `cash_courier/confirmed` (ledger пуст), заказ Б `alif_mobi/paid_escrow` (ledger содержит `hold_created`) | `EscrowInvariantSpec` проверяет ОБА заказа | Для А: `status≠'paid_escrow' AND ledger пуст` — согласовано; для Б: `status='paid_escrow' AND ledger непуст` — согласовано; спец НЕ находит нарушений ни для одного |
| TC-ORD-001d | Запрещённый переход `confirmed → paid_escrow` | Заказ `cash_courier` в `confirmed` | Попытка вызвать `order.markPaidEscrow(...)` программно (юнит/интеграционный тест домена) | `InvalidOrderStatusTransitionError` — переход отклонён (SRS-DOM-102, дополнено D-25) |
| TC-ORD-002 | Мультиаптечный сплит | Корзина с товарами от 2 разных аптек | `POST /api/v1/orders` со всеми `cartItemIds` | Ответ содержит МАССИВ из 2 заказов, каждый со своим `pharmacyId`, `orderNumber`, независимым расчётом `delivery_fee_tjs` |
| TC-ORD-003 | Частичный сбой одной группы | Аптека Б имеет `stock_quantity=0` на один из товаров в корзине; аптека А — в наличии | `POST /api/v1/orders` на обе группы | `data.orders` содержит заказ аптеки А; `data.failedGroups` содержит запись для Б с `INSUFFICIENT_STOCK`; заказ А НЕ откатывается |
| TC-ORD-004 | Rx-исключение из checkout | Корзина: 1 Rx-товар без верифицированного рецепта + 1 обычный товар той же аптеки | `POST /api/v1/orders` | Заказ создан ТОЛЬКО с обычным товаром; `meta.excludedItems` содержит Rx-строку с `PRESCRIPTION_NOT_VERIFIED`; Rx-строка остаётся в корзине |
| TC-ORD-005 | Полностью непокрытая корзина | Корзина ТОЛЬКО из Rx-товаров без верификации | `POST /api/v1/orders` | `422 NO_ORDERABLE_ITEMS`, ни один заказ не создан |
| TC-ORD-006 | COD-лимит | Корзина non-Rx, `total_amount_diram = 60000` (600 TJS), `codLimitDiram=50000` (дефолт) | `POST /api/v1/orders` с `paymentMethod='cash_courier'` | `422 COD_LIMIT_EXCEEDED`, заказ не создан |
| TC-ORD-007 | Банковский метод выключен тенантом | `tenant_settings.enabledPaymentMethods = ['cash_courier']` | `POST /api/v1/orders` с `paymentMethod='alif_mobi'` | `422 PAYMENT_METHOD_NOT_ENABLED` |
| TC-ORD-008 | Дрейф цены при checkout | Клиент видел цену `10.00 TJS`, к моменту checkout аптека обновила цену до `12.00 TJS`, клиент передаёт `expectedTotalDiram` на основе старой цены | `POST /api/v1/orders` | `409 PRICE_OR_STOCK_CHANGED` в `failedGroups`, `details.actualTotalDiram` = пересчитанная сумма, заказ не создан |
| TC-ORD-009 | Идемпотентность checkout | Первый `POST /api/v1/orders` с `Idempotency-Key=K` уже завершился созданием заказов | Повторный `POST` с тем же `K` и тем же телом | Возвращён СОХРАНЁННЫЙ ответ (те же `orderId`), новые заказы НЕ создаются, `InventoryFacade.reserveStock` вызван ровно один раз |
| TC-ORD-010 | Конкурентный дубль во время обработки | `Idempotency-Key=K`, первый запрос ещё в процессе (искусственная задержка в тесте) | Второй запрос с тем же `K` приходит ДО завершения первого | `409 IDEMPOTENCY_KEY_CONFLICT` немедленно, не ожидание |
| TC-ORD-011 | Гонка за последнюю единицу товара | `stock_quantity=1` на конкретную партию, два конкурентных `POST /api/v1/orders` от разных клиентов | Оба запроса одновременно | Ровно ОДИН успешен, второй получает `INSUFFICIENT_STOCK` для своей группы (не `500`, не зависание) |
| TC-ORD-012 | Отмена `pending_payment` (non-cash, R1 тестовый банковский метод) | Заказ в `pending_payment`, `PAYMENT_DRIVER=mock_bank`, `enabledPaymentMethods` включает `alif_mobi` для тест-тенанта | `POST /api/v1/orders/:id/cancel` от `customer` | `status='cancelled'`, `cancel_reason='customer_changed_mind'`, `InventoryFacade.releaseStock` вызван |
| TC-ORD-013 | Таймаут неоплаченного заказа | Заказ non-cash в `pending_payment`, `payment_window_expires_at` в прошлом | `UnpaidOrderTimeoutJob` запускается | `status='cancelled'`, `cancel_reason='payment_timeout'`, остаток освобождён |
| TC-ORD-014 | Оплата после авто-отмены | Заказ уже `cancelled` по таймауту, banковский `PAID_HOLD`-вебхук приходит с опозданием | `POST /api/v1/payments/webhook` | Заказ ОСТАЁТСЯ `cancelled` (НЕ реанимируется в `paid_escrow`); создана пара `escrow_ledger` записей `hold_created`+`refunded_to_customer`; `support_ticket(category='payment_issue')` создан |
| **TC-PAY-001** | Webhook — успешный путь E2E (CUJ-2) | Заказ создан, `paymentMethod='alif_mobi'`, `PAYMENT_DRIVER=mock_bank`, `MOCK_BANK_AUTO_PAY_DELAY_MS=2000` | Ждать 2.5 сек после checkout | Заказ автоматически переходит в `paid_escrow`, `escrow_ledger` содержит `hold_created` |
| TC-PAY-002 | Повторный вебхук (сетевой ретрай банка) | Вебхук с `bankEventId=X` уже обработан | Повторный POST с тем же телом/`bankEventId` | `200 OK`, `escrow_ledger` содержит РОВНО одну запись `hold_created` (не две) |
| TC-PAY-003 | Невалидная подпись | Вебхук с телом, изменённым после подписи (симуляция подделки) | `POST /api/v1/payments/webhook` | `401 INVALID_WEBHOOK_SIGNATURE`, ни одна запись БД не изменена, `audit_log` содержит событие |
| TC-PAY-004 | Неизвестный `providerRef` | Вебхук ссылается на `providerRef`, никогда не созданный `createInvoice()` | `POST /api/v1/payments/webhook` | `200 OK`, `support_tickets(category='payment_issue')` создан, НИ ОДИН заказ не изменён |
| TC-PAY-005 | Неверный провайдер в заголовке | `X-Payment-Provider: unknown_bank` | `POST /api/v1/payments/webhook` | `400 WEBHOOK_PROVIDER_UNKNOWN` |
| TC-PAY-006 | Капчур — двойная доставка события | `OrderDeliveredEvent` доставлен дважды (at-least-once, worker restart между) | `CaptureEscrowUseCase` вызван дважды с тем же `event_id` | `escrow_ledger` содержит РОВНО одну пару `platform_fee_captured`+`captured_to_pharmacy`, `processed_events` содержит запись после первого вызова |
| TC-PAY-007 | Payout не создаётся для `cash_courier` | Заказ `cash_courier`, `status='delivered'` | Проверка `escrow_ledger`/`payout_schedule` для этого `order_id` | ОБЕ таблицы не содержат ни одной строки для этого `order_id` |
| TC-PAY-008 | Payout due → paid | `payout_schedule.status='due'`, `MockBankPayoutTransferProvider` | `PayoutExecutionJob` прогоняется | `status='paid'`, `paid_at` заполнен |
| TC-PAY-009 | Спор блокирует payout | `payout_schedule.status='due'` для заказа | Открывается `order_disputes(status='open', is_escrow_blocking=true)` | `payout_schedule.status='disputed'`, `held_by_dispute_id` заполнен; `PayoutExecutionJob` НЕ включает эту строку в батч |
| TC-PAY-010 | Реконсиляция находит расхождение | `escrow_ledger`: `hold_created=10000`, `captured_to_pharmacy=9000`, `platform_fee_captured=800` (расхождение 200) | `EscrowReconciliationJob` | `support_tickets(category='payment_issue')` создан, `audit_log` содержит `discrepancyDiram=200`, метрика `escrow_ledger_imbalance_count` инкрементирована |
| TC-PAY-011 | Реконсиляция не дублирует тикет | Расхождение уже зафиксировано вчера, тикет открыт | `EscrowReconciliationJob` прогоняется снова, расхождение то же | Новый `support_ticket` НЕ создаётся, существующий обновлён метаданными |
| TC-PAY-012 | B2B-инвойс за наличные | 5 `cash_courier`-заказов `delivered` за неделю у одной сети | `CashCommissionAggregationJob` ежедневно, затем конец недели | `platform_billing_invoices(invoice_type='cash_courier_commission')` содержит `subtotal_diram = Σ(platform_fee_diram)`, `vat_diram = subtotal×0.14`, переходит `draft→issued` в конце периода |
| TC-PAY-013 | Просрочка B2B-инвойса блокирует сеть | `platform_billing_invoices.due_at + grace_period` истёк, не оплачен | Джоба проверки просрочки | `pharmacy_chains.is_active=false`; уже оформленные `confirmed`/`paid_escrow`/`processing` заказы НЕ отменяются; новый checkout на эту сеть — `PHARMACY_SUSPENDED` |
| **TC-RET-001** | Возврат до вручения | Заказ `picked_up`, курьер отмечает `refused_at_door` | `POST /api/v1/order-returns` | `OrderReturn` создан, СРАЗУ `status='return_in_transit'` (курьер уже везёт товар обратно, минуя отдельное назначение) |
| TC-RET-002 | Финансовая матрица — брак | `return_reason='defect'`, `return_confirmed` | Резолюция возврата | Полный возврат `items_total` И `delivery_fee`; `courier_return_fee_diram > 0` |
| TC-RET-003 | Финансовая матрица — отказ у двери | `return_reason='refused_at_door'` | Резолюция | Возврат `items_total` полный; `delivery_fee` НЕ возвращается; `courier_return_fee_diram > 0` |
| TC-RET-004 | Раздельный биллинг — частичный возврат | Заказ создан с `billing_strategy='split_items_delivery'`, две отдельные `payment_operations` (items/delivery) | Возврат только `items_total` (брак части товара) | `refund()` вызван на `providerRef` строки `billing_component='items'` ТОЛЬКО; `delivery`-транзакция не затронута |
| TC-RET-005 | Резервная стратегия при отключённом split billing | `billing_strategy='single_invoice'`, `supportsPartialRefund=false` | Частичный возврат запрошен | Выполняется ПОЛНЫЙ `refund()`, создаётся `escrow_ledger.adjustment` на недополученную разницу |
| TC-RET-006 | Возврат вне окна | `now() > delivered_at + dispute_window_hours` | `POST /api/v1/order-returns { reason: 'customer_dispute_post_delivery' }` | `422 RETURN_WINDOW_EXPIRED` |
| TC-RET-007 | Наличные — возврат без ledger | `payment_method='cash_courier'`, возврат подтверждён | Резолюция возврата | `escrow_ledger` не создаёт записей; `order_returns` содержит запись как обычно; факт возврата наличных фиксируется отдельно (`admin_override`/операционная запись) |
| **TC-DISP-001** | Атомарное открытие + заморозка | `payout_schedule.status='due'` для заказа | `POST /api/v1/support-tickets` с `category='payment_issue'` (эскроу-блокирующая) | В ОДНОЙ транзакции: `support_tickets` + `order_disputes(status='open')` + `payout_schedule.status='disputed'` |
| TC-DISP-002 | Спор после payout | `payout_schedule.status='paid'` | Открытие спора | `order_disputes.requires_adjustment=true`, `payout_schedule.status` ОСТАЁТСЯ `'paid'` (не бросает ошибку) |
| TC-DISP-003 | Порог автовозврата `support_agent` | `dispute_auto_refund_threshold_dirams=15000`, сумма спора `10000` | `support_agent` вызывает `resolve-refund-full` | Успех |
| TC-DISP-004 | Превышение порога — отказ | Сумма спора `20000` > порога `15000` | `support_agent` вызывает `resolve-refund-full` | `403 UNAUTHORIZED_ADJUSTMENT` — только `super_admin` |
| TC-DISP-005 | Self-dealing запрет | Актор — `pharmacy_admin` сети заказа | `resolve-reject` от его имени | `403 SELF_DEALING_FORBIDDEN` |
| TC-DISP-006 | Двойной клик на резолюцию | `Idempotency-Key=K` уже использован для `resolve-refund-full` этого спора | Повторный вызов с тем же `K` | Возвращён сохранённый ответ, `PaymentProvider.refund()` вызван РОВНО один раз |
| TC-DISP-007 | Спор для cash-заказа | `payment_method='cash_courier'`, спор открыт | Открытие спора | `order_disputes` создан; `payout_schedule`-заморозка — нет-оп (строки не существует); операционная эскалация без денежного действия ledger |
| TC-DISP-008 (E2E, CUJ-4-продолжение) | Просрочка SLA доставки → авто-спор | `delivery_sla_city_minutes` истёк, заказ всё ещё `picked_up` | Джоба детекции SLA | `support_tickets(channel='system_auto', category='order_not_received')` создан → `order_disputes(status='open')` → payout (если существовал) заморожен |

---

**Итог**: документ вводит требования `SRS-ORD-001..041` (+`027a`), `SRS-PAY-001..042` (+`017a`),
`SRS-RET-001..012`, `SRS-DISP-001..010` (корзина, checkout, PaymentProvider-порт и три реализации,
эскроу-ledger двойной записи, вебхуки банка с категорическим запретом смены статуса вне вебхука
(единственное исключение — `AdminPaymentOverrideUseCase`), payout-расписание с заморозкой по спору,
возвраты с финансовой матрицей и стратегией раздельного биллинга, споры с атомарной заморозкой и
ролевыми порогами, отмены, три вида таймаутов, полная таблица местонахождения денег по статусам)
поверх `10-domain-model.md` (SRS-DOM-*), `11-database-schema.md` (SRS-DB-*) и
`12-api-conventions-auth-tenancy.md` (SRS-API-*), с явным разбиением по релизам согласно
`04-SCOPE-DECISION-PIVOT.md`: архитектура (порты, ledger, state machines) — целиком **R1**; реальные
банковские интеграции (Alif Mobi/DC Next) и связанные с ними физические переводы — **R3**.

**D-25 (`cash_courier` → статус `confirmed`, не `paid_escrow`)** — архитектурно РЕШЕНО и отражено в
§2.4/§4.6/§5.1/§9/§10.2/§11 этого документа; ранее стоявшая здесь версия (синхронный переход в
`paid_escrow` без ledger) архитектором ОТКЛОНЕНА как статус-обманка (см. §2.4). Обязательное условие
реализации — `confirmed` должен появиться в `CREATE TYPE order_status` (`11-database-schema.md`) и в
state machine/запрещённых переходах (`10-domain-model.md`, SRS-DOM-102) ДО того, как код этого модуля
может полагаться на него; это отдельные тикеты Tech Lead, не входящие в данный документ. Каждое
ОСТАЛЬНОЕ расширение схемы БД (§«Дополнения к схеме БД») по-прежнему явно помечено как требующее
подтверждения архитектором (ADR) перед реализацией.
