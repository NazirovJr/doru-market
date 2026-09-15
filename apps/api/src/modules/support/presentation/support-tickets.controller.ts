/**
 * `SupportTicketsController` (EP-14, DTJ-282, SRS-ADM-074/SRS-API-038) — `/api/v1/support-tickets`.
 *
 * Обоснованная достройка сверх буквального SRS (см. «Риски» DTJ-282): единственный явно
 * специфицированный маршрут — `POST /` (SRS-ADM-074). `GET /`/`GET /:id`/`POST /:id/messages`/
 * `POST /:id/status` — необходимая достройка для функциональной полноты «облегчённой очереди
 * обращений» (иначе тикеты некому читать/резолвить).
 *
 * `@Roles(...)` НЕ объявлен на `create`/`list`/`detail`/`addTicketMessage` — `RolesGuard` без
 * декоратора пропускает ЛЮБУЮ аутентифицированную роль (её же JSDoc, SRS-API-036): создать тикет/
 * читать свои тикеты/отвечать в свой тикет может любой сотрудник платформы, не только `customer`
 * (ticket «Что сделать» п.1). Тонкая RBAC-детализация (владение, «свой тенант») — целиком в
 * `SupportTicketsPolicy`/use case'ах (application), не в guard'е (`02` §3.4). `changeTicketStatus`
 * — ЕДИНСТВЕННЫЙ маршрут с `@Roles('support_agent', 'super_admin')`: резолюция — грубо ролевая
 * граница, не просто «владение», уточнять нечего.
 *
 * `POST /` возвращает ПОЛНЫЙ `SupportTicketDto` (АС1 DTJ-282) — `SupportFacade.createTicket`
 * (DTJ-281) отдаёт только `{ ticketId }`, поэтому создание завершается вторым чтением через
 * `GetSupportTicketUseCase` (актор — только что создавший тикет, `canRead` тривиально проходит
 * веткой владельца) — простая и корректная альтернатива дублированию SLA-арифметики use case'а
 * создания в контроллере.
 *
 * `Idempotency-Key` НЕ требуется ни на одном маршруте (DTJ-282 «Что сделать» п.1: нет платёжного
 * эффекта — см. также JSDoc `ChangeSupportTicketStatusUseCase`).
 */
import { Body, Controller, Get, HttpCode, Inject, InternalServerErrorException, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common'
import { encodeCursor, ErrorCode, ok, type PaginationMeta, type SuccessEnvelope, type SupportTicketDto } from '@dorutj/contracts'
import { HttpStatus } from '@/common/http/http-status.constants.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import {
  AddSupportTicketMessageUseCase,
} from '../application/use-cases/add-support-ticket-message.use-case.js'
import { ChangeSupportTicketStatusUseCase } from '../application/use-cases/change-support-ticket-status.use-case.js'
import { GetSupportTicketUseCase } from '../application/use-cases/get-support-ticket.use-case.js'
import { ListSupportTicketsUseCase } from '../application/use-cases/list-support-tickets.use-case.js'
import type { SupportTicketsPolicyActor } from '../application/support-tickets.policy.js'
import { SUPPORT_FACADE, type SupportFacade } from '../index.js'
import { AddMessageSchema, type AddMessageDto } from './dto/add-message.dto.js'
import { ChangeStatusSchema, type ChangeStatusDto } from './dto/change-status.dto.js'
import { CreateSupportTicketSchema, type CreateSupportTicketDto } from './dto/create-support-ticket.dto.js'
import { ListSupportTicketsQuerySchema, type ListSupportTicketsQueryDto } from './dto/list-support-tickets-query.dto.js'
import { toSupportTicketDto } from './mappers/support-ticket.mapper.js'
import { parseListCursor } from './support-tickets-query.util.js'

const ID_PARSE_UUID = new ParseUUIDPipe({ version: '4' })
const RESOLVE_ROLES = ['support_agent', 'super_admin'] as const

