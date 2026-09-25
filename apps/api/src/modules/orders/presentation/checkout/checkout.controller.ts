/**
 * `CheckoutController` (EP-09, DTJ-233, SRS-ORD-016..020/029/031, SRS-API-001..016) — HTTP-граница
 * checkout: `POST /api/v1/orders`, `POST /api/v1/orders/:id/cancel`, `GET
 * /api/v1/orders/:id/payment-status` (заглушка до EP-10).
 *
 * **Маппинг доменных ошибок → HTTP — уже сделан, ОДНИМ местом (SRS-API-016).** `AllExceptionsFilter`
 * (`common/filters/all-exceptions.filter.ts`, ЕДИНСТВЕННЫЙ фильтр приложения) читает
 * `ERROR_HTTP_STATUS[error.code]` для ЛЮБОГО `DomainError`, брошенного откуда угодно —
 * `ControlledSubstanceNotOrderableError`(422)/`PrescriptionNotVerifiedError`(422, на уровне
 * ГРУППЫ, живёт в `failedGroups`, не бросается на весь checkout)/`CodForbiddenForRxError`(422)/
 * `CodLimitExceededError`(422)/`PaymentMethodNotEnabledError`(422)/`NoOrderableItemsError`(422)/
 * `ForbiddenError`(403, cart ownership/`OrderPolicy.canCancel=false`) — уже маппятся АВТОМАТИЧЕСКИ,
 * контроллер их не перехватывает и не строит таблицу заново (DoD DTJ-233: «контроллер не содержит
 * бизнес-логики сверх маппинга DTO↔команда»). `PriceOrStockChangedError` (DTJ-231) — НЕ
 * исключение уровня HTTP-ответа вовсе: она уже осела в `failedGroups` ВНУТРИ `CheckoutResultDto`,
 * сюда долетает только собранный `data`.
 *
 * **Единственный случай, требующий явной логики ЗДЕСЬ** — провайдерный таймаут (D-EP09-17):
 * `CheckoutOrderResultDto.paymentPending=true` — не исключение, а поле результата. Если это
 * ЕДИНСТВЕННАЯ группа ответа (одна аптека, ни успеха, ни другого провала), транслируем в `503
 * PAYMENT_PROVIDER_UNAVAILABLE` (см. JSDoc `CheckoutOrderResultDto`, DTJ-227) — при НЕСКОЛЬКИХ
 * группах остальные не теряются, `paymentPending` остаётся видимым полем внутри `data.orders[]`.
 *
 * **`Idempotency-Key` — общая инфраструктура (`@Idempotent()`), НЕ своя.** `IdempotencyInterceptor`
 * (`common/idempotency/`, `APP_INTERCEPTOR` глобально) активируется декоратором и САМ отдаёт `400
 * IDEMPOTENCY_KEY_REQUIRED`/`409 IDEMPOTENCY_KEY_CONFLICT`/кэш ДО вызова этого контроллера —
 * `CheckoutUseCase` не вызывается на дублях (DTJ-231 «Риски», D-EP09-4 «локальный fallback
 * запрещён»). `CheckoutUseCase.execute()` (DTJ-227) вдобавок несёт СВОЙ application-уровневый
 * `IdempotencyAttemptAdapter` — оба слоя пишут в ОДНУ таблицу `idempotency_keys` под РАЗНЫМИ
 * `endpoint` (`'POST /api/v1/orders'` vs `'checkout:create-orders'`, см. JSDoc порта), поэтому не
 * конфликтуют: HTTP-слой обычно перехватывает повтор раньше, чем use case вообще вызывается.
 *
 * **`customerPhone` — presentation обязан резолвить (foundIssue, ASSUMPTION).** `CheckoutCommand`
 * требует `customerPhone` (нужен `PaymentInvoicePort.createInvoice`, DTJ-227), но `JwtClaims` его
 * не несёт (`sub`/`role`/`tenantId`/`pharmacyId`/`chainId`/`sessionId` — телефона нет), а тело
 * `POST /api/v1/orders` (SRS-ORD-017) тоже не содержит отдельного поля контактного телефона.
 * Единственный источник — учётная запись пользователя: `USERS_REPOSITORY` экспортирован
 * `@/modules/auth/index.js` ИМЕННО для этого («findById(id) — для guards/HTTP-контроллеров,
 * достать User по sub из JWT», JSDoc порта) — тот же легальный межмодульный путь, что
 * `UserAddressFacadePort` в application-слое DTJ-229, только уровнем выше (presentation читает
 * публичный порт другого модуля напрямую, без промежуточного application-порта orders — DTO
 * `CheckoutCommand` не растягивает лишний слой ради одного поля). `phoneNumber === null`
 * (Telegram-путь без телефона, JSDoc `User`) — пропускается как пустая строка: `createInvoice`
 * вызывается ТОЛЬКО для non-cash, а Telegram-клиент без телефона на non-cash — известный,
 * незадокументированный спекой предельный случай, вне периметра этого тикета.
 *
 * `Idempotency-Key` также передаётся В `CheckoutCommand.checkoutAttemptId` — СЫРОЕ значение
 * заголовка (SRS-DOM-166), гарантированно валидный UUID v4 к этому моменту (интерсептор уже
 * проверил формат).
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ErrorCode, PaymentProviderUnavailableError, fail, ok, type SuccessEnvelope } from '@dorutj/contracts'
import { CancelOrderRequestSchema, type CancelOrderRequest } from '@dorutj/contracts'
import { CreateOrderRequestSchema, type CreateOrderRequestDto } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, USERS_REPOSITORY, type JwtClaims, type UsersRepository } from '@/modules/auth/index.js'
import { CheckoutUseCase } from '@/modules/orders/application/checkout/checkout.use-case.js'
import type { CheckoutCommand, InlineDeliveryAddress } from '@/modules/orders/application/checkout/dto/checkout-command.dto.js'
import type { CheckoutResultDto } from '@/modules/orders/application/checkout/dto/checkout-result.dto.js'
import { CancelOrderUseCase } from '@/modules/orders/application/order-lifecycle/cancel-order.use-case.js'
import type { CancelOrderCommand } from '@/modules/orders/application/order-lifecycle/dto/cancel-order-command.dto.js'
import {
  toCancelOrderResponseData,
  toCheckoutResponseData,
  toCheckoutResponseMeta,
} from './dto/order-response.dto.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })
const IDEMPOTENCY_KEY_HEADER = 'idempotency-key'
/** Не в `common/http/http-status.constants.ts` (C6: только именованные, чужой barrel-файл не
 *  трогается ради одной строки, D-27) — статус специфичен ЭТОМУ, единственному, маршруту-заглушке. */
