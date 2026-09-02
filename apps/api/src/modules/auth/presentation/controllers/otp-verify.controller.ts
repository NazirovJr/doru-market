/**
 * `OtpVerifyController` (EP-01, DTJ-024, SRS-API-022/023/024) — шаг 2 OTP-логина.
 *
 * `POST /api/v1/auth/otp/verify` — `{ otpRequestId, code }` → `200 { data:
 * { accessToken, refreshToken, user } }` или `4xx` с `error.code` (см.
 * `apps/api/src/common/filters/all-exceptions.filter.ts` для маппинга).
 *
 * `deviceLabel` (эвристика) и `userAgent`/`ipAddress` извлекаются из
 * Fastify request; `tenantId` резолвится из `TenantContext`, который
 * устанавливает `TenantResolutionMiddleware` (EP-02, DTJ-054) — см. JSDoc
 * `resolveTenantIdForVerify()` ниже.
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common'
import { ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import {
  VerifyOtpUseCase,
  type VerifyOtpResult,
} from '@/modules/auth/application/use-cases/verify-otp.use-case.js'
import { type VerifyOtpDto, verifyOtpDtoSchema } from '@/modules/auth/presentation/dto/verify-otp.dto.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { HTTP_STATUS_OK } from '@/common/http/http-status.constants.js'

const DEVICE_LABEL_BROWSER = 'browser'
const DEVICE_LABEL_MOBILE_APP = 'mobile-app'
const IP_ADDRESS_PLACEHOLDER = '0.0.0.0'
const USER_AGENT_HEADER = 'user-agent'
const MOBILE_APP_UA_TOKEN = 'DoruTJ'

interface FastifyLikeRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
}

interface VerifyOtpResponseBody {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: {
    readonly id: string
    readonly role: string
    readonly tenantId: string | null
    readonly phoneNumber: string
    readonly fullName: string | null
  }
}

@Controller({ path: 'auth/otp', version: '1' })
export class OtpVerifyController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(VerifyOtpUseCase) private readonly useCase: VerifyOtpUseCase) {}

  // DTJ-024 §3.4: «OtpVerifyController: POST /api/v1/auth/otp/verify, @Public()».
  // @Public() отключает AuthGuard (DTJ-022) — verify доступен до авторизации.
  @Public()
  @Post('verify')
  @HttpCode(HTTP_STATUS_OK)
  async verify(
    @Body(new ZodValidationPipe(verifyOtpDtoSchema)) dto: VerifyOtpDto,
    @Req() request: FastifyLikeRequest,
  ): Promise<SuccessEnvelope<VerifyOtpResponseBody> | ErrorEnvelope> {
    const result = await this.useCase.execute({
      otpRequestId: dto.otpRequestId,
      code: dto.code,
      // Резолвим `tenantId` из `TenantContext` (поставлен `TenantResolutionMiddleware`) —
      // см. JSDoc `resolveTenantIdForVerify()` ниже: только реальный UUID, без
      // тихих fallback'ов на slug/литерал.
      tenantId: resolveTenantIdForVerify(),
      deviceLabel: deriveDeviceLabel(request.headers[USER_AGENT_HEADER]),
      userAgent: extractUserAgent(request.headers[USER_AGENT_HEADER]),
      ipAddress: IP_ADDRESS_PLACEHOLDER,
    })
    if (!isOk(result)) throw result.error
    return ok(toResponseBody(result.value))
  }
}

function toResponseBody(value: VerifyOtpResult): VerifyOtpResponseBody {
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    user: {
      id: value.user.id,
      role: value.user.role,
      tenantId: value.user.tenantId,
      // OTP-путь (DTJ-024) ВСЕГДА создаёт User с `phoneNumber: string` —
      // null допустим только для Telegram-пути (DTJ-027). Здесь мы в
      // OTP-ветке, поэтому приведение безопасно.
      phoneNumber: value.user.phoneNumber ?? '',
      fullName: value.user.fullName,
    },
  }
}

function deriveDeviceLabel(userAgent: string | string[] | undefined): string {
  const value = Array.isArray(userAgent) ? userAgent[0] : userAgent
  if (value === undefined) {
    return DEVICE_LABEL_BROWSER
  }
  return value.includes(MOBILE_APP_UA_TOKEN) ? DEVICE_LABEL_MOBILE_APP : DEVICE_LABEL_BROWSER
}

function extractUserAgent(userAgent: string | string[] | undefined): string {
  return Array.isArray(userAgent) ? (userAgent[0] ?? '') : (userAgent ?? '')
}

/**
 * Резолв `tenantId` для verify-флоу.
 *
 * Контракт `TenantContext` (см. `tenant-context.ts`): `tenantId` — реальный
 * UUID тенанта, включая нейтральный (он резолвится как настоящая строка в
 * `tenants`, различие несёт `isNeutral`, а не `tenantId`); `tenantId === null`
 * означает СТРОГО «не резолвлено» (`unresolved: true`, включая случай, когда
 * `TenantResolutionMiddleware` вообще не отработал — контекста нет).
 *
 * `VerifyOtpInput.tenantId` едет в колонки `UUID NOT NULL` (`users.tenant_id`,
 * `otp_codes.tenant_id`, `auth_sessions.tenant_id`). Раньше здесь был fallback
 * на `store.slug`/литерал `'neutral'` — не-UUID строка, тихо утекавшая в БД и
 * дающая `22P02 invalid input syntax for type uuid` после перевода
 * `USERS_REPOSITORY` на Drizzle (DTJ-024). CTO-решение: молчаливая подстановка
 * невалидного UUID недопустима — падаем громко, а не портим данные.
 */
function resolveTenantIdForVerify(): string {
  const store = TenantContext.get()
  if (store !== undefined && store.tenantId !== null) {
    return store.tenantId
  }
  throw new Error(
    'OtpVerifyController: TenantContext не резолвлен (tenantId === null) или отсутствует — ' +
      'убедитесь, что TenantResolutionMiddleware зарегистрирован перед этим роутом',
  )
}
