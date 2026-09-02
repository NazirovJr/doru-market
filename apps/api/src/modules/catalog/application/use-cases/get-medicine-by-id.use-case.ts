/**
 * `GetMedicineByIdUseCase` (DTJ-095, минимальная read-часть для волны 3.5).
 *
 * Достаёт `Medicine` по `id`. Если запись не найдена ИЛИ `medicine.canOrderRemotely()`
 * возвращает `false` (не опубликована, либо `controlCategory` в `{psychotropic, narcotic}`,
 * SRS-CAT-006) — бросает `MedicineNotFoundError` с ТЕМ ЖЕ сообщением, что и «не найдено»,
 * чтобы существование запрещённой к обороту записи не подтверждалось постороннему
 * (D-08, 404 замаплен в `DomainExceptionFilter`).
 *
 * Проверка — defense-in-depth: `MedicineReadRepository.findById` уже обязан фильтровать
 * `psychotropic`/`narcotic` на своём уровне (см. JSDoc порта), но use case не полагается
 * на это молча (та же схема, что в `GetMedicineDetailUseCase` и `FindAnalogsUseCase`).
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
    if (!medicine?.canOrderRemotely()) {
      // Не раскрываем факт существования запрещённой записи (SRS-CAT-006) —
      // одно и то же сообщение/ошибка для «не найдено» и «найдено, но запрещено».
      throw new MedicineNotFoundError(`Medicine not found: ${id}`)
    }
    return medicine
  }
}
