# Модуль: Курьер и доставка

> Владелец: Analyst (SRS). Статус: **BASELINE для фазы Analysis**.
> Приоритет источников при противоречии: `04-SCOPE-DECISION-PIVOT.md` > `03-ARCHITECT-DECISIONS.md` (D-*)
> > `00-PROJECT-CHARTER.md` (CUJ-*, §) > `research/00-RESEARCH-DIGEST.md` (REQ-*) > `tz.log` (§ТЗ).
> Обязательные к соблюдению (не переопределяются, только расширяются с обоснованием):
> `docs/spec/10-domain-model.md` (сущности `DeliveryAssignment`, `Courier`, `OtpCode`, `GeoPoint`, `Money`,
> state machines, доменные ошибки), `docs/spec/11-database-schema.md` (DDL групп D/H), `docs/spec/12-api-conventions-auth-tenancy.md`
> (envelope, пагинация, идемпотентность, RBAC, WS, мультитенантность).
> Покрывает **CUJ-4** (Доставка). Слои — по `02-CLEAN-ARCHITECTURE-AND-CODE.md`.
> Модуль: `modules/delivery` (`apps/api/src/modules/delivery/{domain,application,infrastructure,presentation}`).
> Публичный фасад: `DeliveryFacade` (`modules/delivery/index.ts`).
> Идентификаторы требований этого документа: **SRS-DELIV-nnn**. Тестовые сценарии: **TC-DELIV-nnn**.

---

## Разбиение по релизам

> Основание: `04-SCOPE-DECISION-PIVOT.md` §3–§5. Архитектурные основания (слои, порты, tenant-скоуп,
> ledger-совместимые записи `courier_earnings`, state machines) закладываются **в R1 целиком** — ретрофит
> дороже. Реальные Flutter-клиенты — R2, реальный банк не затрагивает этот модуль (наличные — R1).

| Компонент | Релиз | Обоснование |
|---|---|---|
| API-контракт `delivery` (все эндпоинты §A), state machine `DeliveryAssignment`, алгоритм назначения, ledger-совместимые `courier_earnings`/`courier_payouts`, наличные (COD) | **R1** | Ядро CUJ-4. Backend не зависит от того, какой клиент его вызывает (Charter §3.6) — пишется один раз |
| **Веб-модуль курьера** (адаптив, React) — тонкий клиент того же API | **R1** | R1-10 устава/PIVOT. Заменяет Flutter в R1, тот же контракт |
| Карта на OSM-тайлах, ориентиры, OTP-вручение, наличные, компенсация курьера | **R1** | R1-1/R1-8/R1-10 PIVOT |
| Холодовая цепь (чек-лист, флаг) | **R1** | Данные (`requires_cold_chain`) существуют в каталоге с R1, чек-лист — дешёвая функция UI |
| **Flutter-приложение курьера** (`apps/courier_mobile`, §B) | **R2** | R2-2 PIVOT. Использует **тот же** API-контракт §A без изменений (Charter §3.6, «смена клиента не трогает backend») |
| `geolocator`/фоновый foreground-service/офлайн-очередь (`drift`) — специфика мобильного клиента | **R2** | Часть Flutter-приложения |
| Push-уведомления (`WebPushProvider`) для веб-курьера | **R1** (Telegram/WS — основной канал), полноценный Web Push — по мере готовности `PushProvider` | R1-13/R2-5 PIVOT — WS уже покрывает live-обновления в R1, push — дополнение |
| Escrow с реальным банком (влияет на `payment_method` набор, не на этот модуль) | R3 (вне этого модуля) | Наличные (R1) и `EscrowLedger.captureOnDelivery` (программный ledger, D-02) не зависят от банка |

Каждое требование ниже помечено **[R1]**, **[R2]** или **[R3]**.

---

## 0. Границы модуля

```
modules/delivery/
├── domain/           DeliveryAssignment (агрегат), Courier, DeliveryOffer, CourierShift, DeliveryZone,
│                      DeliveryPricingRule, CourierRating — сущности/VO этого модуля.
│                      OtpCode, GeoPoint, Money, PhoneNumber, TenantId — переиспользуются из общего
│                      domain-kernel (10-domain-model.md §4), НЕ дублируются.
├── application/      Use cases (§A.4), порты: CourierRepositoryPort, DeliveryAssignmentRepositoryPort,
│                      DeliveryOfferRepositoryPort, OtpGeneratorPort (переиспользован), ClockPort,
│                      IdGeneratorPort, NotificationPort (Telegram/SMS/WebPush — Provider Pattern),
│                      RealtimePublisherPort (WS), OrdersFacade (для чтения снапшота адреса/суммы заказа),
│                      PaymentsFacade (для чтения/капчура эскроу — используется через событие, не напрямую).
├── infrastructure/   Drizzle-репозитории, BullMQ-продюсеры (`delivery-offer-timeout` очередь),
│                      WS-gateway публикатор, адаптер геораспределения (PostGIS `ST_DWithin`).
└── presentation/     DeliveryAssignmentsController, DeliveryOffersController, CourierLocationsController,
                       CourierShiftsController, CourierEarningsController, DeliveryPricingController,
                       DeliveryWsGateway (часть общего `/api/v1/realtime`), guards/policies.
```

**SRS-DELIV-001** [R1, `02` §1.2] Единственный способ, которым модули `orders`, `payments`, `billing`,
`returns` взаимодействуют с этим модулем — через `DeliveryFacade` (методы: `createAssignment`,
`assign`, `reassign`, `hasActiveAssignment`, `getActiveAssignment`, `calculateDeliveryFee`,
`assignReturnCourier`) и доменные события (§A.6). Прямой импорт
`modules/delivery/domain/*` из другого модуля — блокирующее нарушение ревью.

**SRS-DELIV-002** [R1, `02` §2] `DeliveryAssignment` защищает свои инварианты сама (SRS-DOM-036..041,
уже определены `10-domain-model.md` — не переопределяются здесь, только используются). Новые сущности
этого документа (`DeliveryOffer`, `CourierShift`, `CourierRating`, `DeliveryZone`, `DeliveryPricingRule`)
следуют тем же правилам §2 `02-CLEAN-ARCHITECTURE-AND-CODE.md`: приватный конструктор + фабрика,
методы-намерения, ноль примитивов там, где нужен VO.

---

## Дополнения к схеме БД

> Обоснование каждого поля — обязательное (Charter §5/`04-SCOPE-DECISION`). Новые денежные поля —
> суффикс `_diram`, `BIGINT` (`SRS-DB-003`). Новые таблицы — `UUID v7` через `IdGeneratorPort`
> (`SRS-DB-001`). Поля, помеченные **[cross-module]**, физически принадлежат таблице другого модуля
> (`orders` — модуль Orders/Checkout) — вносятся сюда, т.к. требуются ЭТИМ модулем для CUJ-4, и подлежат
> согласованию при мерже миграций (см. «Открытые вопросы» в конце документа).

### D.1 `couriers` (расширение)

```sql
ALTER TABLE couriers
    ADD COLUMN last_known_latitude NUMERIC(10, 8),
    ADD COLUMN last_known_longitude NUMERIC(11, 8),
    ADD COLUMN last_location_at TIMESTAMPTZ,
    ADD COLUMN shift_status courier_shift_status NOT NULL DEFAULT 'off_shift',
    ADD COLUMN rating_avg NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
    ADD COLUMN rating_count INT NOT NULL DEFAULT 0,
    ADD COLUMN current_cash_on_hand_diram BIGINT NOT NULL DEFAULT 0;

CREATE TYPE courier_shift_status AS ENUM ('off_shift', 'on_shift');

CONSTRAINT chk_couriers_rating_range CHECK (rating_avg >= 0 AND rating_avg <= 5);
CONSTRAINT chk_couriers_cash_nonneg CHECK (current_cash_on_hand_diram >= 0);
```

**SRS-DELIV-003** [R1, ASSUMPTION] `last_known_latitude/longitude/at` — кэш последней GPS-точки,
источник для алгоритма назначения (§A.4) и живой карты диспетчера; НЕ история (история — см. D.3).
`shift_status` — жёсткий фильтр приёмлемости в алгоритме (`off_shift` курьер никогда не предлагается).
`rating_avg`/`rating_count` — агрегат `courier_ratings` (D.6), пересчитывается application-слоем после
каждой новой оценки (скользящее среднее, не курсор по всей истории на каждый запрос).
`current_cash_on_hand_diram` — текущий остаток наличных у курьера между инкассациями (REQ-COUR-7,
D.4 ниже).

### D.2 `delivery_assignments` (расширение)

```sql
ALTER TABLE delivery_assignments
    ADD COLUMN requires_cold_chain BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN cold_chain_bag_confirmed BOOLEAN,
    ADD COLUMN cold_chain_bag_confirmed_at TIMESTAMPTZ,
    ADD COLUMN contact_attempts_count INT NOT NULL DEFAULT 0,
    ADD COLUMN last_contact_attempt_at TIMESTAMPTZ,
    ADD COLUMN distance_meters INT; -- снапшот дистанции аптека→клиент на момент создания (для delivery_fee аудита)
```

**SRS-DELIV-004** [R1, SRS-DOM-038] `requires_cold_chain` — снапшот на момент
`CreateDeliveryAssignmentUseCase.execute()` (агрегируется как `OR` по всем `order_items.medicine_id →
medicines.requires_cold_chain` заказа), НЕ живой JOIN при каждой проверке — стабильность аудита, если
позже поменяется классификация препарата. `contact_attempts_count`/`last_contact_attempt_at` —
счётчик попыток связаться с клиентом (SRS-DOM-143, ASSUMPTION 3 попытки/30 минут, см. §A.7).

### D.3 Новая таблица `delivery_offers`

```sql
CREATE TYPE delivery_offer_status AS ENUM ('pending', 'accepted', 'declined', 'expired', 'superseded');

CREATE TABLE delivery_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_assignment_id UUID NOT NULL REFERENCES delivery_assignments(id) ON DELETE CASCADE,
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,
    sequence_no INT NOT NULL, -- 1..N по порядку эскалации
    status delivery_offer_status NOT NULL DEFAULT 'pending',
    distance_meters INT NOT NULL,
    score NUMERIC(6, 4) NOT NULL, -- итоговый скор алгоритма на момент оффера (аудит/объяснимость)
    offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    decline_reason VARCHAR(100),
    CONSTRAINT chk_delivery_offers_sequence_positive CHECK (sequence_no > 0)
);
CREATE UNIQUE INDEX ux_delivery_offers_one_pending_per_assignment
    ON delivery_offers (delivery_assignment_id) WHERE status = 'pending';
CREATE INDEX ix_delivery_offers_courier_pending
    ON delivery_offers (courier_id) WHERE status = 'pending';
COMMENT ON TABLE delivery_offers IS
    'Очередь последовательных предложений курьерам (REQ-DELIV-2). Один PENDING оффер на назначение '
    'одновременно (частичный уникальный индекс). Эскалация — новая строка sequence_no+1, старая '
    'помечается expired. Не путать с delivery_assignments.status — назначение остаётся unassigned, '
    'пока ни один оффер не принят.';
```

