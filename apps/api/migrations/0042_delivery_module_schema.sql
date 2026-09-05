-- =====================================================================================
-- 0042_delivery_module_schema.sql — EP-13 (DTJ-313), схема БД модуля `delivery` (scaffolding).
-- =====================================================================================
-- Номер сверен непосредственно перед созданием файла: `ls apps/api/migrations/` и
-- `meta/_journal.json` на ветке `feat/ep-13` (от `claude/flutter-code-check-21bcb5`) —
-- последняя запись в журнале `0035_escrow_ledger_refund_unique` (idx 37); файл
-- `0036_orders_payment_window_expires_at.sql` физически присутствует, но НЕ зарегистрирован в
-- журнале и не отражён ни в одной Drizzle-схеме (`grep -rn "payment_window_expires_at"
-- apps/api/src` — пусто) — foundIssue вне периметра этого тикета (не EP-13), задокументирован в
-- отчёте DTJ-313, не исправляется здесь (правило 7 AGENTS.md). Следующий свободный номер — 0037.
--
-- === foundIssue №1 (критично для этого файла): «couriers»/«delivery_assignments» физически НЕ
-- существуют ни в одной миграции. Тикет DTJ-313 (п.1-2 «Что сделать») предполагает ALTER TABLE
-- поверх уже существующих таблиц «Группы H» (`11-database-schema.md` строки 1083-1207,
-- запланированы как `0012_delivery.sql`) — но `grep -rn "CREATE TABLE couriers\|CREATE TABLE
-- delivery_assignments" apps/api/migrations` даёт ПУСТОЙ результат. Миграция `0023_orders_cart.sql`
-- (строки 34-40, 175-177) САМА документирует это как известный, осознанный пробел: колонка
-- `orders.courier_id` — БЕЗ `REFERENCES` «т.к. таблицы couriers/prescriptions физически не
-- существуют — FK на них добавится отдельным ALTER TABLE ниже... когда соответствующий модуль
-- создаст свою таблицу» (дословно) + `TODO(DTJ-313): FK orders.courier_id → couriers(id), после
-- CREATE TABLE couriers (EP-13, Группа H)`. Это ИМЕННО данный тикет. Разрешение: ниже — CREATE
-- TABLE (не ALTER) обеих таблиц, 1:1 транскрипция канонического DDL Группы H
-- (`11-database-schema.md` §32-33) + расширения D.1/D.2 `25-module-courier-delivery.md` слиты в
-- ОДИН CREATE (таблицы создаются впервые — разделять на CREATE+ALTER в одной и той же миграции
-- не даёт дополнительной пользы). Затем — деферренная FK `orders.courier_id → couriers(id)`
-- (закрывает TODO из 0023). `courier_earnings`/`tenant_courier_payout_rules`/`courier_payouts`
-- (остаток «Группы H») — ВНЕ периметра ЭТОГО тикета (не в `files_owned` DTJ-313, не упомянуты в
-- его «Что сделать», ни одна из 5 новых таблиц D.3-D.6 на них не ссылается) — оставлены
-- НЕсозданными, foundIssue зафиксирован в отчёте для владельца DTJ-320/321 (курьерские
-- заработок/выплаты, по `blocks:` этого тикета).
--
-- === foundIssue №2: PostGIS НЕ доступен в этом окружении. `pg_available_extensions` — 0 строк
-- для `postgis*` в образе `postgres:16` (независимо подтверждено здесь; уже задокументировано
-- ДРУГИМ тикетом — `apps/api/src/db/schema/pharmacies.ts` JSDoc + `0022_pharmacies_lat_lon_index.sql`,
-- DTJ-195 постмортем, тот же вывод по тому же образу). Тикет DTJ-313 (п.6, «Риски») предполагает
-- обратное («PostGIS уже подключён... используется pharmacies.geo_point») — это утверждение
-- ОШИБОЧНО: `pharmacies.geo_point` был РАССМОТРЕН и ОТКЛОНЁН именно по причине недоступности
-- PostGIS (см. тот же JSDoc). Разрешение — тот же приём, что уже дважды применён в этой кодовой
-- базе (DTJ-185 `postgres-search.sql.ts`, DTJ-195 `postgres-pharmacy-map.adapter.ts`): GEOGRAPHY-
-- колонки/GiST-индексы заменены на обычные `NUMERIC`-пары широта/долгота + составной btree.
-- Затронуто: `delivery_assignments.delivery_geo_point` (канонический DDL §33) — колонка ОПУЩЕНА
-- целиком (не просто адаптирована): она избыточна — точка доставки уже снапшотится
-- `orders.delivery_latitude/longitude` (см. D.8 ниже), модуль `delivery` читает её через
-- `OrdersFacade.getDeliverySnapshot(orderId)` (SRS-DELIV-041), не дублирует на своей таблице;
-- `ix_delivery_assignments_geo_point` (GiST) соответственно тоже не создаётся. `delivery_zones.
-- center_geo_point` (D.6, `25-module-courier-delivery.md`) — АДАПТИРОВАНА (не опущена, нужна
-- зонам): `center_latitude NUMERIC(10,8)` + `center_longitude NUMERIC(11,8)`, `ix_delivery_zones_geo`
-- (GiST) заменён на `ix_delivery_zones_lat_lon` (обычный составной btree, bbox-предфильтр).
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE TYPE` — `DO $$ ... EXCEPTION WHEN
-- duplicate_object THEN NULL; END $$;` (приём `0023`/`0034`). `CREATE TABLE IF NOT EXISTS`,
-- `CREATE (UNIQUE) INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — идемпотентны
-- нативно. `ADD CONSTRAINT` — guard по `pg_constraint` (приём `0009_verification_status_add_revoked.sql`).
--
-- === Пункт 8 (D.8, cross-module `orders`) — расширение ЧУЖОЙ таблицы (`orders` принадлежит
-- `modules/orders`, EP-09/EP-10/EP-12). Координация — см. отчёт DTJ-313 «Открытые вопросы»:
-- поля ещё не существовали на момент этого тикета (проверено), активных агентов на этих
-- конкретных колонках в момент написания не было — минимальный изолированный ALTER (ровно 5 полей,
-- ничего больше в orders), эндпоинты модуля `delivery` читают их ТОЛЬКО через
-- `OrdersFacade.getDeliverySnapshot(orderId)` (минимизация связности, D.8 §«25-module...»).
-- =====================================================================================


