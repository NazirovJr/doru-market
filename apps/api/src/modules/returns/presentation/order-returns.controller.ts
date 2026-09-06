/**
 * `OrderReturnsController` (EP-11, DTJ-275, SRS-RET-011/012, SRS-API-009/038) — единственная
 * точка входа в модуль `returns` снаружи `apps/api`, базовый путь `/api/v1/order-returns`.
 *
 * **Маппинг доменных ошибок → HTTP — уже сделан, ОДНИМ местом** (см. JSDoc `CheckoutController`
 * «Маппинг доменных ошибок...»): `AllExceptionsFilter` читает `ERROR_HTTP_STATUS[error.code]`
 * для ЛЮБОГО `DomainError` — `DuplicateActiveReturnError`(409)/`ReturnWindowExpiredError`(422)/
 * `InvalidReturnStatusTransitionError`(409)/`NotFoundError`(404)/`ForbiddenError`(403) уже
 * маппятся автоматически, контроллер их не перехватывает. `RestockConditionsNotMetError`/
 * `ControlledSubstanceMustBeDestroyedError` НЕ долетают сюда вовсе — `ConfirmReturnReceivedUseCase`
 * перехватывает их внутри и возвращает вычисленный `disposition` (см. её JSDoc, DTJ-271/273).
 *
 * **RBAC — два слоя** (`02` §3.4): грубая проверка роли — `@Roles()`+`RolesGuard` (класс
 * `DomainError`, не выброс контроллера); точная проверка владения — `ReturnsPolicy` ЗДЕСЬ,
 * ДО делегирования в use case (единственное исключение — `admin-override`: `ReturnsPolicy.
 * canOverride` уже встроена в `AdminOverrideReturnUseCase` из необходимости DTJ-273 п.6, см. её
 * JSDoc — контроллер не дублирует проверку для этого одного эндпоинта).
 *
 * **`Idempotency-Key`** — общая инфраструктура `@Idempotent()`/`IdempotencyInterceptor` (см.
 * JSDoc `CheckoutController`), не своя: `POST /` и `POST /:id/admin-override` (SRS-RET-011,
 * двойной клик администратора не должен переопределить дважды).
 *
 * **`courier`-ветка `POST /`** — `orders.courier_id` хранит `couriers.id`, не `users.id`
 * (`JwtClaims.sub`) — курьерская личность резолвится через `ReturnsOrdersPort.getCourierIdForUser`
 * ПЕРЕД проверкой владения (см. JSDoc порта, DTJ-275 foundIssue).
 */
