/**
 * `MergeGuestCartUseCase` (EP-09, DTJ-226, SRS-ORD-020, «Что сделать» §5) — переносит гостевую
 * корзину (`cart.session_token`) на аккаунт клиента ПОСЛЕ успешного OTP-логина.
 *
 * Точка вызова — модуль `auth` (EP-01), ПОСЛЕ `VerifyOtpUseCase`/`TelegramAuthUseCase`. Хук в
 * `auth`-flow — ВНЕ периметра этого тикета (ticket «Риски»): здесь только сам use case +
 * регистрация в `OrdersFacade.mergeGuestCart` (см. JSDoc там), координация по фактическому
 * вызову — отдельно с владельцем EP-01 (см. `foundIssues`/`blockers` отчёта сдачи).
 *
 * Два исхода (критерии приёмки №1/№2 тикета) + no-op:
 *   - Гостевой корзины с этим `sessionToken` нет (`findBySessionToken` → `null`) — no-op,
 *     `{merged: false}`. НЕ ошибка: гость мог логиниться без единой позиции в корзине.
 *   - У клиента ЕЩЁ НЕТ своей корзины (`findByCustomerId` → `null`) — гостевая строка `cart`
 *     ПЕРЕПРИВЯЗЫВАЕТСЯ (`rebindToCustomer`: `customer_id=customerId, session_token=NULL`),
 *     без построчного переноса — `cart_items` остаются под тем же `cart.id` (критерий №1).
 *   - У клиента УЖЕ ЕСТЬ своя корзина — каждая позиция гостевой корзины переносится upsert'ом
 *     (`CartRepository.upsertItem`, DTJ-223 — количества СУММИРУЮТСЯ через
 *     `unique_cart_medicine_pharmacy`, не перезаписываются и не дублируют строку, критерий
 *     №2), затем гостевая строка `cart` УДАЛЯЕТСЯ (`deleteCart`) — не остаётся сиротой.
 *
 * Тенант-изоляция (D-EP09-24): `tenantId` — ПЕРВЫЙ параметр, тот же на ОБЕИХ сторонах merge —
 * гостевая корзина тенанта A физически не резолвится `findBySessionToken(tenantIdB, ...)`,
 * поэтому смешение тенантов невозможно без отдельной проверки (тенант-фильтр уже внутри
 * каждого вызова репозитория, тот же приём, что `CartRepository`/`CartIdentityRepository`).
 *
 * НЕ обёрнуто в единую DB-транзакцию (ASSUMPTION, см. `assumptions` отчёта сдачи): перенос —
 * несколько раздельных round-trip'ов (`findItemsByCartId` → N×`upsertItem` → `deleteCart`).
 * Крах МЕЖДУ последним upsert'ом и `deleteCart` оставит гостевую корзину неудалённой; retry
 * того же вызова тогда повторно просуммирует те же позиции (не строго идемпотентно на этом
 * узком окне). Полная атомарность потребовала бы протаскивать `tx` через `CartRepository` —
 * весь порт DTJ-223 её сегодня не несёт ни в одном из своих потребителей, заводить это здесь
 * означало бы менять чужой контракт ради риска, не предусмотренного тест-планом тикета.
 */
import { Inject, Injectable } from '@nestjs/common'
import { CART_REPOSITORY, type CartRepository } from './ports/cart.repository.port.js'
import { CART_IDENTITY_REPOSITORY, type CartIdentityRepository } from './ports/cart-identity.repository.port.js'

export interface MergeGuestCartResult {
  readonly merged: boolean
  readonly cartId: string | null
}

@Injectable()
export class MergeGuestCartUseCase {
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepository: CartRepository,
    // Явный @Inject на КАЖДОМ параметре — esbuild/vitest не эмитит `design:paramtypes` (DTJ-001).
    @Inject(CART_IDENTITY_REPOSITORY) private readonly cartIdentityRepository: CartIdentityRepository,
  ) {}

  async execute(tenantId: string, sessionToken: string, customerId: string): Promise<MergeGuestCartResult> {
    const guestCart = await this.cartIdentityRepository.findBySessionToken(tenantId, sessionToken)
    if (guestCart === null) {
      return { merged: false, cartId: null }
    }

    const customerCart = await this.cartIdentityRepository.findByCustomerId(tenantId, customerId)
    if (customerCart === null) {
      const rebound = await this.cartIdentityRepository.rebindToCustomer(tenantId, guestCart.id, customerId)
      return { merged: rebound !== null, cartId: rebound?.id ?? null }
    }

    await this.transferItems(tenantId, guestCart.id, customerCart.id)
    await this.cartIdentityRepository.deleteCart(tenantId, guestCart.id)
    return { merged: true, cartId: customerCart.id }
  }

  /** Переиспользует `upsertItem` DTJ-223 (сумма количеств через `UNIQUE`-констрейнт) —
   *  правило 12 AGENTS.md, не копирует логику упсёрта. `Promise.all` (C14), позиции гостевой
   *  корзины уже уникальны по `(medicineId, pharmacyId)` — конкурентные upsert'ы бьют в
   *  РАЗНЫЕ ключи `unique_cart_medicine_pharmacy` целевой корзины, гонки между ними нет. */
  private async transferItems(tenantId: string, guestCartId: string, customerCartId: string): Promise<void> {
    const items = await this.cartRepository.findItemsByCartId(tenantId, guestCartId)
    await Promise.all(
      items.map((item) =>
        this.cartRepository.upsertItem(tenantId, {
          cartId: customerCartId,
          medicineId: item.medicineId,
          pharmacyId: item.pharmacyId,
          quantityDelta: item.quantity,
        }),
      ),
    )
  }
}
