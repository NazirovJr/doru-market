/**
 * `DrizzleSupportTicketsRepository` (EP-14, DTJ-279) — реализация `SupportTicketsRepositoryPort`
 * поверх `support_tickets` (`db/schema/support.ts`, DTJ-270/278).
 *
 * `save()` — `INSERT ... ON CONFLICT (id) DO UPDATE` (upsert по `id`): `CreateSupportTicketUseCase`
 * только вставляет новые тикеты в этом тикете, но порт объявлен как общий `save()` (DTJ-279
 * «Что сделать» п.1) — реализация уже готова для будущего "обновить существующий" без изменения
 * контракта (`resolve()`/`transitionTo()`-мутации — тикеты вне периметра этой волны, DTJ-281+).
 * `is_escrow_blocking` — ЖЁСТКО `false` (не читается из entity, у неё такого сеттера нет,
 * SRS-ADM-053) — единственный источник этого значения в INSERT.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { supportTickets, type SupportTicketRow } from '@/db/schema/support.js'
import { SupportTicket, SupportTicketCategory } from '@/modules/support/domain/index.js'
import {
  SUPPORT_TICKETS_REPOSITORY,
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
    createdAt: row.createdAt ?? new Date(0),
    updatedAt: row.updatedAt ?? new Date(0),
  })
}

export const SUPPORT_TICKETS_REPOSITORY_PROVIDER = {
  provide: SUPPORT_TICKETS_REPOSITORY,
  useClass: DrizzleSupportTicketsRepository,
} as const
