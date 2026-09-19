/**
 * `PaymentMethodEnabledPolicyService` (EP-09, DTJ-229) — unit-набор: включённый/выключенный
 * метод, «деградация» при недоступном поле — на уровне ЭТОЙ policy деградация не видна
 * (единая точка — `TenancyFacadeAdapter`, см. JSDoc сервиса): тест мока подтверждает, что
 * policy честно передаёт РЕЗУЛЬТАТ порта, включая R1-дефолт `['cash_courier']`.
 */
import { describe, expect, it, vi } from 'vitest'
import type { OrderPaymentMethod } from '@dorutj/contracts'
import type { TenancyFacadePort } from '@/modules/orders/application/ports/tenancy-facade.port.js'
import { PaymentMethodEnabledPolicyService } from './payment-method-enabled-policy.service.js'

const TENANT_ID = 'tenant-1'

function makeService(enabled: readonly OrderPaymentMethod[]): PaymentMethodEnabledPolicyService {
  const tenancyFacade: TenancyFacadePort = {
    resolveCommissionRate: vi.fn(),
    getCodLimitDiram: vi.fn(),
    getEnabledPaymentMethods: vi.fn().mockResolvedValue(enabled),
    getPickupSlaMinutes: vi.fn(),
    getPartialFulfillmentConfirmationTimeoutMinutes: vi.fn(),
    getHandoverOtpMaxRegenerationsPerOrder: vi.fn(),
    getHandoverOtpRegenerateMinIntervalSeconds: vi.fn(),
  }
  return new PaymentMethodEnabledPolicyService(tenancyFacade)
}

describe('PaymentMethodEnabledPolicyService (DTJ-229)', () => {
  it('AC3 — R1-дефолт [cash_courier]: cash_courier → true', async () => {
    const service = makeService(['cash_courier'])
    await expect(service.isEnabled('cash_courier', TENANT_ID)).resolves.toBe(true)
  })

  it('AC3 — R1-дефолт [cash_courier]: alif_mobi → false (422 PAYMENT_METHOD_NOT_ENABLED у вызывающего)', async () => {
    const service = makeService(['cash_courier'])
    await expect(service.isEnabled('alif_mobi', TENANT_ID)).resolves.toBe(false)
  })

  it('метод в расширенном списке тенанта → true', async () => {
    const service = makeService(['cash_courier', 'alif_mobi', 'dc_next'])
    await expect(service.isEnabled('dc_next', TENANT_ID)).resolves.toBe(true)
  })

  it('пустой список разрешённых методов → любой метод false', async () => {
    const service = makeService([])
    await expect(service.isEnabled('cash_courier', TENANT_ID)).resolves.toBe(false)
  })
})
