-- =====================================================================================
-- 0053_courier_earnings_payouts.sql — EP-13 (DTJ-321), courier_payouts + courier_earnings.
-- =====================================================================================
-- Перенос на актуальную development (волна 4): старая 0044 конфликтовала с уже занятым
-- номером — перенумеровано в 0053/idx 55 по указанию координатора (`_journal.json`).
--
-- === foundIssue (не домысел этого тикета, унаследован от DTJ-313): `courier_earnings`/
-- `courier_payouts` — «остаток Группы H» (`11-database-schema.md` §34/36) — НЕ созданы ни одной
-- предыдущей миграцией. `0042_delivery_module_schema.sql` (DTJ-313) явно документирует это как
-- сознательно вне своего периметра («не в files_owned DTJ-313... foundIssue зафиксирован в отчёте
-- для владельца DTJ-320/321»), подтверждено `docs/STATE-AND-RESUME-POINT.md`: «courier_earnings/
-- tenant_courier_payout_rules/courier_payouts (остаток Группы H) — по-прежнему не существуют,
-- нужны DTJ-320/321». DTJ-321 (`GET /courier-earnings`/`GET /courier-payouts`, SRS-DELIV-030/031)
-- не может отдать READ-ONLY эндпоинты без физической таблицы — создаются здесь, 1:1 транскрипция
-- канонического DDL (`11-database-schema.md` §34/36), порядок создания (`courier_payouts` первой)
-- избегает отложенного `ALTER TABLE ... ADD CONSTRAINT` для `courier_earnings.payout_batch_id`
-- (док создаёт `courier_earnings` первой и потом ALTER'ит FK — здесь оба CREATE в одной миграции,
-- дополнительный ALTER не даёт пользы).
--
-- `tenant_courier_payout_rules` (§35, формула `amount_diram` для write-стороны признания
-- заработка) — НЕ создаётся: нужна только `DeliveryCompletedEvent -> billing.recordEarning`
-- обработчику, вне периметра READ-ONLY DTJ-321 (см. риски тикета) — остаётся открытым гэпом для
-- владельца этого будущего обработчика (см. отчёт сдачи).
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE TYPE` — `DO $$ ... EXCEPTION WHEN
-- duplicate_object THEN NULL; END $$;` (courier_payout_batch_status добавлен в
-- `db/schema/enums.schema.ts`, синтаксис миграции — тот же приём `0034_support_tickets_audit_log.sql`).
-- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` — идемпотентны нативно.
-- =====================================================================================

DO $$ BEGIN
  CREATE TYPE "courier_payout_batch_status" AS ENUM ('draft', 'issued', 'paid', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================================
-- courier_payouts [РАСШИРЕНИЕ REQ-COUR-6 — физическая выплата батчами, §36]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS courier_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    total_amount_diram BIGINT NOT NULL,
    cash_remittance_offset_diram BIGINT NOT NULL DEFAULT 0,
    status courier_payout_batch_status NOT NULL DEFAULT 'draft',
    issued_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_courier_payouts_period CHECK (period_end > period_start),
    CONSTRAINT chk_courier_payouts_amount_nonneg CHECK (total_amount_diram >= 0)
);
COMMENT ON TABLE courier_payouts IS
    'Батч физической выплаты курьеру платформенного пула (REQ-COUR-6, дефолт — раз в неделю, '
    'конфигурируемо). cash_remittance_offset_diram — REQ-COUR-7: сумма наличных, собранных курьером '
    'за cash_courier-заказы, автоматически вычитается из ближайшего батча. DTJ-321: READ-ONLY '
    'эндпоинт (GET /courier-payouts) — генерация батчей вне периметра, см. JSDoc db/schema/courier-payouts.ts.';

CREATE INDEX IF NOT EXISTS ix_courier_payouts_courier ON courier_payouts (courier_id, created_at DESC);

-- =====================================================================================
-- courier_earnings [РАСШИРЕНИЕ REQ-COUR-5 — признание заработка, append-only, §34]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS courier_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    courier_id UUID NOT NULL REFERENCES couriers(id) ON DELETE RESTRICT,
    delivery_assignment_id UUID NOT NULL REFERENCES delivery_assignments(id) ON DELETE RESTRICT,
    amount_diram BIGINT NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    is_return_fee BOOLEAN NOT NULL DEFAULT false,
    payout_batch_id UUID REFERENCES courier_payouts(id) ON DELETE SET NULL,
    recognized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_courier_earnings_amount_positive CHECK (amount_diram > 0)
);
COMMENT ON TABLE courier_earnings IS
    'Признаётся В МОМЕНТ delivered, НЕЗАВИСИМО от hold_period_days выплаты аптеке (SRS-DOM: '
    'DeliveryCompletedEvent -> billing.recordEarning, REQ-COUR-5) — два несвязанных таймлайна. '
    'Только для couriers.chain_id IS NULL (platform_pool) — own_fleet курьеры НЕ имеют записей здесь '
    '(REQ-COUR-3: delivery_fee_tjs целиком выручка тенанта, DoruTJ не ведёт их earnings). DTJ-321: '
    'READ-ONLY эндпоинт (GET /courier-earnings) — запись строки вне периметра, см. JSDoc '
    'db/schema/courier-earnings.ts.';

-- Батч-выплата курьеру (REQ-COUR-6): незачтённые earnings пула.
CREATE INDEX IF NOT EXISTS ix_courier_earnings_courier_unpaid
    ON courier_earnings (courier_id, recognized_at)
    WHERE payout_batch_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_courier_earnings_courier ON courier_earnings (courier_id, recognized_at DESC);
