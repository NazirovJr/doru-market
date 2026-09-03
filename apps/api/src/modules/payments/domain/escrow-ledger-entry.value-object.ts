/**
 * `EscrowLedgerEntry` (EP-10, DTJ-240) — Value Object одной строки `escrow_ledger`
 * (`21-module-orders-payments-escrow.md` §4.1, SRS-DOM-031/067, SRS-PAY-010/011).
 *
 * Append-only факт двойной записи: без сеттеров, без `id`/`createdAt` (генерируются
 * инфраструктурой при вставке — VO описывает НАМЕРЕНИЕ записи, не персистентную строку).
 * Приватный конструктор + фабрика `create()` — невалидное состояние не конструируется
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.2).
 *
 * `direction` — ОТДЕЛЬНОЕ поле, не отрицательный `Money` (SRS-DOM-067): `Money` инвариантно
 * `>= 0` (`money.vo.ts`), знак проводки кодируется здесь. `amountDiram` дополнительно обязан
 * быть СТРОГО положительным (`> 0`, не `>= 0`) — нулевая проводка ledger'а бессмысленна,
 * это правило самого агрегата, не `Money`, поэтому проверяется здесь, а не в VO `Money`.
 *
 * Опциональные поля — `T | null` (не `T | undefined`/`?:`): `exactOptionalPropertyTypes:
 * true` (`tsconfig.base.json`) делает ручное присваивание опционального `?:`-поля из
 * опционального параметра ошибкой компиляции TS2412 (см. JSDoc `payment-provider.error.ts`,
 * тот же модуль); `T | null`, как у `OrderSnapshot`/`Order` (`orders/domain/order.entity.ts`),
 * этой проблемы не имеет.
 *
 * `orderId` — часть VO (не отдельный параметр `EscrowLedgerRepository.append`): единственный
 * способ репозиторию узнать, к какому заказу относится проводка при вставке.
 */
import { InvalidMoneyError } from '@/shared-kernel/domain/errors/invalid-money.error.js'
import type { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { AdjustmentRequiresReasonError } from './errors/adjustment-requires-reason.error.js'

/** `escrow_ledger.entry_type` (1:1 `escrow_entry_type` enum, `db/schema/enums.schema.ts`). */
export type EscrowEntryType =
  | 'hold_created'
  | 'platform_fee_captured'
  | 'captured_to_pharmacy'
  | 'refunded_to_customer'
  | 'partially_refunded'
  | 'adjustment'

/** `escrow_ledger.direction` (1:1 `escrow_entry_direction` enum). */
export type EscrowEntryDirection = 'debit' | 'credit'

const ADJUSTMENT_ENTRY_TYPE: EscrowEntryType = 'adjustment'

export interface EscrowLedgerEntryProps {
  readonly orderId: string
  readonly entryType: EscrowEntryType
  readonly direction: EscrowEntryDirection
  readonly amountDiram: Money
  readonly paymentTransactionRef: string | null
  readonly reason: string | null
  readonly actorUserId: string | null
}

export class EscrowLedgerEntry {
  readonly orderId: string
  readonly entryType: EscrowEntryType
  readonly direction: EscrowEntryDirection
  readonly amountDiram: Money
  readonly paymentTransactionRef: string | null
  readonly reason: string | null
  readonly actorUserId: string | null

  private constructor(props: EscrowLedgerEntryProps) {
    this.orderId = props.orderId
    this.entryType = props.entryType
    this.direction = props.direction
    this.amountDiram = props.amountDiram
    this.paymentTransactionRef = props.paymentTransactionRef
    this.reason = props.reason
    this.actorUserId = props.actorUserId
  }

  /**
   * Фабрика — единственный легальный способ получить `EscrowLedgerEntry`.
   * Given `amountDiram <= 0` → `InvalidMoneyError` (переиспользуем существующий VO-класс
   * money-инвариантов, правило 12 AGENTS.md — не заводить дубликат «сумма обязана быть
   * положительной»). Given `entryType==='adjustment'` и `reason`/`actorUserId` пусты →
   * `AdjustmentRequiresReasonError` (SRS-DOM-035).
   */
  static create(props: EscrowLedgerEntryProps): EscrowLedgerEntry {
    assertPositiveAmount(props)
    assertAdjustmentHasReason(props)
    return new EscrowLedgerEntry(props)
  }
}

function assertPositiveAmount(props: EscrowLedgerEntryProps): void {
  if (!props.amountDiram.isPositive()) {
    throw new InvalidMoneyError(
      `EscrowLedgerEntry.amountDiram must be positive, got ${props.amountDiram.diram.toString()} diram (SRS-DOM-067)`,
      { orderId: props.orderId, entryType: props.entryType },
    )
  }
}

function assertAdjustmentHasReason(props: EscrowLedgerEntryProps): void {
  if (props.entryType !== ADJUSTMENT_ENTRY_TYPE) return
  const reasonMissing = isBlank(props.reason)
  const actorMissing = isBlank(props.actorUserId)
  if (reasonMissing || actorMissing) {
    throw new AdjustmentRequiresReasonError(props.orderId)
  }
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0
}
