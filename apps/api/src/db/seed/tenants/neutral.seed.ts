/**
 * Seed нейтрального тенанта (DTJ-051, п.6).
 *
 * `DoruTJ` — единственный литерал бренда, разрешённый в кодовой базе вне
 * `packages/i18n`/тестовых фикстур (SRS-TEN-017, обоснование тикета DTJ-051).
 * Это seed-данные, не исполняемый UI-код.
 *
 * `customDomain = NULL` для нейтрального тенанта (демо-домен `sifat.dorutj.local`
 * относится к демо White-Label тенанту, заводится отдельно после DTJ-057).
 */
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

// Валидный UUID v4: `TenantId.from()` валидирует вход через `uuid.validate()`, и
// нулевой version-ниббл (`0000-0000-...`, как было раньше) её не проходит — Postgres
// такое значение принимает, а домен на чтении бросает ValidationError. Тот же id
// зашит в `migrations/0021_seed_neutral_tenant.sql` — значения обязаны совпадать.
const NEUTRAL_TENANT_ID = '00000000-0000-4000-8000-000000000001'
const BRAND_NAME = 'DoruTJ'

/** Дефолты per-tenant SLA/лимитов для нейтрального тенанта. Должны совпадать с
 * дефолтами в `apps/api/src/db/schema/tenants.ts` (там это `default(...)` на колонках). */
const SEED_COD_LIMIT_DIRAM = 50000
const SEED_HOLD_PERIOD_DAYS = 1
const SEED_PICKUP_SLA_MINUTES = 7
const SEED_PICKUP_SLA_BUFFER_MINUTES = 5
const SEED_DELIVERY_SLA_CITY_MINUTES = 240
const SEED_DELIVERY_SLA_REMOTE_MINUTES = 1440
const SEED_DISPUTE_WINDOW_HOURS = 24
const SEED_INVENTORY_DELTA_SLA_MINUTES = 5
const SEED_RETURN_RESTOCK_MIN_REMAINING_DAYS = 30

const NEUTRAL_PALETTE_JSON = JSON.stringify({
  '--brand-primary': '#64748b',
  '--brand-primary-hover': '#475569',
  '--brand-secondary': '#94a3b8',
  '--brand-accent': '#0ea5e9',
  '--brand-bg': '#ffffff',
  '--brand-surface': '#f8fafc',
  '--brand-text': '#0f172a',
  '--brand-text-muted': '#64748b',
  '--brand-border': '#e2e8f0',
  '--brand-success': '#16a34a',
  '--brand-danger': '#dc2626',
  '--brand-warning': '#d97706',
  '--brand-radius': '8px',
  '--brand-font-family': 'system-ui, sans-serif',
})

export async function seedNeutralTenant(db: NodePgDatabase): Promise<void> {
  // Idempotent upsert (SRS-DB-037): `ON CONFLICT (id) DO NOTHING` гарантирует,
  // что повторный `pnpm db:seed` не дублирует строку.
  await db.execute(
    /* sql */ `
      INSERT INTO tenants (id, slug, is_neutral, courier_sourcing_mode, custom_domain_status)
      VALUES ('${NEUTRAL_TENANT_ID}', 'neutral', true, 'platform_pool', 'none')
      ON CONFLICT (id) DO NOTHING;
    `,
  )

  await db.execute(
    /* sql */ `
      INSERT INTO tenant_settings (
        tenant_id, brand_name, brand_palette, default_locale,
        cod_limit_diram, hold_period_days, pickup_sla_minutes, pickup_sla_buffer_minutes,
        delivery_sla_city_minutes, delivery_sla_remote_minutes, dispute_window_hours,
        inventory_delta_sla_minutes, return_restock_min_remaining_days
      )
      VALUES (
        '${NEUTRAL_TENANT_ID}', '${BRAND_NAME}', '${NEUTRAL_PALETTE_JSON}', 'tj',
        ${String(SEED_COD_LIMIT_DIRAM)}, ${String(SEED_HOLD_PERIOD_DAYS)}, ${String(SEED_PICKUP_SLA_MINUTES)}, ${String(SEED_PICKUP_SLA_BUFFER_MINUTES)},
        ${String(SEED_DELIVERY_SLA_CITY_MINUTES)}, ${String(SEED_DELIVERY_SLA_REMOTE_MINUTES)}, ${String(SEED_DISPUTE_WINDOW_HOURS)},
        ${String(SEED_INVENTORY_DELTA_SLA_MINUTES)}, ${String(SEED_RETURN_RESTOCK_MIN_REMAINING_DAYS)}
      )
      ON CONFLICT (tenant_id) DO NOTHING;
    `,
  )
}
