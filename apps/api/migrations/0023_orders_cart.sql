-- =====================================================================================
-- 0023_orders_cart.sql — EP-09 (DTJ-220), DDL «Группа D» 1:1 из 11-database-schema.md
-- строки 694-816: orders, order_items, cart, cart_items, favorites.
-- =====================================================================================
-- Номер файла: следующий свободный на момент DTJ-220 — 0023 (D-EP09-1, reports/EP09-CTO-BRIEF.md
-- §4). Тикет исходно называл файл `0008_orders_cart.sql` — 0008 занят дважды
-- (0008_onboarding_foundation.sql, 0008_user_telegram_identities.sql), решение CTO закрыто.
--
-- enum `order_status` (SRS-DB-008/009) НЕ существовал ни в одной миграции на момент этого
-- тикета (проверено CTO лично против живой dorutj_test, D-EP09-2) — создаётся здесь целиком,
-- сразу со всеми девятью значениями канонического DDL (11-database-schema.md строки 107-116),
-- включая 'confirmed' (D-25: cash_courier переходит сюда синхронно, НЕ в paid_escrow) и
-- 'return_in_progress' (D-09). Идемпотентность — приём 0002_enums.sql: DO-блок с EXCEPTION
-- WHEN duplicate_object, не голый CREATE TYPE.
DO $$ BEGIN
  CREATE TYPE "order_status" AS ENUM (
    'pending_payment',
    'confirmed',
    'paid_escrow',
    'processing',
    'picked_up',
    'delivered',
    'cancelled',
    'refunded',
    'return_in_progress'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================================
-- 19. orders [ТЗ 1:1, расширено D-03/D-09/D-16/D-22/REQ-ONBOARD/Charter §3.4]
-- =====================================================================================
-- ОТКЛОНЕНИЕ ОТ КАНОНИЧЕСКОГО DDL (найдено при подготовке этой миграции, см. отчёт DTJ-220
-- «foundIssues»): `orders.courier_id`, `orders.prescription_id` — БЕЗ REFERENCES на этом шаге
-- (D-EP09-3, CTO-решение закрыто). Таблицы `couriers`/`prescriptions` физически не существуют —
-- FK на них добавится отдельным ALTER TABLE ниже, в разделе «ОТЛОЖЕНО», когда соответствующий
-- модуль создаст свою таблицу. `orders.handover_otp_id` — ИСКЛЮЧЕНИЕ из этой группы: получает
-- нормальный REFERENCES сразу, `otp_codes` существует с миграции 0014 (D-EP09-7, поправка CTO
-- к первоначальной группировке, reports/EP09-CTO-BRIEF.md).
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(20) UNIQUE NOT NULL, -- OrderNumber VO: DTJ-{YYMMDD}-{seq5}, SRS-DOM-085
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    pharmacy_id UUID REFERENCES pharmacies(id),
    status order_status DEFAULT 'pending_payment',
    payment_method VARCHAR(50) NOT NULL, -- 'alif_mobi', 'dc_next', 'cash_courier' (см. также enum payment_method)
    payment_transaction_id VARCHAR(255),
    items_total_tjs NUMERIC(10, 2) NOT NULL,
    delivery_fee_tjs NUMERIC(10, 2) NOT NULL,
    total_amount_tjs NUMERIC(10, 2) NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_landmark TEXT,
    delivery_latitude NUMERIC(10, 8),
    delivery_longitude NUMERIC(11, 8),
    courier_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE couriers (группа H, EP-13, TODO(DTJ-313))
    courier_eta_minutes INT,
    prescription_image_url TEXT, -- СОХРАНЕНО из tz.log для совместимости; каноничный источник — prescriptions.image_url
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- [РАСШИРЕНИЕ Charter §3.4/D-03/D-09/D-22] --
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    prescription_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE prescriptions (модуль рецептов, см. «ОТЛОЖЕНО»)
    cancel_reason VARCHAR(100),
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    sla_deadline_at TIMESTAMPTZ, -- processing_started_at + pickup_sla (SRS-DOM-167: сервер — источник времени)
    processing_started_at TIMESTAMPTZ,
    picked_up_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    handover_otp_id UUID REFERENCES otp_codes(id) ON DELETE SET NULL, -- D-EP09-7: FK сразу, otp_codes существует с 0014_otp_codes.sql
    checkout_attempt_id UUID NOT NULL, -- SRS-DOM-166: idempotency ключ ПОПЫТКИ, не заказа
    deleted_at TIMESTAMPTZ, -- soft delete (юридический аудит, SRS-DB-004)
    CONSTRAINT chk_orders_total_matches_sum
        CHECK (total_amount_tjs = items_total_tjs + delivery_fee_tjs), -- SRS-DOM-003, дублирует домен
    CONSTRAINT chk_orders_amounts_nonnegative
        CHECK (items_total_tjs >= 0 AND delivery_fee_tjs >= 0 AND total_amount_tjs >= 0)
);
COMMENT ON TABLE orders IS
    'Order aggregate root (10-domain-model.md). tenant_id — обязательный скоуп (Charter §3.4). '
    'checkout_attempt_id — идемпотентность ПОПЫТКИ оформления при таймауте платёжного провайдера '
    '(SRS-DOM-166), UNIQUE на (tenant_id, checkout_attempt_id) не задаётся намеренно: одна попытка '
    'может дать РОВНО один заказ, повтор с тем же ключом — идемпотентный возврат уже созданного.';
