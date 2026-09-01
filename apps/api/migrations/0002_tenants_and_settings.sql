-- =============================================================================
-- 0002_tenants_and_settings.sql — EP-02 (DTJ-051)
-- =============================================================================
-- Создаёт таблицы `tenants` и `tenant_settings` (Charter §3.4, D-01).
-- Полная DDL — 1:1 по `11-database-schema.md` Группа C §13–14 + дополнения
-- `26-module-tenancy-whitelabel.md` §12 п.1–3:
--   • `ux_tenants_single_chain` — один тенант на сеть (UNIQUE WHERE chain_id IS NOT NULL)
--   • `custom_domain_status`/`domain_verification_token` для DNS-верификации
--   • Поля брендинга/контактов (`brand_logo_square_url`, `brand_favicon_url`,
--     `support_phone`, `support_email`, `merchant_credentials_status`)
--   • `chk_tenants_neutral_has_no_chain` (SRS-DOM-042)
--   • `chk_tenants_domain_status` (SRS-TEN-035, согласованность домена и статуса)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. tenants
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(32) NOT NULL UNIQUE, -- TenantSlug VO: ^[a-z0-9-]{3,32}$
    chain_id UUID, -- FK на pharmacy_chains добавляется отдельной миграцией (см. README §3)
    custom_domain VARCHAR(255) UNIQUE,
    is_neutral BOOLEAN NOT NULL DEFAULT false,
    courier_sourcing_mode VARCHAR(32) NOT NULL DEFAULT 'platform_pool', -- own_fleet | platform_pool | hybrid
    custom_domain_status VARCHAR(32) NOT NULL DEFAULT 'none', -- none | pending_verification | verified
    domain_verification_token VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_tenants_neutral_has_no_chain CHECK (is_neutral = false OR chain_id IS NULL),
    CONSTRAINT chk_tenants_domain_status CHECK (
        (custom_domain IS NULL AND custom_domain_status = 'none')
        OR (custom_domain IS NOT NULL)
    )
);

COMMENT ON TABLE tenants IS
    'Tenant aggregate (EP-02, DTJ-050..062). Ровно одна строка slug=''neutral'', is_neutral=true, '
    'chain_id NULL (SRS-DOM-042) — обеспечивается частичным уникальным индексом '
    'ux_tenants_single_neutral. White-Label тенант ссылается на pharmacy_chains (D-01, Charter §3.4).';

-- Частичный уникальный индекс: ровно один нейтральный тенант.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_single_neutral
    ON tenants ((true))
    WHERE is_neutral = true;

-- Частичный уникальный индекс: один тенант на сеть (SRS-TEN-002 / §12 п.1).
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_single_chain
    ON tenants (chain_id)
    WHERE chain_id IS NOT NULL;

-- Вспомогательные индексы для резолвинга (DTJ-054).
CREATE INDEX IF NOT EXISTS ix_tenants_custom_domain
    ON tenants (custom_domain)
    WHERE custom_domain IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. tenant_settings (1:1 с tenants, ON DELETE CASCADE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    brand_name VARCHAR(255) NOT NULL, -- SRS-TEN-038: NOT NULL, без дефолта
    brand_logo_url TEXT,
    brand_logo_square_url TEXT, -- §12 п.2: PWA/Telegram-бот 512x512
    brand_favicon_url TEXT, -- §12 п.2: favicon + apple-touch-icon источник
    brand_palette JSONB NOT NULL DEFAULT '{}'::jsonb, -- CSS custom properties
    telegram_bot_username VARCHAR(64),
    telegram_bot_token_ref TEXT, -- ссылка в SecretsVaultPort (НЕ сам секрет)
    merchant_credentials_ref TEXT, -- ссылка в SecretsVaultPort
    merchant_credentials_status VARCHAR(20) NOT NULL DEFAULT 'not_configured', -- not_configured | configured
    support_phone VARCHAR(20), -- публичный саппорт (не KYB)
    support_email VARCHAR(255),
    cod_limit_diram BIGINT NOT NULL DEFAULT 50000, -- D-16, дефолт 500 TJS
    hold_period_days INT NOT NULL DEFAULT 1, -- D-19, T+1
    pickup_sla_minutes INT NOT NULL DEFAULT 7, -- D-19
    pickup_sla_buffer_minutes INT NOT NULL DEFAULT 5,
    delivery_sla_city_minutes INT NOT NULL DEFAULT 240, -- D-19, 4ч
    delivery_sla_remote_minutes INT NOT NULL DEFAULT 1440, -- D-19, 24ч
    dispute_window_hours INT NOT NULL DEFAULT 24,
    inventory_delta_sla_minutes INT NOT NULL DEFAULT 5, -- D-04
    return_restock_min_remaining_days INT NOT NULL DEFAULT 30, -- REQ-RET-3
    default_locale VARCHAR(5) NOT NULL DEFAULT 'tj',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_tenant_settings_sla_ranges CHECK (
        inventory_delta_sla_minutes BETWEEN 1 AND 15
        AND pickup_sla_minutes > 0
        AND cod_limit_diram >= 0
    )
);

COMMENT ON TABLE tenant_settings IS
    'TenantSettings value entity (1:1 с tenants) — брендинг + per-tenant SLA/лимиты. '
    'merchant_credentials_ref — НЕ сам секрет, а непрозрачная ссылка vault://tenants/{id}/... '
    'разрешаемая через SecretsVaultPort (DTJ-058).';
