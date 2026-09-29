import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import type { AppConfigService } from '@/config/app-config.service.js'
import type { SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import { MockSmsProviderAdapter } from '@/modules/auth/infrastructure/adapters/mock-sms-provider.adapter.js'
import { PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number.vo.js'
import { E2eLastOtpController } from './e2e-last-otp.controller.js'

const PHONE_A = '+992900000001'
const PHONE_B = '+992900000002'

function config(enabled: boolean): AppConfigService {
  return { e2eTestEndpoints: enabled, isProduction: false, mockSmsExposeCodeInResponse: false } as AppConfigService
}

async function smsWithCodes(): Promise<MockSmsProviderAdapter> {
  const sms = new MockSmsProviderAdapter(config(true))
  await sms.sendOtp(PhoneNumber.parse(PHONE_A), '111111', 'login')
  await sms.sendOtp(PhoneNumber.parse(PHONE_B), '222222', 'login')
  return sms
}

describe('E2eLastOtpController', () => {
  it('отдаёт последний код именно запрошенного номера, а не последний вообще', async () => {
    const controller = new E2eLastOtpController(config(true), await smsWithCodes())
    expect(controller.lastOtp(PHONE_A)).toEqual({ data: { code: '111111' } })
    expect(controller.lastOtp(PHONE_B)).toEqual({ data: { code: '222222' } })
  })

  it('флаг выключен — 404, код не раскрывается', async () => {
    const controller = new E2eLastOtpController(config(false), await smsWithCodes())
    expect(() => controller.lastOtp(PHONE_A)).toThrow(NotFoundException)
  })

  it('номеру код не отправлялся или phone не передан — 404', async () => {
    const controller = new E2eLastOtpController(config(true), await smsWithCodes())
    expect(() => controller.lastOtp('+992900000009')).toThrow(NotFoundException)
    expect(() => controller.lastOtp(undefined)).toThrow(NotFoundException)
  })

  it('реальный SMS-провайдер без peekLastFor — 404 даже при включённом флаге', () => {
    const realSms: SmsProviderPort = { sendOtp: () => Promise.resolve() }
    const controller = new E2eLastOtpController(config(true), realSms)
    expect(() => controller.lastOtp(PHONE_A)).toThrow(NotFoundException)
  })
})
