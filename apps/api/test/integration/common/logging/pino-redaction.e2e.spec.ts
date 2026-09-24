/**
 * `pino`-редактор чувствительных полей (EP-16, DTJ-375, SRS-ADM-044) — интеграционный тест:
 * РЕАЛЬНЫЙ `pino`-логгер (`buildPinoOptions` — те же опции, что использует `createRootLogger`),
 * grep ВСЕГО сериализованного вывода. Обобщённая версия `TC-ADM-017` (DTJ-365 покрывал только
 * `apiKey`/`hmacSecret`) — здесь на ВСЕ поля `SENSITIVE_FIELD_NAMES` (`@dorutj/contracts`).
 *
 * НЕ требует Postgres/Redis (в отличие от соседних файлов `test/integration/common/audit/**`) —
 * запускается как обычный интеграционный тест этого пакета (`pnpm --filter @dorutj/api
 * test:integration`), реальной сети/БД не касается.
 *
 * `pino()` без явного `destination` создаёт СИНХРОННЫЙ `SonicBoom`, пишущий напрямую в файловый
 * дескриптор `1` (`fs.writeSync`), МИНУЯ `process.stdout.write` — перехват метода (приём
 * `http-logger.middleware.spec.ts` для `pino-http`) здесь НЕ работает. Вместо этого передаём
 * `pino()` явный `destination`-объект второй позиционной опцией — минимальный синхронный
 * writable, который `pino` поддерживает нативно для тестов (тот же приём, что тесты `pino`
 * upstream, см. `node_modules/pino/test/`).
 */
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
