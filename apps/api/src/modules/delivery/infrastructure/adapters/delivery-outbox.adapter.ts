/**
 * `DrizzleDeliveryOutboxAdapter` (EP-13, DTJ-320) — реализация `DeliveryOutboxPort` поверх ОБЩЕЙ
 * таблицы `outbox` (EP-01, DTJ-016). 1:1 паттерн `drizzle-support-outbox.adapter.ts`/
 * `drizzle-payments-outbox.adapter.ts`, с ОДНИМ отличием, специфичным для этого модуля:
 *
 * **bigint-ловушка (foundIssue, не домысел):** `outbox.payload` — `jsonb`
 * (`db/schema/outbox.schema.ts`), `JSON.stringify` не умеет сериализовывать `bigint` (кидает
 * `TypeError`) — 1:1 та же причина, что задокументирована `payments/domain/payment-domain-event.ts`
 * (`holdAmountDiram: string, не bigint`). `DeliveryDomainEvent.CashReconciliationDiscrepancyEvent.
 * discrepancyDiram` — `bigint` (домен намеренно остаётся денежно-типизированным, `02` §2.6/AGENTS.md
 * правило 6) — конвертация в JSON-безопасный вид сделана ЗДЕСЬ, на границе infrastructure, а не
 * правкой уже закрытого домена DTJ-313 (`delivery-domain-event.ts`/`courier-shift.entity.ts` —
 * вне `files_owned` DTJ-320, AGENTS.md правило 7): без этого `EndCourierShiftUseCase` падал бы
 * `500`-й на КАЖДОМ ненулевом расхождении наличных — ровно тот путь, который DoD тикета требует
 * НЕ блокировать закрытие смены.
 *
 * `aggregateId`/`aggregateType` — per-event (`switch` с exhaustive-проверкой, `never`-guard ниже,
 * тот же приём, что рекомендует JSDoc `delivery-domain-event.ts`): каждый из семи вариантов
 * привязан к своему естественному агрегату (`delivery_assignment`/`courier_shift`/`courier_rating`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { type DrizzleDb, DRIZZLE_DB } from '@/infrastructure/database/drizzle.provider.js'
import { outbox } from '@/db/schema/outbox.schema.js'
import {
  DELIVERY_OUTBOX,
  type DeliveryOutboxPort,
} from '@/modules/delivery/application/ports/delivery-outbox.port.js'
import type { DeliveryDomainEvent } from '@/modules/delivery/domain/delivery-domain-event.js'
import type { DeliveryUnitOfWorkTx } from '@/modules/delivery/application/ports/delivery-unit-of-work.port.js'
import { resolveDrizzleClient } from '../drizzle-tx.util.js'

const AGGREGATE_TYPE_DELIVERY_ASSIGNMENT = 'delivery_assignment'
const AGGREGATE_TYPE_COURIER_SHIFT = 'courier_shift'
const AGGREGATE_TYPE_COURIER_RATING = 'courier_rating'

interface AggregateRef {
  readonly aggregateType: string
  readonly aggregateId: string
}

@Injectable()
export class DrizzleDeliveryOutboxAdapter implements DeliveryOutboxPort {
  public constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  public async append(event: DeliveryDomainEvent, tenantId: string | null, tx: DeliveryUnitOfWorkTx): Promise<void> {
    const client = resolveDrizzleClient(this.db, tx)
    const { aggregateType, aggregateId } = resolveAggregateRef(event)
    await client.insert(outbox).values({
      eventType: event.type,
      aggregateType,
      aggregateId,
      payload: toJsonSafePayload(event),
      tenantId,
    })
  }
}

/** Единственное поле, не умещающееся в `JSON.stringify` без потерь (см. JSDoc файла): `bigint → string`. */
function toJsonSafePayload(event: DeliveryDomainEvent): Record<string, unknown> {
  if (event.type === 'CashReconciliationDiscrepancyEvent') {
    return { ...event, discrepancyDiram: event.discrepancyDiram.toString() }
  }
  return { ...event }
}

function resolveAggregateRef(event: DeliveryDomainEvent): AggregateRef {
  switch (event.type) {
    case 'DeliveryOfferCreatedEvent':
    case 'DeliveryOfferExpiredEvent':
    case 'DeliveryEscalatedToPoolEvent':
    case 'DeliveryFailedEvent':
    case 'OrderRefusedAtDoorEvent':
      return { aggregateType: AGGREGATE_TYPE_DELIVERY_ASSIGNMENT, aggregateId: event.deliveryAssignmentId }
    case 'CashReconciliationDiscrepancyEvent':
      return { aggregateType: AGGREGATE_TYPE_COURIER_SHIFT, aggregateId: event.courierShiftId }
    case 'CourierRatedEvent':
      return { aggregateType: AGGREGATE_TYPE_COURIER_RATING, aggregateId: event.orderId }
    default:
      return assertUnreachable(event)
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`DeliveryDomainEvent: unhandled event type ${JSON.stringify(value)}`)
}

export const DELIVERY_OUTBOX_PROVIDER = {
  provide: DELIVERY_OUTBOX,
  useClass: DrizzleDeliveryOutboxAdapter,
} as const
