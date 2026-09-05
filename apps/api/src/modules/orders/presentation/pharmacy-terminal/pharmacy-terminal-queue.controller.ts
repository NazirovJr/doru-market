/**
 * `PharmacyTerminalQueueController` (DTJ-301, EP-12, модуль 24 «Терминал фармацевта»,
 * SRS-PHT-005..010) — `GET /api/v1/orders` (очередь), `POST /api/v1/orders/:id/accept`,
 * `POST /api/v1/orders/:id/reclaim`. Тонкий HTTP-слой (`02` §1.1) — DTO↔command маппинг,
 * авторизация уровня «своя аптека/статус» — `OrderPolicy`/`OrderQueueSortPolicy` в `application`
 * (`OrdersPolicy.canAccept`/`ReclaimPolicy` — в application, НЕ в guard, DoD тикета).
 *
 * **Маппинг доменных ошибок → HTTP уже сделан ОДНИМ местом (SRS-API-016).** `AllExceptionsFilter`
 * читает `ERROR_HTTP_STATUS[error.code]` для ЛЮБОГО `DomainError` — `NotFoundError`(404)/
 * `ForbiddenError`(403)/`OrderAlreadyClaimedError`(409, SRS-PHT-009)/`ExpiredStockError`(422)
 * уже маппятся автоматически, контроллер их не перехватывает.
 *
 * `Idempotency-Key` — общая инфраструктура `@Idempotent()` (тот же приём, что
 * `CheckoutController`/`RetryPaymentController`), обязателен на `accept`/`reclaim` (SRS-PHT-039);
 * `GET` очереди — без идемпотентности (чтение, `12-api-conventions...md` §1.4).
 *
 * `super_admin` НЕ допущен ни на один из трёх маршрутов (SRS-PHT-004: наблюдение через отдельный
 * `platform:ops`-канал, не через терминал) — `@Roles('pharmacist', 'pharmacy_admin')` уже
 * ограничивает список, `super_admin` не входит.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { ErrorCode, ok, ReclaimOrderRequestSchema, type ReclaimOrderRequestDto, type SuccessEnvelope } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { Idempotent } from '@/common/http/decorators/idempotent.decorator.js'
import { CursorQueryPipe, type CursorQuerySchema } from '@/common/http/pipes/cursor-query.pipe.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { GetOrderQueueUseCase } from '@/modules/orders/application/pharmacy-terminal/get-order-queue.use-case.js'
import { AcceptOrderUseCase } from '@/modules/orders/application/pharmacy-terminal/accept-order.use-case.js'
import { ReclaimOrderUseCase } from '@/modules/orders/application/pharmacy-terminal/reclaim-order.use-case.js'
import {
  toAcceptResponseData,
  toQueueResponseData,
  toQueueResponseMeta,
  toReclaimResponseData,
  type AcceptOrderResponseData,
  type ReclaimOrderResponseData,
} from './pharmacy-terminal.mapper.js'

const UUID_PIPE = new ParseUUIDPipe({ version: '4' })
/** `sort=priority` — единственное допустимое значение (SRS-PHT-005, резолвится в application). */
const QUEUE_SORT_ENUM = z.enum(['priority'])
const QUEUE_CURSOR_PIPE = new CursorQueryPipe(QUEUE_SORT_ENUM, 'string')

