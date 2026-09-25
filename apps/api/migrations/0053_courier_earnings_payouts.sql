-- courier_payouts + courier_earnings (EP-13, DTJ-321). Renumbered 0044 -> 0053 on transfer to development.
-- Idempotent: CREATE TYPE guarded by duplicate_object, CREATE TABLE/INDEX use IF NOT EXISTS.

DO $$ BEGIN
  CREATE TYPE "courier_payout_batch_status" AS ENUM ('draft', 'issued', 'paid', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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

COMMENT ON TABLE courier_payouts IS 'Батч физической выплаты курьеру платформенного пула (REQ-COUR-6). Read-only в DTJ-321, генерация батчей вне периметра.';

CREATE INDEX IF NOT EXISTS ix_courier_payouts_courier ON courier_payouts (courier_id, created_at DESC);

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

COMMENT ON TABLE courier_earnings IS 'Признаётся в момент delivered (REQ-COUR-5), только для platform_pool курьеров. Read-only в DTJ-321.';

CREATE INDEX IF NOT EXISTS ix_courier_earnings_courier_unpaid
    ON courier_earnings (courier_id, recognized_at)
    WHERE payout_batch_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_courier_earnings_courier ON courier_earnings (courier_id, recognized_at DESC);
