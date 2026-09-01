-- =============================================================================
-- 0008_onboarding_foundation.sql — EP-03 (DTJ-063)
-- =============================================================================
-- Фундаментальные таблицы EP-03 «Онбординг сети/аптеки»:
--   • `pharmacy_chains` (SRS-DOM-047) — юрлицо-владелец 1..N аптек
--   • `pharmacies` (SRS-DOM-047..050) — операционная точка
--   • `pharmacy_verification` (D-22, REQ-ONBOARD-1) — состояние верификации
--     (одна активная запись на субъект — точку ИЛИ юрлицо)
--   • `onboarding_review_log` (REQ-ONBOARD-7) — append-only журнал решений
--
-- Базовые DDL — 1:1 по `11-database-schema.md` Группа A §1–2 + Группа I
-- §38–39, плюс дополнения `27-module-admin-moderation-onboarding.md` §10.1
-- (review_reason, revoked_at, revoked_reason, revoked_by).
--
-- FK на `tenants` (pharmacy_chains.tenant_id) отложена в 0015_deferred_fks.sql —
-- в EP-01 миграции tenants ещё не созданы на этом шаге.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. pharmacy_chains
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacy_chains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_entity_name VARCHAR(255) NOT NULL,
    tin_inn VARCHAR(20) NOT NULL UNIQUE,
    logo_url TEXT,
    is_whitelabel_active BOOLEAN DEFAULT false,
    custom_domain VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    legal_address TEXT,
    registration_certificate_url TEXT,
    director_full_name VARCHAR(255),
    contact_phone VARCHAR(20),
    bank_account_ref TEXT,
    payout_merchant_ref TEXT,
    is_whitelabel_requested BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    tenant_id UUID,
    submitted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    contact_phone_verified BOOLEAN NOT NULL DEFAULT false
);

COMMENT ON TABLE pharmacy_chains IS
    'EP-03, DTJ-063. Юрлицо-владелец 1..N аптек (SRS-DOM-047). Соло-аптека без сети '
    'заводится той же парой сущностей (REQ-ONBOARD-2).';
COMMENT ON COLUMN pharmacy_chains.status IS
    'chain_onboarding_status: draft->pending_review->(changes_requested)->approved->active->'
    '(suspended|terminated). approved->active — автоматический переход при первой active pharmacies (REQ-ONBOARD-9).';
COMMENT ON COLUMN pharmacy_chains.tin_inn IS
    'ИНН юрлица. Повторная заявка тем же tin_inn после rejected переиспользует запись (REQ-ONBOARD-19), не создаёт дубликат.';

CREATE INDEX IF NOT EXISTS ix_pharmacy_chains_status ON pharmacy_chains (status);
CREATE INDEX IF NOT EXISTS ix_pharmacy_chains_tenant ON pharmacy_chains (tenant_id)
    WHERE tenant_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. pharmacies
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address_text TEXT NOT NULL,
    landmark_tj TEXT,
    latitude NUMERIC(10, 8) NOT NULL,
    longitude NUMERIC(11, 8) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    is_24_7 BOOLEAN DEFAULT false,
    opening_time TIME,
    closing_time TIME,
    one_c_endpoint TEXT,
    is_active BOOLEAN DEFAULT true,
    license_number VARCHAR(100),
    license_issuing_authority VARCHAR(255),
    license_issue_date DATE,
    license_expiry_date DATE,
    license_scan_url TEXT,
    pharmacist_in_charge_name VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    suspension_reason VARCHAR(32),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE pharmacies IS
    'EP-03, DTJ-063. Операционная точка (PharmacyAccount aggregate). status не может стать '
    'active, если родительская pharmacy_chains.status не в {approved,active} (SRS-DOM-048).';
COMMENT ON COLUMN pharmacies.license_expiry_date IS
    'Ежедневный скан (30/14/3 дня) эскалирует уведомления; по достижении даты — автоматический '
    'suspended(license_expired) без участия человека (REQ-ONBOARD-16).';

CREATE INDEX IF NOT EXISTS ix_pharmacies_chain_status ON pharmacies (chain_id, status);
CREATE INDEX IF NOT EXISTS ix_pharmacies_license_expiry ON pharmacies (license_expiry_date)
    WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- 3. pharmacy_verification (D-22, Группа I §38 + дополнения §10.1)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pharmacy_verification (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE,
    verification_status VARCHAR(32) NOT NULL DEFAULT 'not_started',
    checklist_snapshot JSONB,
    submitted_at TIMESTAMPTZ,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    sla_target_at TIMESTAMPTZ,
    review_reason VARCHAR(30) NOT NULL DEFAULT 'initial',
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    revoked_by UUID,
    CONSTRAINT chk_pharmacy_verification_one_subject
        CHECK ((pharmacy_id IS NOT NULL AND chain_id IS NULL)
            OR (pharmacy_id IS NULL AND chain_id IS NOT NULL))
);

COMMENT ON TABLE pharmacy_verification IS
    'EP-03, DTJ-063 (D-22, REQ-ONBOARD-1). Текущее СОСТОЯНИЕ верификации — одна активная '
    'запись на субъект проверки (точку ИЛИ юрлицо). Полная история — в '
    'onboarding_review_log (append-only). review_reason отличает первичную заявку от '
    'address_change/reactivation (SRS-ADM-012).';
COMMENT ON COLUMN pharmacy_verification.review_reason IS
    'SRS-ADM-012: initial|address_change|reactivation.';

-- -----------------------------------------------------------------------------
-- 4. onboarding_review_log (REQ-ONBOARD-7, Группа I §39)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onboarding_review_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE CASCADE,
    chain_id UUID REFERENCES pharmacy_chains(id) ON DELETE CASCADE,
    action VARCHAR(30) NOT NULL,
    actor_user_id UUID NOT NULL,
    reason TEXT,
    checklist_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_onboarding_log_one_subject
        CHECK ((pharmacy_id IS NOT NULL) OR (chain_id IS NOT NULL))
);

COMMENT ON TABLE onboarding_review_log IS
    'EP-03, DTJ-063 (REQ-ONBOARD-7). Append-only журнал решений super_admin. Включая '
    'автоматические (license_expired auto-suspend, actor_user_id=система).';

CREATE INDEX IF NOT EXISTS ix_onboarding_review_log_pharmacy
    ON onboarding_review_log (pharmacy_id) WHERE pharmacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_onboarding_review_log_chain
    ON onboarding_review_log (chain_id) WHERE chain_id IS NOT NULL;
