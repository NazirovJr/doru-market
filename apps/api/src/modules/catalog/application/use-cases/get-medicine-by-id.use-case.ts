/**
 * `GetMedicineByIdUseCase` (DTJ-095, минимальная read-часть для волны 3.5).
 *
 * Достаёт `Medicine` по `id`. Если запись не найдена ИЛИ `controlCategory`
 * в `{psychotropic, narcotic}` (SRS-CAT-006) — бросает `MedicineNotFoundError`
 * (404 замаплен в `DomainExceptionFilter`).
 *
 * Тенантный скоуп НЕ применяется: каталог мульти-тенантный (аптеки разных
 * тенантов видят общий каталог), изоляция — на уровне остатков, не каталога.
 *
 * @see docs/STATE-AND-RESUME-POINT.md §11.4 задача 3.1/3.2
 */
import { Inject, Injectable } from '@nestjs/common'
import { Medicine } from '../../domain/medicine.entity.js'
import { MedicineNotFoundError } from '../../domain/errors/medicine-not-found.error.js'
import {
  MEDICINE_READ_REPOSITORY,
  type MedicineReadRepository,
} from '../ports/medicine-read.repository.port.js'

@Injectable()
export class GetMedicineByIdUseCase {
  constructor(
    @Inject(MEDICINE_READ_REPOSITORY)
    private readonly medicineReadRepository: MedicineReadRepository,
  ) {}

  async execute(id: string): Promise<Medicine> {
    const medicine = await this.medicineReadRepository.findById(id)
    if (medicine === null) {
      throw new MedicineNotFoundError(`Medicine not found: ${id}`)
    }
    return medicine
  }
}
