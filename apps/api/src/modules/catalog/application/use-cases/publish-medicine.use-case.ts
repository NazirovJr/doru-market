/**
 * `PublishMedicineUseCase` (DTJ-096, EP-04, R1).
 *
 * Публикует препарат: загружает `Medicine` через `CatalogRepository`,
 * вызывает `medicine.publish()` (DTJ-093), при успехе — `CatalogRepository.save()`;
 * при ошибке (`MissingSubstancesError`) — пробрасывает наружу. Событие
 * `MedicinePublishedEvent` в outbox пока НЕ пишется (см. TODO(DTJ-096) ниже) —
 * возвращается вызывающему коду.
 *
 * **Убрана декоративная `unitOfWork.run(...)` (волна 6, найдено аудитом того же дефекта, что
 * чинили в checkout DTJ-231/233, verify-otp, ingest-inventory) — см. полное обоснование в JSDoc
 * `ProposeControlCategoryUseCase` (идентичная пара use case'ов, идентичный дефект).** Коротко:
 * `execute()` открывал `unitOfWork.run(async (_tx) => {...})` с НЕИСПОЛЬЗУЕМЫМ `_tx` — ни
 * `CatalogRepository.findMedicineById`/`save`, ни (несуществующая пока) outbox-запись его не
 * принимали. Транзакция без единого участника не даёт атомарности, но держит соединение пула и
 * несёт тот же риск self-deadlock при конкурентности ≥ размера пула — обёртка убрана целиком.
 *
 * Используется админскими эндпоинтами модерации каталога (вне scope EP-04).
 *
 * @see docs/spec/10-domain-model.md SRS-DOM-013
 * @see docs/spec/20-module-catalog-search.md SRS-CAT-064
 */
import { Inject, Injectable } from '@nestjs/common'
import { Barcode, DosageForm } from '@dorutj/domain-kernel'
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports/catalog-repository.port.js'
import { Medicine } from '../../domain/medicine.entity.js'
import { MedicinePublishedEvent } from '../../domain/events/medicine-published.event.js'
import { NotFoundError } from '@dorutj/contracts'
import type { MedicineRecord } from '../../domain/medicine.types.js'

export interface PublishMedicineInput {
  readonly medicineId: string
  readonly actorId: string
}

export interface PublishMedicineResult {
  readonly medicineId: string
  readonly publishedAt: string
  readonly event: MedicinePublishedEvent
}

@Injectable()
export class PublishMedicineUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
  ) {}

  /**
   * Публикует препарат. Бросает `NotFoundError` если препарат не найден.
   * Бросает `MissingSubstancesError` если у препарата нет действующих веществ.
   * Возвращает результат с событием для подтверждения записи в outbox.
   */
  async execute(input: PublishMedicineInput): Promise<PublishMedicineResult> {
    // Загружаем препарат через репозиторий (без фильтра видимости — админское действие)
    const record = await this.catalogRepository.findMedicineById(input.medicineId)
    if (record === null) {
      throw new NotFoundError({ resource: 'medicine' })
    }

    // Реконструируем доменную сущность
    const medicine = this.recordToMedicine(record)

    // Публикуем — доменная логика валидирует наличие веществ
    const publishResult = medicine.publish(new Date())
    if (!publishResult.ok) {
      // MissingSubstancesError пробрасываем наружу без изменений
      throw publishResult.error
    }

    // Сохраняем обновлённую сущность (isPublished = true)
    await this.catalogRepository.save(medicine)

    // Событие уже сгенерировано доменом, возвращаем его для записи в outbox
    // TODO(DTJ-096): когда общий OutboxPort EP-01 будет доступен (DTJ-016),
    // здесь должна быть запись в outbox через UnitOfWork:
    // await this.outbox.append(publishResult.value)
    // Пока outbox-инфраструктура не стабилизирована — возвращаем событие,
    // вызывающий код (контроллер/админ) решает что с ним делать.

    return {
      medicineId: input.medicineId,
      publishedAt: publishResult.value.publishedAt,
      event: publishResult.value,
    }
  }

  /**
   * Реконструирует доменную сущность `Medicine` из `MedicineRecord`.
   * Использует приватную фабрику `Medicine.restore` (доступна только инфраструктуре).
   */
  private recordToMedicine(record: MedicineRecord): Medicine {
    // Medicine.restore ожидает команду с полными данными включая isPublished, barcode и т.д.
    // Мы преобразуем MedicineRecord обратно в формат, который понимает restore()
    const dosageFormResult = DosageForm.create(record.dosageFormClass)
    if (!dosageFormResult.ok) {
      // Теоретически невозможно — dosageFormClass в БД прошёл CHECK-инвариант.
      throw new Error(`Invalid dosageFormClass in record ${record.id}: ${record.dosageFormClass}`)
    }
    return Medicine.restore({
      id: record.id,
      tradeName: record.tradeName,
      innName: record.innName,
      categoryId: record.categoryId,
      dosageForm: dosageFormResult.value,
      dosageStrengthRaw: record.dosageStrength,
      manufacturerCountry: record.manufacturerCountry,
      manufacturerName: record.manufacturerName,
      isPrescriptionRequired: record.isPrescriptionRequired,
      controlCategory: record.controlCategory,
      requiresColdChain: record.requiresColdChain,
      imageUrl: record.imageUrl,
      descriptionTj: record.descriptionTj,
      descriptionRu: record.descriptionRu,
      substances: record.substances.map(s => ({
        substanceId: s.substanceId,
        strengthValue: s.strengthValue,
        strengthUnit: s.strengthUnit,
      })),
      isPublished: record.isPublished,
      barcode: record.barcode ? Barcode.parse(record.barcode) : null,
      isGloballyIdentifiableByBarcode: record.isGloballyIdentifiableByBarcode,
    })
  }
}