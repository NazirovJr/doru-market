/**
 * Агрегат `OrderReturn` (EP-11, DTJ-271, SRS-DOM-052..056, `21-module-orders-payments-
 * escrow.md` §7.1). Ядро эпика — без него use case'ы (DTJ-273) и финансовая политика (DTJ-272)
 * не имеют на что опираться.
 *
 * Домен — чистый: ноль импортов фреймворка/Drizzle/`Date.now()` (`02` §2.6). Время — параметр
 * `now: Date` (приходит из application через порт `Clock`, тот же приём, что `Order`/
 * `InventorySyncBatch`), идентификатор — параметр `command.id` (генерируется use case через
 * `IdGenerator`, домен не вызывает `crypto.randomUUID()`).
 *
 * Ветвление `request()` (SRS-RET-001/002) и таблица переходов — `order-return.state-machine.ts`.
 * Финансовый исход (кто платит) — НЕ ответственность этой сущности, см.
 * `application/policies/return-financial-outcome.policy.ts` (DTJ-272): `OrderReturn` защищает
 * ФИЗИЧЕСКИЕ/статусные инварианты возврата, не деньги.
 */
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { ValidationError, type ReturnStatus } from '@dorutj/contracts'
import type { ReturnReason } from './value-objects/return-reason.vo.js'
import { ReturnDisposition } from './value-objects/return-disposition.vo.js'
import { isReturnTransitionAllowed } from './order-return.state-machine.js'
import { DuplicateActiveReturnError } from './errors/duplicate-active-return.error.js'
import { RestockConditionsNotMetError } from './errors/restock-conditions-not-met.error.js'
import { ControlledSubstanceMustBeDestroyedError } from './errors/controlled-substance-must-be-destroyed.error.js'
import { InvalidReturnStatusTransitionError } from './errors/invalid-return-status-transition.error.js'
import { UnsupportedReturnReasonError } from './errors/unsupported-return-reason.error.js'

const ZERO_DIRAM = 0n
/** Миллисекунд в сутках (24 * 60 * 60 * 1000) — единственное числовое значение, C6. */
const MS_PER_DAY = 86_400_000

/** SRS-RET-001 — возврат уже физически в пути к аптеке на момент `request()` (курьер везёт заказ). */
const BEFORE_DELIVERY_REASONS: ReadonlySet<string> = new Set(['refused_at_door', 'undeliverable'])

export interface OrderReturnRequestCommand {
  readonly id: string
  readonly orderId: string
  readonly reason: ReturnReason
  readonly initiatedBy: string
  readonly initiatorRole: string
  /** Обязателен, когда `reason` попадает в `BEFORE_DELIVERY_REASONS` (SRS-RET-001) — проверяется в рантайме. */
  readonly courierId?: string
  /** Обязателен вместе с `courierId` для той же ветки (REQ-RET-7 — сбор начисляется всегда). */
  readonly courierReturnFeeDiram?: Money
  /** Уже прочитанные use case'ом нетерминальные возвраты этого `orderId` (SRS-DOM-052). */
  readonly existingNonTerminalReturnIds: readonly string[]
}

export interface ConfirmReceivedChecklist {
  readonly packagingIntact: boolean
  readonly notes?: string
}

/** SRS-DOM-053 — сигналы, нужные для решения «restock допустим?», уже резолвленные use case'ом (домен не читает catalog/tenant_settings). */
export interface ReturnRestockEligibility {
  readonly expiryDate: Date
  readonly minRemainingDays: number
  /** SRS-DOM-054 — агрегированный флаг «хотя бы одна позиция возврата подконтрольна» (`control_category !== 'none'`). */
  readonly hasControlledSubstance: boolean
}

export interface ConfirmReceivedCommand {
  readonly checklist: ConfirmReceivedChecklist
  readonly restockEligibility: ReturnRestockEligibility
  /** `true` — фармацевт запрашивает restock; при отказе физического состояния/подконтрольности — ошибка (см. JSDoc `confirmReceived`). */
  readonly requestRestock: boolean
}

export interface OrderReturnSnapshot {
  readonly id: string
  readonly orderId: string
  readonly status: ReturnStatus
  readonly reason: ReturnReason
  readonly disposition: ReturnDisposition | null
  readonly initiatedBy: string
  readonly initiatorRole: string
  readonly courierId: string | null
  readonly courierReturnFeeDiram: Money
  readonly packagingIntact: boolean | null
  readonly checklistNotes: string | null
  readonly adminOverrideReason: string | null
  readonly adminOverrideBy: string | null
  readonly requestedAt: Date
  readonly resolvedAt: Date | null
}

export class OrderReturn {
  private _status: ReturnStatus
  private _disposition: ReturnDisposition | null
  private _courierId: string | null
  private _courierReturnFeeDiram: Money
  private _packagingIntact: boolean | null
  private _checklistNotes: string | null
  private _adminOverrideReason: string | null
  private _adminOverrideBy: string | null
  private _resolvedAt: Date | null

