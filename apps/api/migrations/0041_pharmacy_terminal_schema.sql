-- =====================================================================================
-- 0041_pharmacy_terminal_schema.sql — EP-12, DTJ-300 (scaffolding: схема БД и доменные
-- расширения терминала фармацевта, модуль 24 «Терминал фармацевта»).
-- =====================================================================================
-- Номер: следующий свободный по файлам `apps/api/migrations/` на момент создания —
-- занято по `0036_orders_payment_window_expires_at.sql` включительно (эта же ветка,
-- `feat/ep-12`, от `claude/flutter-code-check-21bcb5`). Параллельные ветки (`feat/ep-10`,
-- `feat/ep-11_12_14`) занимают СВОИ, другие по содержанию `0037`/`0038` — ожидаемая,
-- задокументированная в тикете (раздел «Риски») коллизия номеров, решается rebase при
-- мерже.
--
-- foundIssue (не входит в периметр этого тикета, но напрямую влияет на его DDL):
-- `apps/api/migrations/meta/_journal.json` НЕ содержит записи для `0036` — файл существует
-- на диске, но `drizzle-orm/node-postgres/migrator` его никогда не применяет (журнал, не
-- список файлов, определяет, что накатывается). Не чинится в рамках DTJ-300 (чужой файл,
-- вне `files_owned`) — см. отчёт сдачи. Эта миграция получает СВОЮ корректную запись в
-- журнале, поэтому применяется независимо от судьбы `0036`.
--
-- SRS-PHT-001: терминал — presentation-поверхность над `orders` (+ `inventory` для замены
-- партии, `delivery` для чтения статуса) — новый backend-модуль НЕ заводится, поэтому все
-- расширения ниже — ALTER существующих таблиц `orders`/`order_items`/`tenant_settings` +
-- одна новая таблица `order_partial_fulfillment_requests`. Аддитивно (Charter §5), базовые
-- имена/типы колонок `11-database-schema.md` не меняются.
--
-- ОТКЛОНЕНИЕ ОТ ДОСЛОВНОГО DDL СПЕЦИФИКАЦИИ (docs/spec/24-module-pharmacy-terminal.md
-- §«Дополнения к схеме БД»): спецификация предписывает `order_items.scanned_batch_id UUID
-- REFERENCES inventory_batches(id)`. Таблицы `inventory_batches` в этой кодовой базе НЕ
-- существует ни в одной миграции (проверено — foundIssue, задокументированный ЕЩЁ в
-- DTJ-220/EP09-CTO-BRIEF.md и покрытый тестом `orders-migration.integration.spec.ts`:
-- «order_items — CHECK-констрейнты и FK на pharmacy_inventory (foundIssues: не
-- inventory_batches)») — партии физически хранятся как строки `pharmacy_inventory`
-- (см. JSDoc `apps/api/src/db/schema/pharmacy-inventory.ts`: «Одна строка = один остаток...
-- с конкретным сроком годности и серией», т.е. это и есть «батч»). `scanned_batch_id` ниже
-- ссылается на `pharmacy_inventory(id)`, СИММЕТРИЧНО уже существующему
-- `order_items.inventory_batch_id` (та же таблица, тот же приём).
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE TYPE`/многоколоночный `ADD CONSTRAINT` не
-- поддерживают `IF NOT EXISTS` в PostgreSQL — обёрнуты в `DO $$ ... EXCEPTION WHEN
-- duplicate_object THEN NULL; END $$;` (тот же приём, что `0002_enums.sql`/
-- `0027_orders_cash_never_escrow.sql`/`0029_payments.sql`). Одноколоночные CHECK на НОВЫХ
-- колонках `order_items` объявлены ВСТРОЕННО в `ADD COLUMN IF NOT EXISTS ... CONSTRAINT ...`
-- — идемпотентны транзитивно через `IF NOT EXISTS` самой колонки (Postgres целиком
-- пропускает клаузу, если колонка уже существует). `CREATE TABLE`/`CREATE INDEX`/
-- `COMMENT ON` идемпотентны нативно (`IF NOT EXISTS` / перезапись комментария).
-- =====================================================================================

-- =====================================================================================
-- orders — мягкая блокировка «кто ведёт сборку» (SRS-PHT-006/007/010/038)
-- =====================================================================================
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS assigned_pharmacist_id UUID REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.assigned_pharmacist_id IS
    'UX-блокировка терминала (не RBAC-контроль — тот остаётся orders:*:pharmacy, SRS-PHT-038). '
    'Заполняется AcceptOrderUseCase/reclaim (DTJ-301+), НЕ проверяется как условие авторизации '
    'на scan/complete-picking. Модуль 24, SRS-PHT-007.';

-- =====================================================================================
-- order_items — прогресс сканирования позиции (SRS-PHT-011..016)
-- =====================================================================================
DO $$ BEGIN
    CREATE TYPE order_item_fulfillment_status AS ENUM ('pending', 'scanned_ok', 'unavailable');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS fulfillment_status order_item_fulfillment_status NOT NULL DEFAULT 'pending',
    -- Симметрично inventory_batch_id — ссылается на pharmacy_inventory(id), см. пояснение выше.
    ADD COLUMN IF NOT EXISTS scanned_batch_id UUID REFERENCES pharmacy_inventory(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scanned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS scan_method VARCHAR(10)
        CONSTRAINT chk_order_items_scan_method CHECK (scan_method IN ('camera', 'manual') OR scan_method IS NULL),
    ADD COLUMN IF NOT EXISTS item_issue_reason VARCHAR(30)
        CONSTRAINT chk_order_items_item_issue_reason
        CHECK (item_issue_reason IN ('out_of_stock', 'expired_on_shelf', 'damaged_packaging') OR item_issue_reason IS NULL);

COMMENT ON COLUMN order_items.fulfillment_status IS
    'Прогресс физической сборки позиции терминалом (модуль 24). Не путать с order.status '
    '(уровень заказа). complete-picking (SRS-PHT-026) требует отсутствия pending среди позиций.';
COMMENT ON COLUMN order_items.scanned_batch_id IS
    'Партия, ФАКТИЧЕСКИ отсканированная при сборке — может отличаться от исходно зарезервированной '
    'по FEFO order_items.inventory_batch_id при замене партии (SRS-PHT-014, inventory.releaseReservation '
    '+ reserveForOrder). Ссылается на pharmacy_inventory(id), НЕ inventory_batches (см. пояснение в '
    'шапке миграции — foundIssue, таблицы inventory_batches не существует в этой БД).';

-- =====================================================================================
-- order_partial_fulfillment_requests — подтверждение частичной сборки (D-10, SRS-PHT-019..023)
-- =====================================================================================
DO $$ BEGIN
    CREATE TYPE partial_fulfillment_status AS ENUM (
        'awaiting_customer', 'confirmed', 'rejected', 'auto_confirmed_timeout'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS order_partial_fulfillment_requests (
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_partial_fulfillment_one_active
    ON order_partial_fulfillment_requests (order_id) WHERE status = 'awaiting_customer';

COMMENT ON TABLE order_partial_fulfillment_requests IS
    'Запрос подтверждения изменённого состава заказа клиентом (модуль 24, D-10/SRS-DOM-162 — '
    'стратегия частичного рефанда). Ровно один активный (awaiting_customer) запрос на заказ '
    '(ux_partial_fulfillment_one_active). auto_confirmed_timeout — см. SRS-PHT-023a.';

-- =====================================================================================
-- tenant_settings — параметры терминала (SRS-PHT-019/029)
-- =====================================================================================
ALTER TABLE tenant_settings
    ADD COLUMN IF NOT EXISTS partial_fulfillment_confirmation_timeout_minutes INT NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS handover_otp_max_regenerations_per_order INT NOT NULL DEFAULT 20,
    ADD COLUMN IF NOT EXISTS handover_otp_regenerate_min_interval_seconds INT NOT NULL DEFAULT 60;

DO $$ BEGIN
    ALTER TABLE tenant_settings
        ADD CONSTRAINT chk_tenant_settings_pht_ranges CHECK (
            partial_fulfillment_confirmation_timeout_minutes > 0
            AND handover_otp_max_regenerations_per_order > 0
        );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN tenant_settings.partial_fulfillment_confirmation_timeout_minutes IS
    'Модуль 24, SRS-PHT-019. Окно ожидания ответа клиента на предложенную частичную сборку до '
    'auto_confirmed_timeout (SRS-PHT-023a). ДОЛЖНО быть < pickup_sla_minutes + '
    'pickup_sla_buffer_minutes для этого же tenant (проверяется вручную при настройке, SRS-PHT-073 '
    '— кросс-констрейнт между двумя независимыми полями сознательно не вводится, `02` C15).';
COMMENT ON COLUMN tenant_settings.handover_otp_max_regenerations_per_order IS
    'Модуль 24, SRS-PHT-029. Rate-limit регенерации OTP вручения на один заказ — 429 RATE_LIMITED '
    'при исчерпании.';
