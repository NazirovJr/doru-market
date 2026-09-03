import { describe, expect, it } from 'vitest'
import { validateEnv } from '@/config/env.schema'

const VALID_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/dorutj',
  REDIS_URL: 'redis://localhost:6379',
  CORS_STATIC_ORIGINS: 'http://localhost:5173,https://dorutj.com',
}

describe('validateEnv', () => {
  it('принимает валидный конфиг и применяет дефолты', () => {
    const config = validateEnv(VALID_ENV)
    expect(config.PORT).toBe(3000)
    expect(config.REQUEST_TIMEOUT_MS).toBe(30_000)
    expect(config.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL)
    expect(config.LOG_LEVEL).toBeUndefined()
    expect(config.PAYMENT_DRIVER).toBe('mock_bank')
    expect(config.MOCK_BANK_AUTO_PAY_DELAY_MS).toBe(2_000)
    expect(config.MOCK_BANK_WEBHOOK_SECRET).toBeUndefined()
  })

  it('DTJ-238: PAYMENT_DRIVER отвергает значение вне допустимого набора', () => {
    expect(() => validateEnv({ ...VALID_ENV, PAYMENT_DRIVER: 'sberbank' })).toThrow(/PAYMENT_DRIVER/)
  })

  it('DTJ-238: MOCK_BANK_AUTO_PAY_DELAY_MS=0 — допустимо (авто-вебхук выключен)', () => {
    const config = validateEnv({ ...VALID_ENV, MOCK_BANK_AUTO_PAY_DELAY_MS: '0' })
    expect(config.MOCK_BANK_AUTO_PAY_DELAY_MS).toBe(0)
  })

  it('принимает явно заданный LOG_LEVEL из допустимого набора', () => {
    const config = validateEnv({ ...VALID_ENV, LOG_LEVEL: 'warn' })
    expect(config.LOG_LEVEL).toBe('warn')
  })

  it('бросает понятную ошибку при отсутствии DATABASE_URL — процесс не должен стартовать', () => {
    const { DATABASE_URL: _DATABASE_URL, ...withoutDatabaseUrl } = VALID_ENV
    expect(() => validateEnv(withoutDatabaseUrl)).toThrow(/DATABASE_URL/)
  })

  it('бросает ошибку при невалидном DATABASE_URL (не URL-формат)', () => {
    expect(() => validateEnv({ ...VALID_ENV, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/)
  })

  it('бросает ошибку при отсутствии REDIS_URL', () => {
    const { REDIS_URL: _REDIS_URL, ...withoutRedisUrl } = VALID_ENV
    expect(() => validateEnv(withoutRedisUrl)).toThrow(/REDIS_URL/)
  })

  it('бросает ошибку при отсутствии CORS_STATIC_ORIGINS (SRS-API-065)', () => {
    const { CORS_STATIC_ORIGINS: _CORS_STATIC_ORIGINS, ...rest } = VALID_ENV
    expect(() => validateEnv(rest)).toThrow(/CORS_STATIC_ORIGINS/)
  })

  it('бросает ошибку при недопустимом NODE_ENV', () => {
    expect(() => validateEnv({ ...VALID_ENV, NODE_ENV: 'staging' })).toThrow()
  })
})
