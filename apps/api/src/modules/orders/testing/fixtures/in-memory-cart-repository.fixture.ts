/**
 * `InMemoryCartRepository` (EP-09, DTJ-223) — фикстура `CartRepository` для unit-тестов
 * use case'ов `application/cart/**`. НЕ используется в боевой проводке (`orders.module.ts`
 * биндит `CART_REPOSITORY` на `DrizzleCartRepository`, урок волны 5 §6.3
 * `reports/EP09-CTO-BRIEF.md` — никаких in-memory адаптеров в проде).
 *
 * Реализует ТУ ЖЕ семантику упсёрта, что `DrizzleCartRepository.upsertItem`
 * (`quantity += quantityDelta` на конфликте `cart_id/medicine_id/pharmacyId`), ТУ ЖЕ
 * тенант-изоляцию (SRS-API-043/046: чужой `tenantId` ⇒ `null`/`false`/`[]`, никогда
 * исключение), чтобы unit-тесты use case'ов проверяли реальное поведение контракта, а не
 * мокали его в обход инварианта, который и есть предмет проверки.
 */
import { randomUUID } from 'node:crypto'
import type {
  CartItemRecord,
  CartRecord,
  CartRepository,
  UpdateCartItemQuantityRepoInput,
  UpsertCartItemInput,
} from '@/modules/orders/application/cart/ports/cart.repository.port.js'

export class InMemoryCartRepository implements CartRepository {
  private readonly carts = new Map<string, CartRecord>()
  private readonly items = new Map<string, CartItemRecord>()

  seedCart(cart: CartRecord): void {
    this.carts.set(cart.id, cart)
  }

  seedItem(item: CartItemRecord): void {
    this.items.set(item.id, item)
  }

  findById(tenantId: string, cartId: string): Promise<CartRecord | null> {
    const found = this.carts.get(cartId)
    return Promise.resolve(found?.tenantId === tenantId ? found : null)
  }

  findItemsByCartId(tenantId: string, cartId: string): Promise<readonly CartItemRecord[]> {
    if (!this.isCartOwnedByTenant(tenantId, cartId)) {
      return Promise.resolve([])
    }
    return Promise.resolve([...this.items.values()].filter((item) => item.cartId === cartId))
  }

  /** DTJ-227 — тот же тенант-фильтр через родительскую `cart`, что остальные методы. */
  findItemsByIds(tenantId: string, cartItemIds: readonly string[]): Promise<readonly CartItemRecord[]> {
    const idSet = new Set(cartItemIds)
    const found = [...this.items.values()].filter(
      (item) => idSet.has(item.id) && this.isCartOwnedByTenant(tenantId, item.cartId),
    )
    return Promise.resolve(found)
  }

  upsertItem(tenantId: string, input: UpsertCartItemInput): Promise<CartItemRecord | null> {
    if (!this.isCartOwnedByTenant(tenantId, input.cartId)) {
      return Promise.resolve(null)
    }
    const existing = [...this.items.values()].find(
      (item) =>
        item.cartId === input.cartId && item.medicineId === input.medicineId && item.pharmacyId === input.pharmacyId,
    )
    if (existing !== undefined) {
      const updated: CartItemRecord = { ...existing, quantity: existing.quantity + input.quantityDelta }
      this.items.set(existing.id, updated)
      return Promise.resolve(updated)
    }
    const created: CartItemRecord = {
      id: randomUUID(),
      cartId: input.cartId,
      medicineId: input.medicineId,
      pharmacyId: input.pharmacyId,
      quantity: input.quantityDelta,
      addedAt: new Date(),
    }
    this.items.set(created.id, created)
    return Promise.resolve(created)
  }

  updateItemQuantity(input: UpdateCartItemQuantityRepoInput): Promise<CartItemRecord | null> {
    if (!this.isCartOwnedByTenant(input.tenantId, input.cartId)) {
      return Promise.resolve(null)
    }
    const existing = this.items.get(input.cartItemId)
    if (existing?.cartId !== input.cartId) {
      return Promise.resolve(null)
    }
    const updated: CartItemRecord = { ...existing, quantity: input.quantity }
    this.items.set(input.cartItemId, updated)
    return Promise.resolve(updated)
  }

  deleteItem(tenantId: string, cartId: string, cartItemId: string): Promise<boolean> {
    if (!this.isCartOwnedByTenant(tenantId, cartId)) {
      return Promise.resolve(false)
    }
    const existing = this.items.get(cartItemId)
    if (existing?.cartId !== cartId) {
      return Promise.resolve(false)
    }
    this.items.delete(cartItemId)
    return Promise.resolve(true)
  }

  private isCartOwnedByTenant(tenantId: string, cartId: string): boolean {
    return this.carts.get(cartId)?.tenantId === tenantId
  }
}