COMMENT ON COLUMN orders.status IS
    'order_status — переходы см. 10-domain-model.md §«State machines»/1. БД не проверяет граф '
    'переходов (это домен), только допустимость значения enum. confirmed [D-25] — синхронный '
    'результат Order.create() для cash_courier; confirmed<->paid_escrow — запрещённая пара '
    'переходов в обе стороны (SRS-DOM-102), paid_escrow достижим только из pending_payment по '
    'подписанному вебхуку (SRS-DOM-089) либо AdminPaymentOverrideUseCase (SRS-PAY-018).';
COMMENT ON CONSTRAINT chk_orders_total_matches_sum ON orders IS
    'SRS-DOM-003: total_amount = items_total + delivery_fee. Значение пересчитывается СЕРВЕРОМ в '
    'Order.create(), constraint — последний рубеж защиты от рассинхронизации (не источник истины).';

-- =====================================================================================
-- 20. order_items [ТЗ 1:1, расширено REQ-MON-1/2/5 — комиссия снэпшотится]
-- =====================================================================================
-- ОТКЛОНЕНИЕ ОТ КАНОНИЧЕСКОГО DDL (foundIssues DTJ-220): `inventory_batch_id` в
-- 11-database-schema.md ссылается на таблицу `inventory_batches` (Группа B, строки 421-555)
-- — эта таблица НЕ существует физически (EP-05/0012_inventory_foundation.sql консолидировал
-- партию и агрегат остатка в ОДНУ таблицу `pharmacy_inventory`: `\d pharmacy_inventory`
-- показывает `expires_at`/`batch_number`/`quantity` прямо в ней, отдельной `inventory_batches`
-- нет ни в одной миграции). FK ниже указывает на РЕАЛЬНУЮ таблицу `pharmacy_inventory(id)` —
-- это единственная физически применимая цель; см. «foundIssues» отчёта DTJ-220.
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    medicine_id UUID REFERENCES medicines(id),
    unit_price_tjs NUMERIC(10, 2) NOT NULL,
    quantity INT NOT NULL,
    total_price_tjs NUMERIC(10, 2) NOT NULL,
    -- [РАСШИРЕНИЕ D-03/REQ-MON-1/2/5] --
    commission_bps SMALLINT NOT NULL DEFAULT 0, -- ставка в момент заказа (basis points, 500=5%), SRS-DOM-008
    platform_fee_diram BIGINT NOT NULL DEFAULT 0, -- D-03: снэпшот суммы комиссии от unit_price*qty (items_total), НЕ delivery_fee (SRS-DOM-009)
    inventory_batch_id UUID REFERENCES pharmacy_inventory(id) ON DELETE SET NULL, -- какая партия зарезервирована (FEFO); см. «ОТКЛОНЕНИЕ» выше
    CONSTRAINT chk_order_items_price_positive CHECK (unit_price_tjs > 0), -- SRS-DB-005
    CONSTRAINT chk_order_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_order_items_total_matches CHECK (total_price_tjs = unit_price_tjs * quantity)
);
COMMENT ON TABLE order_items IS
    'OrderItem entity (жизненный цикл подчинён Order, не отдельный агрегат). commission_bps/'
    'platform_fee_diram — НЕИЗМЕНЯЕМЫ после создания (SRS-DOM-008): последующее изменение ставки в '
    'platform_fee (таблица) не влияет на уже созданные строки — обеспечивается ТОЛЬКО прикладным '
    'кодом (readonly в domain), БД физически позволяет UPDATE, но application никогда его не вызывает.';