**SRS-DELIV-005** [R1, REQ-DELIV-2] Обоснование новой таблицы: `delivery_assignment_status`
(`11-database-schema.md`) не содержит промежуточного состояния «предложено» — не переопределяется
(`D-*` — закон), поэтому фаза предложения/эскалации моделируется отдельной сущностью, оставляющей
`DeliveryAssignment.status = 'unassigned'` до фактического `assign()`.

### D.4 Новая таблица `courier_shifts`

```sql
CREATE TYPE courier_shift_record_status AS ENUM ('active', 'closed');

CREATE TABLE courier_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,
    status courier_shift_record_status NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    opening_cash_on_hand_diram BIGINT NOT NULL DEFAULT 0,
    cash_collected_diram BIGINT NOT NULL DEFAULT 0, -- сумма record-cash за смену (cash_courier заказы)
    cash_submitted_diram BIGINT, -- заполняется при закрытии смены (инкассация/сдача дежурному)
    discrepancy_diram BIGINT, -- collected - submitted, заполняется при закрытии
    closed_by UUID REFERENCES users(id) ON DELETE SET NULL, -- self или dispatcher
    notes TEXT
);
CREATE UNIQUE INDEX ux_courier_shifts_one_active ON courier_shifts (courier_id) WHERE status = 'active';
COMMENT ON TABLE courier_shifts IS
    'История смен (REQ-COUR-7 соседняя область). Разделяет "признание заработка" (courier_earnings, '
    'по факту delivered) от "физического учёта наличных на руках" (эта таблица). discrepancy_diram != 0 '
    'логируется в audit_log (category=cash_reconciliation_discrepancy, см. D.7).';
```

**SRS-DELIV-006** [R1, ASSUMPTION] Ровно одна `active` смена на курьера одновременно (частичный
уникальный индекс). `couriers.shift_status='on_shift'` — денормализованный быстрый флаг для алгоритма
назначения, синхронизируется атомарно в той же транзакции, что и создание/закрытие `courier_shifts`.

### D.5 Новая таблица `courier_ratings`

```sql
CREATE TABLE courier_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE, -- одна оценка на заказ
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_courier_ratings_range CHECK (rating BETWEEN 1 AND 5)
);
```

**SRS-DELIV-007** [R1, ASSUMPTION — рейтинг курьера не описан ни в `tz.log`, ни в research; вводится
как минимально необходимая опора для алгоритма назначения из §A.4 задачи PIVOT, подлежит подтверждению
продуктом] Оценка доступна `customer` только для заказов в статусе `delivered`, один раз на заказ
(`UNIQUE(order_id)`). Создание строки атомарно инкрементирует `couriers.rating_count` и пересчитывает
`rating_avg = (rating_avg * rating_count_before + rating) / rating_count_after` в той же транзакции.

### D.6 Ценообразование доставки: `delivery_zones` + `delivery_pricing_rules`

```sql
CREATE TABLE delivery_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = глобальный дефолт (neutral)
    name VARCHAR(100) NOT NULL,
    center_geo_point GEOGRAPHY(POINT, 4326) NOT NULL,
    radius_km NUMERIC(6, 2) NOT NULL,
    priority SMALLINT NOT NULL DEFAULT 0, -- меньше = выше приоритет при перекрытии зон
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT chk_delivery_zones_radius_positive CHECK (radius_km > 0)
);
CREATE INDEX ix_delivery_zones_geo ON delivery_zones USING GIST (center_geo_point);

CREATE TABLE delivery_pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = глобальный дефолт
    zone_id UUID REFERENCES delivery_zones(id) ON DELETE CASCADE, -- NULL = дефолтное правило тенанта вне зон
    base_rate_diram BIGINT NOT NULL,
    rate_per_km_diram BIGINT NOT NULL,
    min_order_amount_diram BIGINT NOT NULL DEFAULT 0,
    free_delivery_threshold_diram BIGINT, -- NULL = бесплатная доставка не предлагается
    night_tariff_start_time TIME, -- Asia/Dushanbe, NULL = ночной тариф выключен
    night_tariff_end_time TIME,
    night_tariff_extra_diram BIGINT NOT NULL DEFAULT 0,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    CONSTRAINT chk_delivery_pricing_rates_nonneg CHECK (
        base_rate_diram >= 0 AND rate_per_km_diram >= 0 AND min_order_amount_diram >= 0
        AND night_tariff_extra_diram >= 0
    )
);
```

**SRS-DELIV-008** [R1, REQ-DELIV-1, ASSUMPTION — тз/research фиксируют только базовую формулу
«ставка + ставка/км»; зоны/мин.сумма/бесплатная доставка/ночной тариф вводятся по требованию
`04-SCOPE-DECISION` §3.1 и подлежат утверждению продуктом, как ставки комиссии D-03] Зона — окружность
(`center_geo_point`+`radius_km`), не полигон — простейшая модель, достаточная для MVP-масштаба города
(намеренно не PostGIS-полигоны — избежание over-engineering, D-05 принцип). При перекрытии зон
выбирается зона с наименьшим `priority`, при равенстве — с наименьшим `radius_km` (более специфичная).
Отсутствие покрывающей зоны для тенанта, где `courierSourcingMode` требует зональности, — конфигурация
"вся территория" по умолчанию (`delivery_zones` с `radius_km` = ASSUMPTION 30 км от единственной аптеки
тенанта, если явных зон не заведено — деградация, не блокировка чекаута).

### D.7 `audit_action_category` — новое значение enum

```sql
-- Отдельная миграция ВНЕ транзакции (SRS-DB-009)
ALTER TYPE audit_action_category ADD VALUE 'cash_reconciliation_discrepancy';
```

**SRS-DELIV-009** [R1] Обоснование: `courier_shifts.discrepancy_diram != 0` при закрытии смены —
финансовое расхождение, подлежащее тому же комплаенс-журналу, что и `ledger_adjustment`/
`payment_override`, но семантически иное — не расширяет существующие значения, вводит новое, по
механике, уже описанной `SRS-DB-009`.

### D.8 `orders` (расширение) — **[cross-module, требует согласования с модулем Orders/Checkout]**

```sql
ALTER TABLE orders
    ADD COLUMN delivery_entrance VARCHAR(20),
    ADD COLUMN delivery_floor VARCHAR(20),
    ADD COLUMN delivery_apartment VARCHAR(20),
    ADD COLUMN delivery_comment TEXT,
    ADD COLUMN delivery_landmark_photo_url TEXT;
```

**SRS-DELIV-010** [R1, REQ-GEO-3] `orders` уже содержит `delivery_address`/`delivery_landmark`/
`delivery_latitude`/`delivery_longitude` (снапшот на момент чекаута), но не имеет паритета с
`user_addresses` (которая ИМЕЕТ `entrance`/`floor`/`apartment`/`landmark_photo_url`, REQ-GEO-3). Без
этого паритета курьерский экран навигации (CUJ-4) не может показать подъезд/этаж/фото — данные либо
отсутствуют для гостевых заказов (без сохранённого адреса), либо теряются при снапшоте из
`user_addresses`, если адрес позже отредактирован/удалён. Эти 5 полей копируются use case'ом чекаута
(модуль Orders) из `user_addresses` (если использован сохранённый адрес) или из формы разового ввода
(гостевой чекаут) — **эта запись use case вне зоны ответственности данного модуля**, но сами эндпоинты
и Flutter-экраны этого документа (§A.5, §B) читают их через `OrdersFacade.getDeliverySnapshot(orderId)`.

---

## (A) API-контракт

### A.1 Обзор ролей и permission-строк (расширение `12-api-conventions-auth-tenancy.md` §4)

| Permission | customer | courier | pharmacist | pharmacy_admin | support_agent | super_admin |
|---|---|---|---|---|---|---|
| `delivery-offers:read:own` | ❌ | ✅ (свои) | ❌ | ❌ | ❌ | ❌ |
| `delivery-offers:respond` | ❌ | ⚠ адресат оффера | ❌ | ❌ | ❌ | ❌ |
| `delivery-assignments:claim` | ❌ | ⚠ `on_shift`, тенантный guard (SRS-DOM-037) | ❌ | ❌ | ❌ | ❌ |
| `delivery-assignments:read:own` | ⚠ свой заказ (только статус/ETA, БЕЗ courier-only полей) | ⚠ назначен | ⚠ своя аптека | ⚠ своя сеть | ⚠ по тикету | ✅ |
| `delivery-assignments:assign-manual` | ❌ | ❌ | ❌ | ✅ свой флот | ❌ | ✅ (включая пул) |
| `delivery-assignments:reassign` | ❌ | ❌ | ❌ | ✅ свой флот | ❌ | ✅ |
| `delivery-assignments:depart` / `:depart-to-customer` | ❌ | ⚠ назначенный курьер, свой рейс | ❌ | ❌ | ❌ | ❌ |
| `delivery-assignments:record-cash` | ❌ | ⚠ назначенный курьер (уже в RBAC §4.1 doc 12) | ❌ | ❌ | ❌ | ❌ |
| `delivery-assignments:deliver` (OTP) | ❌ | ⚠ назначенный курьер (уже в doc 12) | ❌ | ❌ | ❌ | ❌ |
| `delivery-assignments:report-issue` | ❌ | ⚠ назначенный | ❌ | ⚠ своя сеть (просмотр/эскалация) | ✅ | ✅ |
| `courier-locations:write` | ❌ | ⚠ себя (`courierId=actor.courierId`) | ❌ | ❌ | ❌ | ❌ |
| `courier-locations:read` | ❌ (только косвенно, через `delivery-assignments:read:own`, без точных координат — только ETA/дистанция) | ⚠ себя | ❌ | ✅ свой флот | ❌ | ✅ |
| `courier-shifts:manage:own` | ❌ | ✅ (старт/финиш себя) | ❌ | ❌ | ❌ | ❌ |
| `courier-earnings:read:own` | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `courier-payouts:read` | ❌ | ✅ свои | ❌ | ❌ | ❌ | ✅ |
| `delivery-pricing:manage` | ❌ | ❌ | ❌ | ⚠ только для тенанта своей сети, если `is_whitelabel_active` (как `tenancy:manage-branding`, doc 12 §4.1) | ❌ | ✅ |
| `courier-ratings:create` | ⚠ свой `delivered`-заказ, один раз | ❌ | ❌ | ❌ | ❌ | ❌ |

**SRS-DELIV-011** [R1, `02` §3.4] Все `⚠`-условия — `application`-политики
(`DeliveryAssignmentOwnershipPolicy`, `CourierShiftPolicy`), НЕ guard'ы (переиспользует принцип
`SRS-API-036`). `customer` НИКОГДА не видит точные координаты курьера или точный адрес аптеки сборки в
ответе — только производные (ETA-минуты, статус, пройденная доля маршрута), см. §A.5.

### A.2 Эндпоинты курьера

**SRS-DELIV-012** [R1] `GET /api/v1/delivery-offers?status=pending` — офферы, адресованные текущему
курьеру (implicit scope `own`, `courierId` берётся из JWT). Ответ (envelope §2 doc 12):