-- =====================================================================================
-- Секция 1 — новые ENUM-типы (couriers/delivery_assignments/delivery_offers/courier_shifts).
-- 1:1 `enums.schema.ts` (Drizzle), добавлены В ЕДИНЫЙ файл pgEnum, не отдельным модульным файлом.
-- =====================================================================================
DO $$ BEGIN
  CREATE TYPE "courier_status" AS ENUM ('pending_verification', 'active', 'suspended', 'terminated');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "courier_tax_status" AS ENUM (
    'individual_patent', 'civil_contract_platform_withholds', 'chain_employee'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "courier_vehicle_type" AS ENUM ('foot', 'bicycle', 'moped', 'car');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "delivery_assignment_status" AS ENUM (
    'unassigned', 'assigned', 'en_route_to_pharmacy', 'picked_up_from_pharmacy',
    'en_route_to_customer', 'delivered', 'delivery_failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- D.1 (25-module-courier-delivery.md) — couriers.shift_status.
DO $$ BEGIN
  CREATE TYPE "courier_shift_status" AS ENUM ('off_shift', 'on_shift');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- D.3 — delivery_offers.status.
DO $$ BEGIN
  CREATE TYPE "delivery_offer_status" AS ENUM ('pending', 'accepted', 'declined', 'expired', 'superseded');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- D.4 — courier_shifts.status (история физических смен, отдельно от couriers.shift_status).
DO $$ BEGIN
  CREATE TYPE "courier_shift_record_status" AS ENUM ('active', 'closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- =====================================================================================
-- Секция 2 — «Группа H» (couriers, delivery_assignments), создаётся ВПЕРВЕ (foundIssue №1 выше).
-- Канонический DDL §32-33 (11-database-schema.md) + D.1/D.2 (25-module-courier-delivery.md).
-- =====================================================================================
CREATE TABLE IF NOT EXISTS couriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE SET NULL, -- NULL = platform_pool (REQ-COUR-1)
    status courier_status NOT NULL DEFAULT 'pending_verification',
    tax_status courier_tax_status NOT NULL,
    tax_status_document_url TEXT,
    vehicle_type courier_vehicle_type NOT NULL,
    cold_chain_certified BOOLEAN NOT NULL DEFAULT false, -- REQ-COUR-9, допуск к requires_cold_chain
    health_certificate_url TEXT,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- ---- D.1 (SRS-DELIV-003) ----
    last_known_latitude NUMERIC(10, 8),
    last_known_longitude NUMERIC(11, 8),
    last_location_at TIMESTAMPTZ,
    shift_status courier_shift_status NOT NULL DEFAULT 'off_shift',
    rating_avg NUMERIC(3, 2) NOT NULL DEFAULT 5.00,
    rating_count INT NOT NULL DEFAULT 0,
    current_cash_on_hand_diram BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT chk_couriers_rating_range CHECK (rating_avg >= 0 AND rating_avg <= 5),
    CONSTRAINT chk_couriers_cash_nonneg CHECK (current_cash_on_hand_diram >= 0)
);
COMMENT ON TABLE couriers IS
    'Courier aggregate (EP-13, DTJ-313). chain_id NULL => partner pool (REQ-COUR-1/2); заполнено '
    '=> собственный флот, обслуживает ТОЛЬКО заказы своей сети (SRS-DOM-037). '
    'pending_verification не может быть назначен ни на один заказ (SRS-DOM-137, REQ-COUR-10).';

CREATE TABLE IF NOT EXISTS delivery_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id UUID REFERENCES couriers(id) ON DELETE SET NULL, -- NULL пока unassigned
    status delivery_assignment_status NOT NULL DEFAULT 'unassigned',
    landmark_text TEXT,
    -- delivery_geo_point GEOGRAPHY(POINT,4326) канонического DDL — ОПУЩЕНА, см. foundIssue №2.
    handover_otp_id UUID REFERENCES otp_codes(id) ON DELETE SET NULL,
    cash_collected_diram BIGINT, -- REQ-DELIV-4, для payment_method='cash_courier'
    cash_change_diram BIGINT,
    reassign_reason TEXT,
    reassigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    picked_up_from_pharmacy_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- ---- D.2 (SRS-DELIV-004) ----
    requires_cold_chain BOOLEAN NOT NULL DEFAULT false,
    cold_chain_bag_confirmed BOOLEAN,
    cold_chain_bag_confirmed_at TIMESTAMPTZ,
    contact_attempts_count INT NOT NULL DEFAULT 0,
    last_contact_attempt_at TIMESTAMPTZ,
    distance_meters INT, -- снапшот дистанции аптека→клиент на момент создания (аудит delivery_fee)
    CONSTRAINT chk_delivery_cash_matches
        CHECK (cash_collected_diram IS NULL OR cash_collected_diram >= COALESCE(cash_change_diram, 0))
);
COMMENT ON TABLE delivery_assignments IS
    'DeliveryAssignment aggregate (EP-13, DTJ-313). Только одно НЕТЕРМИНАЛЬНОЕ назначение на '
    'order_id одновременно (SRS-DOM-036) — см. ux_delivery_assignment_one_active. markDelivered() '
    'для cash_courier требует ПРЕДВАРИТЕЛЬНОГО recordCash() (SRS-DOM-040).';

-- Закрывает TODO(DTJ-313) из 0023_orders_cart.sql строка 175-177: FK теперь достижима.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_courier_id_fkey') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_courier_id_fkey
      FOREIGN KEY (courier_id) REFERENCES couriers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_couriers_active_pool ON couriers (status) WHERE chain_id IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS ix_couriers_active_chain ON couriers (chain_id, status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ix_delivery_assignments_order ON delivery_assignments (order_id);
CREATE INDEX IF NOT EXISTS ix_delivery_assignments_courier_active
    ON delivery_assignments (courier_id, status)
    WHERE status NOT IN ('delivered', 'delivery_failed');
-- SRS-DOM-036: только одно нетерминальное назначение на order_id (домен-тест АС3 — DeliveryAssignment.create()).
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_assignment_one_active
    ON delivery_assignments (order_id)
    WHERE status NOT IN ('delivered', 'delivery_failed');


-- =====================================================================================
-- Секция 3 — delivery_offers (D.3, SRS-DELIV-005).
-- =====================================================================================
CREATE TABLE IF NOT EXISTS delivery_offers (
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_offers_one_pending_per_assignment
    ON delivery_offers (delivery_assignment_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_delivery_offers_courier_pending
    ON delivery_offers (courier_id) WHERE status = 'pending';
COMMENT ON TABLE delivery_offers IS
    'Очередь последовательных предложений курьерам (REQ-DELIV-2). Один PENDING оффер на назначение '
    'одновременно (частичный уникальный индекс). Эскалация — новая строка sequence_no+1, старая '
    'помечается expired. Не путать с delivery_assignments.status — назначение остаётся unassigned, '
    'пока ни один оффер не принят.';


-- =====================================================================================
-- Секция 4 — courier_shifts (D.4, SRS-DELIV-006).
-- =====================================================================================
CREATE TABLE IF NOT EXISTS courier_shifts (
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_courier_shifts_one_active ON courier_shifts (courier_id) WHERE status = 'active';
COMMENT ON TABLE courier_shifts IS
    'История смен (REQ-COUR-7 соседняя область). Разделяет "признание заработка" (courier_earnings, '
    'вне периметра DTJ-313 — foundIssue) от "физического учёта наличных на руках" (эта таблица). '
    'discrepancy_diram != 0 логируется в audit_log (category=cash_reconciliation_discrepancy, '
    'см. 0043_audit_action_category_cash_reconciliation.sql).';


-- =====================================================================================
-- Секция 5 — courier_ratings (D.5, SRS-DELIV-007).
-- =====================================================================================
CREATE TABLE IF NOT EXISTS courier_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE, -- одна оценка на заказ
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_courier_ratings_range CHECK (rating BETWEEN 1 AND 5)
);


-- =====================================================================================
-- Секция 6 — delivery_zones + delivery_pricing_rules (D.6, SRS-DELIV-008). Гео — см. foundIssue №2.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS delivery_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = глобальный дефолт (neutral)
    name VARCHAR(100) NOT NULL,
    center_latitude NUMERIC(10, 8) NOT NULL,
    center_longitude NUMERIC(11, 8) NOT NULL,
    radius_km NUMERIC(6, 2) NOT NULL,
    priority SMALLINT NOT NULL DEFAULT 0, -- меньше = выше приоритет при перекрытии зон
    is_active BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT chk_delivery_zones_radius_positive CHECK (radius_km > 0)
);
-- ix_delivery_zones_geo (GiST) канонического DDL заменён обычным btree — PostGIS недоступен
-- (foundIssue №2). Bbox-предфильтр + точный гаверсинус — application-слой (DTJ-314+).
CREATE INDEX IF NOT EXISTS ix_delivery_zones_lat_lon ON delivery_zones (center_latitude, center_longitude);

CREATE TABLE IF NOT EXISTS delivery_pricing_rules (
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


-- =====================================================================================
-- Секция 7 — [cross-module] orders (D.8) — паритет с user_addresses (REQ-GEO-3, SRS-DELIV-010/041).
-- Владелец таблицы — modules/orders (EP-09/EP-10/EP-12); заполняется use case'ом чекаута ТОГО
-- модуля (вне периметра DTJ-313). Модуль delivery читает ИСКЛЮЧИТЕЛЬНО через
-- OrdersFacade.getDeliverySnapshot(orderId), не напрямую — минимизация связности.
-- =====================================================================================
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivery_entrance VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_floor VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_apartment VARCHAR(20),
    ADD COLUMN IF NOT EXISTS delivery_comment TEXT,
    ADD COLUMN IF NOT EXISTS delivery_landmark_photo_url TEXT;
