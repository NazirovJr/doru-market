/**
 * `CourierRatingRepositoryPort` (EP-13, DTJ-321). Файл СВЕРХ буквального `files_owned` (тот же
 * приём, что остальные `*.repository.port.ts` этого модуля, DTJ-314/320) — `SubmitCourierRatingUseCase`
 * не может выполнить свою работу без доступа к `courier_ratings` (`02` §1.3).
 *
 * `existsByOrderId` — источник истины для `409 RATING_ALREADY_SUBMITTED` (`UNIQUE(order_id)`,
 * `db/schema/courier-ratings.ts`) — отдельный метод, не `findByOrderId`: use case нужен только факт
 * существования, не сама строка (C11, explicit over implicit).
 */
import type { CourierRating } from '../../domain/courier-rating.entity.js'
import type { DeliveryUnitOfWorkTx } from './delivery-unit-of-work.port.js'

export const COURIER_RATING_REPOSITORY = Symbol.for('@dorutj/delivery/courier-rating-repository')

export interface CourierRatingRepositoryPort {
  /** `UNIQUE(order_id)` — precondition-проверка ДО вставки (`409 RATING_ALREADY_SUBMITTED`). */
  existsByOrderId(orderId: string, tx?: DeliveryUnitOfWorkTx): Promise<boolean>
  save(rating: CourierRating, tx?: DeliveryUnitOfWorkTx): Promise<void>
}
