/** Append-only снэпшот телеметрии воронки: фабрика валидирует и строит, домен не мутирует и не читает обратно. */
import { ValidationError } from '@dorutj/contracts'

// Единственное место перечисления типов события — незнакомый eventType иначе тихо создавал бы
// «мёртвый» тип, невидимый воронке.
export const PRODUCT_EVENT_TYPES = [
  'search_performed',
  'analog_shown',
  'analog_clicked',
  'added_to_cart',
  'order_placed',
] as const

export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number]

const PRODUCT_EVENT_TYPE_SET: ReadonlySet<string> = new Set(PRODUCT_EVENT_TYPES)

export function isProductEventType(value: string): value is ProductEventType {
  return PRODUCT_EVENT_TYPE_SET.has(value)
}

// order_placed создаётся только серверными use case'ами (checkout, DTJ-380 через AnalyticsFacade) —
// публичный батч-эндпоинт (DTJ-379) не должен принимать его от клиента: иначе бот пишет
// произвольный savingsDiram под order_placed, минуя проверку orderId воронкой (DTJ-381).
const SERVER_ONLY_PRODUCT_EVENT_TYPES: ReadonlySet<ProductEventType> = new Set(['order_placed'])

export const CLIENT_PRODUCT_EVENT_TYPES: readonly ProductEventType[] = PRODUCT_EVENT_TYPES.filter(
  (type) => !SERVER_ONLY_PRODUCT_EVENT_TYPES.has(type),
)

export function isClientProductEventType(value: string): value is ProductEventType {
  return isProductEventType(value) && !SERVER_ONLY_PRODUCT_EVENT_TYPES.has(value)
}

export interface ProductEventCreateCommand {
  readonly tenantId: string
  readonly userId?: string | null
  readonly sessionId: string
  readonly eventType: string
  readonly medicineId?: string | null
  readonly pharmacyId?: string | null
  readonly orderId?: string | null
  readonly savingsDiram?: bigint | null
  readonly metadata?: Record<string, unknown>
}

export interface ProductEventSnapshot {
  readonly tenantId: string
  readonly userId: string | null
  readonly sessionId: string
  readonly eventType: ProductEventType
  readonly medicineId: string | null
  readonly pharmacyId: string | null
  readonly orderId: string | null
  readonly savingsDiram: bigint | null
  readonly metadata: Record<string, unknown>
  readonly occurredAt: Date
}

export class ProductEvent {
  private constructor(private readonly snapshot: ProductEventSnapshot) {}

  // id не часть фабрики — генерируется БД (см. db/schema/product-events.ts), тот же приём, что notifications.
  static create(command: ProductEventCreateCommand, occurredAt: Date): ProductEvent {
    assertSessionIdPresent(command.sessionId)
    assertKnownEventType(command.eventType)
    return new ProductEvent({
      tenantId: command.tenantId,
      userId: command.userId ?? null,
      sessionId: command.sessionId,
      eventType: command.eventType,
      medicineId: command.medicineId ?? null,
      pharmacyId: command.pharmacyId ?? null,
      orderId: command.orderId ?? null,
      savingsDiram: command.savingsDiram ?? null,
      metadata: command.metadata ?? {},
      occurredAt,
    })
  }

  get tenantId(): string {
    return this.snapshot.tenantId
  }

  get userId(): string | null {
    return this.snapshot.userId
  }

  get sessionId(): string {
    return this.snapshot.sessionId
  }

  get eventType(): ProductEventType {
    return this.snapshot.eventType
  }

  get occurredAt(): Date {
    return this.snapshot.occurredAt
  }

  toSnapshot(): ProductEventSnapshot {
    return this.snapshot
  }
}

function assertKnownEventType(eventType: string): asserts eventType is ProductEventType {
  if (!isProductEventType(eventType)) {
    throw new ValidationError(`Unknown product event type "${eventType}"`, {
      eventType,
      knownEventTypes: PRODUCT_EVENT_TYPES,
    })
  }
}

function assertSessionIdPresent(sessionId: string): void {
  if (sessionId.trim().length === 0) {
    throw new ValidationError('sessionId is required for product_events')
  }
}
