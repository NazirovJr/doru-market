/**
 * `log-pii-leakage.spec.ts` (DTJ-425, `TC-NFR-010`, `SRS-NFR-010`) — `POST /auth/otp/verify` с
 * `phone`/`code` в теле → структурный (JSON, pino) лог этого запроса захвачен через перехват
 * `process.stdout.write` (тот самый «тестовый лог-коллектор/перехват stdout», допустимый по
 * тикету «Риски и подводные камни» — в CI это тот же поток, что `docker compose logs api`).
 *
 * **Почему `createApp()` (полный `AppModule`), а не облегчённый `@apitest/.../test-app.js`
 * харнесс.** `HttpLoggerMiddleware` (`common/logging/http-logger.middleware.ts`, ЕДИНСТВЕННОЕ
 * место, которое автоматически пишет access-лог на каждый HTTP-запрос) подключается ТОЛЬКО в
 * `AppModule.configure()` (`apps/api/src/app.module.ts`) — облегчённые харнессы (`test/
 * integration/.../__tests__/test-app.ts`) строят `Test.createTestingModule` из ОТДЕЛЬНЫХ
 * фичевых модулей (`AuthModule` и т.п.), НЕ из `AppModule`, поэтому middleware НЕ применяется и
 * `capture.lines` оставался бы пустым (найдено живым прогоном при реализации, не выдумано
 * заранее) — только полный `createApp()` (тот же приём, что `rate-limiting.spec.ts`/DTJ-432's
 * `rate-limit.integration.spec.ts`) реально регистрирует middleware.
 *
 * **Реальное поведение — СИЛЬНЕЕ буквального AC5 тикета, не слабее.** Прочитан весь стек
 * логирования (`common/logging/root-logger.ts`, `http-logger.middleware.ts`,
 * `@dorutj/contracts`'s `sensitive-fields.ts`): access-лог строит запись ТОЛЬКО из
 * `customProps: { method, path, statusCode }` (плюс `requestId/tenantId/userId/role` через
 * `mixin`) — `serializers: { req: () => undefined, res: () => undefined }` явно подавляет
 * сериализацию `req`/`res`, тело запроса (`phone`/`code`) НЕ СЕРИАЛИЗУЕТСЯ В ЛОГ ВООБЩЕ, ни в
 * каком виде — не «замаскировано», а физически отсутствует в объекте лога. Это даёт даже более
 * сильную гарантию, чем буквальный AC5 («phone замаскирован `+992******NN`; ключ `code`
 * отсутствует») — здесь ОБА поля отсутствуют, а не одно замаскировано/одно отсутствует. Тест
 * ниже проверяет РЕАЛЬНЫЙ инвариант (`expect(logEntry).not.toHaveProperty('phone')` И `('code')`
 * — буквально форма AC5 из тикета: `not.toHaveProperty`, не сравнение с пустой строкой) на
 * ВСЕХ JSON-строках лога, порождённых `/auth/otp/verify`, а не предполагает наличие
 * несуществующего маскирования.
 */
// Прямое присваивание (не `??=`) ДО динамического `import('@/main.js')` — `vitest.config.ts`'s
// щедрый `LOG_LEVEL='error'` (нужен другим файлам пакета, чтобы не шуметь в консоли) подавил бы
// ИМЕННО access-лог (`pino-http` пишет успешный запрос на уровне `info`), который этот файл
// обязан перехватить.
process.env.LOG_LEVEL = 'info'

import { Pool } from 'pg'
import fs from 'node:fs'
import type { Server } from 'node:http'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const FULL_BOOT_TIMEOUT_MS = 30_000

async function isPostgresReachable(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 1_500 })
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    await pool.end().catch(() => undefined)
  }
}
const postgresAvailable = await isPostgresReachable(TEST_DATABASE_URL)

interface RequestOtpBody {
  readonly data: { readonly otpRequestId: string }
}

/**
 * Захватывает КАЖДУЮ построчную запись, которую процесс пишет в stdout (fd 1), пока активен
 * `stop()`. `pino`/`pino-http` (`sonic-boom`/`thread-stream`) пишут в stdout ЧЕРЕЗ `fs.write`/
 * `fs.writeSync` на fd 1 НАПРЯМУЮ, В ОБХОД `process.stdout.write` (проверено живым прогоном —
 * перехват на уровне `process.stdout.write` давал 0 захваченных строк, хотя лог реально
 * печатался в терминал) — перехват здесь на уровне `node:fs`, единственном месте, которое
 * реально видит эти записи.
 */
function bufferToText(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof Uint8Array) return new TextDecoder().decode(data)
  return String(data)
}

function captureStdout(): { readonly lines: string[]; readonly stop: () => void } {
  const lines: string[] = []
  const originalWrite: typeof fs.write = fs.write
  const originalWriteSync: typeof fs.writeSync = fs.writeSync
  const rawWrite = originalWrite as unknown as (...args: readonly unknown[]) => unknown
  const rawWriteSync = originalWriteSync as unknown as (...args: readonly unknown[]) => number

  fs.write = ((fd: number, ...rest: readonly unknown[]): unknown => {
    if (fd === 1) lines.push(bufferToText(rest[0]))
    return rawWrite(fd, ...rest)
  }) as typeof fs.write

  fs.writeSync = (fd: number, ...rest: readonly unknown[]): number => {
    if (fd === 1) lines.push(bufferToText(rest[0]))
    return rawWriteSync(fd, ...rest)
  }

  return {
    lines,
    stop: (): void => {
      fs.write = originalWrite
      fs.writeSync = originalWriteSync
    },
  }
}

describe.skipIf(!postgresAvailable)('tests/security/log-pii-leakage (DTJ-425, TC-NFR-010)', () => {
  let app: NestFastifyApplication
  let httpServer: Server

  beforeAll(async () => {
    const { createApp } = await import('@/main.js')
    app = await createApp()
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    httpServer = app.getHttpServer()
  }, FULL_BOOT_TIMEOUT_MS)

  afterAll(async () => {
    await app.close()
  })

  it('AC5 буквально: JSON-запись лога verify-запроса не содержит ключей phone/code (not.toHaveProperty, не пустая строка)', async () => {
    const phone = `+99291${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`
    const capture = captureStdout()
    let response: request.Response
    try {
      const reqResp = await request(httpServer).post('/api/v1/auth/otp/request').send({ phone })
      const otpRequestId = (reqResp.body as RequestOtpBody).data.otpRequestId
      response = await request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code: '000000' })
    } finally {
      capture.stop()
    }
    expect(response.status).toBe(400)

    const logEntries = capture.lines
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null)
    expect(logEntries.length).toBeGreaterThan(0)

    const verifyRequestLogs = logEntries.filter((entry) => typeof entry.path === 'string' && entry.path.includes('/auth/otp/verify'))
    expect(verifyRequestLogs.length).toBeGreaterThan(0)

    for (const entry of verifyRequestLogs) {
      expect(entry).not.toHaveProperty('code')
      expect(entry).not.toHaveProperty('phone')
      expect(entry).not.toHaveProperty('otp.code')
      expect(JSON.stringify(entry)).not.toContain(phone)
      expect(JSON.stringify(entry)).not.toContain('000000')
    }
  })
})
