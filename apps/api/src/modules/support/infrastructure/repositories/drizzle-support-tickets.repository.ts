/**
 * `DrizzleSupportTicketsRepository` (EP-14, DTJ-279, расширен DTJ-282) — реализация
 * `SupportTicketsRepositoryPort` поверх `support_tickets`/`support_ticket_messages`
 * (`db/schema/support.ts`/`support-ticket-messages.ts`, DTJ-270/278).
 *
 * `save()` — `INSERT ... ON CONFLICT (id) DO UPDATE` (upsert по `id`): `CreateSupportTicketUseCase`
 * только вставляет новые тикеты в этом тикете, но порт объявлен как общий `save()` (DTJ-279
 * «Что сделать» п.1) — реализация уже готова для будущего "обновить существующий" без изменения
 * контракта. `is_escrow_blocking` — ЖЁСТКО `false` (не читается из entity, у неё такого сеттера
 * нет, SRS-ADM-053) — единственный источник этого значения в INSERT.
 *
 * `list()`/`saveMessage()`/`listMessagesByTicketId()` — ДОБАВЛЕНО DTJ-282, см. JSDoc порта.
 * `list()` — тот же keyset-паттерн, что `DrizzlePayoutScheduleRepository.findByPharmacy`
 * (DTJ-252): `LIMIT input.limit + 1` даёт `hasMore` без второй `COUNT`-круговой поездки.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { supportTickets, type SupportTicketRow } from '@/db/schema/support.js'
import { supportTicketMessages, type SupportTicketMessageRow } from '@/db/schema/support-ticket-messages.js'
import { SupportTicket, SupportTicketCategory, SupportTicketMessage } from '@/modules/support/domain/index.js'
import {
  SUPPORT_TICKETS_REPOSITORY,
  type SupportTicketListFilter,
  type SupportTicketListPage,
  type SupportTicketsRepositoryPort,
} from '@/modules/support/application/ports/support-tickets-repository.port.js'
import type { SupportUnitOfWorkTx } from '@/modules/support/application/ports/support-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

@Injectable()
export class DrizzleSupportTicketsRepository implements SupportTicketsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async save(ticket: SupportTicket, tx?: SupportUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const snapshot = ticket.toSnapshot()
    const row = {
      id: snapshot.id,
      orderId: snapshot.orderId,
      tenantId: snapshot.tenantId,
      channel: snapshot.channel,
      category: snapshot.category.value,
      isEscrowBlocking: ticket.isEscrowBlocking,
      status: snapshot.status,
      createdBy: snapshot.createdBy,
      description: snapshot.description,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      firstResponseDueAt: snapshot.firstResponseDueAt,
      firstRespondedAt: snapshot.firstRespondedAt,
      lastEscalatedAt: snapshot.lastEscalatedAt,
      priority: snapshot.priority,
    }
    await client
      .insert(supportTickets)
      .values(row)
      .onConflictDoUpdate({ target: supportTickets.id, set: row })
  }

  public async findById(id: string, tx?: SupportUnitOfWorkTx): Promise<SupportTicket | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(supportTickets).where(eq(supportTickets.id, id)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async list(filter: SupportTicketListFilter, tx?: SupportUnitOfWorkTx): Promise<SupportTicketListPage> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(supportTickets)
      .where(and(...listConditions(filter)))
      .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
      .limit(filter.limit + 1)
    const hasMore = rows.length > filter.limit
    const page = hasMore ? rows.slice(0, filter.limit) : rows
    const last = page[page.length - 1]
    return {
      items: page.map(toDomain),
      nextCursor: hasMore && last !== undefined ? { v: cursorCreatedAt(last.createdAt).toISOString(), id: last.id } : null,
      hasMore,
    }
  }

  public async saveMessage(message: SupportTicketMessage, tx?: SupportUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const snapshot = message.toSnapshot()
    await client.insert(supportTicketMessages).values({
      id: snapshot.id,
      ticketId: snapshot.ticketId,
      authorUserId: snapshot.authorUserId,
      authorRole: snapshot.authorRole,
      body: snapshot.body,
      createdAt: snapshot.createdAt,
    })
  }

  public async listMessagesByTicketId(ticketId: string, tx?: SupportUnitOfWorkTx): Promise<readonly SupportTicketMessage[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, ticketId))
      .orderBy(supportTicketMessages.createdAt)
    return rows.map(toMessageDomain)
  }
}

/** `list()` `WHERE` — тенант обязателен, остальные фильтры/keyset-курсор — опциональны (DTJ-282). */
function listConditions(filter: SupportTicketListFilter) {
  const conditions = [eq(supportTickets.tenantId, filter.tenantId)]
  if (filter.createdBy !== undefined) {
    conditions.push(eq(supportTickets.createdBy, filter.createdBy))
  }
  if (filter.status !== undefined) {
    conditions.push(eq(supportTickets.status, filter.status))
  }
  if (filter.category !== undefined) {
    // Cast — тот же приём, что `payout-schedule.repository.ts` `PayoutStatusValue`: невалидное
    // значение просто не совпадёт ни с одной строкой (WHERE), не бросает — permissive-фильтр.
    conditions.push(eq(supportTickets.category, filter.category as SupportTicketRow['category']))
  }
  if (filter.priority !== undefined) {
    conditions.push(eq(supportTickets.priority, filter.priority))
  }
  if (filter.cursor != null) {
    const cursorCreatedAtValue = new Date(filter.cursor.v)
    const keysetCondition = or(
      lt(supportTickets.createdAt, cursorCreatedAtValue),
      and(eq(supportTickets.createdAt, cursorCreatedAtValue), lt(supportTickets.id, filter.cursor.id)),
    )
    if (keysetCondition !== undefined) {
      conditions.push(keysetCondition)
    }
  }
  return conditions
}

/** `created_at` схема `support.ts` не несёт `.notNull()` — практически всегда заполнена (`default(NOW())`), эпоха — оборонительный фолбэк (тот же приём, что `payout-schedule.repository.ts`). */
function cursorCreatedAt(createdAt: Date | null): Date {
  return createdAt ?? new Date(0)
}

function toDomain(row: SupportTicketRow): SupportTicket {
  return SupportTicket.restore({
    id: row.id,
    tenantId: row.tenantId,
    orderId: row.orderId,
    channel: row.channel,
    category: SupportTicketCategory.fromTrusted(row.category),
    status: row.status,
    priority: row.priority,
    createdBy: row.createdBy,
    description: row.description,
    firstResponseDueAt: row.firstResponseDueAt,
    firstRespondedAt: row.firstRespondedAt,
    lastEscalatedAt: row.lastEscalatedAt,
    createdAt: row.createdAt ?? new Date(0),
    updatedAt: row.updatedAt ?? new Date(0),
  })
}

function toMessageDomain(row: SupportTicketMessageRow): SupportTicketMessage {
  return SupportTicketMessage.restore({
    id: row.id,
    ticketId: row.ticketId,
    authorUserId: row.authorUserId,
    authorRole: row.authorRole,
    body: row.body,
    createdAt: row.createdAt,
  })
}

export const SUPPORT_TICKETS_REPOSITORY_PROVIDER = {
  provide: SUPPORT_TICKETS_REPOSITORY,
  useClass: DrizzleSupportTicketsRepository,
} as const