const HTTP_STATUS_NOT_IMPLEMENTED = 501

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class CheckoutController {
  constructor(
    @Inject(CheckoutUseCase) private readonly checkoutUseCase: CheckoutUseCase,
    @Inject(CancelOrderUseCase) private readonly cancelOrder: CancelOrderUseCase,
    // Явный @Inject — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(USERS_REPOSITORY) private readonly usersRepository: UsersRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Ok)
  @Roles('customer')
  @Idempotent()
  async checkout(
    @CurrentUser() claims: JwtClaims,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string,
    @Body(new ZodValidationPipe(CreateOrderRequestSchema)) body: CreateOrderRequestDto,
  ): Promise<SuccessEnvelope<unknown>> {
    const customerPhone = await this.resolveCustomerPhone(claims.sub)
    const cmd = toCheckoutCommand(body, {
      tenantId: requireTenantId(claims),
      customerId: claims.sub,
      customerPhone,
      checkoutAttemptId: idempotencyKey,
    })
    const result = await this.checkoutUseCase.execute(cmd)
    assertNotSolePendingPayment(result)
    return ok(toCheckoutResponseData(result), toCheckoutResponseMeta(result))
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.Ok)
  @Roles('customer', 'pharmacist', 'pharmacy_admin')
  async cancel(
    @Param('id', UUID_PIPE) orderId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(CancelOrderRequestSchema)) body: CancelOrderRequest,
  ): Promise<SuccessEnvelope<unknown>> {
    const cmd: CancelOrderCommand = {
      orderId,
      reason: body.reason,
      actor: {
        userId: claims.sub,
        role: claims.role,
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
    }
    const result = await this.cancelOrder.execute(cmd)
    return ok(toCancelOrderResponseData(result))
  }

  /**
   * Заглушка (DTJ-233 «Что сделать» п.3, `TODO(DTJ-242)`) — реальная реализация делегирует в
   * `payments`-модуль через будущий `PaymentsFacade`/`PaymentInvoicePort` (EP-10). Маршрут
   * существует с первого дня для фронтенда (DTJ-235), отвечает `501 NOT_IMPLEMENTED` до готовности
   * EP-10 — не `404` (маршрут РЕАЛЕН, просто не реализован) и не `200` с выдуманными данными.
   */
  @Get(':id/payment-status')
  paymentStatus(@Param('id', UUID_PIPE) orderId: string): never {
    throw new HttpException(
      fail(ErrorCode.NOT_IMPLEMENTED, 'Payment status is not implemented yet (EP-10, DTJ-242)', { orderId }),
      HTTP_STATUS_NOT_IMPLEMENTED,
    )
  }

  /** См. JSDoc файла «customerPhone — presentation обязан резолвить». */
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

/**
 * D-EP09-17/JSDoc `CheckoutOrderResultDto` — единственная группа ответа и она `paymentPending`
 * → `503 PAYMENT_PROVIDER_UNAVAILABLE` (заказ уже создан `pending_payment`, инвойс не выставлен).
 * Не бросается, когда групп больше одной — остальные заказы теряться не должны, флаг остаётся
 * видимым внутри `data.orders[].paymentPending`.
 */
function assertNotSolePendingPayment(result: CheckoutResultDto): void {
  const isSoleGroup = result.orders.length === 1 && result.failedGroups.length === 0
  const soleOrder = result.orders[0]
  if (isSoleGroup && soleOrder?.paymentPending === true) {
    throw new PaymentProviderUnavailableError({
      orderId: soleOrder.orderId,
      orderNumber: soleOrder.orderNumber,
      reason: 'payment_invoice_creation_failed_or_timed_out',
    })
  }
}

interface CheckoutCommandContext {
  readonly tenantId: string
  readonly customerId: string
  readonly customerPhone: string
  readonly checkoutAttemptId: string
}

/** DTO↔command маппинг (SRS-ORD-017) — ровно то, что DoD называет «не более маппинга». */
function toCheckoutCommand(body: CreateOrderRequestDto, ctx: CheckoutCommandContext): CheckoutCommand {
  const inlineAddress: InlineDeliveryAddress | null =
    body.inlineAddress === undefined || body.inlineAddress === null
      ? null
      : {
          addressText: body.inlineAddress.addressText,
          landmarkText: body.inlineAddress.landmarkText ?? null,
          latitude: body.inlineAddress.latitude,
          longitude: body.inlineAddress.longitude,
        }
  return {
    tenantId: ctx.tenantId,
    customerId: ctx.customerId,
    customerPhone: ctx.customerPhone,
    cartItemIds: body.cartItemIds,
    deliveryAddressId: body.deliveryAddressId ?? null,
    inlineAddress,
    deliveryLandmark: body.deliveryLandmark ?? null,
    paymentMethod: body.paymentMethod,
    prescriptionIds: body.prescriptionIds ?? [],
    expectedTotalDiramByPharmacy: toExpectedTotalDiramByPharmacy(body.expectedTotalDiramByPharmacy),
    checkoutAttemptId: ctx.checkoutAttemptId,
    sessionId: body.sessionId ?? null, // DTJ-380 — см. JSDoc `CheckoutCommand.sessionId`.
  }
}

/** SRS-ORD-023, поправка CTO волна 6 — `number` (граница JSON) → `bigint` (домен/приложение,
 *  правило 6 AGENTS.md), ПО КАЖДОЙ группе; поле целиком опционально (пустой объект по умолчанию). */
function toExpectedTotalDiramByPharmacy(input: Record<string, number> | undefined): Readonly<Record<string, bigint>> {
  if (input === undefined) {
    return {}
  }
  return Object.fromEntries(Object.entries(input).map(([pharmacyId, valueDiram]) => [pharmacyId, BigInt(valueDiram)]))
}

/** 1:1 с `CartController.resolveTenantId` — `AuthGuard` уже отверг рассинхрон `claims.tenantId`
 *  с резолвленным тенантом (SRS-API-045) ДО того, как запрос дошёл сюда; `null` — только `super_admin`,
 *  который не входит ни в один `@Roles(...)` набор этого контроллера (защитная проверка). */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'checkout/cancel requires a tenant-scoped actor (super_admin is not in @Roles for this route)',
    })
  }
  return claims.tenantId
}
