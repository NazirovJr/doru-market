/**
 * `FakeCartHoldStorePort` (EP-09, DTJ-224) — фикстура `CartHoldStorePort` для unit-тестов
 * `AddCartItemUseCase`/`UpdateCartItemQuantityUseCase`/`ExtendCartHoldUseCase`. Реальный
 * адаптер — `RedisCartHoldStoreAdapter` (`infrastructure/adapters/`), эта фикстура ТОЛЬКО для
 * тестов, не для боевой проводки (`orders.module.ts` биндит порт на Redis-реализацию).
 *
 * Записывает вызовы `hold`/`extend` (спай без внешней библиотеки моков) — use case'ы
 * проверяются на факт/аргументы вызова, а не на побочный эффект в Redis.
 */
import type {
  CartHoldCommand,
  CartHoldExtendCommand,
  CartHoldStorePort,
} from '@/modules/orders/application/ports/cart-hold-store.port.js'

export class FakeCartHoldStorePort implements CartHoldStorePort {
  readonly holdCalls: CartHoldCommand[] = []
  readonly extendCalls: CartHoldExtendCommand[] = []
  private activeHolds = 0

  /** Настраивает возврат `getActiveHolds` для тестов `AvailabilityCalculator`/`GetCartUseCase`. */
  setActiveHolds(quantity: number): void {
    this.activeHolds = quantity
  }

  hold(command: CartHoldCommand): Promise<void> {
    this.holdCalls.push(command)
    return Promise.resolve()
  }

  extend(command: CartHoldExtendCommand): Promise<void> {
    this.extendCalls.push(command)
    return Promise.resolve()
  }

  getActiveHolds(): Promise<number> {
    return Promise.resolve(this.activeHolds)
  }
}
