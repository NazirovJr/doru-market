/**
 * Unit-тесты `GetOrderLedgerQuery` (EP-10, DTJ-248) — `EscrowLedgerRepository`/
 * `PaymentsOrdersPort` замоканы (`vi.fn()`), без БД/сети. Интеграционное доказательство (все 4
 * критерия приёмки через реальный HTTP + Postgres) — `test/integration/payments/
 * get-order-ledger.integration.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { NotFoundError, ForbiddenError } from '@dorutj/contracts'
import type { EscrowLedgerRepository } from '@/modules/payments/application/ports/escrow-ledger-repository.port.js'
import type { PaymentsOrdersPort, PaymentsOrderSnapshot } from '@/modules/payments/application/ports/orders-facade.port.js'
import { EscrowLedgerEntry } from '@/modules/payments/domain/escrow-ledger-entry.value-object.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import { GetOrderLedgerQuery } from './get-order-ledger.query.js'

const TENANT_ID = 'tenant-1'
const ORDER_ID = 'order-1'
const OTHER_CHAIN_ID = 'chain-other'
const OWN_CHAIN_ID = 'chain-own'

function fakeOrder(overrides: Partial<PaymentsOrderSnapshot> = {}): PaymentsOrderSnapshot {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    pharmacyId: 'pharmacy-1',
    status: 'delivered',
    paymentMethod: 'alif_mobi',
    totalAmountDiram: 10_000n,
    pharmacyChainId: OWN_CHAIN_ID,
    items: [],
    ...overrides,
  }
}

function entry(overrides: Partial<Parameters<typeof EscrowLedgerEntry.create>[0]> = {}): EscrowLedgerEntry {
  return EscrowLedgerEntry.create({
    orderId: ORDER_ID,
    entryType: 'hold_created',
    direction: 'debit',
    amountDiram: Money.fromDiram(10_000n),
    paymentTransactionRef: 'txn-ref-1',
    reason: null,
    actorUserId: null,
    ...overrides,
  })
}

/** Набор БАЛАНСИРУЮЩИХСЯ записей: hold(10000) = fee(800) + pharmacy(9200). */
function balancedEntries(): EscrowLedgerEntry[] {
  return [
    entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
    entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n), paymentTransactionRef: null }),
    entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(9_200n), paymentTransactionRef: null }),
  ]
}

function fakeLedgerRepository(entries: EscrowLedgerEntry[]): EscrowLedgerRepository {
  return {
    append: vi.fn(),
    findByOrderId: vi.fn<EscrowLedgerRepository['findByOrderId']>().mockResolvedValue(entries),
    sumByType: vi.fn(),
  }
}

function fakeOrdersPort(order: PaymentsOrderSnapshot | null): PaymentsOrdersPort {
  return {
    getOrderById: vi.fn<PaymentsOrdersPort['getOrderById']>().mockResolvedValue(order),
    markPaidEscrow: vi.fn(),
    cancel: vi.fn(),
  }
}

