import { describe, expect, it, vi } from 'vitest'
import { GeoPoint } from '@/shared-kernel/index.js'
import type { CourierCandidate, CourierCandidatePort, CourierCandidateQuery } from '../ports/courier-candidate.port.js'
import type { DeliveryTenancyPort } from '../ports/delivery-tenancy.port.js'
import { SuggestNearestCourierUseCase } from './suggest-nearest-courier.use-case.js'

const TENANT_ID = 'tenant-1'
const PHARMACY_CHAIN_ID = 'chain-1'
const PHARMACY_GEO_POINT = requireGeoPoint(38.5598, 68.787)

function requireGeoPoint(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!result.ok) throw result.error
  return result.value
}

function candidate(overrides: Partial<CourierCandidate> = {}): CourierCandidate {
  return {
    courierId: 'courier-1',
    courierChainId: null,
    coldChainCertified: false,
    ratingAvg: 5,
    activeAssignmentsCount: 0,
    distanceMeters: 1000,
    ...overrides,
  }
}

function makeUseCase(params: {
  readonly candidates: readonly CourierCandidate[]
  readonly sourcingMode?: 'own_fleet' | 'platform_pool' | 'hybrid'
}): { useCase: SuggestNearestCourierUseCase; findEligibleCandidates: ReturnType<typeof vi.fn> } {
  const findEligibleCandidates = vi.fn<(query: CourierCandidateQuery) => Promise<readonly CourierCandidate[]>>().mockResolvedValue(params.candidates)
  const candidatePort: CourierCandidatePort = { findEligibleCandidates }
  const tenancyPort: DeliveryTenancyPort = {
    getCourierSourcingMode: vi.fn().mockResolvedValue(params.sourcingMode ?? 'hybrid'),
  }
  return { useCase: new SuggestNearestCourierUseCase(candidatePort, tenancyPort), findEligibleCandidates }
}

function baseInput(overrides: { readonly pharmacyChainId?: string | null; readonly requiresColdChain?: boolean } = {}) {
  return {
    tenantId: TENANT_ID,
    pharmacyChainId: overrides.pharmacyChainId ?? PHARMACY_CHAIN_ID,
    pharmacyGeoPoint: PHARMACY_GEO_POINT,
    requiresColdChain: overrides.requiresColdChain ?? false,
  }
}

