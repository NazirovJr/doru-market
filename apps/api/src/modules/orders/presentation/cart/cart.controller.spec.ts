/**
 * `CartController` — юнит-тест (EP-09, DTJ-226, AC4). Мокает все шесть use case'ов —
 * фокус ИСКЛЮЧИТЕЛЬНО на порядке вызовов (`GET /cart?extendHold=true`), который HTTP-
 * интеграционный Supertest-тест (`cart.controller.integration.spec.ts`) напрямую не
 * различает (оба порядка дают одинаковый финальный ответ). Прямой вызов метода контроллера
 * (в обход HTTP pipeline Nest) НЕ проверяет декораторы (`@Body`/`@Param`/`@Res` и т.п.) — это
 * ответственность интеграционного теста (тот же класс дефекта, что урок волны 5 §6.2).
 *
 * Моки собраны как `{ execute: fn }` объекты, приведённые `as unknown as <UseCase>` — assert
 * идёт по ЛОКАЛЬНОЙ переменной `fn` (не по `mock.execute`), чтобы не ловить
 * `@typescript-eslint/unbound-method` (правило видит статический тип интерфейса use case'а на
 * приведённом объекте и требует `this`-биндинг, нерелевантный для простого `vi.fn()`).
 */
import type { FastifyReply } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { TenantContext } from '@/common/context/tenant-context.js'
import type { ResolveOrCreateCartUseCase } from '@/modules/orders/application/cart/resolve-or-create-cart.use-case.js'
import type { GetCartUseCase } from '@/modules/orders/application/cart/get-cart.use-case.js'
import type { ExtendCartHoldUseCase } from '@/modules/orders/application/cart/extend-cart-hold.use-case.js'
import type { AddCartItemUseCase } from '@/modules/orders/application/cart/add-cart-item.use-case.js'
import type { UpdateCartItemQuantityUseCase } from '@/modules/orders/application/cart/update-cart-item-quantity.use-case.js'
import type { RemoveCartItemUseCase } from '@/modules/orders/application/cart/remove-cart-item.use-case.js'
import { CartController } from './cart.controller.js'

const CART = { id: 'cart-1', tenantId: 'tenant-1', customerId: null, sessionToken: null }
const EMPTY_VIEW = { items: [], meta: { pharmacyGroups: [], warnings: [] } }
const IDENTITY = { customerId: null, sessionToken: null }

function buildReply(): { reply: FastifyReply; header: ReturnType<typeof vi.fn> } {
  const header = vi.fn()
  return { reply: { header } as unknown as FastifyReply, header }
}

function runWithTenant<T>(fn: () => T): T {
  return TenantContext.run(TenantContext.forTenant({ tenantId: 'tenant-1', slug: 's', chainId: null, isNeutral: false }), fn)
}

describe('CartController.getCartView (DTJ-226, AC4)', () => {
  it('extendHold=true — ExtendCartHoldUseCase.execute вызывается ДО GetCartUseCase.execute', async () => {
    const callOrder: string[] = []
    const resolveExec = vi.fn(() => {
      callOrder.push('resolve')
      return Promise.resolve({ cart: CART, issuedSessionToken: null })
    })
    const extendExec = vi.fn(() => {
      callOrder.push('extend')
      return Promise.resolve()
    })
    const getExec = vi.fn(() => {
      callOrder.push('get')
      return Promise.resolve(EMPTY_VIEW)
    })
    const controller = new CartController(
      { execute: resolveExec } as unknown as ResolveOrCreateCartUseCase,
      { execute: getExec } as unknown as GetCartUseCase,
      { execute: extendExec } as unknown as ExtendCartHoldUseCase,
      {} as AddCartItemUseCase,
      {} as UpdateCartItemQuantityUseCase,
      {} as RemoveCartItemUseCase,
    )

    await runWithTenant(() => controller.getCartView(IDENTITY, 'true', buildReply().reply))

    expect(callOrder).toEqual(['resolve', 'extend', 'get'])
  })

  it('extendHold отсутствует — ExtendCartHoldUseCase.execute НЕ вызывается', async () => {
    const resolveExec = vi.fn(() => Promise.resolve({ cart: CART, issuedSessionToken: null }))
    const extendExec = vi.fn(() => Promise.resolve())
    const getExec = vi.fn(() => Promise.resolve(EMPTY_VIEW))
    const controller = new CartController(
      { execute: resolveExec } as unknown as ResolveOrCreateCartUseCase,
      { execute: getExec } as unknown as GetCartUseCase,
      { execute: extendExec } as unknown as ExtendCartHoldUseCase,
      {} as AddCartItemUseCase,
      {} as UpdateCartItemQuantityUseCase,
      {} as RemoveCartItemUseCase,
    )

    await runWithTenant(() => controller.getCartView(IDENTITY, undefined, buildReply().reply))

    expect(extendExec).not.toHaveBeenCalled()
    expect(getExec).toHaveBeenCalledOnce()
  })

  it('extendHold="false" (не буквально "true") — ExtendCartHoldUseCase.execute НЕ вызывается', async () => {
    const resolveExec = vi.fn(() => Promise.resolve({ cart: CART, issuedSessionToken: null }))
    const extendExec = vi.fn(() => Promise.resolve())
    const getExec = vi.fn(() => Promise.resolve(EMPTY_VIEW))
    const controller = new CartController(
      { execute: resolveExec } as unknown as ResolveOrCreateCartUseCase,
      { execute: getExec } as unknown as GetCartUseCase,
      { execute: extendExec } as unknown as ExtendCartHoldUseCase,
      {} as AddCartItemUseCase,
      {} as UpdateCartItemQuantityUseCase,
      {} as RemoveCartItemUseCase,
    )

    await runWithTenant(() => controller.getCartView(IDENTITY, 'false', buildReply().reply))

    expect(extendExec).not.toHaveBeenCalled()
  })

  it('issuedSessionToken !== null — ставит заголовок X-Cart-Session-Token на ответе', async () => {
    const resolveExec = vi.fn(() => Promise.resolve({ cart: CART, issuedSessionToken: 'fresh-token' }))
    const getExec = vi.fn(() => Promise.resolve(EMPTY_VIEW))
    const { reply, header } = buildReply()
    const controller = new CartController(
      { execute: resolveExec } as unknown as ResolveOrCreateCartUseCase,
      { execute: getExec } as unknown as GetCartUseCase,
      {} as ExtendCartHoldUseCase,
      {} as AddCartItemUseCase,
      {} as UpdateCartItemQuantityUseCase,
      {} as RemoveCartItemUseCase,
    )

    await runWithTenant(() => controller.getCartView(IDENTITY, undefined, reply))

    expect(header).toHaveBeenCalledWith('x-cart-session-token', 'fresh-token')
  })

  it('issuedSessionToken === null — заголовок НЕ ставится', async () => {
    const resolveExec = vi.fn(() => Promise.resolve({ cart: CART, issuedSessionToken: null }))
    const getExec = vi.fn(() => Promise.resolve(EMPTY_VIEW))
    const { reply, header } = buildReply()
    const controller = new CartController(
      { execute: resolveExec } as unknown as ResolveOrCreateCartUseCase,
      { execute: getExec } as unknown as GetCartUseCase,
      {} as ExtendCartHoldUseCase,
      {} as AddCartItemUseCase,
      {} as UpdateCartItemQuantityUseCase,
      {} as RemoveCartItemUseCase,
    )

    await runWithTenant(() => controller.getCartView(IDENTITY, undefined, reply))

    expect(header).not.toHaveBeenCalled()
  })
})
