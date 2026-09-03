/**
 * AC3 DTJ-239 — независимость ДВУХ уровней защиты банковской оплаты: `PAYMENT_DRIVER`
 * (DI-переключатель адаптера, этот тикет) и `tenant_settings.enabledPaymentMethods`
 * (`PaymentMethodEnabledPolicyService`, DTJ-229). Given `PAYMENT_DRIVER=alif_mobi` реально
 * установлен в процессе (не мок значения), When `enabledPaymentMethods` тенанта НЕ содержит
 * `'alif_mobi'` (R1-дефолт), Then `isEnabled('alif_mobi', ...)` всё равно `false` —
 * `PaymentMethodEnabledPolicyService`/`TenancyFacadeAdapter` (модуль `orders`, DTJ-229) не
 * читают `PAYMENT_DRIVER` вовсе, поэтому смена ENV не может случайно обойти этот гейт.
 *
 * Не `arch:check`-нарушение: правило `no-cross-module-deep-import` матчит только
 * `apps/(api|worker)/src/modules/**`, `test/**` исключён из анализа depcruise целиком (тот же
 * приём, что остальные `test/integration/**`, которым для сборки сквозного сценария нужны
 * внутренности НЕСКОЛЬКИХ модулей).
 */
import { describe, expect, it } from 'vitest'
import type { TenantSettingsRepositoryPort } from '@/modules/tenancy/index.js'
import { TenancyFacadeAdapter } from '@/modules/orders/infrastructure/adapters/tenancy-facade.adapter.js'
import { PaymentMethodEnabledPolicyService } from '@/modules/orders/application/policies/payment-method-enabled-policy.service.js'

describe('AC3 DTJ-239 — PAYMENT_DRIVER не влияет на tenant_settings.enabledPaymentMethods', () => {
  it('PAYMENT_DRIVER=alif_mobi выставлен реально в process.env — политика тенанта всё равно отклоняет alif_mobi', async () => {
    const originalDriver = process.env.PAYMENT_DRIVER
    process.env.PAYMENT_DRIVER = 'alif_mobi'
    try {
      // getEnabledPaymentMethods() — константа R1-дефолта, репозиторий не вызывается вовсе
      // (см. JSDoc TenancyFacadeAdapter) — заглушка ниже никогда не вызывается, если это
      // изменится (реальное чтение из tenant_settings), тест упадёт на неожиданном вызове,
      // а не молча пройдёт с ложным результатом.
      const neverCalledRepository: TenantSettingsRepositoryPort = {
        findByTenantId: () => {
          throw new Error('unexpected call — getEnabledPaymentMethods must not read the repository (R1 constant default)')
        },
        save: () => {
          throw new Error('unexpected call — this test never persists tenant settings')
        },
      }
      const tenancyFacade = new TenancyFacadeAdapter(neverCalledRepository)
      const policy = new PaymentMethodEnabledPolicyService(tenancyFacade)

      await expect(policy.isEnabled('alif_mobi', 'tenant-1')).resolves.toBe(false)
      await expect(policy.isEnabled('cash_courier', 'tenant-1')).resolves.toBe(true)
    } finally {
      if (originalDriver === undefined) {
        delete process.env.PAYMENT_DRIVER
      } else {
        process.env.PAYMENT_DRIVER = originalDriver
      }
    }
  })
})
