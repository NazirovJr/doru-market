/**
 * `OtpRequestController` (EP-01, DTJ-023) — `POST /api/v1/auth/otp/request`.
 *
 * @Public() — гость без аутентификации запрашивает OTP. Никаких `@Roles(...)`.
 * Ответ ВСЕГДА `202` (не `200`) с телом `{ data: { otpRequestId, expiresInSeconds: 300 } }`
 * (SRS-API-018), независимо от того, существует ли пользователь с этим номером.
 *
 * Zod-валидация тела — `ZodValidationPipe` с `requestOtpDtoSchema`. Дальнейшая
 * валидация формата (`+992XXX...`) и rate-limit — внутри use case.
 *
 * `tenantId` резолвится из `TenantContext` (см. `resolveTenantIdForRequest()`
 * ниже) — тот же приём, что `OtpVerifyController.resolveTenantIdForVerify()`
 * (волна 5, блок A, возврат): раньше здесь стоял литерал `'neutral'`, не-UUID
 * строка, тихо утекавшая в `otp_codes.tenant_id UUID NOT NULL` и роняющая
 * ЛЮБОЙ `POST /auth/otp/request` c `22P02 invalid input syntax for type uuid`
 * после перевода `OTP_CODES_REPOSITORY` на Drizzle. CTO-решение (то же, что
 * для verify): молчаливая подстановка невалидного UUID недопустима — падаем
 * громко, а не портим данные.
 */
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common'
import { ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
// Внутренние импорты — ПРЯМО из файла, не через barrel `@/modules/auth/index.ts`
// (D-27: barrel — только для межмодульного использования; иначе цикл
// `auth.module.ts → otp-request.controller.ts → barrel → auth.module.ts`,
// отвергаемый depcruise `no-circular`).
import { RequestOtpUseCase } from '@/modules/auth/application/use-cases/request-otp.use-case.js'
import { type RequestOtpDto, requestOtpDtoSchema } from '@/modules/auth/presentation/dto/request-otp.dto.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'

const REQUEST_OTP_DTO_PIPE = new ZodValidationPipe(requestOtpDtoSchema)
/** [DTJ-023, SRS-API-018] HTTP 202 Accepted — код создан и поставлен в очередь, но клиент ещё не подтвердил получение. */
const HTTP_ACCEPTED = 202

@Controller({ path: 'auth/otp', version: '1' })
export class OtpRequestController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(RequestOtpUseCase) private readonly requestOtp: RequestOtpUseCase) {}

  /**
   * `202 Accepted` — код создан и поставлен в очередь на отправку, но клиент
   * ещё не подтвердил его получение. Это НЕ `200`/`201` (конвенция SuccessEnvelope
   * из DTJ-005, DTJ-018 поддерживает произвольный HTTP-статус успеха).
   */
  @Public()
  @Post('request')
  @HttpCode(HTTP_ACCEPTED)
  async request(
    @Body(REQUEST_OTP_DTO_PIPE) body: RequestOtpDto,
  ): Promise<SuccessEnvelope<{ otpRequestId: string; expiresInSeconds: number }> | ErrorEnvelope> {
    const tenantId = resolveTenantIdForRequest()
    const ipAddress = '0.0.0.0' // Real IP извлекается в EP-19 из Fastify request
    const result = await this.requestOtp.execute({ phone: body.phone, ipAddress, tenantId })
    return ok(result)
  }
}

/**
 * Резолв `tenantId` для request-флоу — зеркало `resolveTenantIdForVerify()`
 * из `otp-verify.controller.ts` (тот же приём, см. JSDoc там для полного
 * контракта `TenantContext`). `RequestOtpInput.tenantId` едет в колонку
 * `otp_codes.tenant_id UUID NOT NULL` — молчаливый fallback на slug/литерал
 * недопустим, падаем громко.
 */
function resolveTenantIdForRequest(): string {
  const store = TenantContext.get()
  if (store !== undefined && store.tenantId !== null) {
    return store.tenantId
  }
  throw new Error(
    'OtpRequestController: TenantContext не резолвлен (tenantId === null) или отсутствует — ' +
      'убедитесь, что TenantResolutionMiddleware зарегистрирован перед этим роутом',
  )
}