  readonly id: string
  readonly orderId: string
  readonly reason: ReturnReason
  readonly initiatedBy: string
  readonly initiatorRole: string
  readonly requestedAt: Date

  private constructor(snapshot: OrderReturnSnapshot) {
    this.id = snapshot.id
    this.orderId = snapshot.orderId
    this.reason = snapshot.reason
    this.initiatedBy = snapshot.initiatedBy
    this.initiatorRole = snapshot.initiatorRole
    this.requestedAt = snapshot.requestedAt
    this._status = snapshot.status
    this._disposition = snapshot.disposition
    this._courierId = snapshot.courierId
    this._courierReturnFeeDiram = snapshot.courierReturnFeeDiram
    this._packagingIntact = snapshot.packagingIntact
    this._checklistNotes = snapshot.checklistNotes
    this._adminOverrideReason = snapshot.adminOverrideReason
    this._adminOverrideBy = snapshot.adminOverrideBy
    this._resolvedAt = snapshot.resolvedAt
  }

  /**
   * SRS-RET-001/002/003. `reason='undelivered'` — `UnsupportedReturnReasonError` (переадресация
   * на спор, вторая линия защиты — use case DTJ-273 обязан отфильтровать её РАНЬШЕ вызова этой
   * фабрики). Дубликат нетерминального возврата — `DuplicateActiveReturnError` (SRS-DOM-052).
   */
  static request(command: OrderReturnRequestCommand, now: Date): OrderReturn {
    assertNoDuplicateActive(command)
    assertSupportedReason(command)

    if (isBeforeDeliveryReason(command.reason)) {
      assertCourierSupplied(command)
      return OrderReturn.buildInitial(command, { status: 'return_in_transit', courierId: command.courierId ?? null }, now)
    }
    return OrderReturn.buildInitial(command, { status: 'return_requested', courierId: null }, now)
  }

  private static buildInitial(
    command: OrderReturnRequestCommand,
    init: { readonly status: ReturnStatus; readonly courierId: string | null },
    now: Date,
  ): OrderReturn {
    return new OrderReturn({
      id: command.id,
      orderId: command.orderId,
      status: init.status,
      reason: command.reason,
      disposition: null,
      initiatedBy: command.initiatedBy,
      initiatorRole: command.initiatorRole,
      courierId: init.courierId,
      courierReturnFeeDiram: command.courierReturnFeeDiram ?? Money.fromDiram(ZERO_DIRAM),
      packagingIntact: null,
      checklistNotes: null,
      adminOverrideReason: null,
      adminOverrideBy: null,
      requestedAt: now,
      resolvedAt: null,
    })
  }

  /** `return_requested → return_in_transit` (SRS-RET-002 — курьер назначен ПОСЛЕ запроса возврата). */
  markInTransit(courierId: string, courierReturnFeeDiram: Money): void {
    this.assertTransition('return_in_transit')
    this.setInTransit(courierId, courierReturnFeeDiram)
  }

  /** `return_rejected → return_in_transit` — повторная попытка (SRS-DOM-056, НЕ-терминальность `return_rejected`). */
  retryTransit(courierId: string, courierReturnFeeDiram: Money): void {
    this.assertTransition('return_in_transit')
    this.setInTransit(courierId, courierReturnFeeDiram)
    this._resolvedAt = null
  }

  private setInTransit(courierId: string, courierReturnFeeDiram: Money): void {
    this._status = 'return_in_transit'
    this._courierId = courierId
    this._courierReturnFeeDiram = courierReturnFeeDiram
  }

  /**
   * `return_in_transit → return_confirmed` — приёмка ВСЕГДА завершается этим статусом
   * (SRS-DOM-053, п.3 задания DTJ-271: «переход всё равно происходит, но disposition
   * принудительно destroy»). Бросает `ControlledSubstanceMustBeDestroyedError`/
   * `RestockConditionsNotMetError` ТОЛЬКО если `command.requestRestock=true` — иначе просто
   * возвращает вычисленный `disposition` (SRS-DOM-054, критерии приёмки 2/3 DTJ-271).
   */
  confirmReceived(command: ConfirmReceivedCommand, now: Date): { readonly disposition: ReturnDisposition } {
    this.assertTransition('return_confirmed')
    this._status = 'return_confirmed'
    this._packagingIntact = command.checklist.packagingIntact
    this._checklistNotes = command.checklist.notes ?? null
    this._resolvedAt = now

    if (command.requestRestock && command.restockEligibility.hasControlledSubstance) {
      this._disposition = ReturnDisposition.destroy()
      throw new ControlledSubstanceMustBeDestroyedError({ returnId: this.id, orderId: this.orderId })
    }
    if (command.requestRestock && !isPhysicallyRestockEligible(command, now)) {
      this._disposition = ReturnDisposition.destroy()
      throw new RestockConditionsNotMetError({
        returnId: this.id,
        orderId: this.orderId,
        packagingIntact: command.checklist.packagingIntact,
      })
    }
    this._disposition = command.requestRestock ? ReturnDisposition.restock() : ReturnDisposition.destroy()
    return { disposition: this._disposition }
  }

