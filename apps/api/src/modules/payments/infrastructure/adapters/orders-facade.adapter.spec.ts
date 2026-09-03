/**
 * Unit-тест `OrdersFacadeAdapter` (EP-10, DTJ-242) — ветки, не требующие реальной БД:
 * делегация `markPaidEscrow`/`cancel` к `OrdersFacade` с правильным маппингом
 * payments-примитивов → orders-команды, и `getOrderById` БЕЗ `tx` (без блокирующего `SELECT`).
 * `SELECT ... FOR UPDATE`-ветка (`tx` передан) и полный маппинг снэпшота с реальным
 * `pharmacies`-JOIN — интеграционный `handle-payment-webhook.integration.spec.ts` (AC1,
 * реальный Postgres, единственный практичный способ проверить `.for('update')`).
 */
import { describe, expect, it, vi } from 'vitest'
import { OrdersFacadeAdapter } from './orders-facade.adapter.js'

function buildAdapter(ordersFacade: {
  readonly getOrderById: ReturnType<typeof vi.fn>
  readonly markPaidEscrow: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
}): OrdersFacadeAdapter {
  // `db` нужен ТОЛЬКО для lookup `pharmacies.chainId` (ветка без `tx`) — фикстуры ниже
  // используют `pharmacyId: null`, что делает этот вызов недостижимым, пустой stub достаточен.
  const fakeDb = {} as never
  return new OrdersFacadeAdapter(fakeDb, ordersFacade as never)
}

describe('OrdersFacadeAdapter', () => {
  it('getOrderById(без tx) — делегирует OrdersFacade.getOrderById, маппит Money→bigint, pharmacyChainId=null для pharmacyId=null', async () => {
    const ordersFacade = {
      getOrderById: vi.fn().mockResolvedValue({
        id: 'order-1',
        tenantId: 'tenant-1',
        pharmacyId: null,
        status: 'pending_payment',
        paymentMethod: 'alif_mobi',
        totalAmount: { diram: 15_000n },
        items: [{ platformFeeDiram: 800n }],
      }),
      markPaidEscrow: vi.fn(),
      cancel: vi.fn(),
    }
    const adapter = buildAdapter(ordersFacade)

    const snapshot = await adapter.getOrderById('tenant-1', 'order-1')

    expect(ordersFacade.getOrderById).toHaveBeenCalledWith('tenant-1', 'order-1')
    expect(snapshot).toEqual({
      id: 'order-1',
      tenantId: 'tenant-1',
      pharmacyId: null,
      status: 'pending_payment',
      paymentMethod: 'alif_mobi',
      totalAmountDiram: 15_000n,
      pharmacyChainId: null,
      items: [{ platformFeeDiram: 800n }],
    })
  })

  it('getOrderById(без tx) — заказ не найден → null', async () => {
    const ordersFacade = { getOrderById: vi.fn().mockResolvedValue(null), markPaidEscrow: vi.fn(), cancel: vi.fn() }
    const adapter = buildAdapter(ordersFacade)

    expect(await adapter.getOrderById('tenant-1', 'missing')).toBeNull()
  })

  it('markPaidEscrow — делегирует OrdersFacade.markPaidEscrow с MarkPaidEscrowCommand и переданным tx', async () => {
    const ordersFacade = { getOrderById: vi.fn(), markPaidEscrow: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() }
    const adapter = buildAdapter(ordersFacade)
    const paidAt = new Date('2026-09-03T10:00:00Z')
    const tx = { marker: 'tx' }

    await adapter.markPaidEscrow('tenant-1', 'order-1', 'txn-ref', paidAt, tx)

    expect(ordersFacade.markPaidEscrow).toHaveBeenCalledWith(
      'order-1',
      { tenantId: 'tenant-1', txId: 'txn-ref', paidAt, ledgerHoldWillBeRecorded: true },
      tx,
    )
  })

  it('cancel — неизвестная причина (не из канонического SRS-ORD-030 списка) бросает, OrdersFacade.cancel НЕ вызывается', async () => {
    const ordersFacade = { getOrderById: vi.fn(), markPaidEscrow: vi.fn(), cancel: vi.fn() }
    const adapter = buildAdapter(ordersFacade)

    await expect(adapter.cancel('tenant-1', 'order-1', 'not_a_real_reason', { userId: 'u1', role: 'customer', pharmacyId: null })).rejects.toThrow(
      'unknown cancel reason',
    )
    expect(ordersFacade.cancel).not.toHaveBeenCalled()
  })

  it('cancel — actor.role="system" маппится в {kind:"system"} (без userId)', async () => {
    const ordersFacade = { getOrderById: vi.fn(), markPaidEscrow: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) }
    const adapter = buildAdapter(ordersFacade)

    await adapter.cancel('tenant-1', 'order-1', 'payment_timeout', { userId: 'irrelevant', role: 'system', pharmacyId: null })

    expect(ordersFacade.cancel).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ tenantId: 'tenant-1', reason: 'payment_timeout', actor: { kind: 'system' } }),
      undefined,
    )
  })

  it('cancel — actor.role="customer" маппится в {kind:"user", userId}', async () => {
    const ordersFacade = { getOrderById: vi.fn(), markPaidEscrow: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) }
    const adapter = buildAdapter(ordersFacade)

    await adapter.cancel('tenant-1', 'order-1', 'customer_changed_mind', { userId: 'user-42', role: 'customer', pharmacyId: null })

    expect(ordersFacade.cancel).toHaveBeenCalledWith(
      'order-1',
      expect.objectContaining({ reason: 'customer_changed_mind', actor: { kind: 'user', userId: 'user-42' } }),
      undefined,
    )
  })
})
