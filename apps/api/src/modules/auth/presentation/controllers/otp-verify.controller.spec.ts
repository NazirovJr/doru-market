/**
 * `otp-verify.controller.spec.ts` (CTO wave-4, дефект «отложенная бомба 22P02
 * в резолвинге нейтрального тенанта») — юнит-тест контракта
 * `resolveTenantIdForVerify()` внутри `OtpVerifyController`.
 *
 * Колонки `users.tenant_id` / `otp_codes.tenant_id` / `auth_sessions.tenant_id`
 * — `UUID NOT NULL`. Контроллер обязан НИКОГДА не передавать в
 * `VerifyOtpInput.tenantId` строку, которая не является UUID (например,
 * `slug` нейтрального тенанта или литерал `'neutral'`) — иначе Postgres
 * ответит `22P02 invalid input syntax for type uuid` при переходе
 * `USERS_REPOSITORY` на Drizzle (DTJ-024).
 *
 * До починки (см. git history) `resolveTenantIdForVerify()`:
 *   - при `TenantContext.get().tenantId === null` возвращала `store.slug`;
 *   - при отсутствии контекста вообще — литерал `'neutral'`.
 * Оба случая — не-UUID строки, тихо утекающие в БД. Тесты ниже фиксируют,
 * что теперь контроллер в этих случаях громко падает, а не подставляет
 * невалидную строку.
 */
import { describe, expect, it, vi } from 'vitest'
import { TenantContext } from '@/common/context/tenant-context.js'
import { OtpVerifyController } from '@/modules/auth/presentation/controllers/otp-verify.controller.js'
import type {
  VerifyOtpInput,
  VerifyOtpResult,
  VerifyOtpUseCase,
} from '@/modules/auth/application/use-cases/verify-otp.use-case.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const NEUTRAL_TENANT_UUID = '00000000-0000-4000-8000-000000000001'
const VALID_DTO = { otpRequestId: '11111111-1111-1111-1111-111111111111', code: '123456' }
const FAKE_REQUEST = { headers: {} }

function fakeResult(tenantId: string): VerifyOtpResult {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    user: {
      id: 'user-1',
      tenantId,
      phoneNumber: '+992000000000',
      role: 'customer',
      fullName: null,
      pharmacyId: null,
      chainId: null,
      telegramChatId: null,
      preferredLocale: 'ru',
      isActive: true,
      createdAt: new Date(),
      deletedAt: null,
    },
  } as unknown as VerifyOtpResult
}

/** Мок use case, захватывающий переданный `input.tenantId`. */
function makeCapturingUseCase(): { useCase: VerifyOtpUseCase; captured: VerifyOtpInput[] } {
  const captured: VerifyOtpInput[] = []
  const useCase = {
    execute: vi.fn((input: VerifyOtpInput) => {
      captured.push(input)
      return Promise.resolve({ ok: true, value: fakeResult(input.tenantId) })
    }),
  } as unknown as VerifyOtpUseCase
  return { useCase, captured }
}

describe('OtpVerifyController — resolveTenantIdForVerify (защита от 22P02)', () => {
  it('контекст резолвлен с реальным UUID (обычный или нейтральный тенант) → tenantId передаётся как есть', async () => {
    const { useCase, captured } = makeCapturingUseCase()
    const controller = new OtpVerifyController(useCase)

    const store = TenantContext.forTenant({
      tenantId: NEUTRAL_TENANT_UUID,
      slug: 'neutral',
      chainId: null,
      isNeutral: true,
    })
    await TenantContext.run(store, () => controller.verify(VALID_DTO, FAKE_REQUEST))

    expect(captured).toHaveLength(1)
    expect(captured[0]?.tenantId).toBe(NEUTRAL_TENANT_UUID)
    expect(UUID_RE.test(captured[0]?.tenantId ?? '')).toBe(true)
  })

  it('ДЕФЕКТ 22P02: контекст резолвлен, но tenantId === null (устаревший неймутральный контракт) → verify() НЕ ДОЛЖЕН тихо подставлять slug/литерал, обязан явно упасть', async () => {
    const { useCase, captured } = makeCapturingUseCase()
    const controller = new OtpVerifyController(useCase)

    // Симулирует контракт ДО починки middleware (resolveNeutral клал tenantId: null).
    const store = TenantContext.forTenant({
      tenantId: null,
      slug: 'neutral',
      chainId: null,
      isNeutral: true,
    })

    await expect(TenantContext.run(store, () => controller.verify(VALID_DTO, FAKE_REQUEST))).rejects.toThrow()
    // Раньше здесь use case вызывался с `input.tenantId === 'neutral'` (не UUID).
    // Теперь запрос не должен даже дойти до use case с невалидным tenantId.
    if (captured.length > 0) {
      expect(UUID_RE.test(captured[0]?.tenantId ?? '')).toBe(true)
    }
  })

  it('ДЕФЕКТ 22P02: TenantContext вообще не установлен (нет middleware) → verify() НЕ ДОЛЖЕН тихо подставлять литерал \'neutral\', обязан явно упасть', async () => {
    const { useCase, captured } = makeCapturingUseCase()
    const controller = new OtpVerifyController(useCase)

    expect(TenantContext.get()).toBeUndefined()
    await expect(controller.verify(VALID_DTO, FAKE_REQUEST)).rejects.toThrow()
    if (captured.length > 0) {
      expect(UUID_RE.test(captured[0]?.tenantId ?? '')).toBe(true)
    }
  })
})
