/**
 * `UpdateCartItemQuantityUseCase` (EP-09, DTJ-223, SRS-ORD-013, «Что сделать» §2; тенант-
 * изоляция — доработка по замечанию CTO, SRS-API-043/046).
 *
 * `quantity <= 0` → эквивалентно `RemoveCartItemUseCase` (строка удаляется, а не пишется с
 * `quantity=0` — `chk_cart_items_quantity_positive` персистентно этого и не допустил бы,
 * критерий приёмки №5). Иначе — `UPDATE cart_items SET quantity`, скоуп по `cartId` И
 * `tenantId` (тот же приём, что `RemoveCartItemUseCase` — `EXISTS`-подзапрос по `cart`
 * атомарно внутри одного SQL-оператора, `DrizzleCartRepository.updateItemQuantity`).
 *
 * `tenantId` — ПЕРВОЕ поле входного объекта (SRS-API-043, не опционально): источник —
 * presentation-слой (DTJ-226), use case НЕ читает `TenantContext` сам; пробрасывается и в
 * `RemoveCartItemUseCase.execute` на ветке `quantity<=0`. Объект-параметр, не 4 позиционных
 * (C5 `02-CLEAN-ARCHITECTURE-AND-CODE.md`: `tenantId`+`cartId`+`cartItemId`+`quantity` — уже
 * 4, `max-params` ≤3).
 *
 * Результат — размеченное объединение (`kind`), а не `Result`: отсутствие строки/чужая
 * корзина/чужой тенант здесь не доменная ошибка (нечего обновлять — SRS-API-046: не
 * подтверждаем существование чужого ресурса), а просто третий исход операции — присвоение
 * `Err`-типа для этого раздуло бы сигнатуру без выигрыша (в кодовой базе `Result`
 * зарезервирован под ОЖИДАЕМЫЕ бизнес-ошибки, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §2.5).
 *
 * `CartHoldStorePort.hold(...)` (DTJ-224, «Что сделать» §4) — ставится ТОЛЬКО на ветке
 * `kind: 'updated'`, количеством ИЗ `item.quantity` репозитория (уже НОВОЕ значение). На ветке
 * `kind: 'removed'` холд НЕ трогается — порт не предоставляет операции снятия холда (см. JSDoc
 * `CartHoldStorePort`, «Что сделать» §1 тикета определяет только `hold`/`extend`/
 * `getActiveHolds`) — истечёт естественно по TTL, что приемлемо для МЯГКОГО (не авторитетного)
 * резерва.
 */
import { Inject, Injectable } from '@nestjs/common'
import { ValidationError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import { CART_HOLD_STORE_PORT, type CartHoldStorePort } from '../ports/cart-hold-store.port.js'
import { CART_REPOSITORY, type CartItemRecord, type CartRepository } from './ports/cart.repository.port.js'
import { RemoveCartItemUseCase } from './remove-cart-item.use-case.js'

export interface UpdateCartItemQuantityInput {
  readonly tenantId: string
  readonly cartId: string
  readonly cartItemId: string
  readonly quantity: number
}

export type UpdateCartItemQuantityResult =
  | { readonly kind: 'removed' }
  | { readonly kind: 'updated'; readonly item: CartItemRecord }
  | { readonly kind: 'not_found' }

@Injectable()
export class UpdateCartItemQuantityUseCase {
  // eslint-disable-next-line max-params -- 3 порта + AppConfigService (DTJ-224 добавил CartHoldStorePort+config к DTJ-223), тот же приём, что RequestOtpUseCase/AddCartItemUseCase — явные @Inject-параметры вместо скрывающей фабрики deps-объекта.
  constructor(
    @Inject(CART_REPOSITORY) private readonly cartRepository: CartRepository,
    @Inject(RemoveCartItemUseCase) private readonly removeCartItemUseCase: RemoveCartItemUseCase,
    @Inject(CART_HOLD_STORE_PORT) private readonly cartHoldStore: CartHoldStorePort,
    @Inject(AppConfigService) private readonly config: AppConfigService,
  ) {}

  async execute(input: UpdateCartItemQuantityInput): Promise<UpdateCartItemQuantityResult> {
    if (!Number.isInteger(input.quantity)) {
      throw new ValidationError('quantity must be an integer', { quantity: input.quantity })
    }

    if (input.quantity <= 0) {
      const { removed } = await this.removeCartItemUseCase.execute(input.tenantId, input.cartId, input.cartItemId)
      return removed ? { kind: 'removed' } : { kind: 'not_found' }
    }

    const item = await this.cartRepository.updateItemQuantity({
      tenantId: input.tenantId,
      cartId: input.cartId,
      cartItemId: input.cartItemId,
      quantity: input.quantity,
    })
    if (item === null) {
      return { kind: 'not_found' }
    }
    await this.cartHoldStore.hold({
      pharmacyId: item.pharmacyId,
      medicineId: item.medicineId,
      cartItemId: item.id,
      quantity: item.quantity,
      ttlSeconds: this.config.cartHoldTtlSeconds,
    })
    return { kind: 'updated', item }
  }
}
