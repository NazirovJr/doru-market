-- =====================================================================================
-- 0047_feature_flags.sql — EP-15 (DTJ-352), таблица feature_flags (SRS-ADM-028).
-- DDL — ДОСЛОВНО docs/spec/27-module-admin-moderation-onboarding.md §10.1.
--
-- ПЕРЕНОМЕРОВАНО при слиянии в development: изначально создана как `0046_feature_flags.sql`
-- (следующий свободный номер на момент разработки ветки), но `0046` параллельно занял
-- feat/dtj-374-audit-log (`0046_audit_log_revoke_update_delete.sql`), смёрженный первым —
-- координатор переномеровал эту миграцию в `0047` при слиянии (тот же приём, что DTJ-280 →
-- `0045_support_ticket_last_escalated_at.sql`).
--
-- Обычная транзакционная миграция (CREATE TABLE, не ALTER TYPE) — SRS-DB-009 здесь
-- неприменим (DoD DTJ-352 п.6).
--
-- Идемпотентность (правило 11 AGENTS.md): CREATE TABLE IF NOT EXISTS, COMMENT ON —
-- идемпотентны нативно.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key VARCHAR(100) NOT NULL,
    scope VARCHAR(10) NOT NULL DEFAULT 'global',
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    rollout_percentage SMALLINT NOT NULL DEFAULT 100,
    description TEXT,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_feature_flags_scope_tenant CHECK (
        (scope = 'global' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL)
    ),
    CONSTRAINT chk_feature_flags_rollout_range CHECK (rollout_percentage BETWEEN 0 AND 100),
    CONSTRAINT uq_feature_flags_key_scope UNIQUE (flag_key, scope, tenant_id)
);

COMMENT ON TABLE feature_flags IS
    'SRS-ADM-028. Резолвинг: per-tenant запись переопределяет global той же flag_key (та же логика '
    'специфичности, что platform_fee, без дат действия). Обязательный R1-флаг '
    'prescription_ocr_pipeline_enabled гейтит R2-4 (04-SCOPE-DECISION §4).';
