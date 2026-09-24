import type { GeoPoint } from '@/shared-kernel/index.js'
import type { CourierSourcingMode } from '@/modules/tenancy/index.js'

export const COURIER_CANDIDATE_PORT = Symbol.for('@dorutj/delivery/courier-candidate-port')

export interface CourierCandidateQuery {
  readonly pharmacyGeoPoint: GeoPoint
  readonly pharmacyChainId: string | null
  readonly requiresColdChain: boolean
  readonly courierSourcingMode: CourierSourcingMode
  readonly radiusKm: number
  readonly maxConcurrentAssignments: number
  readonly locationStaleMinutes: number
}

export interface CourierCandidate {
  readonly courierId: string
  readonly courierChainId: string | null
  readonly coldChainCertified: boolean
  readonly ratingAvg: number
  readonly activeAssignmentsCount: number
  readonly distanceMeters: number
}

export interface CourierCandidatePort {
  findEligibleCandidates(query: CourierCandidateQuery): Promise<readonly CourierCandidate[]>
}