  /** `return_in_transit → return_rejected` (SRS-DOM-056 — НЕ терминален, REQ-RET-13). */
  reject(reason: string, now: Date): void {
    this.assertTransition('return_rejected')
    this._status = 'return_rejected'
    this._checklistNotes = reason
    this._resolvedAt = now
  }

  /**
   * `return_rejected → return_confirmed` (REQ-RET-9). `reason` обязателен —
   * `order_returns.admin_override_reason` `NOT NULL` при этом переходе. Форсирует `disposition
   * = restock` (административное решение переопределяет отказ фармацевта).
   */
  adminOverride(actorId: string, reason: string, now: Date): void {
    if (reason.trim().length === 0) {
      throw new ValidationError('adminOverride reason is required (REQ-RET-9)', { returnId: this.id })
    }
    this.assertTransition('return_confirmed')
    this._status = 'return_confirmed'
    this._adminOverrideBy = actorId
    this._adminOverrideReason = reason
    this._disposition = ReturnDisposition.restock()
    this._resolvedAt = now
  }

  private assertTransition(to: ReturnStatus): void {
    if (!isReturnTransitionAllowed(this._status, to)) {
      throw new InvalidReturnStatusTransitionError({ returnId: this.id, from: this._status, to })
    }
  }

  get status(): ReturnStatus {
    return this._status
  }

  get disposition(): ReturnDisposition | null {
    return this._disposition
  }

  get courierId(): string | null {
    return this._courierId
  }

  get courierReturnFeeDiram(): Money {
    return this._courierReturnFeeDiram
  }

  get packagingIntact(): boolean | null {
    return this._packagingIntact
  }

  get checklistNotes(): string | null {
    return this._checklistNotes
  }

  get adminOverrideReason(): string | null {
    return this._adminOverrideReason
  }

  get adminOverrideBy(): string | null {
    return this._adminOverrideBy
  }

  get resolvedAt(): Date | null {
    return this._resolvedAt
  }

  /** `restore` — доверие БД, повторная валидация не выполняется (репозиторий, DTJ-273). */
  static restore(snapshot: OrderReturnSnapshot): OrderReturn {
    return new OrderReturn(snapshot)
  }

  toSnapshot(): OrderReturnSnapshot {
    return {
      id: this.id,
      orderId: this.orderId,
      status: this._status,
      reason: this.reason,
      disposition: this._disposition,
      initiatedBy: this.initiatedBy,
      initiatorRole: this.initiatorRole,
      courierId: this._courierId,
      courierReturnFeeDiram: this._courierReturnFeeDiram,
      packagingIntact: this._packagingIntact,
      checklistNotes: this._checklistNotes,
      adminOverrideReason: this._adminOverrideReason,
      adminOverrideBy: this._adminOverrideBy,
      requestedAt: this.requestedAt,
      resolvedAt: this._resolvedAt,
    }
  }
}

function isBeforeDeliveryReason(reason: ReturnReason): boolean {
  return BEFORE_DELIVERY_REASONS.has(reason.value)
}

function assertNoDuplicateActive(command: OrderReturnRequestCommand): void {
  if (command.existingNonTerminalReturnIds.length > 0) {
    throw new DuplicateActiveReturnError({
      orderId: command.orderId,
      conflictingReturnId: command.existingNonTerminalReturnIds[0],
    })
  }
}

function assertSupportedReason(command: OrderReturnRequestCommand): void {
  if (command.reason.value === 'undelivered') {
    throw new UnsupportedReturnReasonError({
      orderId: command.orderId,
      reason: command.reason.value,
      hint: 'undelivered is redirected to SupportFacade/OrderDispute, not OrderReturn (SRS-RET-003)',
    })
  }
}

function assertCourierSupplied(command: OrderReturnRequestCommand): void {
  if (command.courierId === undefined || command.courierId.length === 0) {
    throw new ValidationError('courierId is required when reason is refused_at_door/undeliverable (SRS-RET-001)', {
      orderId: command.orderId,
      reason: command.reason.value,
    })
  }
  if (command.courierReturnFeeDiram === undefined) {
    throw new ValidationError('courierReturnFeeDiram is required together with courierId (REQ-RET-7)', {
      orderId: command.orderId,
    })
  }
}

/** SRS-DOM-053 — упаковка цела + срок годности с буфером. `cold_chain_breach_suspected` — см. риски DTJ-271: значения нет в enum `return_reason`, условие всегда истинно. */
function isPhysicallyRestockEligible(command: ConfirmReceivedCommand, now: Date): boolean {
  const bufferMs = command.restockEligibility.minRemainingDays * MS_PER_DAY
  const isExpiryOk = command.restockEligibility.expiryDate.getTime() > now.getTime() + bufferMs
  return isExpiryOk && command.checklist.packagingIntact
}
