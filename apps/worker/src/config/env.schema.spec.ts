import { describe, expect, it } from 'vitest'
import { validateWorkerEnv } from './env.schema.js'

const VALID_ENV = {
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/dorutj',
}

describe('validateWorkerEnv', () => {
  it('принимает валидный набор ENV и подставляет дефолты WORKER_HEALTH_PORT/LOG_LEVEL', () => {
    const result = validateWorkerEnv(VALID_ENV)

    expect(result.REDIS_URL).toBe(VALID_ENV.REDIS_URL)
    expect(result.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL)
    expect(result.WORKER_HEALTH_PORT).toBe(3001)
    expect(result.LOG_LEVEL).toBe('info')
    expect(result.API_INTERNAL_URL).toBe('http://localhost:3000')
    expect(result.MOCK_BANK_WEBHOOK_SECRET).toBeUndefined()
  })

  it('DTJ-238: уважает явно заданные API_INTERNAL_URL/MOCK_BANK_WEBHOOK_SECRET', () => {
    const result = validateWorkerEnv({
      ...VALID_ENV,
      API_INTERNAL_URL: 'http://api:3000',
      MOCK_BANK_WEBHOOK_SECRET: 'test-secret',
    })

    expect(result.API_INTERNAL_URL).toBe('http://api:3000')
    expect(result.MOCK_BANK_WEBHOOK_SECRET).toBe('test-secret')
  })

  it('DTJ-238: бросает на невалидный API_INTERNAL_URL', () => {
    expect(() => validateWorkerEnv({ ...VALID_ENV, API_INTERNAL_URL: 'not-a-url' })).toThrow(/API_INTERNAL_URL/)
  })

  it('уважает явно заданные WORKER_HEALTH_PORT и LOG_LEVEL', () => {
    const result = validateWorkerEnv({ ...VALID_ENV, WORKER_HEALTH_PORT: '4000', LOG_LEVEL: 'debug' })

    expect(result.WORKER_HEALTH_PORT).toBe(4000)
    expect(result.LOG_LEVEL).toBe('debug')
  })

  it('бросает, когда REDIS_URL не задан (AC4 DTJ-002)', () => {
    const { REDIS_URL: _omit, ...withoutRedis } = VALID_ENV
    expect(() => validateWorkerEnv(withoutRedis)).toThrow(/REDIS_URL/)
  })

  it('бросает, когда REDIS_URL не является валидным URL', () => {
    expect(() => validateWorkerEnv({ ...VALID_ENV, REDIS_URL: 'not-a-url' })).toThrow()
  })

  it('бросает, когда DATABASE_URL не задан', () => {
    const { DATABASE_URL: _omit, ...withoutDb } = VALID_ENV
    expect(() => validateWorkerEnv(withoutDb)).toThrow(/DATABASE_URL/)
  })

  it('бросает на неизвестное значение LOG_LEVEL', () => {
    expect(() => validateWorkerEnv({ ...VALID_ENV, LOG_LEVEL: 'verbose' })).toThrow()
  })
})
