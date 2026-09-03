/**
 * `GetOrderLedgerQuery` (EP-10, DTJ-248, SRS-PAY-016, SRS-API-014/015,
 * `21-module-orders-payments-escrow.md` §4.5) — единственный человекочитаемый доступ к
 * эскроу-леджеру заказа. Query-объект (read-only), не use case мутации — тот же паттерн «один
 * класс, один публичный метод `execute()`» (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §3.1).
 *
 * ВИДИМОСТЬ ПО РОЛЯМ — ПОЛИТИКА ЗДЕСЬ, НЕ В GUARD/CONTROLLER (`02` §3.4, «Риски» тикета):
 *   - `super_admin` — все записи, все поля (включая `paymentTransactionRef`).
 *   - `pharmacy_admin` — ТОЛЬКО если заказ принадлежит её СЕТИ (`pharmacies.chain_id` заказа ===
 *     `claims.chainId` актора, см. `PaymentsOrderSnapshot.pharmacyChainId`, DTJ-248-правка порта)
 *     — иначе `403`. Видимые записи — `entryType IN ('captured_to_pharmacy',
 *     'platform_fee_captured')`, БЕЗ `paymentTransactionRef` (ключ ОТСУТСТВУЕТ в объекте, не
 *     `null` — чтобы «исключено» было однозначно проверяемо тестом).
 *
 * Чужой ТЕНАНТ (SRS-API-046) — другое дело: `PaymentsOrdersPort.getOrderById` уже скоупит по
 * `tenantId` (резолвится `TenantContext`, controller) и возвращает `null` для чужого тенанта —
 * здесь это `404`, не `403` (существование чужой строки не подтверждается). `403` — ТОЛЬКО
 * внутритенантный случай: тот же (нейтральный) тенант, но чужая сеть (SRS-NFR-009).
 *
 * `meta.isBalanced` — `EscrowLedger.isBalanced()` вызывается «на лету» на ПОЛНОМ наборе
 * записей ДО фильтрации по роли (фильтрация — только для отображения, баланс — всегда честный).
 *
 * Записи отдаются в порядке, в котором их вернул `EscrowLedgerRepository.findByOrderId` —
 * репозиторий уже сортирует по `created_at ASC` (DTJ-240, `.orderBy(escrowLedger.createdAt)`) —
 * здесь порядок не переопределяется повторно (не дублировать чужую ответственность).
 */
import { Inject, Injectable } from '@nestjs/common'
import { ForbiddenError, NotFoundError, type UserRole } from '@dorutj/contracts'
import {
  ESCROW_LEDGER_REPOSITORY,
  type EscrowLedgerRepository,
} from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import {
  PAYMENTS_ORDERS_PORT,
  type PaymentsOrdersPort,
  type PaymentsOrderSnapshot,
} from '@/modules/payments/application/ports/orders-facade.port.js'
import { EscrowLedger } from '@/modules/payments/domain/escrow-ledger.entity.js'
import type {
  EscrowLedgerEntry,
  EscrowEntryType,
  EscrowEntryDirection,
} from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'

/** SRS-PAY-016: набор `entryType`, видимый `pharmacy_admin` — БЕЗ `hold_created`/`adjustment`/refund-веток. */
const PHARMACY_ADMIN_VISIBLE_ENTRY_TYPES: readonly EscrowEntryType[] = ['captured_to_pharmacy', 'platform_fee_captured']

export interface GetOrderLedgerInput {
  readonly tenantId: string
  readonly orderId: string
  readonly actorRole: UserRole
  /** `claims.chainId` (JWT) — `null` для ролей без привязки к сети (в т.ч. `super_admin`). */
  readonly actorChainId: string | null
}

export interface LedgerEntryViewDto {
  readonly entryType: EscrowEntryType
  readonly direction: EscrowEntryDirection
  readonly amountDiram: number
  readonly reason: string | null
  readonly actorUserId: string | null
  /** Ключ ОТСУТСТВУЕТ в объекте для `pharmacy_admin` (см. JSDoc файла), не `undefined`/`null`. */
  readonly paymentTransactionRef?: string | null
}

export interface LedgerViewDto {
  readonly orderId: string
  readonly entries: readonly LedgerEntryViewDto[]
  readonly meta: { readonly isBalanced: boolean }
}

@Injectable()
export class GetOrderLedgerQuery {
  // Явный @Inject на каждом параметре конструктора — esbuild (vitest) не эмитит
  // `design:paramtypes` (правило 2 задания, тот же приём, что весь модуль `payments`).
  public constructor(
    @Inject(ESCROW_LEDGER_REPOSITORY) private readonly ledgerRepository: EscrowLedgerRepository,
    @Inject(PAYMENTS_ORDERS_PORT) private readonly ordersPort: PaymentsOrdersPort,
  ) {}

  public async execute(input: GetOrderLedgerInput): Promise<LedgerViewDto> {
    const order = await this.ordersPort.getOrderById(input.tenantId, input.orderId)
    if (order === null) {
      throw new NotFoundError({ orderId: input.orderId })
    }
    const entries = await this.ledgerRepository.findByOrderId(input.tenantId, input.orderId)
    const isBalanced = EscrowLedger.isBalanced(entries)
    const visibleEntries = selectVisibleEntries(input, order, entries)
    return {
      orderId: input.orderId,
      entries: visibleEntries.map((entry) => toEntryView(entry, input.actorRole)),
      meta: { isBalanced },
    }
  }
}

function selectVisibleEntries(
  input: GetOrderLedgerInput,
  order: PaymentsOrderSnapshot,
  entries: readonly EscrowLedgerEntry[],
): readonly EscrowLedgerEntry[] {
  if (input.actorRole === 'super_admin') return entries
  if (input.actorRole === 'pharmacy_admin') {
    assertOwnNetwork(order, input.actorChainId)
    return entries.filter((entry) => PHARMACY_ADMIN_VISIBLE_ENTRY_TYPES.includes(entry.entryType))
  }
  // Дефолт-отказ: `RolesGuard` на маршруте уже ограничивает роли до этих двух (грубая проверка),
  // но политика видимости — здесь (см. JSDoc файла) — не полагается на то, что guard не разошёлся.
  throw new ForbiddenError(`role "${input.actorRole}" is not authorized to view the escrow ledger`)
}

/** SRS-NFR-009: заказ той же строки `tenants`, но чужой `pharmacy_chains` — 403, не 404. */
function assertOwnNetwork(order: PaymentsOrderSnapshot, actorChainId: string | null): void {
  if (actorChainId === null || order.pharmacyChainId !== actorChainId) {
    throw new ForbiddenError('order does not belong to the pharmacy_admin network', {
      orderId: order.id,
    })
  }
}

function toEntryView(entry: EscrowLedgerEntry, actorRole: UserRole): LedgerEntryViewDto {
  const base: LedgerEntryViewDto = {
    entryType: entry.entryType,
    direction: entry.direction,
    amountDiram: Number(entry.amountDiram.diram),
    reason: entry.reason,
    actorUserId: entry.actorUserId,
  }
  if (actorRole !== 'super_admin') return base
  return { ...base, paymentTransactionRef: entry.paymentTransactionRef }
}
