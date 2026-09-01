/**
 * `ListMedicinesUseCase` (DTJ-094, read-часть для EP-04 / Волна 4).
 *
 * Возвращает пагинированный список medicines: либо все опубликованные, либо
 * по конкретной категории. Только `isPublished = true` и без `psychotropic`/
 * `narcotic` (SRS-CAT-006) — это инвариант `Medicine.canOrderRemotely()`,
 * репозиторий фильтрует на своей стороне.
 *
 * Тенантный скоуп НЕ применяется: каталог мульти-тенантный (аптеки разных тенантов
 * видят общий каталог), изоляция — на уровне остатков (EP-05), не каталога.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.6
 */
import { Inject, Injectable } from '@nestjs/common'
import { type Medicine } from '../../domain/medicine.entity.js'
import {
  MEDICINE_READ_REPOSITORY,
  type ListMedicinesParams,
  type MedicineReadRepository,
} from '../ports/medicine-read.repository.port.js'

@Injectable()
export class ListMedicinesUseCase {
  constructor(
    @Inject(MEDICINE_READ_REPOSITORY)
    private readonly medicineReadRepository: MedicineReadRepository,
  ) {}

  async execute(input: {
    categoryId: number | null
    params: ListMedicinesParams
  }): Promise<readonly Medicine[]> {
    if (input.categoryId === null) {
      return this.medicineReadRepository.listPublished(input.params)
    }
    return this.medicineReadRepository.listByCategoryId(input.categoryId, input.params)
  }
}