describe('GetOrderLedgerQuery (DTJ-248)', () => {
  it('AC1: super_admin — все записи, все поля, включая paymentTransactionRef', async () => {
    const entries = balancedEntries()
    const query = new GetOrderLedgerQuery(fakeLedgerRepository(entries), fakeOrdersPort(fakeOrder()))

    const result = await query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'super_admin', actorChainId: null })

    expect(result.entries).toHaveLength(3)
    expect(result.entries.map((e) => e.entryType)).toEqual(['hold_created', 'platform_fee_captured', 'captured_to_pharmacy'])
    expect(result.entries[0]).toHaveProperty('paymentTransactionRef', 'txn-ref-1')
    expect(result.meta.isBalanced).toBe(true)
  })

  it('AC2: pharmacy_admin своей сети — только captured_to_pharmacy/platform_fee_captured, без paymentTransactionRef/hold_created', async () => {
    const entries = balancedEntries()
    const query = new GetOrderLedgerQuery(fakeLedgerRepository(entries), fakeOrdersPort(fakeOrder({ pharmacyChainId: OWN_CHAIN_ID })))

    const result = await query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'pharmacy_admin', actorChainId: OWN_CHAIN_ID })

    expect(result.entries).toHaveLength(2)
    expect(result.entries.map((e) => e.entryType).sort()).toEqual(['captured_to_pharmacy', 'platform_fee_captured'])
    for (const view of result.entries) {
      expect(view).not.toHaveProperty('paymentTransactionRef')
    }
    expect(result.meta.isBalanced).toBe(true)
  })

  it('AC3: pharmacy_admin ЧУЖОЙ сети — ForbiddenError (403)', async () => {
    const query = new GetOrderLedgerQuery(
      fakeLedgerRepository(balancedEntries()),
      fakeOrdersPort(fakeOrder({ pharmacyChainId: OTHER_CHAIN_ID })),
    )

    await expect(
      query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'pharmacy_admin', actorChainId: OWN_CHAIN_ID }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('AC4: расхождение — meta.isBalanced=false, рассчитано на ПОЛНОМ наборе независимо от ролевой фильтрации', async () => {
    // Расхождение: hold(10000) != fee(800) + pharmacy(9000) — недостаёт 200.
    const imbalanced = [
      entry({ entryType: 'hold_created', direction: 'debit', amountDiram: Money.fromDiram(10_000n) }),
      entry({ entryType: 'platform_fee_captured', direction: 'credit', amountDiram: Money.fromDiram(800n), paymentTransactionRef: null }),
      entry({ entryType: 'captured_to_pharmacy', direction: 'credit', amountDiram: Money.fromDiram(9_000n), paymentTransactionRef: null }),
    ]
    const query = new GetOrderLedgerQuery(fakeLedgerRepository(imbalanced), fakeOrdersPort(fakeOrder()))

    const superAdminResult = await query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'super_admin', actorChainId: null })
    expect(superAdminResult.meta.isBalanced).toBe(false)

    const pharmacyAdminResult = await query.execute({
      tenantId: TENANT_ID,
      orderId: ORDER_ID,
      actorRole: 'pharmacy_admin',
      actorChainId: OWN_CHAIN_ID,
    })
    expect(pharmacyAdminResult.meta.isBalanced).toBe(false)
  })

  it('чужой тенант (getOrderById → null) — NotFoundError (404), не 403', async () => {
    const query = new GetOrderLedgerQuery(fakeLedgerRepository(balancedEntries()), fakeOrdersPort(null))

    await expect(
      query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'super_admin', actorChainId: null }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('pharmacy_admin без chainId (actorChainId=null) — ForbiddenError, не пропускается по умолчанию', async () => {
    const query = new GetOrderLedgerQuery(fakeLedgerRepository(balancedEntries()), fakeOrdersPort(fakeOrder()))

    await expect(
      query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'pharmacy_admin', actorChainId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('неизвестная/неавторизованная роль — ForbiddenError (дефолт-отказ политики, не guard)', async () => {
    const query = new GetOrderLedgerQuery(fakeLedgerRepository(balancedEntries()), fakeOrdersPort(fakeOrder()))

    await expect(
      query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'customer', actorChainId: null }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('записи отдаются в порядке, возвращённом репозиторием (created_at ASC — ответственность репозитория)', async () => {
    const first = entry({ entryType: 'hold_created' })
    const second = entry({ entryType: 'platform_fee_captured', paymentTransactionRef: null })
    const query = new GetOrderLedgerQuery(fakeLedgerRepository([first, second]), fakeOrdersPort(fakeOrder()))

    const result = await query.execute({ tenantId: TENANT_ID, orderId: ORDER_ID, actorRole: 'super_admin', actorChainId: null })

    expect(result.entries.map((e) => e.entryType)).toEqual(['hold_created', 'platform_fee_captured'])
  })
})