@Controller({ path: 'support-tickets', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class SupportTicketsController {
  // 5 зависимостей — тот же обоснованный превышение C5 (max-params ≤3), что use case'ы этого же
  // модуля (`CreateSupportTicketUseCase`/`AddSupportTicketMessageUseCase`): явный @Inject на
  // каждом use case держит граф зависимостей видимым в providers[] модуля, а не скрывает его за
  // анонимной фабрикой/bag-объектом без собственной семантики.
  // eslint-disable-next-line max-params -- см. комментарий выше
  public constructor(
    @Inject(SUPPORT_FACADE) private readonly supportFacade: SupportFacade,
    @Inject(GetSupportTicketUseCase) private readonly getTicket: GetSupportTicketUseCase,
    @Inject(ListSupportTicketsUseCase) private readonly listTickets: ListSupportTicketsUseCase,
    @Inject(AddSupportTicketMessageUseCase) private readonly addMessage: AddSupportTicketMessageUseCase,
    @Inject(ChangeSupportTicketStatusUseCase) private readonly changeStatus: ChangeSupportTicketStatusUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.Created)
  public async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(CreateSupportTicketSchema)) body: CreateSupportTicketDto,
  ): Promise<SuccessEnvelope<SupportTicketDto>> {
    const tenantId = requireTenantId(claims)
    const { ticketId } = await this.supportFacade.createTicket({
      tenantId,
      channel: body.channel,
      category: body.category,
      createdBy: claims.sub,
      description: body.description,
      actorRole: claims.role,
      ...(body.orderId !== undefined && { orderId: body.orderId }),
    })
    const detail = await this.getTicket.execute({ ticketId, actor: toActor(claims, tenantId) })
    return ok(toSupportTicketDto(detail, detail.messages))
  }

  @Get()
  public async list(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(ListSupportTicketsQuerySchema)) query: ListSupportTicketsQueryDto,
  ): Promise<SuccessEnvelope<readonly SupportTicketDto[]>> {
    const tenantId = requireTenantId(claims)
    const result = await this.listTickets.execute({
      actor: toActor(claims, tenantId),
      limit: query.limit,
      cursor: parseListCursor(query.cursor),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.category !== undefined && { category: query.category }),
      ...(query.priority !== undefined && { priority: query.priority }),
    })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map((item) => toSupportTicketDto(item)), { pagination: meta })
  }

  @Get(':id')
  public async detail(
    @Param('id', ID_PARSE_UUID) ticketId: string,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<SupportTicketDto>> {
    const detail = await this.getTicket.execute({ ticketId, actor: toActor(claims, requireTenantId(claims)) })
    return ok(toSupportTicketDto(detail, detail.messages))
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.Created)
  public async addTicketMessage(
    @Param('id', ID_PARSE_UUID) ticketId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(AddMessageSchema)) body: AddMessageDto,
  ): Promise<SuccessEnvelope<SupportTicketDto>> {
    const detail = await this.addMessage.execute({
      ticketId,
      actor: toActor(claims, requireTenantId(claims)),
      body: body.body,
    })
    return ok(toSupportTicketDto(detail, detail.messages))
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.Ok)
  @Roles(...RESOLVE_ROLES)
  public async changeTicketStatus(
    @Param('id', ID_PARSE_UUID) ticketId: string,
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(ChangeStatusSchema)) body: ChangeStatusDto,
  ): Promise<SuccessEnvelope<SupportTicketDto>> {
    const item = await this.changeStatus.execute({
      ticketId,
      actor: toActor(claims, requireTenantId(claims)),
      status: body.status,
    })
    return ok(toSupportTicketDto(item))
  }
}

function toActor(claims: JwtClaims, tenantId: string): SupportTicketsPolicyActor {
  return { role: claims.role, userId: claims.sub, tenantId }
}

/** 1:1 с `requireTenantId` в `PharmacyTerminalQueueController`/`CheckoutController` — `super_admin`
 *  без тенанта (платформенный, вне периметра поддержки конкретного тенанта) не может использовать
 *  этот маршрут; тот же паттерн явного 500 вместо молчаливого `null`-тенанта в SQL-фильтре. */
function requireTenantId(claims: JwtClaims): string {
  if (claims.tenantId === null) {
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'support-tickets endpoints require a tenant-scoped actor (claims.tenantId is null)',
    })
  }
  return claims.tenantId
}
