/**
 * `DrizzleEscrowLedgerRepository` (EP-10, DTJ-240) — реализация `EscrowLedgerRepository`
 * (`application/ports/escrow-ledger-repository.port.ts`) поверх `escrow_ledger`
 * (DTJ-236, `apps/api/src/db/schema/payments.ts`, миграция `0029_payments.sql`).
 *
 * Append-only: единственный метод записи — `append()`, реализованный через `INSERT`. Метод
 * `update`/`delete` НЕ РЕАЛИЗОВАН, потому что порт его не объявляет (компиляционная гарантия
 * AC4 живёт в порте, не здесь — см. JSDoc `escrow-ledger-repository.port.ts`).
 *
 * `tx` — `EscrowLedgerUnitOfWorkTx` (`= unknown`), резолвится в конкретный Drizzle-клиент
 * через `resolveDrizzleClient` (тот же паттерн, что `orders/infrastructure/repositories/
 * drizzle-tx.util.ts`, DTJ-227) — не переиспользуем чужую копию НАПРЯМУЮ: межмодульный
 * deep-import чужой `infrastructure/**` запрещён `dependency-cruiser`
 * (`no-cross-module-deep-import`, `02` §1.2), поэтому у `payments` СВОЯ маленькая копия.
 *
 * `sumByType` суммирует в JS, не SQL `SUM()`: объём строк на заказ — единицы (план счетов
 * §4.1), лишний раунд-трип к диалекту SQL ради `COALESCE(SUM(...),0)` не оправдан, а
 * bigint-арифметика в JS остаётся ТОЧНОЙ (правило 6 AGENTS.md — целые дирамы, не float).
 *
 * ТЕНАНТ-ИЗОЛЯЦИЯ (SRS-API-043/046, замечание CTO при приёмке DTJ-240): `escrow_ledger` СВОЕЙ
 * колонки `tenant_id` не несёт (канонная схема Группы E — не упущение, DDL не трогаем).
 * `findByOrderId`/`sumByType` скоупят через `EXISTS (SELECT 1 FROM orders WHERE id = :orderId
 * AND tenant_id = :tenantId)` — тот же приём, что `DrizzleCartRepository.findItemsByCartId`
 * (`orders/infrastructure/repositories/cart.repository.ts`, DTJ-223). Здесь — типизированный
 * `.select()` с `sql`-фрагментом ВНУТРИ `and()`, а не полностью сырой `db.execute(sql...)`,
 * как у `cart.repository.ts`: там сырой SQL нужен был для атомарного `UPDATE ... EXISTS` в
 * ОДНОМ операторе (TOCTOU-защита мутации); здесь оба метода — чистые `SELECT`, мутации нет,
 * а типизированный `.select()` сохраняет автоматическое bigint-декодирование `amount_diram`
 * (`mode: 'bigint'`, `db/schema/payments.ts`) — сырой `db.execute()` вернул бы его строкой
 * (`node-postgres` не конвертирует `int8` без явного `mode`), что пришлось бы парсить вручную
 * второй раз. Смешивание типизированного eq() и raw-фрагмента sql внутри and() —
 * существующий приём проекта (`orders/infrastructure/adapters/inventory-facade.adapter.ts:108`),
 * не новый. Чужой `tenantId` ⇒ подзапрос по `orders` даёт 0 строк ⇒ `EXISTS` ложен ⇒ пустой
 * результат/`0n`
 * (SRS-API-046: чужая финансовая запись не подтверждается как существующая).
 *
 * НЕ забинжен ни к одному use case в этом тикете (нет вызывающего кода — DTJ-244/245/246 вне
 * периметра) — тот же приём, что `MockBankProvider`/`MockBankWebhookVerifierAdapter`
 * (DTJ-238): провайдер зарегистрирован в `payments.module.ts` заранее, DI-граф резолвится
 * СЕЙЧАС (`payments.module.full-boot.di.spec.ts`), реальный вызывающий код появится позже.
 */
import { Inject, Injectable } from '@nestjs/common'
import { eq, and, sql } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { escrowLedger } from '@/db/schema/payments.js'
import { orders } from '@/db/schema/orders.js'
import {
  type EscrowLedgerRepository,
  type EscrowLedgerUnitOfWorkTx,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import { EscrowLedgerEntry, type EscrowEntryType } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'

const ZERO_DIRAM = 0n

type EscrowLedgerRow = typeof escrowLedger.$inferSelect

@Injectable()
export class DrizzleEscrowLedgerRepository implements EscrowLedgerRepository {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async append(entry: EscrowLedgerEntry, tx?: EscrowLedgerUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    await client.insert(escrowLedger).values({
      orderId: entry.orderId,
      entryType: entry.entryType,
      direction: entry.direction,
      amountDiram: entry.amountDiram.diram,
      paymentTransactionRef: entry.paymentTransactionRef,
      reason: entry.reason,
      actorUserId: entry.actorUserId,
    })
  }

  public async findByOrderId(tenantId: string, orderId: string): Promise<EscrowLedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(escrowLedger)
      .where(and(eq(escrowLedger.orderId, orderId), orderBelongsToTenant(tenantId, orderId)))
      .orderBy(escrowLedger.createdAt)
    return rows.map(toDomainEntry)
  }

  public async sumByType(tenantId: string, orderId: string, entryType: EscrowEntryType): Promise<bigint> {
    const rows = await this.db
      .select({ amountDiram: escrowLedger.amountDiram })
      .from(escrowLedger)
      .where(
        and(
          eq(escrowLedger.orderId, orderId),
          eq(escrowLedger.entryType, entryType),
          orderBelongsToTenant(tenantId, orderId),
        ),
      )
    return rows.reduce((acc, row) => acc + row.amountDiram, ZERO_DIRAM)
  }
}

function toDomainEntry(row: EscrowLedgerRow): EscrowLedgerEntry {
  return EscrowLedgerEntry.create({
    orderId: row.orderId,
    entryType: row.entryType,
    direction: row.direction,
    amountDiram: Money.fromDiram(row.amountDiram),
    paymentTransactionRef: row.paymentTransactionRef,
    reason: row.reason,
    actorUserId: row.actorUserId,
  })
}

/**
 * `EXISTS (SELECT 1 FROM orders WHERE id = :orderId AND tenant_id = :tenantId)` — см. JSDoc
 * файла (ТЕНАНТ-ИЗОЛЯЦИЯ). `orders`-импорт из чужого модуля `db/schema` — это Drizzle-схема
 * (общая инфраструктура, не `modules/orders/domain|application/**`), не межмодульный
 * deep-import: `dependency-cruiser` не запрещает читать таблицу другого модуля из своего
 * `infrastructure`-слоя, запрещён только импорт чужих `domain`/`application` (`02` §1.2).
 */
function orderBelongsToTenant(tenantId: string, orderId: string): ReturnType<typeof sql> {
  return sql`EXISTS (SELECT 1 FROM ${orders} WHERE ${orders.id} = ${orderId} AND ${orders.tenantId} = ${tenantId})`
}

/** См. JSDoc файла — тот же паттерн, что `orders/infrastructure/repositories/drizzle-tx.util.ts`. */
function resolveDrizzleClient(db: DrizzleDb, tx: EscrowLedgerUnitOfWorkTx): DrizzleDb {
  return (tx ?? db) as DrizzleDb
}
