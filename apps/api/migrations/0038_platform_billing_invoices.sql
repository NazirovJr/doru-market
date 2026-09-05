-- =====================================================================================
-- 0038_platform_billing_invoices.sql — EP-10, DTJ-251 (CashCommissionAggregationJob).
-- =====================================================================================
-- Номер: следующий свободный по `ls apps/api/migrations/`/`meta/_journal.json`, проверено
-- непосредственно перед созданием файла — последняя применённая `0037_payout_schedule_status_
-- index.sql`.
--
-- КОНТЕКСТ (расхождение с текстом тикета DTJ-251, зафиксировано явно, отчёт сдачи):
-- «Технический контекст» тикета описывает `platform_billing_invoices` как «таблицу из базовой
-- схемы DTJ-236» — ПРОВЕРЕНО: это неверно. `files_owned` самого DTJ-236 (`tickets/
-- ep06-cart-checkout-money/DTJ-236.md`) перечисляет ТОЛЬКО `escrow_ledger`/`payout_schedule`/
-- `platform_fee`/`payment_operations` («Группа E», `11-database-schema.md` строки 812-928) —
-- `platform_billing_invoices` физически НЕ существует НИ В ОДНОЙ миграции этой ветки (проверено
-- `grep -rn "platform_billing_invoices" apps/`). Таблица принадлежит «Группе»
-- REQ-MON-6/9/10 (`11-database-schema.md` строки 1341-1365, «43. platform_billing_invoices») —
-- отдельному разделу идеализированного канонического DDL (`0014_platform.sql` в разделе
-- «Миграции» документа), которого ни один предыдущий тикет ЭТОЙ ветки не реализовал. Этот тикет
-- (DTJ-251) — ПЕРВЫЙ реальный потребитель таблицы (`CashCommissionAggregationJob` не может
-- работать без неё) — тот же класс необходимого расширения, что DTJ-247 добавил
-- `ix_escrow_ledger_created_at` за пределы буквального `files_owned`, только крупнее по объёму
-- (целая таблица, не индекс).
--
-- DDL — 1:1 транскрипция `11-database-schema.md` строки 209-213 (enum'ы `billing_invoice_type`/
-- `billing_invoice_status`) и строки 1341-1365 (таблица), С ОДНИМ добавлением сверх
-- канонического DDL:
--
-- `CONSTRAINT uq_billing_invoices_chain_type_period UNIQUE (chain_id, invoice_type,
-- period_start)` — канонический DDL НЕ определяет эту уникальность, но `PgCashCommission
-- AggregationAdapter.upsertDraftSubtotal` (apps/worker) физически требует `ON CONFLICT` на
-- ЭТИХ трёх колонках, чтобы ежедневный прогон добавлял к СУЩЕСТВУЮЩЕМУ draft-инвойсу периода,
-- а не создавал дубликат строки на каждый день недели (буквальный текст тикета «Что сделать»
-- п.1: «upsert строку... за ТЕКУЩИЙ расчётный период»). Естественный бизнес-ключ цикла
-- агрегации — тот же класс обоснованного расширения канонического DDL, что PAYOUT_SCHEDULE
-- индекс DTJ-249 (см. `0037_payout_schedule_status_index.sql`).
--
-- Идемпотентность (правило 11 AGENTS.md): `CREATE TYPE` обёрнут в `DO $$ ... EXCEPTION WHEN
-- duplicate_object THEN NULL; END $$;` (тот же приём, что `0029_payments.sql`). `CREATE TABLE
-- IF NOT EXISTS` идемпотентна нативно.
-- =====================================================================================

DO $$ BEGIN
  CREATE TYPE "billing_invoice_type" AS ENUM ('cash_courier_commission', 'whitelabel_license', 'whitelabel_royalty');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "billing_invoice_status" AS ENUM ('draft', 'issued', 'paid', 'overdue', 'void');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================================================
-- 43. platform_billing_invoices [РАСШИРЕНИЕ REQ-MON-6/9/10 — B2B-биллинг]
-- =====================================================================================
CREATE TABLE IF NOT EXISTS platform_billing_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID NOT NULL REFERENCES pharmacy_chains(id) ON DELETE RESTRICT,
    invoice_type billing_invoice_type NOT NULL,
    status billing_invoice_status NOT NULL DEFAULT 'draft',
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    subtotal_diram BIGINT NOT NULL, -- сумма до НДС
    vat_diram BIGINT NOT NULL DEFAULT 0, -- REQ-MON-9: НДС 14% отдельной строкой
    total_diram BIGINT NOT NULL, -- subtotal + vat
    issued_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ, -- issued_at + net-7 (08-1 §ОВ.5)
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_billing_invoices_total_matches CHECK (total_diram = subtotal_diram + vat_diram),
    CONSTRAINT chk_billing_invoices_period CHECK (period_end > period_start),
    -- ДОБАВЛЕНО сверх канонического DDL (см. комментарий файла выше) — бизнес-ключ upsert'а.
    CONSTRAINT uq_billing_invoices_chain_type_period UNIQUE (chain_id, invoice_type, period_start)
);
COMMENT ON TABLE platform_billing_invoices IS
    'PlatformBillingInvoice aggregate (REQ-MON-6): ежедневная агрегация delivered-заказов '
    'cash_courier сети в draft, конец периода (неделя) -> issued, due_at = +7 дней. Просрочка сверх '
    'due_at+grace_period -> авто-блокировка приёма заказов ВСЕЙ сети (REQ-MON-7, is_active=false на '
    'pharmacy_chains), снятие — только super_admin.';

-- =====================================================================================
-- Индекс запроса CashCommissionAggregationJob (DTJ-251) — та же логика, что ix_payout_
-- schedule_status (DTJ-249, 0037): без него ежедневный скан `orders` по (payment_method,
-- status, delivered_at) — full table scan на РАСТУЩЕЙ таблице, притом «ЕДИНСТВЕННЫЙ реальный
-- источник дохода платформы» (буквальный текст «Задача» тикета) — ошибка агрегации из-за
-- деградации производительности здесь прямо бьёт по выручке. Partial-индекс (не полный) —
-- запрос джобы фильтрует ИМЕННО по этим трём предикатам одновременно (буквальный текст «Что
-- сделать» п.2.1), тот же приём, что `outbox_pending_created_at_idx`/`ix_pharmacy_inventory_
-- medicine_instock` (0005/0019 — partial-индексы под конкретный WHERE, уже применяемый приём
-- в этой кодовой базе).
-- =====================================================================================
CREATE INDEX IF NOT EXISTS ix_orders_cash_delivered ON orders (delivered_at)
    WHERE payment_method = 'cash_courier' AND status = 'delivered' AND deleted_at IS NULL;