```json
{ "data": [{
  "id": "9f1...", "deliveryAssignmentId": "a21...", "sequenceNo": 1,
  "distanceMeters": 1840, "expiresAt": "2026-08-27T09:16:30.000Z",
  "pharmacy": { "name": "Аптека №4", "addressText": "...", "geoPoint": { "lat": 38.57, "lon": 68.78 } },
  "orderSummary": { "itemsCount": 3, "requiresColdChain": false, "paymentMethod": "cash_courier",
                     "estimatedDeliveryFeeDiram": 1500 }
}], "meta": { "pagination": { "hasMore": false, "limit": 20 } } }
```

Точный адрес/ориентир/телефон клиента **не раскрывается** до `accept` (SRS-DELIV-018) — минимизация
утечки ПДн при отклонённых офферах.

**SRS-DELIV-013** [R1] `POST /api/v1/delivery-offers/:id/accept`. Given оффер `status='pending'` И
`courier.id = актор` И `now() <= expires_at`, When accept, Then атомарно (одна транзакция): (1)
`offer.status = 'accepted'`, `responded_at = now()`; (2) все ОСТАЛЬНЫЕ `pending`-офферы этого же
`delivery_assignment_id` (не должно быть — частичный уникальный индекс гарантирует ровно один pending)
инвариант проверен структурно; (3) `DeliveryAssignment.assign(courierId)` (домен, SRS-DOM-037/038
guard'ы применяются здесь); (4) BullMQ delayed job таймаута оффера отменяется; (5) публикуется
`CourierAssignedEvent`/WS `delivery.courier_assigned`. Given `now() > expires_at` (гонка: истёк между
чтением клиентом и кликом), Then `409 OFFER_EXPIRED` — клиент обязан обновить список офферов. Given
`status != 'pending'` (уже отвечен другим потоком/устройством того же курьера), Then
`409 OFFER_ALREADY_RESPONDED`.

**SRS-DELIV-014** [R1] `POST /api/v1/delivery-offers/:id/decline { "reason"?: string }`. Given оффер
`pending` и принадлежит актору, When decline, Then `offer.status='declined'`, немедленно триггерится
эскалация к следующему кандидату (§A.4.3) — курьер, однажды отклонивший оффер по заказу, повторно не
предлагается по тому же `delivery_assignment_id` (структурно: `sequence_no` уникален по
`(assignment_id, courier_id)` — SQL-уровень не форсирует, но `SuggestNearestCourierUseCase` исключает
уже отвечавших курьеров из кандидатского пула следующей итерации).

**SRS-DELIV-015** [R1] `GET /api/v1/delivery-assignments/available-pool?radiusKm=5` — эскалированные
(после исчерпания последовательных офферов, §A.4.4) назначения, видимые ЛЮБОМУ приемлемому `on_shift`
курьеру в радиусе (тенантный guard SRS-DOM-037 применяется к фильтрации списка, не только к `assign`).
Сортировка — по дистанции (по умолчанию), курсор — `sort=distance:asc`. Поля ответа — тот же
урезанный вид, что в SRS-DELIV-012 (без точного адреса клиента).

**SRS-DELIV-016** [R1] `POST /api/v1/delivery-assignments/:id/claim` (`Idempotency-Key` опционален,
но операция сама атомарна без него). Given назначение `unassigned` И присутствует в пуле (все
предыдущие офферы `expired`) И курьер проходит тенантный/cold-chain guard, When claim, Then
`DeliveryAssignment.assign(courierId)` — первый успешный `UPDATE ... WHERE status='unassigned'`
побеждает (optimistic check на `status`, не `SELECT FOR UPDATE` — конкуренция редка, ре-попытка дешева).
Given уже заявлен другим курьером (гонка), Then `409 ASSIGNMENT_ALREADY_CLAIMED`.

**SRS-DELIV-017** [R1] `GET /api/v1/delivery-assignments/mine?status=active|history` — назначения
текущего курьера. `active` — нетерминальные (`assigned`..`en_route_to_customer`); `history` —
терминальные (`delivered`/`delivery_failed`), пагинация курсором (SRS-API-004). Обязателен для
REST-catch-up после WS-реконнекта (SRS-API-053) — Flutter/веб клиент вызывает его первым делом при
восстановлении соединения, ДО повторной подписки на WS-комнату `courier:{id}`.

**SRS-DELIV-018** [R1] `GET /api/v1/delivery-assignments/:id` — полная детализация: адрес аптеки,
`landmark_text`/`landmark_photo_url`/`entrance`/`floor`/`apartment`/`delivery_comment` клиента (только
ПОСЛЕ `assign`, т.е. `status != 'unassigned'` — иначе `403 FORBIDDEN`, курьер вне назначения не видит
детали чужого заказа даже по прямому `id`), `requiresColdChain`, `paymentMethod`,
`estimatedDeliveryFeeDiram`, статус OTP (`otpIssued: boolean`, НИКОГДА сам код — `code_hash` не
покидает `infrastructure`), текущий `contactAttemptsCount`.

**SRS-DELIV-019** [R1, SRS-DOM-041] `POST /api/v1/delivery-assignments/:id/depart` — `assigned →
en_route_to_pharmacy`. Только назначенный курьер. `403 FORBIDDEN`, если `assignment.courierId !=
actor.courierId`.

**SRS-DELIV-020** [R1] `POST /api/v1/delivery-assignments/:id/depart-to-customer
{ "coldChainBagConfirmed"?: boolean }` — `picked_up_from_pharmacy → en_route_to_customer`. Given
`assignment.requiresColdChain = true` И `coldChainBagConfirmed` отсутствует или `false`, Then
`422 COLD_CHAIN_BAG_NOT_CONFIRMED` (§A.9). Успех записывает `cold_chain_bag_confirmed=true`,
`cold_chain_bag_confirmed_at=now()`.

**SRS-DELIV-021** [R1, SRS-API-009, SRS-DOM-040] `POST /api/v1/delivery-assignments/:id/record-cash
{ "collectedDiram": number, "changeDiram": number }` — **`Idempotency-Key` ОБЯЗАТЕЛЕН** (уже в таблице
`SRS-API-009` doc 12). Только для `payment_method='cash_courier'`. Given
`collectedDiram - changeDiram !== order.totalAmountDiram`, Then `422 CASH_AMOUNT_MISMATCH` (домен-код,
уже определён `10-domain-model.md`). Успех: `delivery_assignments.cash_collected_diram/cash_change_diram`
заполняются, `couriers.current_cash_on_hand_diram += (collectedDiram)` (сдача выдаётся клиенту сразу
из наличных курьера — на балансе курьера остаётся именно `collectedDiram`, `changeDiram` физически
передан клиенту и не хранится курьером; правило: то, что осталось у курьера после сдачи, —
`order.totalAmountDiram`, что и прибавляется к `current_cash_on_hand_diram`; уравнение
`collected - change = total` из чек-констрейнта БД гарантирует это тождество), инкрементирует
`courier_shifts.cash_collected_diram` активной смены курьера. Обязателен ДО `deliver` (домен требует —
SRS-DOM-040).

**SRS-DELIV-022** [R1, SRS-DOM-039] `POST /api/v1/delivery-assignments/:id/deliver { "otpCode": "1234" }`
— `en_route_to_customer → delivered`. Домен уже определяет `OtpExpiredError`/`OtpMismatchError`/
`OtpAttemptsExceededError` (SRS-DOM-082) → `400 OTP_EXPIRED`/`400 OTP_MISMATCH`/`423 OTP_LOCKED`.
Успех: `EscrowLedger.captureOnDelivery(...)` (через событие `OrderDeliveredEvent` → `payments`, НЕ
прямой вызов — module boundary, `10-domain-model.md` таблица «Межмодульные связи»),
`courier_earnings` строка признаётся (только для `chainId IS NULL`, REQ-COUR-3), закрывает
`contact_attempts_count`.

**SRS-DELIV-023** [R1, REQ-DELIV-3, SRS-DOM-173] Given курьер заблокирован OTP (`OTP_LOCKED`, 5
неверных попыток), Then единственный путь восстановления — `ReissueHandoverOtpUseCase`, доступный
`pharmacist` (своя аптека) ИЛИ `support_agent`/`super_admin` (эскалация через тикет). Курьер САМ не
может перевыпустить свой хендовер-OTP — предотвращает сценарий, где курьер перебором подбирает код
без участия клиента. `POST /api/v1/delivery-assignments/:id/reissue-handover-otp` — роли
`pharmacist`/`support_agent`/`super_admin`, `Idempotency-Key` не требуется (не финансовая операция, но
идемпотентна по построению — повторный вызов просто перевыпускает новый код, старый уже недействителен).

**SRS-DELIV-024** [R1, альтернативное подтверждение] Given клиент физически недоступен для ввода
OTP (потерян телефон с приложением/неграмотен/иная уважительная причина, подтверждённая ЗВОНКОМ
поддержки), When `support_agent`/`super_admin` вызывает `reissue-handover-otp` (SRS-DELIV-023) И
сообщает новый код клиенту голосом по телефону, Then курьер вводит этот код через ОБЫЧНЫЙ `deliver`
(SRS-DELIV-022) — контракт не вводит отдельного «alternative confirmation» эндпоинта, обходящего
`OtpCode.verify()`: **единственный путь к `delivered` — успешная проверка OTP** (домен, SRS-DOM-039).
Фото/подпись как ЕДИНСТВЕННОЕ подтверждение без OTP — ЗАПРЕЩЕНЫ контрактом (риск мошенничества,
несовместимо с `10-domain-model.md`, который не определяет такой путь для агрегата). Фото допускается
ТОЛЬКО как ДОПОЛНИТЕЛЬНАЯ доказательная база при уже состоявшемся OTP-подтверждении (см.
`POST .../deliver` — необязательное поле `proofPhotoUrl` в теле, для складов без консьержа/спорных
адресов), не заменяет его.

**SRS-DELIV-025** [R1] `POST /api/v1/delivery-assignments/:id/report-issue
{ "issueType": "customer_unreachable" | "address_not_found" | "other", "notes"?: string }` — только
`en_route_to_customer`. Инкрементирует `contact_attempts_count`, `last_contact_attempt_at=now()`.
Given `issueType='customer_unreachable'` И `contact_attempts_count >= 3` (ASSUMPTION, конфигурируемо
`DELIVERY_MAX_CONTACT_ATTEMPTS`) И `now() - first_attempt >= 30 минут` (ASSUMPTION
`DELIVERY_CONTACT_WINDOW_MINUTES`), Then разрешён следующий вызов
`POST /api/v1/delivery-assignments/:id/mark-failed { "reason": "customer_unreachable" }` — переход
`en_route_to_customer → delivery_failed` (SRS-DOM-143), событие `DeliveryFailedEvent` (новое, §A.6) →
`returns`-модуль создаёт `OrderReturn(reason='undeliverable')` (межмодульная граница, не эта команда).
Ниже порога попыток — `422 CONTACT_ATTEMPTS_INSUFFICIENT` на `mark-failed`.

**SRS-DELIV-026** [R1, REQ-DELIV-5] `POST /api/v1/delivery-assignments/:id/refuse-at-door
{ "reason": "refused_at_door", "notes"?: string }` — клиент отказался принять на пороге. Только
`en_route_to_customer`. Переход `en_route_to_customer → delivery_failed` НЕ используется — вместо
этого события `OrderRefusedAtDoorEvent` (§A.6) → `orders` переводит заказ, `returns` создаёт
`OrderReturn(reason='refused_at_door')` (SRS-DOM-096 уже определяет эту ветвь на уровне `Order`, этот
эндпоинт — триггер со стороны курьера).

**SRS-DELIV-027** [R1] `POST /api/v1/courier-locations { "lat": .., "lon": .., "capturedAt": "...",
"accuracyM"?: number, "speedKmh"?: number }` ИЛИ батч `{ "pings": [ {...}, {...} ] }` (офлайн-очередь
Flutter, §B.5). Роль `courier`, `Idempotency-Key` не требуется (не финансовая операция, естественно
идемпотентна — повторная отправка той же точки безвредна). Given `capturedAt` старше
`LOCATION_PING_MAX_AGE_MINUTES` (ASSUMPTION 30), Then точка молча пропускается (не ошибка — офлайн-
очередь может содержать устаревшие точки после долгого разрыва связи), но КАЖДАЯ принятая точка
обновляет `couriers.last_known_latitude/longitude/at` ТОЛЬКО если `capturedAt` новее уже сохранённого
(защита от переупорядочивания батча). Ответ: `{ "data": { "accepted": 3, "skippedStale": 1 } }`.
Rate-limit: `RATE_LIMIT_COURIER_LOCATION_PER_MIN = 30` на курьера (одиночные пинги — раз в 10-15с
нормальная частота, см. §B.3).

**SRS-DELIV-028** [R1] `POST /api/v1/courier-shifts` (без тела) — начать смену. Given уже есть
`active`-смена (уникальный индекс), Then `409 SHIFT_ALREADY_ACTIVE`. Успех:
`couriers.shift_status='on_shift'`, `courier_shifts` строка создаётся с
`opening_cash_on_hand_diram = couriers.current_cash_on_hand_diram` (перенос остатка с прошлой смены,
если инкассация не была полной).

**SRS-DELIV-029** [R1] `POST /api/v1/courier-shifts/:id/end { "cashSubmittedDiram": number }` —
завершить смену. Given нет активных (нетерминальных) `delivery_assignments` у курьера, When end, Then
`status='closed'`, `ended_at=now()`, `discrepancy_diram = cash_collected_diram +
opening_cash_on_hand_diram - cashSubmittedDiram`, `couriers.shift_status='off_shift'`,
`couriers.current_cash_on_hand_diram = 0` (передано/инкассировано). Given
`discrepancy_diram != 0`, Then событие `CashReconciliationDiscrepancyEvent` пишется в `audit_log`
(`category='cash_reconciliation_discrepancy'`) — НЕ блокирует закрытие смены (курьер физически ушёл
домой, расхождение разбирается административно). Given есть активное назначение (`assigned`..
`en_route_to_customer`), Then `422 ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END` — нельзя закрыть смену, пока
заказ физически у курьера.

**SRS-DELIV-030** [R1] `GET /api/v1/courier-earnings?cursor=&limit=` — `implicit scope: own` для
`courier`; `filter[courierId]` обязателен для `super_admin`. Возвращает строки `courier_earnings`
(§`11-database-schema.md` §32-36) — `amount_diram`, `is_return_fee`, `recognized_at`, `payoutBatchId`
(если уже включена в батч).

**SRS-DELIV-031** [R1] `GET /api/v1/courier-payouts` — история батчей выплат (§`courier_payouts`),
`courier` видит только свои, `super_admin` — все/по фильтру.

**SRS-DELIV-032** [R1] `POST /api/v1/courier-ratings { "orderId": "...", "rating": 1..5, "comment"?: "" }`
— роль `customer`, только владелец заказа, только `order.status='delivered'`, один раз (`409
RATING_ALREADY_SUBMITTED` при повторе — новый код, соответствует `UNIQUE(order_id)`).

### A.3 Эндпоинты диспетчера/админа

**SRS-DELIV-033** [R1, REQ-DELIV-2] `POST /api/v1/delivery-assignments/:id/assign-manual
{ "courierId": "...", "reason"?: string }` — `pharmacy_admin` (свой флот, `courier.chainId ===
actor.chainId`) / `super_admin` (любой курьер, включая пул). Отменяет все `pending`-офферы этого
назначения (`superseded`), вызывает `DeliveryAssignment.assign(courierId)` напрямую — обходит
алгоритм и очередь предложений целиком (REQ-DELIV-2 «обязательный ручной override»).

**SRS-DELIV-034** [R1, SRS-DOM-041] `POST /api/v1/delivery-assignments/:id/reassign
{ "courierId": "...", "reason": string }` — `reason` обязателен (не опционален, в отличие от
`assign-manual` — переназначение УЖЕ идущей доставки требует объяснения для аудита, первичное
назначение — нет). Доступно в ЛЮБОЙ нетерминальной стадии (`assigned`..`en_route_to_customer`).
Роли — как в SRS-DELIV-033.

**SRS-DELIV-035** [R1] `GET /api/v1/delivery-assignments?filter[status][in]=...&sort=createdAt:desc` —
операционный дашборд диспетчера. `pharmacy_admin` — только своя сеть (implicit `chainId`-скоуп);
`super_admin` — все, включая пул.

**SRS-DELIV-036** [R1] `GET/PUT /api/v1/delivery-pricing-rules`, `GET/POST/PATCH /api/v1/delivery-zones`
— тенант резолвится из `TenantContext` (не из пути, SRS-API-041), `super_admin` может явно указать
чужой `X-Tenant-Slug` (SRS-API-044, логируется `crossTenantOverride=true`). `PUT` на
`delivery-pricing-rules` создаёt НОВУЮ строку с `effective_from=now()` и закрывает предыдущую
(`effective_to=now()`) — история ставок не перезаписывается (тот же паттерн, что
`tenant_courier_payout_rules`/`commission_rates`).

### A.4 Назначение курьера

**SRS-DELIV-037** [R1, REQ-DELIV-2, SRS-DOM-036] Триггер создания `DeliveryAssignment`:
`OrderPickedUpEvent` (переход заказа `processing → picked_up`, сборка фармацевтом завершена, сейф-пакет
опечатан, SRS-DOM-094/SRS-PHT-027) — ЗАКОН из `10-domain-model.md` (таблица «Межмодульные связи»:
`orders → delivery: OrderPickedUpEvent → delivery создаёт/обновляет DeliveryAssignment»; таблица
«События»: `OrderPickedUpEvent` потребляется `delivery`, `OrderProcessingStartedEvent` — только
`notifications`/`analytics`, БЕЗ `delivery`), этот документ его НЕ переоткрывает (см. преамбулу —
`10-domain-model.md` обязателен к соблюдению без права переопределения аналитиком). Обработчик
`OrderPickedUpEvent` вызывает `DeliveryAssignment.create()`, который проверяет отсутствие уже активного
назначения для `orderId` (SRS-DOM-036 — идемпотентность обработчика при повторной доставке события);
`requiresColdChain` вычисляется в этот же момент из снапшота заказа (D.2). Оффер первому кандидату
(`SuggestNearestCourierUseCase`, SRS-DELIV-038) создаётся немедленно в той же транзакции обработчика
события.

**Пояснение к отклонённой альтернативе (параллельный подбор курьера во время сборки).** Более ранняя
редакция этого документа переопределяла момент создания `DeliveryAssignment` на
`OrderProcessingStartedEvent` (`paid_escrow → processing`), чтобы подбор курьера шёл параллельно со
сборкой и не терял время SLA (7 минут, D-19) на ожидание `OrderPickedUpEvent`. Это переопределение
удалено: `10-domain-model.md` не даёт этому документу права переносить момент создания агрегата, и
такой перенос нигде не был закреплён ADR в `03-ARCHITECT-DECISIONS.md`, из-за чего два backend-модуля
(`orders`/`pharmacy-terminal` через SRS-PHT-027 и `delivery` через SRS-DELIV-037) расходились в том,
какой обработчик реально владеет `DeliveryAssignment.create()`. Если операционные данные впоследствии
покажут, что подбор курьера ПОСЛЕ `OrderPickedUpEvent` не укладывается в SLA, устранение — отдельный
ADR, который явно (1) обновит `10-domain-model.md` (таблицу «Межмодульные связи», SRS-DOM-036, таблицу
«События» — добавит `delivery` в потребители `OrderProcessingStartedEvent`) и (2) обновит SRS-PHT-027 в
`24-module-pharmacy-terminal.md` соответственно; ИЛИ введёт read-only «soft-search» кандидатов
(запрос `CourierCandidatePort` и кэширование ранжированного списка по `orderId` с коротким TTL — БЕЗ
создания `DeliveryAssignment`/`DeliveryOffer` и без записи в БД доставки), который `SuggestNearestCourierUseCase`
(SRS-DELIV-038) переиспользует при фактическом создании назначения на `OrderPickedUpEvent`, если кэш
ещё свеж. До появления такого ADR действует правило этого пункта: создание строго на
`OrderPickedUpEvent`.

**SRS-DELIV-038 — Алгоритм подбора (`SuggestNearestCourierUseCase`)** [R1, REQ-DELIV-2, ASSUMPTION —
точные веса не заданы ни `tz.log`, ни research, вводятся по требованию задачи PIVOT, подлежат
калибровке продуктом после эксплуатационных данных]

Application use case, порт `CourierCandidatePort` (infrastructure — Drizzle-запрос с PostGIS
`ST_DWithin`). Шаги:

1. **Фильтр приемлемости** (жёсткий, не скоринг): `couriers.status = 'active'` (SRS-DOM-137/
   REQ-COUR-10 — `pending_verification` исключён структурно); `shift_status = 'on_shift'`;
   тенантный guard (SRS-DOM-037: `chainId IS NULL` ИЛИ `chainId = order.pharmacy.chainId`, с учётом
   `tenant.courierSourcingMode` — `own_fleet` режим исключает `chainId IS NULL` кандидатов вовсе,
   `platform_pool` исключает `chainId = X` кандидатов, `hybrid` включает оба, но ранжирует `own_fleet`
   выше при равном скоре); cold-chain guard (SRS-DOM-038, если `requiresColdChain`); текущая нагрузка
   `< MAX_CONCURRENT_ASSIGNMENTS_PER_COURIER` (ASSUMPTION 2, конфигурируемо per-tenant) — курьер с 2
   активными доставками не рассматривается; дистанция до аптеки
   `≤ COURIER_CANDIDATE_RADIUS_KM` (ASSUMPTION 8, per-tenant); `last_location_at` не старше
   `COURIER_LOCATION_STALE_MINUTES` (ASSUMPTION 15) — курьер без свежих координат не предлагается
   (вероятно оффлайн, см. §A.8 «курьер пропал со связи»).
2. **Скоринг** оставшихся кандидатов:
   `distanceScore = max(0, 1 - distanceKm / COURIER_CANDIDATE_RADIUS_KM)`;
   `workloadScore = 1 / (1 + activeAssignmentsCount)`;
   `ratingScore = courier.ratingAvg / 5`;
   `totalScore = W_DISTANCE × distanceScore + W_WORKLOAD × workloadScore + W_RATING × ratingScore`
   (ASSUMPTION `W_DISTANCE=0.5, W_WORKLOAD=0.3, W_RATING=0.2`, `Σ=1`, ENV-конфигурируемо per-tenant).
3. Кандидаты сортируются по `totalScore` убыв.; первый становится офферу `sequence_no=1`
   (`delivery_offers`, §D.3), `expires_at = now() + OFFER_ACCEPT_TIMEOUT_SECONDS` (ASSUMPTION 45).

**SRS-DELIV-039 — Эскалация по таймауту** [R1, REQ-DELIV-2] BullMQ delayed job
(`delivery-offer-timeout`, `jobId = offerId` — идемпотентен при дублирующемся планировании) выполняется
на `expires_at`. Given оффер всё ещё `pending`, Then `offer.status='expired'`, следующий кандидат из
уже вычисленного списка (не пересчитывается — список кандидатов кэшируется на весь цикл эскалации
одного назначения, ИЛИ пересчитывается, если прошло `> RECANDIDATE_AFTER_MINUTES` ASSUMPTION 5 —
чтобы учесть изменившееся местоположение) получает `sequence_no+1` оффер. Given список кандидатов
исчерпан (все `pending`→`expired`/`declined`), Then `DeliveryAssignment` переходит в состояние «в
пуле» (не отдельный статус БД — просто отсутствие `pending`/`accepted` офферов при `status=
'unassigned'` ЕСТЬ определение «в пуле», см. SRS-DELIV-015), событие `DeliveryEscalatedToPoolEvent`
(§A.6) → комната `platform:ops` (+ `chain:{chainId}` для `own_fleet`-режима) — диспетчер видит
непринятый заказ и может вызвать `assign-manual` (SRS-DELIV-033) немедленно, не дожидаясь, пока
кто-то заберёт из пула.

**SRS-DELIV-040** [R1] Given `assigned` (оффер принят), но курьер не вызвал `depart`
(SRS-DELIV-019) дольше `COURIER_DEPART_SLA_MINUTES` (ASSUMPTION 10), Then фоновая job помечает
`SlaBreachedEvent` (`entityType='delivery_assignment'`) в комнату `platform:ops`/`chain:{chainId}` —
**не отменяет назначение автоматически** (курьер мог быть на пути физически, просто забыл нажать
кнопку — авто-переназначение рискует дублировать физический выезд); решение — за диспетчером через
`reassign` (SRS-DELIV-034).

### A.5 Навигация по ориентирам

**SRS-DELIV-041** [R1, REQ-GEO-2/3] Адрес хранится как: `orders.delivery_address` (текст, введённый/
выбранный на чекауте) + `orders.delivery_landmark` (ориентир, `landmark_tj`-подобный текст) +
`orders.delivery_latitude/longitude` (пин, поставленный ПОЛЬЗОВАТЕЛЕМ вручную на карте — REQ-GEO-2:
Nominatim только подсказка, финальные координаты — ручной пин) + `orders.delivery_entrance/floor/
apartment/comment/landmark_photo_url` (D.8). Курьерский экран деталей (`GET
/api/v1/delivery-assignments/:id`, SRS-DELIV-018) отображает ВСЕ поля одновременно — ориентир НЕ
заменяет координаты, а дополняет (клиент может написать «дом с зелёной крышей у мечети» ДАЖЕ если пин
стоит верно — текст помогает опознать конкретный подъезд среди похожих домов).

**SRS-DELIV-042** [R1] Given `landmark_photo_url` присутствует, Then Flutter/веб-клиент показывает
превью фото дома НАД картой (не под ней) — курьер должен увидеть визуальный ориентир ДО того, как
начнёт сверять с картой, это быстрее для повторяющихся типовых домов.

**SRS-DELIV-043** [R1] «Курьер уточняет» — не отдельный API-эндпоинт: курьер звонит клиенту (§A.5.1)
ИЛИ, если звонок не помог, использует `report-issue { issueType: 'address_not_found' }`
(SRS-DELIV-025) — это НЕ увеличивает `contact_attempts_count` (тот считает попытки СВЯЗАТЬСЯ С
КЛИЕНТОМ, а не попытки найти дом) — отдельное поле не заводится, `notes` в `report-issue` фиксирует
детали для последующего разбора диспетчером; событие уходит в `platform:ops` немедленно (не ждёт
порога 3 попытки/30 минут, в отличие от `customer_unreachable`).

**SRS-DELIV-044 — Звонок клиенту** [R1, ASSUMPTION — маскированный номер требует телефонии-провайдера,
которого нет в текущем скоупе провайдеров Charter §3.3; вводится Provider Pattern] Порт
`MaskedCallingProvider` (application), реализации: `MockMaskedCallingProvider` (dev/тест — просто
возвращает прямой номер клиента без маскировки, помечено в логе `mockMode=true`),
`DirectPhoneCallingProvider` — фактическая реализация MVP: контракт возвращает
`{ "phoneNumber": "+992901234567", "isMasked": false }` в ответе `GET
/api/v1/delivery-assignments/:id` (поле `customerContact`), т.к. реальный маскирующий телефонный шлюз
— внешняя интеграция вне `04-SCOPE-DECISION` R1 (не входит ни в один список R1-R3, требует отдельного
коммерческого решения по аналогии с D-20/Часть D `03-ARCHITECT-DECISIONS.md`). Порт объявлен уже в R1,
чтобы включение маскировки в будущем было сменой ENV (`CALLING_DRIVER=direct|masked_gateway`), а не
рефакторингом контракта — Flutter/веб просто вызывает `tel:` со значением `customerContact.phoneNumber`
и не знает, маскирован он или нет.

### A.6 Доменные события (расширение таблицы `10-domain-model.md`)

| Событие | Payload | Издатель | Потребители | Идемпотентность |
|---|---|---|---|---|
| `DeliveryOfferCreatedEvent` | `offerId, deliveryAssignmentId, courierId, sequenceNo, expiresAt` | delivery | notifications (push курьеру) | `event_id` |
| `DeliveryOfferExpiredEvent` | `offerId, deliveryAssignmentId, courierId` | delivery | analytics | `event_id` |
| `DeliveryEscalatedToPoolEvent` | `deliveryAssignmentId, orderId, candidatesExhausted` | delivery | notifications (`platform:ops`), analytics | `event_id` |
| `DeliveryFailedEvent` | `deliveryAssignmentId, orderId, reason, contactAttemptsCount` | delivery | returns (создаёт `OrderReturn(reason='undeliverable')`), notifications, analytics | `event_id` |
| `OrderRefusedAtDoorEvent` | `deliveryAssignmentId, orderId, notes` | delivery | orders, returns (`OrderReturn(reason='refused_at_door')`), notifications | `event_id` |
| `CashReconciliationDiscrepancyEvent` | `courierShiftId, courierId, discrepancyDiram` | delivery | notifications (`platform:ops`/`chain:{chainId}`), audit_log | `event_id` |
| `CourierRatedEvent` | `orderId, courierId, rating` | delivery | analytics (влияет на будущий скоринг) | `event_id`, `UNIQUE(order_id)` на уровне таблицы |

**SRS-DELIV-045** [R1, SRS-DOM-151] Каждое из событий выше пишется в `outbox` в ОДНОЙ транзакции с
доменным изменением, следуя уже установленному паттерну `10-domain-model.md`; отдельно не
переопределяется.

### A.7 WS-события (расширение таблицы `12-api-conventions-auth-tenancy.md` §6.3)

| WS-событие | Домен-событие | Комната(ы) |
|---|---|---|
| `delivery.offer_created` | `DeliveryOfferCreatedEvent` | `courier:{courierId}` |
| `delivery.offer_expired` | `DeliveryOfferExpiredEvent` | `courier:{courierId}` (снять карточку из UI) |
| `delivery.escalated_to_pool` | `DeliveryEscalatedToPoolEvent` | `platform:ops`, `chain:{chainId}` |
| `delivery.departed_to_pharmacy` / `.picked_up_from_pharmacy` / `.departed_to_customer` | внутренние переходы `DeliveryAssignment` (без отдельного домен-события верхнего уровня — маппятся из уже существующих `OrderPickedUpEvent` и явных courier-действий) | `customer:{customerId}` (для живого статуса «курьер выехал») |
| `delivery.location_updated` | — (не доменное событие, троттлированная проекция `courier-locations`, НЕ через outbox) | `customer:{customerId}` (только пока `en_route_to_customer`, ETA/приблизительное положение, НЕ точные координаты — см. SRS-DELIV-048), `pharmacy:{pharmacyId}`/`chain:{chainId}` (точные координаты — операционная необходимость) |
| `delivery.failed` | `DeliveryFailedEvent` | `customer:{customerId}`, `pharmacy:{pharmacyId}`, `platform:ops` |
| `delivery.refused_at_door` | `OrderRefusedAtDoorEvent` | `customer:{customerId}`, `pharmacy:{pharmacyId}` |

**SRS-DELIV-046** [R1, SRS-API-053] `delivery.location_updated` — единственное WS-событие модуля, НЕ
проходящее через `outbox`/`at-least-once` гарантию: публикуется НАПРЯМУЮ из
`POST /api/v1/courier-locations` обработчика в WS-комнаты, троттлировано
`LOCATION_BROADCAST_THROTTLE_MS` (ASSUMPTION 5000 — не чаще раза в 5 секунд в комнату клиента, вне
зависимости от частоты пингов курьера) — это чисто UX-хинт (SRS-API-053 «WS как hint, REST как
источник истины»), клиент, реконнектнувшийся после разрыва, обязан вызвать `GET
/api/v1/delivery-assignments/:id` (customer-версия — только ETA, без точных координат курьера) для
восстановления состояния, не полагаясь на пропущенные `location_updated` кадры.

**SRS-DELIV-047** [R1] Given роль `customer`, When `delivery.location_updated`/ответ `GET
.../: id` для СВОЕГО заказа, Then payload содержит `courierEtaMinutes` (пересчитано от последней
известной точки курьера до `orders.delivery_latitude/longitude` через `GeoPoint.distanceTo` +
конфигурируемая средняя скорость ASSUMPTION `AVERAGE_COURIER_SPEED_KMH=15`), но НЕ содержит
`courier.lastKnownLatitude/longitude` напрямую — предотвращает точечное геолокационное отслеживание
курьера третьими лицами через API клиента. `pharmacy_admin`/`super_admin`/сам `courier` получают
точные координаты (операционная необходимость).

### A.8 Расчёт стоимости доставки

**SRS-DELIV-048** [R1, REQ-DELIV-1, D.6] `DeliveryFacade.calculateDeliveryFee(pharmacyGeoPoint,
customerGeoPoint, tenantId, itemsTotalDiram, atMoment)`:

1. Найти покрывающую `delivery_zones` строку (по `ST_DWithin(center_geo_point, customerGeoPoint,
   radius_km*1000)`, приоритет — наименьший `priority`, при равенстве — наименьший `radius_km`); если
   ни одна не покрывает — `DeliveryZoneNotCoveredError` (§A.9), чекаут блокируется на уровне `orders`
   (эта ошибка возвращается модулю `orders` через `DeliveryFacade`, HTTP-код формируется в orders'
   `presentation`, не здесь — граница фасада).
2. Найти действующую `delivery_pricing_rules` строку для `(tenantId, zoneId, atMoment ∈
   [effective_from, effective_to)]`; при отсутствии зональной строки — строка с `zone_id IS NULL`
   (дефолт тенанта); при отсутствии тенантной — глобальная (`tenant_id IS NULL`).
3. Given `itemsTotalDiram < rule.minOrderAmountDiram`, Then `DeliveryMinOrderNotMetError` (§A.9).
4. `distanceKm = pharmacyGeoPoint.distanceTo(customerGeoPoint) / 1000` (`GeoPoint.distanceTo`,
   SRS-DOM-073, гаверсинус).
5. `feeDiram = rule.baseRateDiram + round(rule.ratePerKmDiram × distanceKm)`.
6. Given `atMoment` (конвертированный в `Asia/Dushanbe` через `ClockPort.nowInTenantTz()`, НЕ в
   domain) попадает в `[nightTariffStartTime, nightTariffEndTime)` (диапазон, пересекающий полночь,
   обрабатывается явно — `start > end` означает «через полночь»), Then
   `feeDiram += rule.nightTariffExtraDiram`.
7. Given `rule.freeDeliveryThresholdDiram IS NOT NULL AND itemsTotalDiram >=
   rule.freeDeliveryThresholdDiram`, Then `feeDiram = 0` (бесплатная доставка перекрывает и ночной
   тариф — иначе UX-обман «бесплатно, но плюс 10 сомони ночью»).
8. Результат — `Money` (целые дирамы), конвертация в `orders.delivery_fee_tjs` — на границе
   `infrastructure` orders-модуля (`money.toDbDecimalTjs()`), не здесь.

**SRS-DELIV-049** [R1] Given `atMoment` не передан (устаревший клиент/тест), Then use case ОБЯЗАН
получить его через `ClockPort.now()` (инфраструктура), НИКОГДА `new Date()` внутри application/domain
(`02` §2.6).

### A.9 Каталог новых кодов ошибок (расширение поверх `10-domain-model.md`/`12-api-conventions...md`)

| Code | HTTP | Класс ошибки | Источник |
|---|---|---|---|
| `OFFER_EXPIRED` | 409 | `OfferExpiredError` | SRS-DELIV-013 |
| `OFFER_ALREADY_RESPONDED` | 409 | `OfferAlreadyRespondedError` | SRS-DELIV-013 |
| `ASSIGNMENT_ALREADY_CLAIMED` | 409 | `AssignmentAlreadyClaimedError` | SRS-DELIV-016 |
| `COURIER_NOT_ON_SHIFT` | 422 | `CourierNotOnShiftError` | SRS-DELIV-038 (guard приемлемости, если явный `assign-manual` вызван на `off_shift` курьера) |
| `COURIER_AT_CAPACITY` | 422 | `CourierMaxConcurrentAssignmentsError` | SRS-DELIV-038 |
| `DELIVERY_ZONE_NOT_COVERED` | 422 | `DeliveryZoneNotCoveredError` | SRS-DELIV-048 |
| `DELIVERY_MIN_ORDER_NOT_MET` | 422 | `DeliveryMinOrderNotMetError` | SRS-DELIV-048 |
| `COLD_CHAIN_BAG_NOT_CONFIRMED` | 422 | `ColdChainBagNotConfirmedError` | SRS-DELIV-020 |
| `SHIFT_ALREADY_ACTIVE` | 409 | `ShiftAlreadyActiveError` | SRS-DELIV-028 |
| `NO_ACTIVE_SHIFT` | 422 | `NoActiveShiftError` | запись координат/наличных без открытой смены |
| `ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END` | 422 | `ActiveAssignmentBlocksShiftEndError` | SRS-DELIV-029 |
| `CONTACT_ATTEMPTS_INSUFFICIENT` | 422 | `ContactAttemptsInsufficientError` | SRS-DELIV-025 |
| `RATING_ALREADY_SUBMITTED` | 409 | `RatingAlreadySubmittedError` | SRS-DELIV-032 |

Уже определённые в `10-domain-model.md` коды, переиспользуемые этим модулем без изменений:
`COURIER_TENANT_MISMATCH` (403), `COURIER_NOT_ELIGIBLE` (422), `CASH_AMOUNT_MISMATCH` (422),
`OTP_EXPIRED`/`OTP_MISMATCH` (400), `OTP_LOCKED` (423).

---

## (B) Flutter UI — `apps/courier_mobile` [R2]

> Charter §3.6: клиент — тонкий, ноль бизнес-логики. Всё в §B ниже рисует состояние, полученное из
> API §A, и отправляет команды из §A. Модели генерируются из `docs/api/openapi.json`
> (`openapi-generator`/`dart-mappable`, пакет `packages_dart/dorutj_api`). До готовности §A этот блок
> реализуем ПОСЛЕ R1.

### B.0 R1: веб-модуль курьера (адаптив, React) — предшественник Flutter

**SRS-DELIV-050** [R1] `apps/web` (или отдельный `apps/courier-web`, решение Tech Lead) реализует
ПОДМНОЖЕСТВО экранов §B.1, вызывающее ТОТ ЖЕ API §A: список офферов/пул, карта (React аналог
`flutter_map` — `maplibre-gl`/`react-leaflet` с OSM-тайлами, тот же принцип REQ-GEO-1: без
проприетарных SDK), кнопки статусных переходов, ввод наличных, ввод OTP, отчёт о проблеме. Геолокация
— браузерный `navigator.geolocation.watchPosition` вместо `geolocator`, частота — та же логика
троттлинга §B.3, НО без foreground-service (веб не может гарантировать фон — известное ограничение,
явно сообщается курьеру баннером «держите вкладку открытой во время доставки»). Офлайн-очередь — та
же идея (§B.5), реализация — `IndexedDB` вместо `drift`.

### B.1 Экраны

**SRS-DELIV-051** [R2] Экраны: `ShiftScreen` (старт/финиш смены, сводка кэша), `OffersScreen`
(текущий оффер полноэкранной карточкой с обратным отсчётом до `expiresAt` + кнопки Принять/Отклонить),
`AvailablePoolScreen` (список для самостоятельного выбора), `ActiveDeliveryScreen` (карта + статусная
кнопка, меняющая подпись по текущему статусу: «Выехал» → «Забрал» (авто, недоступна вручную) → «В
пути к клиенту» → «Доставлено»), `NavigationDetailSheet` (фото дома, ориентир, подъезд/этаж/квартира,
комментарий, кнопка звонка), `CashCollectionScreen` (числовые поля «получено»/«сдача», авторасчёт
остатка = `order.total`), `OtpEntryScreen` (4 ячейки цифр, автопереход, авто-сабмит на 4-й цифре),
`IssueReportScreen` (список причин + фото + заметка), `EarningsScreen` (список `courier_earnings`
+ история `courier_payouts`), `RatingPromptScreen` — НЕ на устройстве курьера (клиентский экран,
упомянут для полноты, реализуется в `apps/web`/Telegram Mini App, не здесь).

### B.2 Состояние — `flutter_bloc`

**SRS-DELIV-052** [R2] Один `Cubit` на экран/поток, состояния — sealed-классы, зеркалящие
`delivery_assignment_status`/`delivery_offer_status` из `GET /api/v1/meta` (Charter §3.6 п.5 — enum'ы
НЕ хардкодятся в Dart, генерируются/сверяются с ответом `meta`). `ActiveDeliveryCubit` подписан на WS
(`web_socket_channel`) через общий `RealtimeClient` (`packages_dart/dorutj_api`), эмитит новое
состояние на каждый релевантный кадр (`delivery.courier_assigned`, статусные переходы), НО при старте
экрана ВСЕГДА сначала вызывает `GET /api/v1/delivery-assignments/mine` (REST catch-up, SRS-DELIV-017)
и только потом обрабатывает WS-дельту (SRS-API-053/054 — тот же порядок для Flutter, что и для
любого клиента).

### B.3 Геолокация (`geolocator`) — частота и экономия батареи

**SRS-DELIV-053** [R2, ASSUMPTION] Частота отправки — АДАПТИВНАЯ по состоянию назначения:

| Состояние | Частота (`geolocator` `LocationSettings.distanceFilter`/интервал) |
|---|---|
| `off_shift` | Не отслеживается (`geolocator` стрим не запущен) |
| `on_shift`, нет активного назначения | Раз в `60` секунд ИЛИ `distanceFilter=100м` (что раньше) — низкая точность (`LocationAccuracy.medium`) |
| `assigned`/`en_route_to_pharmacy` | Раз в `20` секунд, `distanceFilter=30м`, `LocationAccuracy.high` |
| `en_route_to_customer` | Раз в `10` секунд, `distanceFilter=15м`, `LocationAccuracy.high` — максимальная частота, это участок, который видит клиент |

Каждая точка ставится в локальную очередь `drift` (§B.5) и отправляется батчем раз в
`LOCATION_FLUSH_INTERVAL_SECONDS` (ASSUMPTION 15) — НЕ один HTTP-запрос на одну точку GPS (экономия
радио-модуля/батареи — группировка сетевых пробуждений).

**SRS-DELIV-054** [R2] Экономия батареи: между активными доставками (`on_shift`, нет назначения)
приложение использует `LocationAccuracy.medium` (сеть/грубый GPS) вместо `high` (спутник) —
компромисс точности ради заряда, оправданный тем, что курьер без заказа не нуждается в
метровой точности.

### B.4 Карта (`flutter_map`, OSM-тайлы)

**SRS-DELIV-055** [R2, REQ-GEO-1] `flutter_map` + self-hosted vector-tile сервер (Charter/research —
без Yandex Maps/Google Maps, без ключей). Слои: точка аптеки (иконка), точка клиента (иконка,
подсвеченный радиус ~50м — GPS неточность, не точный дом), маршрут — НЕ турн-бай-турн навигация
(вне скоупа — курьер использует штатное приложение навигации телефона через `url_launcher`
`geo:lat,lon`/`google.navigation:q=lat,lon` deeplink, если установлено; наша карта — только
ОРИЕНТИРОВОЧНАЯ картинка «где это примерно» + фото дома, не turn-by-turn).

### B.5 Офлайн-режим и очередь действий

**SRS-DELIV-056** [R2, `drift` (SQLite)] Таблицы: `pending_location_pings` (см. B.3),
`pending_actions` (generic очередь: `actionType, deliveryAssignmentId, payloadJson, createdAt,
retryCount`). Given сеть недоступна, When курьер нажимает статусную кнопку (`depart`,
`depart-to-customer`, `record-cash`, `deliver`, `report-issue`), Then действие УСПЕШНО пишется в
`pending_actions` НЕМЕДЛЕННО (UI не блокируется, оптимистичное обновление локального состояния с
пометкой «не синхронизировано» — иконка часов на карточке), фоновый воркер (`WorkManager`
Android-обёртка через `workmanager` пакет) пытается отправить каждые `RETRY_INTERVAL_SECONDS`
(экспоненциальный backoff `5с, 10с, 20с, 40с, макс 120с`) до успеха.

**SRS-DELIV-057** [R2] Given действие требует `Idempotency-Key` (`record-cash`, SRS-API-009), Then
ключ генерируется В МОМЕНТ постановки в очередь (`uuid.v4()`), НЕ в момент фактической отправки —
гарантирует, что повторная попытка после разрыва не задваивает операцию, даже если первая попытка
физически ДОШЛА до сервера, но ответ не долетел обратно клиенту (классический сценарий, ради которого
и введена идемпотентность, SRS-API-010).

**SRS-DELIV-058** [R2] Given `deliver` (OTP) в очереди офлайн, When сеть восстанавливается, Then
ПЕРЕД повторной отправкой клиент обязан сверить локальный TTL OTP (клиент знает `handoverOtpTtlSeconds`
из `meta`, но НЕ знает точный `issuedAt` без сети) — если с момента постановки действия в очередь
прошло `> handoverOtpTtlSeconds`, UI предупреждает курьера «код мог устареть» ПЕРЕД повторной
отправкой (не блокирует — сервер всё равно провалидирует и вернёт `OTP_EXPIRED`, это только UX-подсказка,
экономящая курьеру шаг «ввести код повторно вручную», раз он уже был введён один раз в офлайне).

**SRS-DELIV-059** [R2] Конфликт очереди: given два статусных действия для ОДНОГО `deliveryAssignmentId`
поставлены в очередь до восстановления сети (например, `depart-to-customer`, затем случайно повторно
`report-issue`), Then они отправляются СТРОГО в порядке постановки (FIFO по `createdAt`), сервер
применяет их последовательно — доменная state machine (`10-domain-model.md`) сама отклонит
несовместимый по порядку переход кодом `409 INVALID_STATE_TRANSITION`, клиент по получении такого
ответа для ОДНОГО из отложенных действий просто отбрасывает это конкретное действие из очереди
(логирует, не ретраит бесконечно) и продолжает со следующим.

### B.6 Wake lock и фоновое поведение Android

**SRS-DELIV-060** [R2] Пока `en_route_to_pharmacy`/`en_route_to_customer` (активная доставка «в
пути»), приложение держит Android **foreground service** (тип `location`, обязательная постоянная
нотификация «DoruTJ: доставка в процессе» — требование Android 10+ для фоновой геолокации) —
обеспечивает продолжение GPS-трекинга и отправки координат, даже если экран заблокирован/приложение
свёрнуто. Foreground service останавливается автоматически при переходе в `delivered`/
`delivery_failed`/`off_shift`. `wakelock_plus` держит экран включённым ТОЛЬКО на экране
`OtpEntryScreen`/`CashCollectionScreen` (короткие интерактивные моменты вручения), не постоянно — не
разряжать батарею держанием экрана в течение всей поездки.

**SRS-DELIV-061** [R2] Android battery-optimization: приложение при первом запуске запрашивает
исключение из Doze-режима (`ignore battery optimizations`) с явным объяснением экрана «почему» ПЕРЕД
системным диалогом (Android рекомендация — pre-permission rationale), не автоматически при старте.

### B.7 Поведение при пропадании GPS/сети

**SRS-DELIV-062** [R2] Given `geolocator` стрим не выдаёт новых точек `> GPS_SIGNAL_LOST_SECONDS`
(ASSUMPTION 60) ПОКА активна доставка, Then UI показывает неблокирующий баннер «GPS сигнал потерян,
координаты могут быть неточными» — не останавливает работу приложения (статусные кнопки/OTP/наличные
работают независимо от GPS, только сама отправка координат приостановлена до восстановления сигнала).
Given сеть (не GPS) недоступна, Then все действия уходят в офлайн-очередь (§B.5), баннер «Нет
соединения — действия будут отправлены автоматически» с индикатором количества отложенных действий.

---

## Пограничные случаи и ошибки

**SRS-DELIV-063** [R1] **Курьер не забрал заказ (не нажал «Выехал»)** — см. SRS-DELIV-040:
`COURIER_DEPART_SLA_MINUTES` (10 мин) истекает без `depart` → `SlaBreachedEvent` диспетчеру,
НЕ авто-реассайн. Диспетчер вызывает `reassign` вручную, старый курьер остаётся в `assigned` до
явного `reassign` (не автоматически освобождается — предотвращает состояние, когда ДВА курьера
одновременно физически едут за одним заказом).

**SRS-DELIV-064** [R1] **Курьер пропал со связи** (нет `courier-locations` пингов
`> COURIER_LOCATION_STALE_MINUTES`=15 ПРИ активном назначении, отличается от «нет свежих координат при
подборе кандидата», SRS-DELIV-038 п.1, которое лишь исключает из будущих офферов) → фоновая job
публикует `SlaBreachedEvent(entityType='courier_silent')` в `platform:ops`/`chain:{chainId}` —
ТОЛЬКО уведомление, без авто-действий: товар (и, возможно, наличные клиента) физически у курьера,
принудительный `reassign` не возвращает физический товар — решение ВСЕГДА за человеком (диспетчер
звонит курьеру, при необходимости — `reassign` с ручным decision).

**SRS-DELIV-065** [R1] **Клиент не отвечает** — SRS-DELIV-025: до 3 попыток/30 минут, затем
`mark-failed` → `delivery_failed` → `DeliveryFailedEvent` → `returns` создаёт
`OrderReturn(reason='undeliverable')`. До достижения порога — `422
CONTACT_ATTEMPTS_INSUFFICIENT` на прямую попытку `mark-failed` (защита от преждевременного отказа
после одного звонка).

**SRS-DELIV-066** [R1] **Адрес не найден** — SRS-DELIV-043: немедленная эскалация `platform:ops` через
`report-issue { issueType: 'address_not_found' }`, доставка НЕ переводится в `delivery_failed`
автоматически (адрес может быть уточнён звонком/диспетчером за минуты) — курьер продолжает попытки,
финальный отказ — тот же путь `mark-failed`, что и «клиент не отвечает», если уточнение не помогло в
разумное время (тот же порог 3/30, `issueType` в событии сохраняет причину для отчётности отдельно от
`customer_unreachable`).

**SRS-DELIV-067** [R1] **Отказ от заказа на пороге** — SRS-DELIV-026, `OrderRefusedAtDoorEvent`,
НЕ `delivery_failed` (разные причины — разная ветвь `return_reason` в модуле `returns`, уже определена
`10-domain-model.md`: `refused_at_door` при `picked_up`).

**SRS-DELIV-068** [R1, открытый вопрос] **Частичный отказ** (клиент принимает часть позиций, отказывается
от других на пороге) — **схема `order_returns` (§`11-database-schema.md`) НЕ поддерживает возврат на
уровне отдельных позиций заказа** (`order_returns.order_id` — весь заказ, нет `order_return_items`).
Этот модуль НЕ вводит такую таблицу — это территория модуля Orders/Returns, не Delivery. **Решение для
R1**: частичный отказ на пороге обрабатывается процедурно, НЕ на уровне API-контракта — курьер либо (а)
убеждает клиента принять весь заказ, либо (б) весь заказ возвращается целиком через
`refuse-at-door` (клиент теряет право на частично принятые позиции — коммерчески неоптимально, но
согласовано со схемой), либо (в) курьер связывается с диспетчером, который вручную (вне API,
телефонным звонком аптеке) организует довоз только отклонённых позиций отдельным новым заказом с
возвратом разницы через `disputes`-модуль. Формальный API для (в) — вне скоупа R1, зафиксировано как
открытый вопрос для согласования с владельцем модуля Orders/Returns (см. раздел «Открытые вопросы»).

**SRS-DELIV-069** [R1] **Заказ отменён, когда курьер уже в пути** — `orders:cancel` доступен только
до `processing` включительно (`12-api-conventions...md` §4.1 RBAC-таблица); после `picked_up`
единственный путь — `AdminForceCancelOrderUseCase` (`super_admin`, SRS-DOM-171, эндпоинт вне этого
модуля). Given форс-отмена происходит, When у заказа есть активное (нетерминальное)
`DeliveryAssignment`, Then обработчик `OrderCancelledEvent`/`OrderAutoCancelledEvent` в модуле
`delivery` переводит `DeliveryAssignment → delivery_failed` с `failed_reason='order_force_cancelled'`
(переиспользует терминальный статус — отдельного статуса `cancelled` в `delivery_assignment_status`
нет и не вводится), останавливает геотрекинг, освобождает курьера
(`couriers`-нагрузка уменьшается немедленно для алгоритма назначения следующих заказов). Физический
возврат товара в аптеку — ответственность модуля `returns` (получает то же событие, создаёт
`OrderReturn`, при необходимости запрашивает `DeliveryFacade.assignReturnCourier`).

**SRS-DELIV-070** [R1] **Аккумулятор сел** — не отдельное серверное состояние: с точки зрения backend
неотличимо от «курьер пропал со связи» (SRS-DELIV-064) — тот же таймаут, тот же алерт диспетчеру.
Клиентское поведение (Flutter) — SRS-DELIV-061 (запрос исключения из battery-optimization заранее)
снижает вероятность, но не исключает физическую разрядку — не решается программно на 100%, диспетчер
как человек — последний рубеж (позвонить курьеру на резервный номер/связаться иным способом,
процедура вне API).

**SRS-DELIV-071** [R1] **Двойной приём одного оффера (два устройства курьера одновременно жмут
«Принять»)** — `ux_delivery_offers_one_pending_per_assignment` и проверка `status='pending'` в
`WHERE`-условии транзакции UPDATE делают вторую попытку неатомарной (`0 rows affected`) →
`409 OFFER_ALREADY_RESPONDED`.

**SRS-DELIV-072** [R1] **Гонка `claim` из пула двумя разными курьерами** — SRS-DELIV-016:
`UPDATE delivery_assignments SET status='assigned', courier_id=:X WHERE id=:id AND
status='unassigned'` — только один `UPDATE` затрагивает строку, второй получает `0 rows` →
`409 ASSIGNMENT_ALREADY_CLAIMED`.

**SRS-DELIV-073** [R1] **1С/внешний провайдер недоступен** — не применимо к этому модулю напрямую
(1С — модуль inventory), НО `MaskedCallingProvider`/`SmsProvider`/`PushProvider` (Provider Pattern,
Charter §3.3) недоступны → circuit breaker (Charter §7) деградирует к следующему каналу уведомления
(WS остаётся первичным и не зависит от внешних провайдеров) — курьер ВСЕГДА видит новый оффер через
WS/REST catch-up, даже если push-уведомление не доставлено.

**SRS-DELIV-074** [R1] **Таймаут отправки координат при плохой связи** — `POST
/api/v1/courier-locations` — обычный HTTP-таймаут клиента (не блокирующий UI, §B.5 очередь), сервер
не вводит особой обработки, кроме стандартного `408 REQUEST_TIMEOUT`, который клиент трактует как
сетевую ошибку → действие остаётся в очереди на повтор.

**SRS-DELIV-075** [R1] **Дубль команды `deliver` после успеха (двойной тап/повторная офлайн-отправка)**
— `OtpCode.verify()` уже финализирует OTP при успехе (`alreadyConsumed`, SRS-DOM-082), повторный вызов
с тем же кодом после успешной доставки → `400 OTP_MISMATCH` (не `500`) — клиент интерпретирует это как
«уже доставлено» ТОЛЬКО если локальное состояние очереди уже подтверждает предыдущий успех (сверяется
по `GET .../mine`, а не слепо показывает ошибку курьеру повторно).

---

## Тестовые сценарии

| ID | Требование | Given | When | Then |
|---|---|---|---|---|
| TC-DELIV-001 | SRS-DELIV-013 | Оффер `pending`, `expires_at` в будущем, курьер — адресат | `POST .../accept` | `200`, `DeliveryAssignment.status='assigned'`, WS `delivery.courier_assigned` в 3 комнаты |
| TC-DELIV-002 | SRS-DELIV-013 | Оффер `pending`, `expires_at` в прошлом (гонка) | `POST .../accept` | `409 OFFER_EXPIRED` |
| TC-DELIV-003 | SRS-DELIV-013 | Оффер `status='declined'` (уже отвечен) | `POST .../accept` | `409 OFFER_ALREADY_RESPONDED` |
| TC-DELIV-004 | SRS-DELIV-014/039 | Оффер `pending`, кандидатов ещё 2 в списке | `POST .../decline` | `offer.status='declined'`, новый оффер `sequence_no+1` создан courier'у #2 в течение секунды (синхронно в той же транзакции или немедленным BullMQ-джобом) |
| TC-DELIV-005 | SRS-DELIV-039 | Список кандидатов исчерпан (все declined/expired) | Таймаут последнего оффера | `DeliveryEscalatedToPoolEvent` опубликован, назначение видно в `GET .../available-pool` |
| TC-DELIV-006 | SRS-DELIV-016 | Назначение в пуле, курьер А и курьер Б одновременно вызывают `claim` | Конкурентные `POST .../claim` | Один получает `200`, другой — `409 ASSIGNMENT_ALREADY_CLAIMED` |
| TC-DELIV-007 | SRS-DOM-037 (переиспользован) | Курьер `chain_id='X'` (свой флот), заказ сети `Y` | `assign-manual`/`claim`/оффер алгоритма | `403 COURIER_TENANT_MISMATCH` / кандидат исключён из скоринга |
| TC-DELIV-008 | SRS-DOM-038 (переиспользован) | `requiresColdChain=true`, курьер `coldChainCertified=false` | Любая попытка назначения | `422 COURIER_NOT_ELIGIBLE` |
| TC-DELIV-009 | SRS-DELIV-020 | `requiresColdChain=true`, `coldChainBagConfirmed` не передан | `POST .../depart-to-customer` | `422 COLD_CHAIN_BAG_NOT_CONFIRMED` |
| TC-DELIV-010 | SRS-DELIV-021 | `payment_method='cash_courier'`, `order.total=6000` diram | `record-cash {collected:6000, change:0}` | `200`, `couriers.current_cash_on_hand_diram += 6000`, `courier_shifts.cash_collected_diram += 6000` |
| TC-DELIV-011 | SRS-DELIV-021 | `collected:6000, change:500` при `order.total=6000` | `record-cash` | `422 CASH_AMOUNT_MISMATCH` (6000-500 ≠ 6000) |
| TC-DELIV-012 | SRS-DOM-040 | `cash_courier` заказ, `recordCash` НЕ вызван | `POST .../deliver` | Домен отклоняет (`recordCash` — предусловие) |
| TC-DELIV-013 | SRS-DELIV-022/SRS-DOM-082 | Верный OTP, TTL не истёк | `POST .../deliver` | `200`, `status='delivered'`, `OrderDeliveredEvent` опубликован, `courier_earnings` строка создана (если `chainId IS NULL`) |
| TC-DELIV-014 | SRS-DELIV-025 | `issueType='customer_unreachable'`, `contact_attempts_count=1` | `POST .../mark-failed` | `422 CONTACT_ATTEMPTS_INSUFFICIENT` |
| TC-DELIV-015 | SRS-DELIV-025 | `contact_attempts_count=3`, окно `30мин` истекло | `POST .../mark-failed` | `200`, `status='delivery_failed'`, `DeliveryFailedEvent` опубликован |
| TC-DELIV-016 | SRS-DELIV-026 | `en_route_to_customer` | `POST .../refuse-at-door` | `OrderRefusedAtDoorEvent` опубликован, `order_returns` строка (проверка со стороны returns-модуля, интеграционный тест на границе события) |
| TC-DELIV-017 | SRS-DELIV-069 | `picked_up`, `super_admin` вызывает форс-отмену заказа | `AdminForceCancelOrderUseCase` (orders) → `OrderCancelledEvent` | `DeliveryAssignment.status='delivery_failed'`, `failed_reason='order_force_cancelled'`, курьер освобождён (`activeAssignmentsCount` для него -1) |
| TC-DELIV-018 | SRS-DELIV-028/029 | Активная смена есть | Повторный `POST /courier-shifts` | `409 SHIFT_ALREADY_ACTIVE` |
| TC-DELIV-019 | SRS-DELIV-029 | Активное назначение (`assigned`) у курьера | `POST /courier-shifts/:id/end` | `422 ACTIVE_ASSIGNMENT_BLOCKS_SHIFT_END` |
| TC-DELIV-020 | SRS-DELIV-029 | `cash_collected=10000`, `opening=0`, `cashSubmitted=9500` | `POST /courier-shifts/:id/end` | `discrepancy_diram=500`, `CashReconciliationDiscrepancyEvent` → `audit_log(category='cash_reconciliation_discrepancy')` |
| TC-DELIV-021 | SRS-DELIV-027 | Батч из 3 пингов, 1 старше `LOCATION_PING_MAX_AGE_MINUTES` | `POST /courier-locations {pings:[...]}` | `{accepted:2, skippedStale:1}`, `couriers.last_known_*` обновлён только самой свежей из принятых |
| TC-DELIV-022 | SRS-DELIV-047 | Роль `customer`, активная доставка | `GET /delivery-assignments/:id` | Ответ содержит `courierEtaMinutes`, НЕ содержит `courier.lastKnownLatitude/longitude` |
| TC-DELIV-023 | SRS-DELIV-048 | Координаты клиента вне всех `delivery_zones` тенанта | `calculateDeliveryFee(...)` (вызов из checkout) | `DeliveryZoneNotCoveredError` → чекаут блокирован кодом `422 DELIVERY_ZONE_NOT_COVERED` |
| TC-DELIV-024 | SRS-DELIV-048 | `itemsTotal=3000` diram, `minOrderAmountDiram=5000` | `calculateDeliveryFee(...)` | `DeliveryMinOrderNotMetError` → `422 DELIVERY_MIN_ORDER_NOT_MET` |
| TC-DELIV-025 | SRS-DELIV-048 | `itemsTotal=60000`, `freeDeliveryThresholdDiram=50000`, ночное время, `nightTariffExtra=1000` | `calculateDeliveryFee(...)` | `feeDiram=0` (бесплатная доставка перекрывает ночной тариф) |
| TC-DELIV-026 | SRS-DELIV-048 | `baseRate=1000, ratePerKm=200`, дистанция `3.4км`, вне ночного окна | `calculateDeliveryFee(...)` | `feeDiram = 1000 + round(200×3.4) = 1000+680=1680` |
| TC-DELIV-032 | SRS-DELIV-032 | `order.status='delivered'`, оценка ещё не оставлена | `POST /courier-ratings {rating:5}` | `200`, `couriers.rating_count+=1`, `rating_avg` пересчитан |
| TC-DELIV-033 | SRS-DELIV-032 | Оценка уже существует для `order_id` | Повторный `POST /courier-ratings` | `409 RATING_ALREADY_SUBMITTED` |
| TC-DELIV-034 | SRS-DELIV-038 | 2 кандидата в радиусе: А (1км, загрузка 0, рейтинг 4.0), Б (0.5км, загрузка 1, рейтинг 5.0) с весами 0.5/0.3/0.2 | `SuggestNearestCourierUseCase.execute()` | Скоры вычислены по формуле п.2 SRS-DELIV-038, победитель — с большим `totalScore` (детерминированный юнит-тест на конкретных числах) |
| TC-DELIV-035 | SRS-DELIV-038 | Курьер `shift_status='off_shift'` | Тот же запрос | Курьер исключён из кандидатского списка на шаге фильтра |
| TC-DELIV-036 (Flutter, R2) | SRS-DELIV-056/057 | Действие `record-cash` поставлено в офлайн-очередь с `Idempotency-Key=K` | Сеть восстановлена, повтор с тем же `K`, тело идентично | Сервер возвращает СОХРАНЁННЫЙ ответ (SRS-API-010), баланс наличных не задвоен |
| TC-DELIV-037 (Flutter, R2) | SRS-DELIV-059 | Очередь: `[depart-to-customer, report-issue]` для одного `assignmentId`, но фактическое серверное состояние уже `delivered` (обработано другим устройством раньше) | Отправка по восстановлении сети | `depart-to-customer` → `409 INVALID_STATE_TRANSITION`, действие отброшено из очереди, `report-issue` НЕ отправляется вовсе (клиент видит терминальный статус через `mine` и очищает всю очередь этого назначения) |

---

## Открытые вопросы (требуют координации с другими SRS-документами/продуктом)

1. **Частичный отказ от части позиций на пороге** (SRS-DELIV-068) — текущая схема `order_returns`
   не поддерживает возврат на уровне отдельных позиций. Требует решения владельца модуля
   Orders/Returns: вводить ли `order_return_items` (расширение схемы вне зоны ответственности этого
   документа) или закрепить процедурный обходной путь как окончательный для R1.
2. **`orders.delivery_entrance/floor/apartment/comment/landmark_photo_url`** (D.8) — расширение
   таблицы, принадлежащей модулю Orders/Checkout. Нужно согласовать порядок миграций (после
   `0008_orders_cart.sql`, до/вместе с `0012_delivery.sql` — см. нумерацию `11-database-schema.md`
   §8) и то, какой use case чекаута их заполняет.
3. **Маскированный номер телефона** (SRS-DELIV-044) — реальная реализация `MaskedCallingProvider`
   требует внешнего телефонного шлюза, вне списка провайдеров Charter §3.3 и вне `04-SCOPE-DECISION`
   R1-R3. Порт заведён, `MockMaskedCallingProvider`=прямой номер — решение о реальном шлюзе выносится
   продукту (аналогично Части D `03-ARCHITECT-DECISIONS.md`).
4. **Точные веса алгоритма подбора и константы таймаутов** (SRS-DELIV-038/039, `W_DISTANCE/
   W_WORKLOAD/W_RATING`, `OFFER_ACCEPT_TIMEOUT_SECONDS`, `COURIER_CANDIDATE_RADIUS_KM` и т.д.) —
   ASSUMPTION-значения, требуют калибровки по эксплуатационным данным R1 (согласуется с методологией
   kill-критериев `04-SCOPE-DECISION-PIVOT.md` §7).
5. **Ставки/зоны ценообразования доставки** (D.6, SRS-DELIV-008) — по аналогии с D-03 (комиссия
   платформы), требуют коммерческого утверждения, сейчас — калиброванная гипотеза.
