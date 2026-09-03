/**
 * Порт `CartHoldStorePort` (EP-09, DTJ-224, SRS-ORD-005..009).
 *
 * Мягкий (UX) резерв количества на Redis TTL — СОЗНАТЕЛЬНО не авторитетная резервация
 * (та — `InventoryFacadePort.reserveStock()` внутри `Order.create()`, DTJ-227). Деградация
 * Redis не имеет права заблокировать покупку — см. `AvailabilityCalculator` (fail-open,
 * SRS-ORD-008) и D-EP09-12 §2 `reports/EP09-CTO-BRIEF.md`: результат этого порта используется
 * ТОЛЬКО для показа пользователю, никогда как условие, запрещающее добавление в корзину или
 * checkout.
 *
 * Ключ хранения — `cart:hold:{pharmacyId}:{medicineId}:{cartItemId}` (значение — количество,
 * `EXPIRE ttlSeconds`). Реализация обязана держать ВТОРИЧНЫЙ индекс по паре
 * `(pharmacyId, medicineId)` (`RedisCartHoldStoreAdapter` — `ZSET`) для `getActiveHolds` —
 * `KEYS`/`SCAN` по паттерну ЗАПРЕЩЕНЫ в проде (D-EP09-12 §3, блокирующая O(n)-операция на
 * весь инстанс).
 *
 * `application` не знает об `infrastructure`/`ioredis` (`dorutj/application-purity`,
 * `eslint.config.mjs`) — реализация (`ioredis`) в
 * `infrastructure/adapters/redis-cart-hold-store.adapter.ts`.
 */

/** DI-токен для провайдера `CartHoldStorePort`. */
export const CART_HOLD_STORE_PORT = Symbol.for('@dorutj/orders/cart-hold-store')

/**
 * Объект-параметр `hold` (C5, `02-CLEAN-ARCHITECTURE-AND-CODE.md`, `max-params` ≤3) — 5
 * логических полей превышают лимит позиционных параметров, тот же приём, что
 * `UpdateCartItemQuantityRepoInput` (`cart.repository.port.ts`, DTJ-223).
 */
export interface CartHoldCommand {
  readonly pharmacyId: string
  readonly medicineId: string
  readonly cartItemId: string
  /** ТЕКУЩЕЕ суммарное количество строки корзины (не дельта) — см. JSDoc `hold`. */
  readonly quantity: number
  readonly ttlSeconds: number
}

/** Объект-параметр `extend` (C5) — 4 поля превышают лимит позиционных параметров. */
export interface CartHoldExtendCommand {
  readonly pharmacyId: string
  readonly medicineId: string
  readonly cartItemId: string
  readonly ttlSeconds: number
}

export interface CartHoldStorePort {
  /**
   * Ставит/ПЕРЕЗАПИСЫВАЕТ мягкий резерв на `cartItemId` — `quantity` есть ТЕКУЩЕЕ суммарное
   * количество этой строки корзины (не дельта), вызывающий (`AddCartItemUseCase`/
   * `UpdateCartItemQuantityUseCase`) передаёт значение ПОСЛЕ upsert/update. Ошибка соединения —
   * не бросает наружу (мягкий резерв — UX-оптимизация, деградация Redis не блокирует мутацию
   * корзины), логируется `WARN` внутри адаптера.
   */
  hold(command: CartHoldCommand): Promise<void>

  /**
   * Продлевает TTL существующего холда (`GET /api/v1/cart?extendHold=true`,
   * `ExtendCartHoldUseCase`). No-op, если холд уже истёк/не существует — `extend` не
   * воскрешает истёкший резерв, это осознанное следствие семантики Redis `EXPIRE`. Ошибка
   * соединения — не бросает наружу, тот же приём деградации, что `hold`.
   */
  extend(command: CartHoldExtendCommand): Promise<void>

  /**
   * Сумма количеств ПО ВСЕМ активным (непросроченным) холдам на пару `(pharmacyId,
   * medicineId)`, кроме `excludeCartItemId` (свой холд не должен вычитаться из собственной
   * доступности — критерий приёмки №2 DTJ-224). Ошибка соединения/таймаут ПРОБРАСЫВАЕТСЯ —
   * fail-open (SRS-ORD-008) реализован на уровне `AvailabilityCalculator`, не здесь: именно он
   * решает, что делать при недоступности хранилища холдов.
   */
  getActiveHolds(pharmacyId: string, medicineId: string, excludeCartItemId?: string): Promise<number>
}
