// Общий контракт `pnpm db:seed` (DTJ-435) и E2E-сценариев: сид создаёт ровно эти сущности, спеки ищут их здесь.
export const SEED_TENANTS = {
  neutral: { id: '00000000-0000-4000-8000-000000000001', slug: 'neutral' },
  whiteLabel: { id: 'e0000000-0000-4000-8000-00000000a001', slug: 'sifat', host: 'sifat.dorutj.local' },
} as const

export const SEED_CHAINS = {
  oneC: { id: 'e0000000-0000-4000-8000-00000000c001', tenant: 'neutral', channel: '1c' },
  excel: { id: 'e0000000-0000-4000-8000-00000000c002', tenant: 'neutral', channel: 'excel' },
  manual: { id: 'e0000000-0000-4000-8000-00000000c003', tenant: 'neutral', channel: 'manual' },
  whiteLabel: { id: 'e0000000-0000-4000-8000-00000000c004', tenant: 'whiteLabel', channel: 'excel' },
} as const

export const SEED_PHARMACIES = {
  oneCCenter: { id: 'e0000000-0000-4000-8000-00000000d001', chain: 'oneC' },
  excelCenter: { id: 'e0000000-0000-4000-8000-00000000d002', chain: 'excel' },
  solo: { id: 'e0000000-0000-4000-8000-00000000d003', chain: null },
  whiteLabelCenter: { id: 'e0000000-0000-4000-8000-00000000d004', chain: 'whiteLabel' },
} as const

export type SeedRole = 'customer' | 'pharmacist' | 'courier' | 'pharmacy_admin' | 'super_admin' | 'support_agent'

export interface SeedUser {
  readonly id: string
  readonly phone: string
  readonly role: SeedRole
  readonly tenant: keyof typeof SEED_TENANTS
  readonly chain?: keyof typeof SEED_CHAINS
  readonly pharmacy?: keyof typeof SEED_PHARMACIES
}

export const SEED_USERS = {
  customer1: { id: 'e0000000-0000-4000-8000-00000000e101', phone: '+992900000101', role: 'customer', tenant: 'neutral' },
  customer2: { id: 'e0000000-0000-4000-8000-00000000e102', phone: '+992900000102', role: 'customer', tenant: 'neutral' },
  customerWhiteLabel: { id: 'e0000000-0000-4000-8000-00000000e103', phone: '+992900000103', role: 'customer', tenant: 'whiteLabel' },
  pharmacistOneC: { id: 'e0000000-0000-4000-8000-00000000e201', phone: '+992900000201', role: 'pharmacist', tenant: 'neutral', chain: 'oneC', pharmacy: 'oneCCenter' },
  pharmacistExcel: { id: 'e0000000-0000-4000-8000-00000000e202', phone: '+992900000202', role: 'pharmacist', tenant: 'neutral', chain: 'excel', pharmacy: 'excelCenter' },
  pharmacistWhiteLabel: { id: 'e0000000-0000-4000-8000-00000000e203', phone: '+992900000203', role: 'pharmacist', tenant: 'whiteLabel', chain: 'whiteLabel', pharmacy: 'whiteLabelCenter' },
  pharmacyAdminOneC: { id: 'e0000000-0000-4000-8000-00000000e301', phone: '+992900000301', role: 'pharmacy_admin', tenant: 'neutral', chain: 'oneC' },
  pharmacyAdminExcel: { id: 'e0000000-0000-4000-8000-00000000e302', phone: '+992900000302', role: 'pharmacy_admin', tenant: 'neutral', chain: 'excel' },
  pharmacyAdminWhiteLabel: { id: 'e0000000-0000-4000-8000-00000000e303', phone: '+992900000303', role: 'pharmacy_admin', tenant: 'whiteLabel', chain: 'whiteLabel' },
  courier1: { id: 'e0000000-0000-4000-8000-00000000e401', phone: '+992900000401', role: 'courier', tenant: 'neutral' },
  courier2: { id: 'e0000000-0000-4000-8000-00000000e402', phone: '+992900000402', role: 'courier', tenant: 'neutral' },
  superAdmin1: { id: 'e0000000-0000-4000-8000-00000000e501', phone: '+992900000501', role: 'super_admin', tenant: 'neutral' },
  superAdmin2: { id: 'e0000000-0000-4000-8000-00000000e502', phone: '+992900000502', role: 'super_admin', tenant: 'neutral' },
  support1: { id: 'e0000000-0000-4000-8000-00000000e601', phone: '+992900000601', role: 'support_agent', tenant: 'neutral' },
  support2: { id: 'e0000000-0000-4000-8000-00000000e602', phone: '+992900000602', role: 'support_agent', tenant: 'neutral' },
} as const satisfies Record<string, SeedUser>

// Кластер аналогов CUJ-1: референт дороже дженериков, все в наличии в oneCCenter и excelCenter.
export const SEED_ANALOG_CLUSTER = {
  innName: 'Парацетамол',
  referenceTradeName: 'Парацетамол 500 мг Sanofi',
  genericTradeNames: ['Парацетамол 500 мг Фармстандарт', 'Парацетамол 500 мг Хумофарм'],
} as const

// Номер для сценариев «нового» пользователя, которого сид НЕ создаёт; у каждого тикета своя сотня.
export const E2E_FRESH_PHONE_PREFIX = '+9929100'