describe('SuggestNearestCourierUseCase', () => {
  it('TC-DELIV-034: считает totalScore по формуле и сортирует победителя первым', async () => {
    // A: 1км, загрузка 0, рейтинг 4.0 -> distanceScore=1-1/5=0.8, workload=1, rating=0.8
    //    total = 0.5*0.8 + 0.3*1 + 0.2*0.8 = 0.4+0.3+0.16 = 0.86
    // B: 0.5км, загрузка 1, рейтинг 5.0 -> distanceScore=1-0.5/5=0.9, workload=0.5, rating=1
    //    total = 0.5*0.9 + 0.3*0.5 + 0.2*1 = 0.45+0.15+0.2 = 0.8
    const a = candidate({ courierId: 'A', distanceMeters: 1000, activeAssignmentsCount: 0, ratingAvg: 4.0 })
    const b = candidate({ courierId: 'B', distanceMeters: 500, activeAssignmentsCount: 1, ratingAvg: 5.0 })
    const { useCase } = makeUseCase({ candidates: [b, a] })

    const result = await useCase.execute(baseInput())

    expect(result).toHaveLength(2)
    expect(result[0]?.courierId).toBe('A')
    expect(result[0]?.totalScore).toBeCloseTo(0.86, 10)
    expect(result[1]?.courierId).toBe('B')
    expect(result[1]?.totalScore).toBeCloseTo(0.8, 10)
  })

  it('TC-DELIV-035 (аналог off-shift): не восстанавливает кандидатов, которых порт не вернул', async () => {
    const { useCase } = makeUseCase({ candidates: [] })
    const result = await useCase.execute(baseInput())
    expect(result).toEqual([])
  })

  it('TC-DELIV-007 (для алгоритма): курьер чужого флота исключён из скоринга (own_fleet mode)', async () => {
    const foreignChainCourier = candidate({ courierId: 'foreign', courierChainId: 'chain-OTHER' })
    const { useCase } = makeUseCase({ candidates: [foreignChainCourier], sourcingMode: 'own_fleet' })
    const result = await useCase.execute(baseInput())
    expect(result).toEqual([])
  })

  it('own_fleet mode: исключает пуловых курьеров (chainId=null)', async () => {
    const poolCourier = candidate({ courierId: 'pool', courierChainId: null })
    const { useCase } = makeUseCase({ candidates: [poolCourier], sourcingMode: 'own_fleet' })
    expect(await useCase.execute(baseInput())).toEqual([])
  })

  it('own_fleet mode: включает курьера той же сети', async () => {
    const ownCourier = candidate({ courierId: 'own', courierChainId: PHARMACY_CHAIN_ID })
    const { useCase } = makeUseCase({ candidates: [ownCourier], sourcingMode: 'own_fleet' })
    const result = await useCase.execute(baseInput())
    expect(result.map((c) => c.courierId)).toEqual(['own'])
  })

  it('platform_pool mode: исключает курьеров с chainId (даже своей сети)', async () => {
    const ownCourier = candidate({ courierId: 'own', courierChainId: PHARMACY_CHAIN_ID })
    const { useCase } = makeUseCase({ candidates: [ownCourier], sourcingMode: 'platform_pool' })
    expect(await useCase.execute(baseInput())).toEqual([])
  })

  it('platform_pool mode: включает пуловых курьеров', async () => {
    const poolCourier = candidate({ courierId: 'pool', courierChainId: null })
    const { useCase } = makeUseCase({ candidates: [poolCourier], sourcingMode: 'platform_pool' })
    const result = await useCase.execute(baseInput())
    expect(result.map((c) => c.courierId)).toEqual(['pool'])
  })

  it('hybrid mode: включает и пул, и свою сеть, ранжирует own_fleet выше при равном score', async () => {
    const pool = candidate({ courierId: 'pool', courierChainId: null, distanceMeters: 1000, ratingAvg: 4, activeAssignmentsCount: 0 })
    const own = candidate({ courierId: 'own', courierChainId: PHARMACY_CHAIN_ID, distanceMeters: 1000, ratingAvg: 4, activeAssignmentsCount: 0 })
    const { useCase } = makeUseCase({ candidates: [pool, own], sourcingMode: 'hybrid' })
    const result = await useCase.execute(baseInput())
    expect(result).toHaveLength(2)
    expect(result[0]?.courierId).toBe('own')
  })

  it('hybrid mode: исключает курьера ЧУЖОЙ сети (не пул и не своя)', async () => {
    const foreign = candidate({ courierId: 'foreign', courierChainId: 'chain-OTHER' })
    const { useCase } = makeUseCase({ candidates: [foreign], sourcingMode: 'hybrid' })
    expect(await useCase.execute(baseInput())).toEqual([])
  })

  it('cold-chain guard: requiresColdChain=true исключает несертифицированного курьера', async () => {
    const notCertified = candidate({ courierId: 'c1', coldChainCertified: false })
    const { useCase } = makeUseCase({ candidates: [notCertified] })
    const result = await useCase.execute(baseInput({ requiresColdChain: true }))
    expect(result).toEqual([])
  })

  it('cold-chain guard: requiresColdChain=true пропускает сертифицированного курьера', async () => {
    const certified = candidate({ courierId: 'c1', coldChainCertified: true })
    const { useCase } = makeUseCase({ candidates: [certified] })
    const result = await useCase.execute(baseInput({ requiresColdChain: true }))
    expect(result.map((c) => c.courierId)).toEqual(['c1'])
  })

  it('cold-chain guard: requiresColdChain=false не требует сертификации', async () => {
    const notCertified = candidate({ courierId: 'c1', coldChainCertified: false })
    const { useCase } = makeUseCase({ candidates: [notCertified] })
    const result = await useCase.execute(baseInput({ requiresColdChain: false }))
    expect(result.map((c) => c.courierId)).toEqual(['c1'])
  })

  it('потолок нагрузки: курьер на пределе MAX_CONCURRENT_ASSIGNMENTS_PER_COURIER (дефолт 3) исключён', async () => {
    const atCapacity = candidate({ courierId: 'c1', activeAssignmentsCount: 3 })
    const { useCase } = makeUseCase({ candidates: [atCapacity] })
    expect(await useCase.execute(baseInput())).toEqual([])
  })

  it('потолок нагрузки: курьер ниже потолка допущен', async () => {
    const underCapacity = candidate({ courierId: 'c1', activeAssignmentsCount: 2 })
    const { useCase } = makeUseCase({ candidates: [underCapacity] })
    const result = await useCase.execute(baseInput())
    expect(result.map((c) => c.courierId)).toEqual(['c1'])
  })

  it('резолвит courierSourcingMode через DeliveryTenancyPort по tenantId из input', async () => {
    const { useCase, findEligibleCandidates } = makeUseCase({ candidates: [], sourcingMode: 'own_fleet' })
    await useCase.execute(baseInput())
    expect(findEligibleCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ courierSourcingMode: 'own_fleet', pharmacyChainId: PHARMACY_CHAIN_ID }),
    )
  })
})
