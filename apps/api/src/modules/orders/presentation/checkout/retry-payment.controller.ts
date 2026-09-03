/**
 * `RetryPaymentController` (EP-10, DTJ-241, SRS-PAY-041) — `POST
 * /api/v1/orders/:id/retry-payment`. Тонкий HTTP-слой (`02` §1.1) — вся проверка владения/
 * ретрайабельности заказа в `RetryPaymentUseCase` (`application/order-lifecycle/`).
 *
 * Живёт в `orders/presentation/checkout/` (соседний файл `checkout.controller.ts`), НЕ в
 * `payments` — см. JSDoc `RetryPaymentUseCase`/`orders.module.ts`/`payments.module.ts`
 * (`no-circular`, DISPUTED в отчёте сдачи DTJ-241).
 *
 * **Маппинг ошибок — уже сделан ОДНИМ местом (SRS-API-016).** `AllExceptionsFilter` читает
 * `ERROR_HTTP_STATUS[error.code]` для ЛЮБОГО `DomainError` — `NotFoundError`(404)/
 * `ForbiddenError`(403)/`OrderNotRetryableError`(409, AC4) уже маппятся автоматически.
 *
 * `Idempotency-Key` — общая инфраструктура `@Idempotent()` (тот же приём, что
 * `CheckoutController`), обязателен (SRS-API-009, «Что сделать» п.3 тикета). Значение
 * заголовка передаётся В `RetryPaymentUseCase` как НОВЫЙ `idempotencyKey` для
 * `PaymentInvoicePort.createInvoice` — клиент обязан передать СВЕЖИЙ UUID на каждую РЕАЛЬНУЮ
 * повторную попытку (JSDoc use case'а «НЕ переиспользующий провалившийся»); HTTP-слой
 * `IdempotencyInterceptor` защищает от повторной ОБРАБОТКИ дубля этого САМОГО запроса.
 *
 * `customerPhone` — presentation обязан резолвить (1:1 с `CheckoutController.resolveCustomerPhone`).
 */
import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ErrorCode, ok, type SuccessEnvelope } from '@dorutj/contracts'
import type { RetryPaymentResponseDto } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, USERS_REPOSITORY, type JwtClaims, type UsersRepository } from '@/modules/auth/index.js'
import { RetryPaymentUseCase } from '@/modules/orders/application/order-lifecycle/retry-payment.use-case.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class RetryPaymentController {
  constructor(
    @Inject(RetryPaymentUseCase) private readonly retryPayment: RetryPaymentUseCase,
    // Явный @Inject — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepository,
  ) {}

  @Post(':id/retry-payment')
  @HttpCode(HttpStatus.Ok)
  @Roles('customer')
  @Idempotent()
  async retry(
    @Param('id', UUID_PIPE) orderId: string,
    @CurrentUser() claims: JwtClaims,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string,
  ): Promise<SuccessEnvelope<RetryPaymentResponseDto>> {
    const customerPhone = await this.resolveCustomerPhone(claims.sub)
    const invoice = await this.retryPayment.execute({
      tenantId: requireTenantId(claims),
      orderId,
      customerId: claims.sub,
      customerPhone,
      idempotencyKey,
    })
    const data: RetryPaymentResponseDto = {
      orderId,
      providerRef: invoice.providerRef,
      qrPayload: invoice.qrPayload,
      expiresAt: invoice.expiresAt.toISOString(),
    }
    return ok(data)
  }

  /** 1:1 с `CheckoutController.resolveCustomerPhone`. */
  private async resolveCustomerPhone(userId: string): Promise<string> {
    const user = await this.usersRepository.findById(userId)
    if (user === null) {
      throw new InternalServerErrorException({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'authenticated user not found (AuthGuard verified a JWT for a non-existent user)',
      })
    }
    return user.phoneNumber ?? ''
  }
}

/** 1:1 с `CheckoutController.requireTenantId`. */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'retry-payment requires a tenant-scoped actor (super_admin is not in @Roles for this route)',
    })
  }
  return claims.tenantId
}
