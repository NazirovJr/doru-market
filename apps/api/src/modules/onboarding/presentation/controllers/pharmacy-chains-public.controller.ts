/**
 * `PharmacyChainsPublicController` (DTJ-064) — публичный (без JWT, `@Public()`)
 * контроллер заявки сети.
 *
 * Маршруты:
 * - `POST /api/v1/pharmacy-chains` — `SubmitChainApplicationUseCase`
 * - `POST /api/v1/pharmacy-chains/:id/verify-contact-phone` — `VerifyChainContactPhoneUseCase`
 * - `POST /api/v1/pharmacy-chains/:id/request-contact-phone-otp` — отправка OTP
 *
 * DTJ-066: `POST /:id/submit` добавляется в этот же контроллер.
 */
import { Body, Controller, HttpCode, Inject, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import {
  ok,
  SubmitChainApplicationRequestSchema,
  VerifyChainContactPhoneRequestSchema,
  type SubmitChainApplicationRequest,
  type VerifyChainContactPhoneRequest,
} from '@dorutj/contracts'
import {
  SubmitChainApplicationUseCase,
  type SubmitChainApplicationInput,
} from '@/modules/onboarding/application/use-cases/submit-chain-application.use-case.js'
import { VerifyChainContactPhoneUseCase } from '@/modules/onboarding/application/use-cases/verify-chain-contact-phone.use-case.js'
import { SubmitChainForReviewUseCase } from '@/modules/onboarding/application/use-cases/submit-chain-for-review.use-case.js'
import { OTP_PORT, type OtpPort } from '@/modules/onboarding/application/ports/otp.port.js'
import { PHARMACY_CHAIN_REPOSITORY, type PharmacyChainRepositoryPort } from '@/modules/onboarding/application/ports/pharmacy-chain.repository.port.js'

/** UUID-валидатор для path-параметра (UUID v4 — `crypto.randomUUID()` ниже). */
const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

@Controller({ path: 'pharmacy-chains', version: '1' })
@Public()
export class PharmacyChainsPublicController {
  /* eslint-disable max-params -- NestJS DI: 4 провайдера в конструкторе — стандартная практика фреймворка */
  constructor(
    // Явный @Inject на каждом параметре: esbuild не эмитит `design:paramtypes` (DTJ-001).
    // Эти три шли ДО декорированных, поэтому попадали в paramtypes как `undefined` и роняли
    // бут: «can't resolve dependencies of the PharmacyChainsPublicController (?, +, +, ...)».
    @Inject(SubmitChainApplicationUseCase)
    private readonly submitChainApplication: SubmitChainApplicationUseCase,
    @Inject(VerifyChainContactPhoneUseCase)
    private readonly verifyChainContactPhone: VerifyChainContactPhoneUseCase,
    @Inject(SubmitChainForReviewUseCase)
    private readonly submitChainForReview: SubmitChainForReviewUseCase,
    @Inject(PHARMACY_CHAIN_REPOSITORY)
    private readonly pharmacyChainRepository: PharmacyChainRepositoryPort,
    @Inject(OTP_PORT)
    private readonly otpPort: OtpPort,
  ) {}
  /* eslint-enable max-params */

  /**
   * Создание новой заявки сети. `id` генерируется сервером
   * через `crypto.randomUUID()` (Web Crypto API доступен в Node 22+).
   */
  @Post()
  async submit(
    @Body(new ZodValidationPipe(SubmitChainApplicationRequestSchema)) body: SubmitChainApplicationRequest,
  ): Promise<unknown> {
    const input: SubmitChainApplicationInput = {
      id: globalThis.crypto.randomUUID(),
      legalEntityName: body.legalEntityName,
      tinInn: body.tinInn,
      directorFullName: body.directorFullName,
      contactPhone: body.contactPhone,
      legalAddress: body.legalAddress,
      isWhitelabelRequested: body.isWhitelabelRequested,
    }
    const result = await this.submitChainApplication.execute(input)
    return ok(result)
  }

  @Post(':id/verify-contact-phone')
  @HttpCode(HttpStatus.Ok)
  async verify(
    @Param('id', ID_PARSE_UUID) id: string,
    @Body(new ZodValidationPipe(VerifyChainContactPhoneRequestSchema)) body: VerifyChainContactPhoneRequest,
  ): Promise<unknown> {
    const result = await this.verifyChainContactPhone.execute({
      chainId: id,
      code: body.code,
      tenantId: resolveTenantId(),
    })
    return ok(result)
  }

  @Post(':id/request-contact-phone-otp')
  async requestOtp(@Param('id', ID_PARSE_UUID) id: string, @Ip() ipAddress: string): Promise<unknown> {
    // Резолв `contactPhone` через репозиторий
    const chain = await this.pharmacyChainRepository.findById(id)
    if (chain === null) {
      return ok({ sent: false })
    }
    const result = await this.otpPort.requestCode({
      chainId: chain.id,
      phone: chain.contactPhone,
      tenantId: resolveTenantId(),
      ipAddress,
    })
    return ok({ sent: true, challengeId: result.challengeId, expiresAt: result.expiresAt.toISOString() })
  }

  @Post(':id/submit')
  async submitForReview(@Param('id', ID_PARSE_UUID) id: string): Promise<unknown> {
    const result = await this.submitChainForReview.execute({ chainId: id })
    return ok(result)
  }
}

// Публичные маршруты работают под нейтральным тенантом платформы; без резолва OTP не к чему привязать.
function resolveTenantId(): string {
  const tenantId = TenantContext.get()?.tenantId ?? null
  if (tenantId === null) {
    throw new Error('PharmacyChainsPublicController: TenantContext не резолвлен, TenantResolutionMiddleware не подключён')
  }
  return tenantId
}
