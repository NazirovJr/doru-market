import { describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { GeoPoint } from '@/shared-kernel/index.js'
import type { BuildCourierCandidateQueryService, AssignmentContext } from './build-courier-candidate-query.service.js'
import type { CalculateDeliveryFeeUseCase } from '../use-cases/calculate-delivery-fee.use-case.js'
import type { SuggestNearestCourierUseCase } from '../use-cases/suggest-nearest-courier.use-case.js'
import { ReturnTripService } from './return-trip.service.js'

const TENANT_ID = 'tenant-1'
const ORDER_ID = 'order-1'

function point(lat: number, lon: number): GeoPoint {
  const result = GeoPoint.create(lat, lon)
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

const PHARMACY_POINT = point(38.57, 68.78)
const CUSTOMER_POINT = point(38.58, 68.79)

function makeContext(overrides: { tenantId?: string; deliveryGeoPoint?: GeoPoint | null } = {}): AssignmentContext {
  return {
    order: {
      orderId: ORDER_ID,
      tenantId: overrides.tenantId ?? TENANT_ID,
      deliveryGeoPoint: overrides.deliveryGeoPoint === undefined ? CUSTOMER_POINT : overrides.deliveryGeoPoint,
    },
    pharmacy: { id: 'pharmacy-1', name: 'P', addressText: 'A', geoPoint: PHARMACY_POINT, chainId: null },
    requiresColdChain: false,
    candidateQuery: { tenantId: TENANT_ID, pharmacyChainId: null, pharmacyGeoPoint: PHARMACY_POINT, requiresColdChain: false },
  } as unknown as AssignmentContext
}

function makeService(context: AssignmentContext, candidates: readonly { courierId: string }[] = []) {
  const executeForReturn = vi.fn().mockResolvedValue(4200n)
  const service = new ReturnTripService(
    { execute: vi.fn().mockResolvedValue(context) } as unknown as BuildCourierCandidateQueryService,
    { execute: vi.fn().mockResolvedValue(candidates) } as unknown as SuggestNearestCourierUseCase,
    { executeForReturn } as unknown as CalculateDeliveryFeeUseCase,
  )
  return { service, executeForReturn }
}

describe('ReturnTripService', () => {
  it('calculateReturnFee: тарифицирует маршрут аптека -> клиент', async () => {
    const { service, executeForReturn } = makeService(makeContext())
    expect(await service.calculateReturnFee({ tenantId: TENANT_ID, orderId: ORDER_ID })).toBe(4200n)
    expect(executeForReturn).toHaveBeenCalledWith({ tenantId: TENANT_ID, pharmacyGeoPoint: PHARMACY_POINT, customerGeoPoint: CUSTOMER_POINT })
  })

  it('calculateReturnFee: без координат клиента берёт точку аптеки (нулевая дистанция)', async () => {
    const { service, executeForReturn } = makeService(makeContext({ deliveryGeoPoint: null }))
    await service.calculateReturnFee({ tenantId: TENANT_ID, orderId: ORDER_ID })
    expect(executeForReturn).toHaveBeenCalledWith(expect.objectContaining({ customerGeoPoint: PHARMACY_POINT }))
  })

  it('чужой тенант -> NotFoundError, тариф не считается', async () => {
    const { service, executeForReturn } = makeService(makeContext({ tenantId: 'other-tenant' }))
    await expect(service.calculateReturnFee({ tenantId: TENANT_ID, orderId: ORDER_ID })).rejects.toBeInstanceOf(NotFoundError)
    expect(executeForReturn).not.toHaveBeenCalled()
  })

  it('suggestReturnCourier: возвращает лучшего кандидата', async () => {
    const { service } = makeService(makeContext(), [{ courierId: 'c-1' }, { courierId: 'c-2' }])
    expect(await service.suggestReturnCourier({ tenantId: TENANT_ID, orderId: ORDER_ID })).toEqual({ courierId: 'c-1', etaMinutes: null })
  })

  it('suggestReturnCourier: нет подходящих курьеров -> null', async () => {
    const { service } = makeService(makeContext(), [])
    expect(await service.suggestReturnCourier({ tenantId: TENANT_ID, orderId: ORDER_ID })).toBeNull()
  })
})
