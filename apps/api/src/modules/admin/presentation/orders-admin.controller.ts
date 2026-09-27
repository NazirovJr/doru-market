// Маршрут списка различает scope=own/any внутри метода, не @Roles-развилкой.
import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common'
import {
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  ok,
  OrdersAdminListQuerySchema,
  type OrderAdminSummaryDto,
  type OrderDetailAdminDto,
  type OrdersAdminListQueryDto,
  type PaginationMeta,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import type { OrderAdminSummaryView, OrdersAnyFilter, OrdersAnyPage, OrdersCursor } from '../application/ports/orders-facade.port.js'
import { ListOrdersAnyUseCase } from '../application/use-cases/list-orders-any.use-case.js'
import { ListOrdersOwnUseCase, type OrdersOwnFilter } from '../application/use-cases/list-orders-own.use-case.js'
import { GetOrderDetailAdminUseCase, type OrderDetailAdminResult } from '../application/use-cases/get-order-detail-admin.use-case.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })

// path: 'admin/orders', не голое 'orders' — тот путь уже занят PharmacyTerminalQueueController (другая роль, другая семантика).
@Controller({ path: 'admin/orders', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class OrdersAdminController {
  public constructor(
    @Inject(ListOrdersAnyUseCase) private readonly listOrdersAnyUseCase: ListOrdersAnyUseCase,
    @Inject(ListOrdersOwnUseCase) private readonly listOrdersOwnUseCase: ListOrdersOwnUseCase,
    @Inject(GetOrderDetailAdminUseCase) private readonly getOrderDetailAdminUseCase: GetOrderDetailAdminUseCase,
  ) {}

  @Get()
  @Roles('super_admin', 'pharmacy_admin')
  public async list(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(OrdersAdminListQuerySchema)) query: OrdersAdminListQueryDto,
  ): Promise<SuccessEnvelope<readonly OrderAdminSummaryDto[]>> {
    const cursor = parseOrdersCursor(query.cursor)
    const result: OrdersAnyPage =
      query.scope === 'own'
        ? await this.listOrdersOwnUseCase.execute({
            actor: { role: claims.role, chainId: claims.chainId },
            filter: toOwnFilter(query),
            limit: query.limit,
            cursor,
          })
        : await this.listOrdersAnyUseCase.execute({
            actor: { role: claims.role },
            filter: toAnyFilter(query),
            limit: query.limit,
            cursor,
          })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toSummaryDto), { pagination: meta })
  }

  @Get(':id')
  @Roles('super_admin', 'pharmacy_admin')
  public async detail(
    @Param('id', ID_PARSE_UUID) id: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<OrderDetailAdminDto>> {
    const result = await this.getOrderDetailAdminUseCase.execute({ actor: { role: claims.role, chainId: claims.chainId }, orderId: id })
    return ok(toDetailDto(result))
  }
}

function toAnyFilter(query: OrdersAdminListQueryDto): OrdersAnyFilter {
  return {
    ...(query['filter[orderNumber]'] !== undefined && { orderNumberLike: query['filter[orderNumber]'] }),
    ...(query['filter[status]'] !== undefined && { status: query['filter[status]'] }),
    ...(query['filter[tenantId]'] !== undefined && { tenantId: query['filter[tenantId]'] }),
    ...(query['filter[pharmacyId]'] !== undefined && { pharmacyId: query['filter[pharmacyId]'] }),
    ...(query['filter[customerId]'] !== undefined && { customerId: query['filter[customerId]'] }),
    ...(query['filter[createdAt][from]'] !== undefined && { createdAtFrom: query['filter[createdAt][from]'] }),
    ...(query['filter[createdAt][to]'] !== undefined && { createdAtTo: query['filter[createdAt][to]'] }),
    ...(query['filter[slaBreached]'] !== undefined && { slaBreached: query['filter[slaBreached]'] }),
  }
}

// Не читает filter[tenantId]/filter[pharmacyId] — тип OrdersOwnFilter их не несёт (chainId резолвится сервером, см. use case).
function toOwnFilter(query: OrdersAdminListQueryDto): OrdersOwnFilter {
  return {
    ...(query['filter[orderNumber]'] !== undefined && { orderNumberLike: query['filter[orderNumber]'] }),
    ...(query['filter[status]'] !== undefined && { status: query['filter[status]'] }),
    ...(query['filter[customerId]'] !== undefined && { customerId: query['filter[customerId]'] }),
    ...(query['filter[createdAt][from]'] !== undefined && { createdAtFrom: query['filter[createdAt][from]'] }),
    ...(query['filter[createdAt][to]'] !== undefined && { createdAtTo: query['filter[createdAt][to]'] }),
    ...(query['filter[slaBreached]'] !== undefined && { slaBreached: query['filter[slaBreached]'] }),
  }
}

function parseOrdersCursor(raw: string | undefined): OrdersCursor | null {
  if (raw === undefined) {
    return null
  }
  const decoded = decodeCursor(raw)
  if (decoded === null || typeof decoded.v !== 'string') {
    throw new InvalidCursorError(`Cannot decode cursor: "${raw}"`, { raw })
  }
  return { v: decoded.v, id: decoded.id }
}

function toSummaryDto(view: OrderAdminSummaryView): OrderAdminSummaryDto {
  return { ...view, createdAt: view.createdAt.toISOString() }
}

function toDetailDto(result: OrderDetailAdminResult): OrderDetailAdminDto {
  return {
    ...result.order,
    createdAt: result.order.createdAt.toISOString(),
    timeline: toTimelineDto(result.timeline),
    escrowLedger: result.escrowLedger?.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })) ?? null,
    payoutSchedule: toPayoutScheduleDto(result.payoutSchedule),
    prescriptionMeta: result.prescriptionMeta,
  }
}

function toTimelineDto(timeline: OrderDetailAdminResult['timeline']): OrderDetailAdminDto['timeline'] {
  return {
    createdAt: timeline.createdAt.toISOString(),
    processingStartedAt: timeline.processingStartedAt?.toISOString() ?? null,
    pickedUpAt: timeline.pickedUpAt?.toISOString() ?? null,
    deliveredAt: timeline.deliveredAt?.toISOString() ?? null,
    slaDeadlineAt: timeline.slaDeadlineAt?.toISOString() ?? null,
    cancelReason: timeline.cancelReason,
    updatedAt: timeline.updatedAt.toISOString(),
  }
}

function toPayoutScheduleDto(payoutSchedule: OrderDetailAdminResult['payoutSchedule']): OrderDetailAdminDto['payoutSchedule'] {
  if (payoutSchedule === null) {
    return null
  }
  return { ...payoutSchedule, dueAt: payoutSchedule.dueAt?.toISOString() ?? null, paidAt: payoutSchedule.paidAt?.toISOString() ?? null }
}
