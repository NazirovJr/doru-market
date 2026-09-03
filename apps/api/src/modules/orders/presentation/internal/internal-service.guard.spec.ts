/**
 * `InternalServiceGuard` (EP-10, DTJ-253/254). `isValidInternalApiKey` — сравнение напрямую
 * (быстрее и точнее, чем гонять полный `ExecutionContext`); один сквозной тест `canActivate`
 * подтверждает, что guard реально ЗОВЁТ эту функцию с заголовком/ENV, а не просто существует.
 */
import type { ConfigService } from '@nestjs/config'
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { AppConfigService } from '@/config/app-config.service.js'
import type { EnvConfig } from '@/config/env.schema.js'
import { InternalServiceGuard, isValidInternalApiKey } from './internal-service.guard.js'

function fakeConfig(internalApiKey: string | undefined): AppConfigService {
  const configService = { get: () => internalApiKey } as unknown as ConfigService<EnvConfig, true>
  return new AppConfigService(configService)
}

function fakeContext(headerValue: string | undefined): ExecutionContext {
  const request = { headers: headerValue === undefined ? {} : { 'x-internal-api-key': headerValue } }
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext
}

describe('isValidInternalApiKey (DTJ-253/254)', () => {
  it('совпадающие непустые строки → true', () => {
    expect(isValidInternalApiKey('secret-1', 'secret-1')).toBe(true)
  })

  it('несовпадающие строки → false', () => {
    expect(isValidInternalApiKey('wrong', 'secret-1')).toBe(false)
  })

  it('заголовок не передан (undefined) → false', () => {
    expect(isValidInternalApiKey(undefined, 'secret-1')).toBe(false)
  })

  it('INTERNAL_API_KEY не настроен (undefined) → false, даже если заголовок совпал бы по значению "undefined"', () => {
    expect(isValidInternalApiKey('undefined', undefined)).toBe(false)
  })

  it('пустая строка заголовка → false (не совпадает с непустым секретом по длине буфера)', () => {
    expect(isValidInternalApiKey('', 'secret-1')).toBe(false)
  })

  it('строки разной длины → false (не бросает на timingSafeEqual с разными буферами)', () => {
    expect(isValidInternalApiKey('short', 'a-much-longer-secret-value')).toBe(false)
  })
})

describe('InternalServiceGuard.canActivate (DTJ-253/254)', () => {
  it('верный секрет в заголовке x-internal-api-key → true', () => {
    const guard = new InternalServiceGuard(fakeConfig('secret-1'))
    expect(guard.canActivate(fakeContext('secret-1'))).toBe(true)
  })

  it('неверный/отсутствующий секрет → бросает UnauthorizedException (401)', () => {
    const guard = new InternalServiceGuard(fakeConfig('secret-1'))
    expect(() => guard.canActivate(fakeContext(undefined))).toThrow(UnauthorizedException)
    expect(() => guard.canActivate(fakeContext('wrong'))).toThrow(UnauthorizedException)
  })
})
