import { describe, expect, it, vi } from 'vitest'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import type { SlaWatchdogQueuePort } from '@/modules/orders/application/ports/sla-watchdog-queue.port.js'
import { ScheduleSlaWatchdogUseCase } from './schedule-sla-watchdog.use-case.js'

const TENANT_ID = 'tenant-1'
const ORDER_ID = 'order-1'

function makeHarness(slaMinutes: number, bufferMinutes: number) {
  const schedule = vi.fn<SlaWatchdogQueuePort['schedule']>().mockResolvedValue(undefined)
  const getPickupSlaMinutes = vi.fn<TenancyFacadePort['getPickupSlaMinutes']>().mockResolvedValue(slaMinutes)
  const getPickupSlaBufferMinutes = vi.fn<TenancyFacadePort['getPickupSlaBufferMinutes']>().mockResolvedValue(bufferMinutes)
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn(),
    getPickupSlaMinutes,
    getPickupSlaBufferMinutes,
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
    getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
    getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
  }
  const useCase = new ScheduleSlaWatchdogUseCase(tenancyFacade, { schedule })
  return { useCase, schedule, getPickupSlaMinutes, getPickupSlaBufferMinutes }
}

describe('ScheduleSlaWatchdogUseCase (DTJ-307, D-19)', () => {
  it('дефолты 7 и 5 → schedule вызван ровно с { orderId, tenantId, softDelayMinutes: 7, hardDelayMinutes: 12 }', async () => {
    const { useCase, schedule, getPickupSlaMinutes, getPickupSlaBufferMinutes } = makeHarness(7, 5)

    await useCase.execute({ orderId: ORDER_ID, tenantId: TENANT_ID })

    expect(getPickupSlaMinutes).toHaveBeenCalledWith(TENANT_ID)
    expect(getPickupSlaBufferMinutes).toHaveBeenCalledWith(TENANT_ID)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      tenantId: TENANT_ID,
      softDelayMinutes: 7,
      hardDelayMinutes: 12, // 7 + 5
    })
  })

  it('настройки тенанта 10 и 3 → softDelayMinutes: 10, hardDelayMinutes: 13 (значения из tenant_settings, не константы)', async () => {
    const { useCase, schedule, getPickupSlaMinutes, getPickupSlaBufferMinutes } = makeHarness(10, 3)

    await useCase.execute({ orderId: ORDER_ID, tenantId: TENANT_ID })

    expect(getPickupSlaMinutes).toHaveBeenCalledWith(TENANT_ID)
    expect(getPickupSlaBufferMinutes).toHaveBeenCalledWith(TENANT_ID)
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(schedule).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      tenantId: TENANT_ID,
      softDelayMinutes: 10,
      hardDelayMinutes: 13, // 10 + 3
    })
  })

  it('оба геттера вызваны с TENANT_ID', async () => {
    const { useCase, schedule, getPickupSlaMinutes, getPickupSlaBufferMinutes } = makeHarness(7, 5)

    await useCase.execute({ orderId: ORDER_ID, tenantId: TENANT_ID })

    expect(getPickupSlaMinutes).toHaveBeenCalledWith(TENANT_ID)
    expect(getPickupSlaBufferMinutes).toHaveBeenCalledWith(TENANT_ID)
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('schedule бросает new Error("redis down") → execute отклоняется с этой ошибкой (не глотает)', async () => {
    const { useCase, schedule } = makeHarness(7, 5)
    schedule.mockRejectedValue(new Error('redis down'))

    await expect(useCase.execute({ orderId: ORDER_ID, tenantId: TENANT_ID })).rejects.toThrow('redis down')
    expect(schedule).toHaveBeenCalledTimes(1)
  })
})