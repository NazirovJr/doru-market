import { describe, expect, it } from 'vitest'
import { PLATFORM_SETTINGS_KEY_NAMES } from '@dorutj/contracts'
import { GetPlatformSettingsUseCase } from './get-platform-settings.use-case.js'
import type { AppConfigService } from '@/config/app-config.service.js'

/** Плоские значения геттеров — НЕ типизировано как `AppConfigService` до каста в `asConfig`, иначе спред ловит `@typescript-eslint/no-misused-spread` (спред «класса»). */
interface FakeConfigValues {
  rateLimitAnonPerMin: number
  rateLimitUserPerMin: number
  rateLimit1cBatchPerMin: number
  paymentProviderTimeoutMs: number
  requestTimeoutMs: number
  otpRequestCooldownSeconds: number
  otpRequestMaxPer10Min: number
  otpRequestMaxPerDay: number
  otpRequestMaxPerIpPerHour: number
  otpVerifyMaxAttempts: number
  searchQueryTimeoutMs: number
  cartHoldTtlSeconds: number
  excelImportMaxRows: number
  bankInvoiceValidityMinutes: number
  apiKeyRotationGracePeriodHours: number
}

const BASE_CONFIG_VALUES: FakeConfigValues = {
  rateLimitAnonPerMin: 111,
  rateLimitUserPerMin: 222,
  rateLimit1cBatchPerMin: 33,
  paymentProviderTimeoutMs: 8_000,
  requestTimeoutMs: 30_000,
  otpRequestCooldownSeconds: 60,
  otpRequestMaxPer10Min: 3,
  otpRequestMaxPerDay: 10,
  otpRequestMaxPerIpPerHour: 20,
  otpVerifyMaxAttempts: 5,
  searchQueryTimeoutMs: 2_000,
  cartHoldTtlSeconds: 900,
  excelImportMaxRows: 20_000,
  bankInvoiceValidityMinutes: 15,
  apiKeyRotationGracePeriodHours: 24,
}

function asConfig(values: FakeConfigValues): AppConfigService {
  return values as unknown as AppConfigService
}

// Секретные ENV (см. `env.schema.ts`) — ни один НЕ обязан появиться в whitelist (риск тикета).
const SENSITIVE_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'MOCK_BANK_WEBHOOK_SECRET',
  'ALIF_MOBI_API_TOKEN',
  'ALIF_MOBI_WEBHOOK_SECRET',
  'DC_NEXT_API_TOKEN',
  'DC_NEXT_WEBHOOK_SECRET',
  'INTERNAL_API_KEY',
  'TELEGRAM_BOT_TOKEN_NEUTRAL',
]

describe('GetPlatformSettingsUseCase (admin, DTJ-360)', () => {
  it('возвращает ровно PLATFORM_SETTINGS_KEY_NAMES, значения — из AppConfigService', () => {
    const useCase = new GetPlatformSettingsUseCase(asConfig(BASE_CONFIG_VALUES))

    const result = useCase.execute()

    expect(result).toHaveLength(PLATFORM_SETTINGS_KEY_NAMES.length)
    expect(result.map((entry) => entry.key)).toEqual([...PLATFORM_SETTINGS_KEY_NAMES])
  })

  it('АС1 — currentValue отражает актуальное значение AppConfigService, читает при КАЖДОМ вызове (не кеширует)', () => {
    const values: FakeConfigValues = { ...BASE_CONFIG_VALUES, rateLimitAnonPerMin: 100 }
    const useCase = new GetPlatformSettingsUseCase(asConfig(values))

    const first = useCase.execute().find((entry) => entry.key === 'RATE_LIMIT_ANON_PER_MIN')
    expect(first?.currentValue).toBe('100')

    values.rateLimitAnonPerMin = 999
    const second = useCase.execute().find((entry) => entry.key === 'RATE_LIMIT_ANON_PER_MIN')
    expect(second?.currentValue).toBe('999')
  })

  it('АС2 — КАЖДАЯ запись сериализуется с requiresRedeploy: true, ни одна не пропущена (проверка через JSON, как увидит клиент)', () => {
    const useCase = new GetPlatformSettingsUseCase(asConfig(BASE_CONFIG_VALUES))

    const serialized = JSON.parse(JSON.stringify(useCase.execute())) as readonly Record<string, unknown>[]

    expect(serialized).toHaveLength(PLATFORM_SETTINGS_KEY_NAMES.length)
    expect(serialized.every((entry) => entry.requiresRedeploy === true)).toBe(true)
  })

  it('негативный тест на утечку секрета — ни один ключ whitelist не совпадает с секретным ENV', () => {
    const keys = [...PLATFORM_SETTINGS_KEY_NAMES]

    for (const sensitiveKey of SENSITIVE_ENV_KEYS) {
      expect(keys).not.toContain(sensitiveKey)
    }
    expect(keys.some((key) => key.endsWith('_SECRET') || key.endsWith('_TOKEN') || key.endsWith('_KEY') || key.endsWith('_URL'))).toBe(false)
  })

  it('descriptionKey каждой записи — непустая строка (i18n-ключ, не хардкод текста)', () => {
    const useCase = new GetPlatformSettingsUseCase(asConfig(BASE_CONFIG_VALUES))

    const result = useCase.execute()

    expect(result.every((entry) => entry.descriptionKey.length > 0)).toBe(true)
  })
})
