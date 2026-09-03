-- =====================================================================================
-- 0029_payments.sql — EP-10 (DTJ-236), «Группа E»: эскроу, выплаты, комиссия, идемпотентность
-- вызовов PaymentProvider. Физическое основание всего эпика EP-10.
-- =====================================================================================
-- Номер файла: тикет называл `0009_payments.sql` — устарело (тот же класс расхождения, что
-- D-EP09-32/D-EP09-33 у EP-09: номера в тикетах фиксируются при нарезке эпика задолго до
-- реализации). Сверено `ls apps/api/migrations/` и `meta/_journal.json` непосредственно перед
-- созданием файла — последняя применённая миграция `0028_orders_payments_extensions.sql`,
-- следующий свободный номер `0029`.
--
-- Применяется ПОСЛЕ `0023_orders_cart.sql` (DTJ-220, EP-09) — `escrow_ledger.order_id` и
-- `payout_schedule.order_id` физически ссылаются на `orders(id)`. Если `orders` не существует,
-- миграция обязана падать на FOREIGN KEY (см. `payments.module.full-boot.di.spec.ts` /
-- негативный сценарий приёмки DTJ-236 п.2) — это ожидаемое поведение, не дефект.
--
-- DDL — 1:1 транскрипция `docs/spec/11-database-schema.md` строки 812-928 («Группа E»).
-- `payout_schedule.held_by_dispute_id` — БЕЗ `REFERENCES` на этом шаге (FK на `order_disputes`
-- добавляется отдельной миграцией EP-11/14 через `ALTER TABLE`, см. комментарий у колонки в
-- каноническом DDL и прецедент `tickets/ep07-returns-disputes/DTJ-270.md`).
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE TYPE`/`ADD CONSTRAINT` не поддерживают
-- `IF NOT EXISTS` в PostgreSQL — обёрнуты в `DO $$ ... EXCEPTION WHEN duplicate_object THEN
-- NULL; END $$;` (тот же приём, что `0002_enums.sql`/`0027_orders_cash_never_escrow.sql`).
-- `CREATE TABLE`/`COMMENT ON` идемпотентны нативно (`IF NOT EXISTS` / перезапись комментария).
-- =====================================================================================

-- === D-02: эскроу-леджер (двойная запись, append-only) ===
DO $$ BEGIN
  CREATE TYPE "escrow_entry_type" AS ENUM (
    'hold_created', 'platform_fee_captured', 'captured_to_pharmacy',
    'refunded_to_customer', 'partially_refunded', 'adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "escrow_entry_direction" AS ENUM ('debit', 'credit');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- === Payout schedule (выплата аптеке) ===
DO $$ BEGIN
  CREATE TYPE "payout_status" AS ENUM ('pending', 'due', 'disputed', 'paid', 'reversed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- === Платежи / провайдер: идемпотентность вызовов PaymentProvider (REQ-PAY-8) ===
DO $$ BEGIN
  CREATE TYPE "payment_operation_type" AS ENUM (
    'create_bill', 'refund', 'partial_refund', 'capture_preauth', 'void_preauth'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "payment_operation_status" AS ENUM ('pending', 'succeeded', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================================
-- 23. escrow_ledger [РАСШИРЕНИЕ D-02 — программный ledger, двойная запись, append-only]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS escrow_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    entry_type escrow_entry_type NOT NULL,
    direction escrow_entry_direction NOT NULL, -- SRS-DOM-067: знак кодируется полем, не отрицательным Money
    amount_diram BIGINT NOT NULL,
    payment_transaction_ref VARCHAR(255), -- ссылка на payment_operations.provider_ref для hold/refund записей
    reason TEXT, -- ОБЯЗАТЕЛЕН для entry_type='adjustment' (SRS-DOM-035)
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- ОБЯЗАТЕЛЕН для 'adjustment' (super_admin)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_escrow_ledger_amount_positive CHECK (amount_diram > 0),
    CONSTRAINT chk_escrow_ledger_adjustment_requires_reason
        CHECK (entry_type != 'adjustment' OR (reason IS NOT NULL AND actor_user_id IS NOT NULL))
);
COMMENT ON TABLE escrow_ledger IS
    'EscrowLedgerEntry — append-only, НИКОГДА не UPDATE/DELETE (SRS-DOM-031). Нет UPDATE-триггера-'
    'запрета намеренно избыточного — защита обеспечивается тем, что ни один прикладной репозиторий '
    'не экспонирует update()/delete() для этой таблицы (архитектурная гарантия), а REVOKE UPDATE, '
    'DELETE FROM app_role — операционная гарантия на уровне роли БД (см. §7).';
COMMENT ON COLUMN escrow_ledger.entry_type IS
    'hold_created (при webhook PAID_HOLD) -> platform_fee_captured + captured_to_pharmacy (ОДНОЙ '
    'транзакцией при delivered, SRS-DOM-032) -> опционально refunded_to_customer/partially_refunded/'
    'adjustment. Инвариант реконсиляции: hold_created = platform_fee_captured + captured_to_pharmacy '
    '+ Σ(refund*/adjustment) — проверяется джобой EscrowReconciliationJob (REQ-PAY-9), не constraint''ом '
    '(требует агрегации по всем строкам заказа, невозможно как CHECK на строке).';

-- =====================================================================================
-- 24. payout_schedule [РАСШИРЕНИЕ D-02/D-03/D-24/REQ-PAY-6/REQ-MON-4]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS payout_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE, -- 1:1 c заказом
    pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
    status payout_status NOT NULL DEFAULT 'pending',
    gross_amount_diram BIGINT NOT NULL, -- REQ-MON-4: items_total до вычета комиссии
    commission_diram BIGINT NOT NULL, -- Σ(order_items.platform_fee_diram)
    net_amount_diram BIGINT NOT NULL, -- REQ-MON-4: аптеке платится только net = gross - commission
    hold_period_days INT NOT NULL, -- снэпшот tenant_settings.hold_period_days на момент delivered
    due_at TIMESTAMPTZ, -- delivered_at + hold_period_days, вычисляется джобой pending->due
    held_by_dispute_id UUID, -- FK добавлен ALTER TABLE после CREATE TABLE order_disputes (группа F)
    paid_at TIMESTAMPTZ,
    payout_batch_ref VARCHAR(255), -- ссылка на банковский пакетный перевод (вне схемы, внешняя система)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_payout_schedule_net_matches CHECK (net_amount_diram = gross_amount_diram - commission_diram),
    CONSTRAINT chk_payout_schedule_amounts_nonneg
        CHECK (gross_amount_diram >= 0 AND commission_diram >= 0 AND net_amount_diram >= 0)
);
COMMENT ON TABLE payout_schedule IS
    'Один payout_schedule на заказ (REQ-PAY-6/REQ-MON-4). Переходы см. 10-domain-model.md §«State '
    'machines»/2. disputed блокирует payout-джобу без доп. логики фильтрации (REQ-DISPUTE-4): джоба '
    'выбирает WHERE status=''due'', disputed автоматически исключён.';
COMMENT ON COLUMN payout_schedule.held_by_dispute_id IS
    'Заполняется атомарно ОДНОЙ транзакцией с order_disputes.status=''open'' (SRS-DOM-058, '
    'OpenDisputeUseCase внутри unitOfWork.run()).';

-- =====================================================================================
-- 25. platform_fee [РАСШИРЕНИЕ D-03/REQ-MON-8 — конфигурация ставок комиссии, резолвинг по специфичности]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS platform_fee (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global default
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE, -- NULL = не специфично к сети
    commission_category VARCHAR(20), -- NULL = не специфично к категории; иначе 'rx'|'otc'|'parapharma'
    commission_bps SMALLINT NOT NULL, -- 500=5%(Rx), 800=8%(ОТС), 1200=12%(парафарм) — ASSUMPTION D-03
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE, -- NULL = бессрочно
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT, -- обязательный аудит изменения ставки
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_platform_fee_bps_range CHECK (commission_bps BETWEEN 0 AND 10000),
    CONSTRAINT chk_platform_fee_date_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);
COMMENT ON TABLE platform_fee IS
    'Ставки комиссии платформы (D-03, REQ-MON-8). Резолвинг по специфичности при Order.create() '
    '(SRS-DOM-160): (tenant_id,chain_id,category) > (tenant_id,chain_id) > (tenant_id,category) > '
    '(tenant_id) > global (все NULL). Более узкое правило побеждает независимо от порядка вставки; '
    'effective_from/effective_to — дополнительный фильтр «активно на дату заказа».';
COMMENT ON COLUMN platform_fee.commission_bps IS
    'Basis points (1/100 процента). Изменение ставки НЕ влияет на уже созданные order_items — '
    'значение снэпшотится один раз в order_items.commission_bps/platform_fee_diram (SRS-DOM-008).';

-- =====================================================================================
-- 26. payment_operations [РАСШИРЕНИЕ REQ-PAY-8 — идемпотентность вызовов PaymentProvider]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS payment_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    operation_type payment_operation_type NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE, -- явный ключ на вызов (createBill/refund), REQ-PAY-8
    provider VARCHAR(30) NOT NULL, -- 'alif_mobi' | 'dc_next' | 'mock_bank'
    provider_ref VARCHAR(255), -- ID операции на стороне провайдера (invoice_id, refund_id)
    status payment_operation_status NOT NULL DEFAULT 'pending',
    amount_diram BIGINT NOT NULL,
    raw_webhook_payload JSONB, -- сырое тело последнего relevant вебхука (для расследований, PII-маскировано на уровне логов)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE payment_operations IS
    'Локальная идемпотентность вызовов PaymentProvider там, где банк не гарантирует нативную '
    '(REQ-PAY-8). idempotency_key для createBill — checkout_attempt_id заказа; для webhook-обработки '
    'дублирующегося PAID_HOLD — банковский transaction_id (SRS-DOM-164): UNIQUE-конфликт => 200 OK '
    'без повторного выполнения бизнес-логики.';
