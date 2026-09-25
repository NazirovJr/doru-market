import type { GeoPoint } from '@/shared-kernel/index.js'

export const PHARMACY_LOOKUP_PORT = Symbol.for('@dorutj/delivery/pharmacy-lookup-port')

export interface PharmacyLocation {
  readonly id: string
  readonly name: string
  readonly addressText: string
  readonly geoPoint: GeoPoint
  readonly chainId: string | null
}

// pharmacies не имеет фасада — прецедент DrizzlePharmacyChainLookupAdapter (payments, DTJ-252).
export interface PharmacyLookupPort {
  findById(pharmacyId: string): Promise<PharmacyLocation | null>
}
