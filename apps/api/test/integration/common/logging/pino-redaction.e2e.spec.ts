/** Явный `destination`-стрим вместо перехвата `process.stdout.write` — без него `pino()`
 * пишет синхронно напрямую в fd, минуя перехват. */
import { describe, expect, it } from 'vitest'
import { default as pino } from 'pino'
import { SENSITIVE_FIELD_NAMES } from '@dorutj/contracts'
import { buildPinoOptions } from '@/common/logging/root-logger'
import type { AppConfigService } from '@/config/app-config.service'

function fakeConfig(): AppConfigService {
  return { logLevel: 'info' } as unknown as AppConfigService
}

function createCapturingLogger(): { logger: pino.Logger; output: () => string } {
  const written: string[] = []
  const destination = { write: (chunk: string) => written.push(chunk) }
  const logger = pino(buildPinoOptions(fakeConfig()), destination)
  return { logger, output: () => written.join('') }
}

describe('pino redaction — ВСЕ SENSITIVE_FIELD_NAMES (DTJ-375, обобщение TC-ADM-017)', () => {
  it('ни одно секретное значение НИГДЕ не встречается в сериализованном выводе логгера (верхний уровень)', () => {
    const { logger, output } = createCapturingLogger()
    const secretValues = Object.fromEntries(
      SENSITIVE_FIELD_NAMES.map((field, index) => [field, `top-level-secret-${String(index)}`]),
    )

    logger.info({ ...secretValues, visibleField: 'not-a-secret' }, 'test log line')

    for (const value of Object.values(secretValues)) {
      expect(output()).not.toContain(value)
    }
    expect(output()).toContain('visibleField')
    expect(output()).toContain('not-a-secret')
  })

  it('ни одно секретное значение НИГДЕ не встречается в выводе, когда поле вложено на один уровень глубже', () => {
    const { logger, output } = createCapturingLogger()
    const secretValues = Object.fromEntries(
      SENSITIVE_FIELD_NAMES.map((field, index) => [field, `nested-secret-${String(index)}`]),
    )

    logger.info({ user: { ...secretValues }, visibleField: 'not-a-secret' }, 'test log line, nested one level')

    for (const value of Object.values(secretValues)) {
      expect(output()).not.toContain(value)
    }
    expect(output()).toContain('visibleField')
  })

  it('литеральный кейс TC-ADM-017 — hmacSecret не встречается в выводе', () => {
    const { logger, output } = createCapturingLogger()

    logger.info({ apiKey: 'ak_live_full_value', hmacSecret: 'hs_live_full_value' }, 'pharmacy api key created')

    expect(output()).not.toContain('ak_live_full_value')
    expect(output()).not.toContain('hs_live_full_value')
  })

  it('заголовки запроса (SRS-API-068) продолжают маскироваться — гостевая правка не сломала существующий рубеж', () => {
    const { logger, output } = createCapturingLogger()

    logger.info({ req: { headers: { authorization: 'Bearer secret-jwt-value' } } }, 'unaffected by DTJ-375')

    expect(output()).not.toContain('secret-jwt-value')
  })
})
