/**
 * `ReturnsPolicy` (EP-11, `02-CLEAN-ARCHITECTURE-AND-CODE.md` §3.4) — точная проверка владения
 * («своя сеть»/«свой заказ»/«назначен на доставку»), ОТДЕЛЬНО от грубой проверки роли
 * (`@Roles()`-декоратор на контроллере, DTJ-275). Имя файла (`*.guard.ts`) фиксировано текстом
 * DTJ-275 `files_owned`, хотя класс — application-политика (чистая функция), не NestJS `CanActivate`.
 *
 * Файл создан РАНЬШЕ своего номинального `files_owned` (DTJ-275) — по необходимости DTJ-273 п.6:
 * `AdminOverrideReturnUseCase` не может проверить «`pharmacy_admin` своей сети» без этого класса
 * СЕЙЧАС. Тот же приём, что прочие «файл сверх буквального files_owned» этого эпика (правило 11
 * AGENTS.md) — здесь дополнительно смещён СРОК (не только периметр), т.к. оба тикета реализует
 * один и тот же исполнитель последовательно в одной сессии, конфликта владения нет. `canRead`
 * (DTJ-275, `GET /:id`) добавляется этим же классом ПОЗЖЕ, строкой (D-27).
 */
import type { UserRole } from '@dorutj/contracts'
import type { OrderReturnContext } from './application/ports/orders-facade.port.js'

export interface ReturnsPolicyActor {
  readonly role: UserRole
  readonly pharmacyId: string | null
  readonly chainId: string | null
}

export class ReturnsPolicy {
  /**
   * DTJ-273 п.6, SRS-RET-011 — `super_admin` (любая сеть) ИЛИ `pharmacy_admin` СВОЕЙ сети
   * (`actor.chainId === order.chainId`, обе стороны непустые — `null` никогда не «совпадает»
   * с `null», иначе pharmacy_admin без сети мог бы переопределить возврат заказа без сети).
   */
  canOverride(actor: ReturnsPolicyActor, order: OrderReturnContext): boolean {
    if (actor.role === 'super_admin') {
      return true
    }
    return actor.role === 'pharmacy_admin' && actor.chainId !== null && actor.chainId === order.chainId
  }
}
