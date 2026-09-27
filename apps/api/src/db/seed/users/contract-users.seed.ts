// Seed пользователей контракта (SEED_USERS, DTJ-435) + couriers для роли courier.
// VerifyOtpUseCase.resolveUser() ищет по телефону ПЕРЕД созданием нового — существующая роль сохраняется в JWT.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { SEED_CHAINS, SEED_PHARMACIES, SEED_TENANTS, SEED_USERS, type SeedUser } from '@dorutj/testing-kit'

const COURIER_ROLE = 'courier'

const DISPLAY_NAMES: Readonly<Record<keyof typeof SEED_USERS, string>> = {
  customer1: 'Клиент Один',
  customer2: 'Клиент Два',
  customerWhiteLabel: 'Клиент Sifat',
  pharmacistOneC: 'Фармацевт Сино Фарм',
  pharmacistExcel: 'Фармацевт Ватан Дору',
  pharmacistWhiteLabel: 'Фармацевт Sifat',
  pharmacyAdminOneC: 'Админ сети Сино Фарм',
  pharmacyAdminExcel: 'Админ сети Ватан Дору',
  pharmacyAdminWhiteLabel: 'Админ сети Sifat',
  courier1: 'Курьер Один',
  courier2: 'Курьер Два',
  superAdmin1: 'Супер-админ Один',
  superAdmin2: 'Супер-админ Два',
  support1: 'Оператор поддержки Один',
  support2: 'Оператор поддержки Два',
}

function resolveTenantId(user: SeedUser): string {
  return SEED_TENANTS[user.tenant].id
}

function resolveChainId(user: SeedUser): string | null {
  return user.chain !== undefined ? SEED_CHAINS[user.chain].id : null
}

function resolvePharmacyId(user: SeedUser): string | null {
  return user.pharmacy !== undefined ? SEED_PHARMACIES[user.pharmacy].id : null
}

async function insertUsers(db: NodePgDatabase): Promise<void> {
  const entries = Object.entries(SEED_USERS) as [keyof typeof SEED_USERS, SeedUser][]
  await Promise.all(
    entries.map(([key, user]) =>
      db.execute(sql`
        INSERT INTO users (id, tenant_id, phone_number, role, full_name, pharmacy_id, chain_id, preferred_locale, is_active)
        VALUES (${user.id}, ${resolveTenantId(user)}, ${user.phone}, ${user.role}, ${DISPLAY_NAMES[key]}, ${resolvePharmacyId(user)}, ${resolveChainId(user)}, 'ru', true)
        ON CONFLICT (id) DO NOTHING;
      `),
    ),
  )
}

// Детерминированный id строки couriers, производный от id пользователя (нужен orders/all-statuses.seed.ts для delivery_assignments.courier_id).
export function courierRowId(userId: string): string {
  return `2${userId.slice(1)}`
}

async function insertCouriers(db: NodePgDatabase): Promise<void> {
  const courierUsers = Object.values(SEED_USERS).filter((u): u is SeedUser => u.role === COURIER_ROLE)
  await Promise.all(
    courierUsers.map((user) =>
      db.execute(sql`
        INSERT INTO couriers (id, user_id, chain_id, status, tax_status, vehicle_type, cold_chain_certified, shift_status)
        VALUES (${courierRowId(user.id)}, ${user.id}, ${resolveChainId(user)}, 'active', 'individual_patent', 'moped', true, 'on_shift')
        ON CONFLICT (id) DO NOTHING;
      `),
    ),
  )
}

export async function seedContractUsers(db: NodePgDatabase): Promise<void> {
  await insertUsers(db)
  await insertCouriers(db)
}