import { Body, Controller, Get, HttpCode, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { ErrorCode, ForbiddenError, NotFoundError, ok, type OrderReturnDto, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { RETURNS_REPOSITORY, type ReturnsRepositoryPort, type OrderReturn } from '../application/ports/returns-repository.port.js'
import { RETURNS_ORDERS_PORT, type ReturnsOrdersPort, type OrderReturnContext } from '../application/ports/orders-facade.port.js'
import { RequestReturnUseCase } from '../application/use-cases/request-return.use-case.js'
import { MarkReturnInTransitUseCase } from '../application/use-cases/mark-return-in-transit.use-case.js'
import { ConfirmReturnReceivedUseCase } from '../application/use-cases/confirm-return-received.use-case.js'
import { RejectReturnUseCase } from '../application/use-cases/reject-return.use-case.js'
import { AdminOverrideReturnUseCase } from '../application/use-cases/admin-override-return.use-case.js'
import { RetryReturnTransitUseCase } from '../application/use-cases/retry-return-transit.use-case.js'
import { ReturnsPolicy, type ReturnsPolicyActor } from '../returns-policy.guard.js'
import { RequestReturnRequestSchema, type RequestReturnRequest } from './dto/request-return.dto.js'
import { MarkInTransitRequestSchema, type MarkInTransitRequest } from './dto/mark-in-transit.dto.js'
import { ConfirmReturnRequestSchema, type ConfirmReturnRequest } from './dto/confirm-return.dto.js'
import { RejectReturnRequestSchema, type RejectReturnRequest } from './dto/reject-return.dto.js'
import { AdminOverrideReturnRequestSchema, type AdminOverrideReturnRequest } from './dto/admin-override-return.dto.js'
import { toOrderReturnDto } from './mappers/order-return.mapper.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

type RequestReturnResponse =
  | { readonly kind: 'return_created'; readonly orderReturn: OrderReturnDto }
  | { readonly kind: 'support_ticket_created'; readonly ticketId: string }

/** Извлечено из сигнатуры `loadReturnAndAuthorize` — C1 (`max-params`, порог 3). */
interface LoadReturnAndAuthorizeInput {
  readonly tenantId: string
  readonly returnId: string
  readonly claims: JwtClaims
  readonly check: (actor: ReturnsPolicyActor, order: OrderReturnContext) => boolean
}

interface LoadReturnAndAuthorizeResult {
  readonly orderReturn: OrderReturn
  readonly order: OrderReturnContext
}

@Controller({ path: 'order-returns', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class OrderReturnsController {
  // eslint-disable-next-line max-params -- явный @Inject на каждой зависимости (esbuild/vitest не эмитит design:paramtypes, DTJ-001), 6 use case'ов + 2 порта для RBAC-предпроверки — 1:1 число зависимостей, что несёт этот контроллер по спецификации DTJ-275.
  public constructor(
    @Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort,
    @Inject(RETURNS_ORDERS_PORT) private readonly ordersPort: ReturnsOrdersPort,
    @Inject(RequestReturnUseCase) private readonly requestReturn: RequestReturnUseCase,
    @Inject(MarkReturnInTransitUseCase) private readonly markInTransit: MarkReturnInTransitUseCase,
    @Inject(ConfirmReturnReceivedUseCase) private readonly confirmReturnReceived: ConfirmReturnReceivedUseCase,
    @Inject(RejectReturnUseCase) private readonly rejectReturn: RejectReturnUseCase,
    @Inject(AdminOverrideReturnUseCase) private readonly adminOverrideReturn: AdminOverrideReturnUseCase,
    @Inject(RetryReturnTransitUseCase) private readonly retryTransit: RetryReturnTransitUseCase,
  ) {}

  private readonly policy = new ReturnsPolicy()

  @Post()
  @HttpCode(HttpStatus.Created)
  @Roles('customer', 'courier', 'super_admin')
  @Idempotent()
  public async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(RequestReturnRequestSchema)) body: RequestReturnRequest,
  ): Promise<SuccessEnvelope<RequestReturnResponse>> {
    const tenantId = resolveTenantId()
    const order = await this.ordersPort.getOrderForReturn(tenantId, body.orderId)
    if (order === null) {
      throw new NotFoundError({ orderId: body.orderId }, ErrorCode.NOT_FOUND, 'Order not found')
    }
    const actor = await this.resolveActor(tenantId, claims)
    if (!this.policy.canRequest(actor, order)) {
      throw new ForbiddenError('Actor is not allowed to request a return for this order', { orderId: body.orderId })
    }
    const result = await this.requestReturn.execute({
      tenantId,
      orderId: body.orderId,
      reason: body.reason,
      initiatorId: claims.sub,
      initiatorRole: claims.role,
    })
    if (result.kind === 'support_ticket_created') {
      return ok({ kind: 'support_ticket_created', ticketId: result.ticketId })
    }
    const orderReturn = await this.mustFindReturn(result.returnId)
    return ok({ kind: 'return_created', orderReturn: toOrderReturnDto(orderReturn) })
  }

  @Post(':id/mark-in-transit')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacy_admin', 'super_admin')
  public async markReturnInTransit(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(MarkInTransitRequestSchema)) body: MarkInTransitRequest,
  ): Promise<SuccessEnvelope<OrderReturnDto>> {
    const tenantId = resolveTenantId()
    const { orderReturn } = await this.loadReturnAndAuthorize({
      tenantId,
      returnId: id,
      claims,
      check: (actor, order) => this.policy.canDispatch(actor, order),
    })
    await this.markInTransit.execute({ tenantId, returnId: id, orderId: orderReturn.orderId, courierId: body.courierId })
    return ok(toOrderReturnDto(await this.mustFindReturn(id)))
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist', 'super_admin')
  public async confirm(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(ConfirmReturnRequestSchema)) body: ConfirmReturnRequest,
  ): Promise<SuccessEnvelope<OrderReturnDto>> {
    const tenantId = resolveTenantId()
    await this.loadReturnAndAuthorize({ tenantId, returnId: id, claims, check: (actor, order) => this.policy.canConfirmOrReject(actor, order) })
    await this.confirmReturnReceived.execute({
      tenantId,
      returnId: id,
      checklist: {
        packagingIntact: body.checklist.packagingIntact,
        ...(body.checklist.notes !== undefined && { notes: body.checklist.notes }),
      },
    })
    return ok(toOrderReturnDto(await this.mustFindReturn(id)))
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist', 'super_admin')
  public async reject(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(RejectReturnRequestSchema)) body: RejectReturnRequest,
  ): Promise<SuccessEnvelope<OrderReturnDto>> {
    const tenantId = resolveTenantId()
    await this.loadReturnAndAuthorize({ tenantId, returnId: id, claims, check: (actor, order) => this.policy.canConfirmOrReject(actor, order) })
    await this.rejectReturn.execute({ tenantId, returnId: id, reason: body.reason })
    return ok(toOrderReturnDto(await this.mustFindReturn(id)))
  }

  @Post(':id/admin-override')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacy_admin', 'super_admin')
  @Idempotent()
  public async adminOverride(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(AdminOverrideReturnRequestSchema)) body: AdminOverrideReturnRequest,
  ): Promise<SuccessEnvelope<OrderReturnDto>> {
    const tenantId = resolveTenantId()
    // Владение («своя сеть») проверяется ВНУТРИ AdminOverrideReturnUseCase (ReturnsPolicy.canOverride,
    // DTJ-273 п.6) — см. JSDoc файла «RBAC — два слоя», контроллер не дублирует эту проверку.
    await this.adminOverrideReturn.execute({
      tenantId,
      returnId: id,
      actorId: claims.sub,
      actor: { role: claims.role, pharmacyId: claims.pharmacyId, chainId: claims.chainId },
      reason: body.reason,
    })
    return ok(toOrderReturnDto(await this.mustFindReturn(id)))
  }

  @Post(':id/retry-transit')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacy_admin', 'super_admin')
  public async retryReturnTransit(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(MarkInTransitRequestSchema)) body: MarkInTransitRequest,
  ): Promise<SuccessEnvelope<OrderReturnDto>> {
    const tenantId = resolveTenantId()
    const { orderReturn } = await this.loadReturnAndAuthorize({
      tenantId,
      returnId: id,
      claims,
      check: (actor, order) => this.policy.canDispatch(actor, order),
    })
    await this.retryTransit.execute({ tenantId, returnId: id, orderId: orderReturn.orderId, courierId: body.courierId })
    return ok(toOrderReturnDto(await this.mustFindReturn(id)))
  }

  @Get(':id')
  @Roles('customer', 'pharmacist', 'super_admin')
  public async findOne(@Param('id', ID_PARSE_UUID) id: string, @CurrentUser() claims: JwtClaims): Promise<SuccessEnvelope<OrderReturnDto>> {
    const tenantId = resolveTenantId()
    await this.loadReturnAndAuthorize({ tenantId, returnId: id, claims, check: (actor, order) => this.policy.canRead(actor, order) })
    return ok(toOrderReturnDto(await this.mustFindReturn(id)))
  }

  /** DTO↔command маппинг — единая проверка владения для эндпоинтов, действующих на УЖЕ существующий возврат (не `POST /`, у него своя ветка — заказ известен из тела, не из `:id`). */
  private async loadReturnAndAuthorize(input: LoadReturnAndAuthorizeInput): Promise<LoadReturnAndAuthorizeResult> {
    const { tenantId, returnId, claims, check } = input
    const orderReturn = await this.mustFindReturn(returnId)
    const order = await this.ordersPort.getOrderForReturn(tenantId, orderReturn.orderId)
    if (order === null) {
      throw new NotFoundError({ orderId: orderReturn.orderId }, ErrorCode.NOT_FOUND, 'Order not found')
    }
    const actor = await this.resolveActor(tenantId, claims)
    if (!check(actor, order)) {
      throw new ForbiddenError('Actor is not allowed to act on this return', { returnId })
    }
    return { orderReturn, order }
  }

  private async mustFindReturn(returnId: string): Promise<OrderReturn> {
    const orderReturn = await this.repository.findById(returnId)
    if (orderReturn === null) {
      throw new NotFoundError({ returnId }, ErrorCode.RETURN_NOT_FOUND, 'Return not found')
    }
    return orderReturn
  }

  /** См. JSDoc файла «courier-ветка `POST /`» — `courierId` резолвится ТОЛЬКО для роли `courier` (лишний запрос иначе). */
  private async resolveActor(tenantId: string, claims: JwtClaims): Promise<ReturnsPolicyActor> {
    const courierId = claims.role === 'courier' ? await this.ordersPort.getCourierIdForUser(tenantId, claims.sub) : null
    return { role: claims.role, pharmacyId: claims.pharmacyId, chainId: claims.chainId, userId: claims.sub, courierId }
  }
}

/**
 * 1:1 с `AdminPaymentOverrideController.resolveTenantId`/`get-order-ledger.controller.ts` —
 * `TenantContext` (подомен-мидлварь, `TenantScopeGuard`), НЕ `claims.tenantId`: `super_admin`
 * входит во ВСЕ `@Roles(...)` наборы этого контроллера, а его `claims.tenantId` ВСЕГДА `null`
 * (`AuthGuard` JSDoc «super_admin exempt — can operate cross-tenant») — тенант этого запроса
 * резолвлен из поддомена независимо от роли актора.
 */
function resolveTenantId(): string {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return store.tenantId
}
