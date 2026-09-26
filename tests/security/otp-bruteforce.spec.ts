/**
 * `otp-bruteforce.spec.ts` (DTJ-425, `TC-NFR-011`/`TC-NFR-012`, `SRS-NFR-011`/`SRS-NFR-012`).
 *
 * **TC-NFR-011 (логин, login OTP verify) — НЕ дублируется.** Полное покрытие (5 неверных попыток
 * → `OTP_MISMATCH` с убывающим `attemptsLeft`, 6-я → `423 OTP_LOCKED`, И — критично для этого
 * тикета — 6-я попытка с ПРАВИЛЬНЫМ кодом ПОСЛЕ лока ТОЖЕ `423 OTP_LOCKED` (fail-closed, не
 * «code сработал бы, если бы не счётчик»)) уже существует буквально: `apps/api/test/integration/
 * auth/otp-brute-force.spec.ts`, сценарий №3 «ПОСЛЕ 423 даже ПРАВИЛЬНЫЙ код → 423 OTP_LOCKED».
 * AGENTS.md §12 («прежде чем создать — найди») запрещает вторую независимую копию того же
 * сценария. Ниже — ОДИН тонкий smoke-тест (не 5+1 повтор всех попыток) как самостоятельное
 * доказательство ИМЕННО в `security-audit` CI-стадии (`integration-tests`/`security-audit` —
 * РАЗНЫЕ job'ы, `pnpm test:security` не запускает `apps/api`'s `test:integration`) — если этот
 * инвариант когда-нибудь сломается, стадия `security-audit` обязана покраснеть независимо от
 * того, попадёт ли в тот же PR прогон `integration-tests`.
 *
 * **TC-NFR-012 (вручение курьером, `delivery_assignment.picked_up_from_pharmacy`,
 * `markDelivered(otp)`, `ReissueHandoverOtpUseCase`) — БЛОКЕР, НЕ РЕАЛИЗОВАНО, НЕ ВЫДУМАНО.**
 * Прочитан весь `apps/api/src/modules/delivery/**`: `DeliveryAssignment.markDelivered()`
 * (`domain/delivery-assignment.entity.ts:205-213`) — доменный метод СУЩЕСТВУЕТ (переход
 * `en_route_to_customer → delivered`, JSDoc: «Верификация OtpCode — вызывающий use case, не эта
 * сущность»), но НИ ОДИН presentation-контроллер/use case его НЕ вызывает (`grep -rn
 * "markDelivered\|confirm-delivery\|ConfirmDelivery" apps/api/src` — ноль совпадений вне самой
 * сущности) — HTTP-эндпоинт верификации OTP для вручения клиенту курьером ФИЗИЧЕСКИ ОТСУТСТВУЕТ.
 * Класс `ReissueHandoverOtpUseCase`, названный тикетом, не существует; ближайший реальный
 * аналог — `RegenerateHandoverOtpUseCase` (`orders/application/pharmacy-terminal/
 * regenerate-handover-otp.use-case.ts`), но он про ДРУГОЙ OTP (вручение аптека→курьер при
 * заборе заказа, `picked_up_from_pharmacy`), не про вручение курьер→клиент при доставке
 * (`delivered`) — два разных потока с похожими названиями (см. `handover-otp.controller.ts`'s
 * собственный JSDoc, только про PHT §A.5). AGENTS.md §7/§10: «зависишь от несделанного тикета —
 * не изобретай, верни blocker со ссылкой» — тест на несуществующий HTTP-контракт НЕ написан.
 * Эскалировано как отдельный бэкенд-дефект (см. отчёт сдачи, «БЛОКЕРЫ»/«НУЖНЫЕ ЗАВИСИМОСТИ»).
 */
import { Pool } from 'pg'
import type { Server } from 'node:http'
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SMS_PROVIDER, type SmsProviderPort } from '@/modules/auth/application/ports/sms-provider.port.js'
import { createTestApp, type TestApp } from '@apitest/integration/auth/__tests__/test-app.js'

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/dorutj_test'
const PHONE = '+992917654321'
const INVALID_CODE = '000000'

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

interface ErrorBody {
  readonly error: { readonly code: string; readonly details?: Record<string, unknown> }
}
interface RequestOtpBody {
  readonly data: { readonly otpRequestId: string }
}

describe.skipIf(!postgresAvailable)('tests/security/otp-bruteforce (DTJ-425, TC-NFR-011/012)', () => {
  let ctx: TestApp
  let app: INestApplication
  let httpServer: Server
  let sms: SmsProviderPort & { peekLast: () => { code: string } | null }

  beforeEach(async () => {
    ctx = await createTestApp()
    app = ctx.app
    httpServer = ctx.httpServer
    sms = app.get<unknown>(SMS_PROVIDER) as SmsProviderPort & { peekLast: () => { code: string } | null }
  })

  afterEach(async () => {
    await ctx.close()
  })

  it('позитивная ветка: верный код с первой попытки → 200 (нет ложного лока на легитимном логине)', async () => {
    const reqResp = await request(httpServer).post('/api/v1/auth/otp/request').send({ phone: PHONE })
    expect(reqResp.status).toBe(202)
    const otpRequestId = (reqResp.body as RequestOtpBody).data.otpRequestId
    const realCode = sms.peekLast()?.code
    expect(realCode).toBeDefined()

    const verifyResp = await request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code: realCode })
    expect(verifyResp.status).toBe(200)
  })

  it('TC-NFR-011 smoke: 6-я verify-попытка блокируется 423 OTP_LOCKED даже с ПРАВИЛЬНЫМ кодом (fail-closed)', async () => {
    const reqResp = await request(httpServer).post('/api/v1/auth/otp/request').send({ phone: PHONE })
    const otpRequestId = (reqResp.body as RequestOtpBody).data.otpRequestId
    const realCode = sms.peekLast()?.code
    expect(realCode).toBeDefined()

    for (let i = 0; i < 5; i += 1) {
      const resp = await request(httpServer).post('/api/v1/auth/otp/verify').send({ otpRequestId, code: INVALID_CODE })
      expect(resp.status, `attempt ${String(i + 1)}/5`).toBe(400)
    }

    const lockedWithRealCode = await request(httpServer)
      .post('/api/v1/auth/otp/verify')
      .send({ otpRequestId, code: realCode })
    expect(lockedWithRealCode.status).toBe(423)
    const body = lockedWithRealCode.body as ErrorBody
    expect(body.error.code).toBe('OTP_LOCKED')
  })

  // TC-NFR-012 (вручение курьером клиенту, `markDelivered(otp)`) — НЕ РЕАЛИЗОВАНО в продуктовом
  // коде (см. JSDoc файла выше), тест на него НЕ пишется (AGENTS.md §10/§15 — не изобретать
  // чужой API и не маскировать пробел `it.skip`'ом). Зафиксировано как БЛОКЕР в отчёте сдачи.
})
