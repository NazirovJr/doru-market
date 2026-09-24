/**
 * `CourierRepositoryPort` (EP-13, DTJ-314) — первый application-порт модуля `delivery`
 * (модуль имел только `domain/` до этого тикета, см. риски DTJ-314/DTJ-320/DTJ-321).
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.3: порт объявляется в application, реализация — в
 * infrastructure, связывание — в `delivery.module.ts`.
 *
 * `findByUserId` — обязателен: JWT (`JwtClaims`, `@/modules/auth`) несёт только `sub` (userId),
 * не `courierId` — презентационный слой (`courier-shifts`/`courier-earnings`/`courier-ratings`
 * контроллеры) резолвит действующего курьера через этот метод, не заводит отдельное поле в
 * токене (без миграции самого токена).
 */
import type { Courier } from '../../domain/courier.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const COURIER_REPOSITORY = Symbol.for('@dorutj/delivery/courier-repository')

export interface CourierRepositoryPort {
  findById(id: string, tx?: DeliveryUnitOfWorkTx): Promise<Courier | null>
  /** Резолвинг courierId из `JwtClaims.sub` (userId) — `couriers.user_id` уникален. */
  findByUserId(userId: string, tx?: DeliveryUnitOfWorkTx): Promise<Courier | null>
  save(courier: Courier, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