@Controller({ path: 'orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class PharmacyTerminalQueueController {
  constructor(
    @Inject(GetOrderQueueUseCase) private readonly getOrderQueue: GetOrderQueueUseCase,
    @Inject(AcceptOrderUseCase) private readonly acceptOrder: AcceptOrderUseCase,
    @Inject(ReclaimOrderUseCase) private readonly reclaimOrder: ReclaimOrderUseCase,
  ) {}

  // `filter[pharmacyId]` — читается ОТДЕЛЬНЫМ `@Query('filter[pharmacyId]')`, НЕ через
  // `CursorQueryPipe`'s `filter`-мешок: Fastify (без кастомного `querystringParser`, `main.ts`
  // его не задаёт) парсит `?filter[pharmacyId]=x` как ОДИН плоский ключ, буквально содержащий
  // скобки в имени (`{"filter[pharmacyId]": "x"}`), а НЕ как вложенный объект `{filter:
  // {pharmacyId: "x"}}` (PHP-style bracket-nesting требует отдельной библиотеки типа `qs`,
  // которой в этом проекте нет) — `CursorQueryPipe.filter` (типизированный как вложенный
  // `Record<string, unknown>`) для ЭТОГО ключа всегда пуст. Обнаружено эмпирически интеграционным
  // тестом (см. отчёт сдачи DTJ-301) — не баг `CursorQueryPipe` (DTJ-018, чужой файл), а её
  // ПЕРВОЕ реальное HTTP-использование, до этого проверялась только на уже готовых JS-объектах.
  @Get()
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist', 'pharmacy_admin')
  async queue(
    @CurrentUser() claims: JwtClaims,
    @Query(QUEUE_CURSOR_PIPE) query: CursorQuerySchema,
    @Query('filter[pharmacyId]') filterPharmacyIdRaw?: string,
  ): Promise<SuccessEnvelope<unknown>> {
    const filterPharmacyId = typeof filterPharmacyIdRaw === 'string' && filterPharmacyIdRaw.length > 0 ? filterPharmacyIdRaw : null
    const result = await this.getOrderQueue.execute({
      actor: {
        role: claims.role,
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
        chainId: claims.chainId,
      },
      filterPharmacyId,
      cursor: typeof query.cursor?.v === 'string' ? query.cursor.v : null,
      limit: query.limit,
    })
    return ok(toQueueResponseData(result), toQueueResponseMeta(result, query.limit))
  }

  // `Idempotency-Key` — заголовок ПРОВЕРЯЕТСЯ `IdempotencyInterceptor` (формат/наличие) ДО вызова
  // этого метода (см. `@Idempotent()`, JSDoc файла) — метод его не читает, `@Headers(...)`
  // намеренно не объявлен параметром (иначе `max-params` C5, `≤3`, а значение никому не нужно).
  @Post(':id/accept')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist', 'pharmacy_admin')
  @Idempotent()
  async accept(
    @Param('id', UUID_PIPE) orderId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<AcceptOrderResponseData>> {
    const result = await this.acceptOrder.execute({
      orderId,
      actor: {
        userId: claims.sub,
        role: claims.role,
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
    })
    return ok(toAcceptResponseData(result))
  }

  /** См. комментарий перед `accept()` — тот же приём, `Idempotency-Key` не объявлен параметром. */
  @Post(':id/reclaim')
  @HttpCode(HttpStatus.Ok)
  @Roles('pharmacist', 'pharmacy_admin')
  @Idempotent()
  async reclaim(
    @Param('id', UUID_PIPE) orderId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(ReclaimOrderRequestSchema)) body: ReclaimOrderRequestDto,
  ): Promise<SuccessEnvelope<ReclaimOrderResponseData>> {
    const result = await this.reclaimOrder.execute({
      orderId,
      actor: {
        userId: claims.sub,
        role: claims.role,
        tenantId: requireTenantId(claims),
        pharmacyId: claims.pharmacyId,
      },
      reason: body.reason,
      // `exactOptionalPropertyTypes` — `note` пропускается целиком, если отсутствует (не
      // `note: undefined`, `ReclaimOrderCommand.note?: string` не допускает явный `undefined`).
      ...(body.note !== undefined ? { note: body.note } : {}),
    })
    return ok(toReclaimResponseData(result))
  }
}

/** 1:1 с `CheckoutController.requireTenantId` — `super_admin` не входит в `@Roles(...)` этого контроллера. */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'pharmacy-terminal endpoints require a tenant-scoped actor (super_admin is not in @Roles for this route)',
    })
  }
  return claims.tenantId
}
