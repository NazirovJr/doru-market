// Seed White-Label тенанта `sifat` + 4 сетей контракта DTJ-435 (packages/testing-kit/src/seed-contract.ts).
// Сети вставляются раньше тенанта: tenants.chain_id — FK на pharmacy_chains(id).
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { SEED_CHAINS, SEED_TENANTS } from '@dorutj/testing-kit'

const NEUTRAL_TENANT_ID = SEED_TENANTS.neutral.id
const WHITE_LABEL_TENANT_ID = SEED_TENANTS.whiteLabel.id
const WHITE_LABEL_HOST = SEED_TENANTS.whiteLabel.host

const WHITE_LABEL_PALETTE_JSON = JSON.stringify({
  '--brand-primary': '#0f766e',
  '--brand-primary-hover': '#115e59',
  '--brand-secondary': '#5eead4',
  '--brand-accent': '#f59e0b',
  '--brand-bg': '#ffffff',
  '--brand-surface': '#f0fdfa',
  '--brand-text': '#134e4a',
  '--brand-text-muted': '#5eead4',
  '--brand-border': '#99f6e4',
  '--brand-radius': '12px',
  '--brand-font-family': 'system-ui, sans-serif',
})

interface ChainSeed {
  readonly id: string
  readonly name: string
  readonly legalEntityName: string
  readonly tinInn: string
  readonly tenantId: string | null
}

const CHAIN_SEEDS: readonly ChainSeed[] = [
  { id: SEED_CHAINS.oneC.id, name: 'Сино Фарм (1С)', legalEntityName: 'ООО «Сино Фарм»', tinInn: '010012345671', tenantId: NEUTRAL_TENANT_ID },
  { id: SEED_CHAINS.excel.id, name: 'Ватан Дору (Excel)', legalEntityName: 'ООО «Ватан Дору»', tinInn: '010012345672', tenantId: NEUTRAL_TENANT_ID },
  { id: SEED_CHAINS.manual.id, name: 'Тибби Дорухона (ручной ввод)', legalEntityName: 'ООО «Тибби Дорухона»', tinInn: '010012345673', tenantId: NEUTRAL_TENANT_ID },
  { id: SEED_CHAINS.whiteLabel.id, name: 'Sifat Pharmacy', legalEntityName: 'ООО «Сифат Фарм»', tinInn: '010012345674', tenantId: WHITE_LABEL_TENANT_ID },
]

async function insertChains(db: NodePgDatabase): Promise<void> {
  await Promise.all(
    CHAIN_SEEDS.map((chain) =>
      db.execute(sql`
        INSERT INTO pharmacy_chains (id, name, legal_entity_name, tin_inn, status, tenant_id, is_whitelabel_active, contact_phone_verified)
        VALUES (${chain.id}, ${chain.name}, ${chain.legalEntityName}, ${chain.tinInn}, 'active', ${chain.tenantId}, ${chain.tenantId === WHITE_LABEL_TENANT_ID}, true)
        ON CONFLICT (id) DO NOTHING;
      `),
    ),
  )
}

async function insertWhiteLabelTenant(db: NodePgDatabase): Promise<void> {
  await db.execute(sql`
    INSERT INTO tenants (id, slug, chain_id, custom_domain, is_neutral, courier_sourcing_mode, custom_domain_status)
    VALUES (${WHITE_LABEL_TENANT_ID}, ${SEED_TENANTS.whiteLabel.slug}, ${SEED_CHAINS.whiteLabel.id}, ${WHITE_LABEL_HOST}, false, 'own_fleet', 'verified')
    ON CONFLICT (id) DO NOTHING;
  `)

  await db.execute(sql`
    INSERT INTO tenant_settings (tenant_id, brand_name, brand_palette, default_locale)
    VALUES (${WHITE_LABEL_TENANT_ID}, 'Sifat Pharmacy', ${WHITE_LABEL_PALETTE_JSON}::jsonb, 'ru')
    ON CONFLICT (tenant_id) DO NOTHING;
  `)
}

export async function seedWhiteLabelTenantAndChains(db: NodePgDatabase): Promise<void> {
  await insertChains(db)
  await insertWhiteLabelTenant(db)
}
