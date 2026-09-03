import { describe, expect, it } from 'vitest'
import { isOk } from '@dorutj/domain-kernel'
import { NotFoundError } from '@dorutj/contracts'
import { Order } from '@/modules/orders/domain/order.entity.js'
import { validOrderCreateCommand } from '@/modules/orders/testing/fixtures/order-create-command.fixture.js'
import { InMemoryOrderRepository } from '@/modules/orders/testing/fixtures/in-memory-order-repository.fixture.js'
import { InMemoryCartRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-repository.fixture.js'
import { InMemoryCartIdentityRepository } from '@/modules/orders/testing/fixtures/in-memory-cart-identity-repository.fixture.js'
import { MergeGuestCartUseCase } from './cart/merge-guest-cart.use-case.js'
import { OrdersFacade } from './orders.facade.js'

const NOW = new Date('2026-08-27T10:00:00.000Z')

function buildOrder(overrides: Parameters<typeof validOrderCreateCommand>[0] = {}): Order {
  const result = Order.create(validOrderCreateCommand(overrides))
  if (!isOk(result)) throw new Error('fixture: expected Ok')
  return result.value
}

describe('OrdersFacade (DTJ-222) — тонкая обёртка: repository.find → домен → repository.save', () => {
  const TENANT_ID = 'tenant-1'

  it('getOrderById — найден', async () => {
    const repo = new InMemoryOrderRepository()
    const order = buildOrder()
    repo.seed(order)
    const facade = new OrdersFacade(repo)
    await expect(facade.getOrderById(TENANT_ID, order.id)).resolves.toBe(order)
  })

  it('getOrderById — не найден → null (не исключение)', async () => {
    const facade = new OrdersFacade(new InMemoryOrderRepository())
    await expect(facade.getOrderById(TENANT_ID, 'missing')).resolves.toBeNull()
  })

  it('getOrderById — чужой тенант → null (SRS-API-046, не исключение)', async () => {
    const repo = new InMemoryOrderRepository()
    const order = buildOrder()
    repo.seed(order)
    const facade = new OrdersFacade(repo)
    await expect(facade.getOrderById('other-tenant', order.id)).resolves.toBeNull()
  })

  it('getOrderForCheckoutAttempt — резолвит по checkoutAttemptId', async () => {
    const repo = new InMemoryOrderRepository()
    const order = buildOrder()
    repo.seed(order)
    const facade = new OrdersFacade(repo)
    await expect(facade.getOrderForCheckoutAttempt(TENANT_ID, order.checkoutAttemptId)).resolves.toBe(order)
  })

  it('markPaidEscrow — переводит статус и сохраняет через repository.save', async () => {
    const repo = new InMemoryOrderRepository()
    const order = buildOrder({ paymentMethod: 'alif_mobi' })
    repo.seed(order)
    const facade = new OrdersFacade(repo)
    await facade.markPaidEscrow(order.id, { tenantId: TENANT_ID, txId: 'tx-1', paidAt: NOW, ledgerHoldWillBeRecorded: true })
    const persisted = await repo.findById(TENANT_ID, order.id)
    expect(persisted?.status).toBe('paid_escrow')
  })

  it('cancel — на несуществующем заказе бросает NotFoundError', async () => {
    const facade = new OrdersFacade(new InMemoryOrderRepository())
    await expect(
      facade.cancel('missing', { tenantId: TENANT_ID, reason: 'customer_changed_mind', actor: { kind: 'system' }, now: NOW }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('startProcessing → markPickedUp → markDelivered — полный наличный путь (D-25)', async () => {
    const repo = new InMemoryOrderRepository()
    const item = validOrderCreateCommand({ paymentMethod: 'cash_courier' })
    const order = buildOrder(item)
    expect(order.status).toBe('confirmed')
    repo.seed(order)
    const facade = new OrdersFacade(repo)

    await facade.startProcessing(order.id, {
      tenantId: TENANT_ID,
      pharmacistId: 'pharmacist-1',
      slaDeadlineAt: NOW,
      hasExpiredReservedBatch: false,
      now: NOW,
    })
    expect((await repo.findById(TENANT_ID, order.id))?.status).toBe('processing')

    await facade.markPickedUp(order.id, { tenantId: TENANT_ID, handoverOtpId: 'otp-1', now: NOW })
    expect((await repo.findById(TENANT_ID, order.id))?.status).toBe('picked_up')

    await facade.markDelivered(order.id, { tenantId: TENANT_ID, now: NOW })
    expect((await repo.findById(TENANT_ID, order.id))?.status).toBe('delivered')
  })
})

describe('OrdersFacade.mergeGuestCart (DTJ-226) — делегация к MergeGuestCartUseCase', () => {
  function buildFacadeWithMerge(): { facade: OrdersFacade; identity: InMemoryCartIdentityRepository } {
    const cartRepo = new InMemoryCartRepository()
    const identityRepo = new InMemoryCartIdentityRepository()
    const mergeUseCase = new MergeGuestCartUseCase(cartRepo, identityRepo)
    const facade = new OrdersFacade(new InMemoryOrderRepository(), mergeUseCase)
    return { facade, identity: identityRepo }
  }

  it('делегирует в MergeGuestCartUseCase и возвращает его результат', async () => {
    const { facade, identity } = buildFacadeWithMerge()
    identity.seedCart({ id: 'guest-cart-1', tenantId: 'tenant-1', customerId: null, sessionToken: 'tok-1' })

    const result = await facade.mergeGuestCart('tenant-1', 'tok-1', 'customer-1')

    expect(result).toEqual({ merged: true, cartId: 'guest-cart-1' })
  })

  it('без гостевой корзины под этим sessionToken — no-op, {merged: false}', async () => {
    const { facade } = buildFacadeWithMerge()
    await expect(facade.mergeGuestCart('tenant-1', 'no-such-token', 'customer-1')).resolves.toEqual({
      merged: false,
      cartId: null,
    })
  })

  it('провайдер не подключён (2-й конструкторский параметр опущен) — явный throw, не тихий no-op', async () => {
    const facade = new OrdersFacade(new InMemoryOrderRepository())
    await expect(facade.mergeGuestCart('tenant-1', 'tok-1', 'customer-1')).rejects.toThrow(
      /MergeGuestCartUseCase provider is not wired/,
    )
  })
})
