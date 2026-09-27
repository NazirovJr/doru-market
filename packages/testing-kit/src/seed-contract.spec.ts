import { describe, expect, it } from 'vitest'
import { SEED_CHAINS, SEED_PHARMACIES, SEED_TENANTS, SEED_USERS, SEED_ANALOG_CLUSTER, E2E_FRESH_PHONE_PREFIX } from './seed-contract.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const TJ_PHONE_RE = /^\+992\d{9}$/u
const ROLES = ['customer', 'pharmacist', 'courier', 'pharmacy_admin', 'super_admin', 'support_agent'] as const
const MIN_USERS_PER_ROLE = 2

const users = Object.values(SEED_USERS)
const allIds = [
  ...Object.values(SEED_TENANTS).map((t) => t.id),
  ...Object.values(SEED_CHAINS).map((c) => c.id),
  ...Object.values(SEED_PHARMACIES).map((p) => p.id),
  ...users.map((u) => u.id),
]

describe('seed-contract', () => {
  it('все идентификаторы — валидные UUID v4 и не повторяются', () => {
    for (const id of allIds) expect(id).toMatch(UUID_RE)
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('телефоны пользователей уникальны и в формате +992XXXXXXXXX, не пересекаются с префиксом «новых» номеров', () => {
    const phones = users.map((u) => u.phone)
    expect(new Set(phones).size).toBe(phones.length)
    for (const phone of phones) {
      expect(phone).toMatch(TJ_PHONE_RE)
      expect(phone.startsWith(E2E_FRESH_PHONE_PREFIX)).toBe(false)
    }
  })

  it('каждая роль представлена минимум двумя пользователями', () => {
    for (const role of ROLES) {
      expect(users.filter((u) => u.role === role).length).toBeGreaterThanOrEqual(MIN_USERS_PER_ROLE)
    }
  })

  it('ссылки на тенант/сеть/аптеку ведут на существующие записи контракта и согласованы по тенанту', () => {
    for (const chain of Object.values(SEED_CHAINS)) expect(SEED_TENANTS[chain.tenant]).toBeDefined()
    for (const pharmacy of Object.values(SEED_PHARMACIES)) {
      if (pharmacy.chain !== null) expect(SEED_CHAINS[pharmacy.chain]).toBeDefined()
    }
    for (const user of users) {
      if ('chain' in user) expect(SEED_CHAINS[user.chain].tenant).toBe(user.tenant)
      if ('pharmacy' in user) expect(SEED_PHARMACIES[user.pharmacy].chain).toBe(user.chain)
    }
  })

  it('кластер аналогов: референт не совпадает с дженериками, дженериков не меньше двух', () => {
    expect(SEED_ANALOG_CLUSTER.genericTradeNames.length).toBeGreaterThanOrEqual(2)
    expect(SEED_ANALOG_CLUSTER.genericTradeNames).not.toContain(SEED_ANALOG_CLUSTER.referenceTradeName)
  })
})