-- =====================================================================================
-- 21. cart / cart_items [РАСШИРЕНИЕ — серверная корзина до оформления заказа]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS cart (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL для гостевой корзины (session_token)
    session_token VARCHAR(128), -- для гостя без аутентификации (до OTP-логина)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_cart_owner CHECK (customer_id IS NOT NULL OR session_token IS NOT NULL)
);
COMMENT ON TABLE cart IS
    'Серверная персистентная корзина (не отдельный доменный агрегат — простое хранилище выбора '
    'товара; правила сплита по аптекам — SplitCartByPharmacyUseCase, вызывается на checkout, '
    'ДО Order.create(), SRS-DOM-002).';

CREATE TABLE IF NOT EXISTS cart_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id UUID NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE, -- цена/остаток конкретной аптеки
    quantity INT NOT NULL,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_cart_medicine_pharmacy UNIQUE (cart_id, medicine_id, pharmacy_id),
    CONSTRAINT chk_cart_items_quantity_positive CHECK (quantity > 0)
);
COMMENT ON TABLE cart_items IS
    'Позиция корзины привязана к КОНКРЕТНОЙ аптеке (цена/остаток различаются между аптеками, tz.log '
    'Модуль 1) — REQ-UX-4: сплит по аптекам виден пользователю ДО оплаты как N отдельных заказов.';

-- =====================================================================================
-- 22. favorites [РАСШИРЕНИЕ — избранные медикаменты клиента]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS favorites (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, medicine_id)
);
COMMENT ON TABLE favorites IS
    'Список избранных медикаментов (не отдельный домен — простое M:N, читается в features/favorites '
    'фронта). Поддерживает REQ-UX-18 (реордер) косвенно через историю заказов, не через favorites.';

-- =====================================================================================
-- ОТЛОЖЕНО (D-EP09-3, решение CTO закрыто) — FK на таблицы, которых физически ещё нет.
-- Раскомментировать И применить отдельной миграцией, когда владеющий модуль создаст свою
-- таблицу. Тот же приём применён в каноническом DDL к order_returns.courier_id — конвенция
-- проекта, не самодеятельность этой миграции.
-- =====================================================================================

-- TODO(DTJ-313): FK orders.courier_id → couriers(id), после CREATE TABLE couriers (EP-13, Группа H).
-- ALTER TABLE orders ADD CONSTRAINT orders_courier_id_fkey
--   FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE SET NULL;

-- TODO(R2-4): FK orders.prescription_id → prescriptions(id), когда модуль рецептов будет
-- заведён. Модуль вне R1 — docs/04-SCOPE-DECISION-PIVOT.md строка 101 относит его к R2-4
-- («AI-конвейер рецептов: OCR + composite_confidence (D-14) + верификация фармацевтом»); в R1
-- существует только Rx-блокировка на checkout (DTJ-230), сам рецепт не загружается. Решение
-- CTO D-EP09-8, reports/EP09-CTO-BRIEF.md — заводить фиктивный DTJ-* под неначатый эпик запрещено.
-- ALTER TABLE orders ADD CONSTRAINT orders_prescription_id_fkey
--   FOREIGN KEY (prescription_id) REFERENCES prescriptions(id);
