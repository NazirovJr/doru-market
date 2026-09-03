import type { ConfigService } from '@nestjs/config'
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { PaymentsInternalServiceGuard } from './payments-internal-service.guard.js'

function fakeConfig(internalApiKey: string | undefined): AppConfigService {
  const configService = { get: () => internalApiKey } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

function fakeContext(headerValue: string | undefined): ExecutionContext {
  const request = { headers: headerValue === undefined ? {} : { 'x-internal-api-key': headerValue } }
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext
}

describe('PaymentsInternalServiceGuard (DTJ-244)', () => {
  it('верный секрет → true', () => {
    const guard = new PaymentsInternalServiceGuard(fakeConfig('secret-1'))
    expect(guard.canActivate(fakeContext('secret-1'))).toBe(true)
  })

  it('неверный/отсутствующий секрет → UnauthorizedException', () => {
    const guard = new PaymentsInternalServiceGuard(fakeConfig('secret-1'))
    expect(() => guard.canActivate(fakeContext(undefined))).toThrow(UnauthorizedException)
    expect(() => guard.canActivate(fakeContext('wrong'))).toThrow(UnauthorizedException)
  })
})
