/**
 * `DrizzleReturnsRepository` (EP-11, DTJ-273) — реализация `ReturnsRepositoryPort` поверх
 * `order_returns` (`db/schema/returns.ts`, DTJ-270). `save()` — upsert по `id` (тот же приём,
 * что `DrizzleSupportTicketsRepository`, DTJ-279): use case'ы этого тикета читают/пишут ОДНУ
 * строку целиком (`02` §1.1 запрещённая таблица — сущность БД не покидает этот файл напрямую).
 *
 * **foundIssue (отчёт сдачи DTJ-273)**: `order_returns` не хранит `initiator_role` (гэп схемы
 * DTJ-270/271 — `OrderReturnSnapshot.initiatorRole` требуется доменом, колонки в миграции
 * `0039_returns_disputes_support.sql` нет). Поле НЕ используется ни одним инвариантом домена
 * (`order-return.entity.ts` только присваивает/возвращает его) и НЕ входит в `OrderReturnDto`
 * (`packages/contracts/src/returns.ts`) — реконструкция подставляет документированную заглушку
 * `UNKNOWN_INITIATOR_ROLE`, не блокирует функциональность. Настоящая починка (миграция ALTER
 * TABLE + колонка) — вне периметра этого тикета, см. финальный отчёт координатору.
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, ne } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { orderReturns, type OrderReturnRow } from '@/db/schema/returns.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { OrderReturn, ReturnReason, ReturnDisposition } from '@/modules/returns/domain/index.js'
import {
  RETURNS_REPOSITORY,
  type ReturnsRepositoryPort,
} from '@/modules/returns/application/ports/returns-repository.port.js'
import type { ReturnsUnitOfWorkTx } from '@/modules/returns/application/ports/orders-facade.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const UNKNOWN_INITIATOR_ROLE = 'unknown'
const TERMINAL_STATUS = 'return_confirmed'

@Injectable()
export class DrizzleReturnsRepository implements ReturnsRepositoryPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async findById(id: string, tx?: ReturnsUnitOfWorkTx): Promise<OrderReturn | null> {
    const client = resolveDrizzleClient(this.db, tx)
    const [row] = await client.select().from(orderReturns).where(eq(orderReturns.id, id)).limit(1)
    return row === undefined ? null : toDomain(row)
  }

  public async findActiveByOrderId(orderId: string, tx?: ReturnsUnitOfWorkTx): Promise<readonly string[]> {
    const client = resolveDrizzleClient(this.db, tx)
    const rows = await client
      .select({ id: orderReturns.id })
      .from(orderReturns)
      .where(and(eq(orderReturns.orderId, orderId), ne(orderReturns.status, TERMINAL_STATUS)))
    return rows.map((row) => row.id)
  }

  public async save(orderReturn: OrderReturn, tx?: ReturnsUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const snapshot = orderReturn.toSnapshot()
    const row = {
      id: snapshot.id,
      orderId: snapshot.orderId,
      status: snapshot.status,
      reason: snapshot.reason.value,
      disposition: snapshot.disposition?.value ?? null,
      initiatedBy: snapshot.initiatedBy,
      courierId: snapshot.courierId,
      courierReturnFeeDiram: snapshot.courierReturnFeeDiram.diram,
      packagingIntact: snapshot.packagingIntact,
      checklistNotes: snapshot.checklistNotes,
      adminOverrideReason: snapshot.adminOverrideReason,
      adminOverrideBy: snapshot.adminOverrideBy,
      requestedAt: snapshot.requestedAt,
      resolvedAt: snapshot.resolvedAt,
    }
    await client.insert(orderReturns).values(row).onConflictDoUpdate({ target: orderReturns.id, set: row })
  }
}

function toDisposition(value: string | null): ReturnDisposition | null {
  switch (value) {
    case 'restock':
      return ReturnDisposition.restock()
    case 'destroy':
      return ReturnDisposition.destroy()
    case 'pending_inspection':
      return ReturnDisposition.pendingInspection()
    default:
      return null
  }
}

function toDomain(row: OrderReturnRow): OrderReturn {
  return OrderReturn.restore({
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    reason: ReturnReason.fromTrusted(row.reason),
    disposition: toDisposition(row.disposition),
    initiatedBy: row.initiatedBy,
    initiatorRole: UNKNOWN_INITIATOR_ROLE,
    courierId: row.courierId,
    courierReturnFeeDiram: Money.fromDiram(row.courierReturnFeeDiram),
    packagingIntact: row.packagingIntact,
    checklistNotes: row.checklistNotes,
    adminOverrideReason: row.adminOverrideReason,
    adminOverrideBy: row.adminOverrideBy,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
  })
}

export const RETURNS_REPOSITORY_PROVIDER = {
  provide: RETURNS_REPOSITORY,
  useClass: DrizzleReturnsRepository,
} as const
