/**
 * Порт `MedicineReadRepository` (DTJ-092, read-часть для EP-04 / Волна 4).
 *
 * Расширен с волны 3.5: добавлены `listByCategoryId` и `listPublished` для
 * `GET /api/v1/medicines` (DTJ-094 read-часть) и `GET /api/v1/categories/:id/medicines`.
 * CRUD-операции (write-часть) пишутся в EP-04 (DTJ-092, 096, 097, 100) последующими тикетами.
 *
 * Контракт:
 *   - `findById(id)` возвращает `Medicine` (агрегат) или `null`. Без скоупа
 *     тенанта — скоупинг делает вызывающий код, если потребуется.
 *   - `findById` ВСЕГДА возвращает `null` для `controlCategory ∈ {psychotropic, narcotic}`,
 *     если только это не super_admin-контекст (TODO EP-15). Сейчас — null
 *     для всех (соответствует SRS-CAT-006: существование запрещённой записи
 *     не подтверждается).
 *   - `listByCategoryId` и `listPublished` возвращают только `isPublished = true`
 *     и только без `psychotropic`/`narcotic`. Пагинация — в вызывающем коде
 *     (use case делает clamp).
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6 (Волна 4)
 * @see docs/tickets/00-INDEX.md DTJ-092, DTJ-094
 */
import type { Medicine } from '../../domain/medicine.entity.js'

export const MEDICINE_READ_REPOSITORY = Symbol.for('@dorutj/catalog/medicine-read-repository')

export interface ListMedicinesParams {
  readonly limit: number
  readonly offset: number
}

export interface MedicineReadRepository {
  findById(id: string): Promise<Medicine | null>
  listByCategoryId(categoryId: number, params: ListMedicinesParams): Promise<readonly Medicine[]>
  listPublished(params: ListMedicinesParams): Promise<readonly Medicine[]>
}
