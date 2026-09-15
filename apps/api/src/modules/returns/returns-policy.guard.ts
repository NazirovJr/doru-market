/**
 * `ReturnsPolicy` (EP-11, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §3.4) — точная проверка владения
 * («своя сеть»/«свой заказ»/«назначен на доставку»), ОТДЕЛЬНО от грубой проверки роли
 * (`@Roles()`-декоратор на контроллере, DTJ-275). Имя файла (`*.guard.ts`) фиксировано текстом
 * DTJ-275 `files_owned`, хотя класс — application-политика (чистая функция), не NestJS `CanActivate`.
 *
 * `canOverride` создан РАНЬШЕ своего номинального `files_owned` (DTJ-275) — по необходимости
 * DTJ-273 п.6 (`AdminOverrideReturnUseCase`), вызывается ИЗ use case'а. Остальные методы
 * (`canRequest`/`canConfirmOrReject`/`canDispatch`/`canRead`) — DTJ-275, вызываются ИЗ
 * `OrderReturnsController` ДО делегирования в use case (владение заказом ещё не проверено самим
 * use case'ом — единственное исключение установлено DTJ-273 из необходимости, см. выше).
 */
import type { UserRole } from '@dorutj/contracts'
import type { OrderReturnContext } from './application/ports/orders-facade.port.js'

export interface ReturnsPolicyActor {
  readonly role: UserRole
  readonly pharmacyId: string | null
  readonly chainId: string | null
  /** DTJ-275 — `canRequest`/`canRead` (владелец заказа): `users.id` вызывающего (`JwtClaims.sub`). Опционально — `canOverride`/`canDispatch`/`canConfirmOrReject` его не используют. */
  readonly userId?: string
  /** DTJ-275 — `canRequest`, courier-ветка: `couriers.id` вызывающего (см. `ReturnsOrdersPort.getCourierIdForUser`), НЕ `users.id`. `undefined`/`null` — не курьер/без профиля. */
  readonly courierId?: string | null
}

export class ReturnsPolicy {
  /**
   * DTJ-273 п.6, SRS-RET-011 — `super_admin` (любая сеть) ИЛИ `pharmacy_admin` СВОЕЙ сети
   * (`actor.chainId === order.chainId`, обе стороны непустые — `null` никогда не «совпадает»
   * с `null», иначе pharmacy_admin без сети мог бы переопределить возврат заказа без сети).
   */
  canOverride(actor: ReturnsPolicyActor, order: OrderReturnContext): boolean {
    return this.isChainDispatcher(actor, order)
  }

  /** DTJ-275 `POST /:id/mark-in-transit`/`POST /:id/retry-transit` — то же правило владения, что `canOverride` (диспетчерские действия закреплены за `pharmacy_admin` своей сети/`super_admin`, `12-api-conventions...md` §4.1 преамбула). Отдельный метод — семантическое разделение «диспетчер» vs «административное переопределение», не дублирование правила. */
  canDispatch(actor: ReturnsPolicyActor, order: OrderReturnContext): boolean {
    return this.isChainDispatcher(actor, order)
  }

  /** DTJ-275 `POST /:id/confirm`/`POST /:id/reject` — `pharmacist` СВОЕЙ аптеки (`actor.pharmacyId === order.pharmacyId`) ИЛИ `super_admin`. */
  canConfirmOrReject(actor: ReturnsPolicyActor, order: OrderReturnContext): boolean {
    if (actor.role === 'super_admin') {
      return true
    }
    return actor.role === 'pharmacist' && actor.pharmacyId !== null && actor.pharmacyId === order.pharmacyId
  }

  /**
   * DTJ-275 `POST /api/v1/order-returns` — `customer` СВОЙ заказ (`actor.userId === order.customerId`)
   * ИЛИ `courier` НАЗНАЧЕН на доставку (`actor.courierId === order.courierId`, обе стороны
   * непустые) ИЛИ `super_admin`. Курьерская ветка не пускает возврат, если `order.courierId`
   * ещё `null` (нет назначения вовсе) — тот же исход (403), что и рассинхрон id.
   */
  canRequest(actor: ReturnsPolicyActor, order: OrderReturnContext): boolean {
    if (actor.role === 'super_admin') {
      return true
    }
    if (actor.role === 'customer') {
      return actor.userId !== undefined && actor.userId === order.customerId
    }
    if (actor.role === 'courier') {
      return actor.courierId !== undefined && actor.courierId !== null && actor.courierId === order.courierId
    }
    return false
  }

  /** DTJ-275 `GET /:id` — владелец заказа (`customer`) ИЛИ `pharmacist` СВОЕЙ аптеки ИЛИ `super_admin`. */
  canRead(actor: ReturnsPolicyActor, order: OrderReturnContext): boolean {
    if (actor.role === 'super_admin') {
      return true
    }
    if (actor.role === 'pharmacist') {
      return actor.pharmacyId !== null && actor.pharmacyId === order.pharmacyId
    }
    return actor.userId !== undefined && actor.userId === order.customerId
  }

  private isChainDispatcher(actor: ReturnsPolicyActor, order: OrderReturnContext): boolean {
    if (actor.role === 'super_admin') {
      return true
    }
    return actor.role === 'pharmacy_admin' && actor.chainId !== null && actor.chainId === order.chainId
  }
}
