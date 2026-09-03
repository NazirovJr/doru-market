/**
 * `InMemoryCartIdentityRepository` (EP-09, DTJ-226) — фикстура `CartIdentityRepository` для
 * unit-тестов `ResolveOrCreateCartUseCase`/`MergeGuestCartUseCase`/`OrdersFacade`. НЕ боевой
 * адаптер (`orders.module.ts` биндит `CART_IDENTITY_REPOSITORY` на
 * `DrizzleCartIdentityRepository`, урок волны 5 §6.3).
 *
 * Тенант-изоляция — тот же контракт, что `InMemoryCartRepository` (DTJ-223): чужой `tenantId`
 * ⇒ `null`/`false`, никогда throw. `findOrCreate*` эмулирует идемпотентность синхронностью
 * `Map`-операций (единственный поток теста — нет реальной гонки, которую проверяет ТОЛЬКО
 * интеграционный тест против настоящего Postgres, `drizzle-cart-identity.repository.
 * integration.spec.ts`).
 */
import { randomUUID } from 'node:crypto'
import type { CartIdentityRepository } from '@/modules/orders/application/cart/ports/cart-identity.repository.port.js'
import type { CartRecord } from '@/modules/orders/application/cart/ports/cart.repository.port.js'

export class InMemoryCartIdentityRepository implements CartIdentityRepository {
  private readonly carts = new Map<string, CartRecord>()

  seedCart(cart: CartRecord): void {
    this.carts.set(cart.id, cart)
  }

  findByCustomerId(tenantId: string, customerId: string): Promise<CartRecord | null> {
    const found = [...this.carts.values()].find((c) => c.tenantId === tenantId && c.customerId === customerId)
    return Promise.resolve(found ?? null)
  }

  findBySessionToken(tenantId: string, sessionToken: string): Promise<CartRecord | null> {
    const found = [...this.carts.values()].find((c) => c.tenantId === tenantId && c.sessionToken === sessionToken)
    return Promise.resolve(found ?? null)
  }

  async findOrCreateByCustomerId(tenantId: string, customerId: string): Promise<CartRecord> {
    const existing = await this.findByCustomerId(tenantId, customerId)
    if (existing !== null) {
      return existing
    }
    const created: CartRecord = { id: randomUUID(), tenantId, customerId, sessionToken: null }
    this.carts.set(created.id, created)
    return created
  }

  async findOrCreateBySessionToken(tenantId: string, sessionToken: string): Promise<CartRecord> {
    const existing = await this.findBySessionToken(tenantId, sessionToken)
    if (existing !== null) {
      return existing
    }
    const created: CartRecord = { id: randomUUID(), tenantId, customerId: null, sessionToken }
    this.carts.set(created.id, created)
    return created
  }

  rebindToCustomer(tenantId: string, cartId: string, customerId: string): Promise<CartRecord | null> {
    const existing = this.carts.get(cartId)
    if (existing?.tenantId !== tenantId) {
      return Promise.resolve(null)
    }
    const updated: CartRecord = { ...existing, customerId, sessionToken: null }
    this.carts.set(cartId, updated)
    return Promise.resolve(updated)
  }

  deleteCart(tenantId: string, cartId: string): Promise<boolean> {
    const existing = this.carts.get(cartId)
    if (existing?.tenantId !== tenantId) {
      return Promise.resolve(false)
    }
    this.carts.delete(cartId)
    return Promise.resolve(true)
  }
}
