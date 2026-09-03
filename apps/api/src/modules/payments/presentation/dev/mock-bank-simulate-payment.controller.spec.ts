/**
 * Unit-тесты `MockBankSimulatePaymentController` (EP-10, DTJ-238, AC3/DoD). Проверяет ОБА
 * рубежа защиты дев-эндпоинта напрямую на уровне обработчика (guard `MockBankDevAccessGuard`
 * не экспортирован — тот же приём, что `ApiDocsAccessGuard`/`openapi.module.ts`; наблюдаемое
 * поведение handler'а идентично тому, что произвело бы срабатывание guard'а, framework-перевод
 * `NotFoundException → HTTP 404` — гарантия самого Nest, не предмет этого теста).
 */
import type { ConfigService } from '@nestjs/config'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import type { MockBankProvider } from '@/modules/payments/infrastructure/adapters/mock-bank.provider.js'
import { MockBankSimulatePaymentController } from './mock-bank-simulate-payment.controller.js'

function fakeConfig(overrides: Partial<Pick<EnvConfig, 'NODE_ENV' | 'PAYMENT_DRIVER'>>): AppConfigService {
  const env: Partial<EnvConfig> = { NODE_ENV: 'development', PAYMENT_DRIVER: 'mock_bank', ...overrides }
  const configService = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

function fakeProvider(simulateWebhook: ReturnType<typeof vi.fn>): MockBankProvider {
  return { simulateWebhook } as unknown as MockBankProvider
}

describe('MockBankSimulatePaymentController (DTJ-238)', () => {
  it('AC3: NODE_ENV=production → NotFoundException (404), провайдер НЕ вызывается', async () => {
    const simulateWebhook = vi.fn()
    const controller = new MockBankSimulatePaymentController(fakeConfig({ NODE_ENV: 'production' }), fakeProvider(simulateWebhook))

    await expect(controller.simulatePayment({ providerRef: 'mock_inv_x', outcome: 'paid' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(simulateWebhook).not.toHaveBeenCalled()
  })

  it('PAYMENT_DRIVER != mock_bank → NotFoundException (404), даже вне production', async () => {
    const simulateWebhook = vi.fn()
    const controller = new MockBankSimulatePaymentController(
      fakeConfig({ NODE_ENV: 'development', PAYMENT_DRIVER: 'alif_mobi' }),
      fakeProvider(simulateWebhook),
    )

    await expect(controller.simulatePayment({ providerRef: 'mock_inv_x', outcome: 'paid' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('development + mock_bank + тело валидно → делегирует MockBankProvider.simulateWebhook, возвращает {triggered:true}', async () => {
    const simulateWebhook = vi.fn().mockResolvedValue({ ok: true, value: undefined })
    const controller = new MockBankSimulatePaymentController(fakeConfig({}), fakeProvider(simulateWebhook))

    const result = await controller.simulatePayment({ providerRef: 'mock_inv_x', outcome: 'paid' })

    expect(result).toEqual({ triggered: true })
    expect(simulateWebhook).toHaveBeenCalledWith('mock_inv_x', 'paid')
  })

  it('тело без providerRef → BadRequestException, провайдер НЕ вызывается', async () => {
    const simulateWebhook = vi.fn()
    const controller = new MockBankSimulatePaymentController(fakeConfig({}), fakeProvider(simulateWebhook))

    await expect(controller.simulatePayment({ outcome: 'paid' })).rejects.toBeInstanceOf(BadRequestException)
    expect(simulateWebhook).not.toHaveBeenCalled()
  })

  it('outcome вне {"paid","failed"} → BadRequestException', async () => {
    const controller = new MockBankSimulatePaymentController(fakeConfig({}), fakeProvider(vi.fn()))

    await expect(
      controller.simulatePayment({ providerRef: 'mock_inv_x', outcome: 'refunded' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('неизвестный providerRef (Err от провайдера) → NotFoundException', async () => {
    const simulateWebhook = vi
      .fn()
      .mockResolvedValue({ ok: false, error: { code: 'PROVIDER_REF_NOT_FOUND', message: 'unknown providerRef' } })
    const controller = new MockBankSimulatePaymentController(fakeConfig({}), fakeProvider(simulateWebhook))

    await expect(controller.simulatePayment({ providerRef: 'mock_inv_missing', outcome: 'paid' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
