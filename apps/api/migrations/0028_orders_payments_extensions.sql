-- =====================================================================================
-- 0028_orders_payments_extensions.sql — EP-09 (DTJ-228), эволюционная миграция ПОСЛЕ
-- 0023_orders_cart.sql (D-EP09-33, ADR утверждён CTO — reports/EP09-CTO-BRIEF.md).
-- =====================================================================================
-- Номер файла: тикет называл `0020_orders_payments_extensions.sql` — устарело, `0020` занят
-- волной 4 (0020_inventory_sync_errors.sql). CTO изначально называл `0025` (D-EP09-33), но к
-- моменту создания файла `0026` (DTJ-226) и `0027_orders_cash_never_escrow` (CTO, D-25 —
-- защита на уровне схемы) уже заняли следующие номера — CTO переназначил на `0028`, сверено
-- `ls apps/api/migrations/` непосредственно перед созданием файла (правило «номер миграции
-- сверять с каталогом» соблюдено).
--
-- `orders.billing_strategy` — снэпшот стратегии биллинга НА МОМЕНТ checkout (SRS-DOM-162,
-- SRS-RET-009): возврат (EP-11, вне периметра этого тикета) читает ЭТУ колонку, а не
-- пересчитывает флаг тенанта задним числом — тенант мог поменять настройку ПОСЛЕ оформления
-- заказа, а история платежа обязана остаться неизменной.
--
-- Колонка аддитивна: `NOT NULL DEFAULT 'single_invoice'` не требует backfill, откат тривиален
-- (см. .down.sql). CHECK держит оба значения канонического домена (SRS-RET-009), НЕ только то,
-- что реально достижимо в R1 — снэпшот обязан уметь ХРАНИТЬ обе стратегии, даже если
-- `ResolveBillingStrategyService` в этой волне резолвит исключительно 'single_invoice'
-- (D-EP09-33: 'split_items_delivery' физически недостижима без `payment_operations.
-- billing_component`/`tenant_settings.useSplitBilling`, оба — EP-10, TODO(DTJ-242/244)).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS billing_strategy VARCHAR(20) NOT NULL DEFAULT 'single_invoice';

DO $$ BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT chk_orders_billing_strategy_values
      CHECK (billing_strategy IN ('single_invoice', 'split_items_delivery'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN orders.billing_strategy IS
    'SRS-DOM-162/SRS-RET-009: снэпшот стратегии биллинга на момент checkout (DTJ-228). '
    'R1 — ResolveBillingStrategyService резолвит ИСКЛЮЧИТЕЛЬНО single_invoice (D-EP09-33, ADR '
    'утверждён): split_items_delivery недостижима без payment_operations.billing_component и '
    'tenant_settings.useSplitBilling (оба — EP-10, TODO(DTJ-242/244)). Колонка хранит оба '
    'значения домена уже сейчас, чтобы возврат (EP-11) не потребовал ещё одной миграции схемы.';
