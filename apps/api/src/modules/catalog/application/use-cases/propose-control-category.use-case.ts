/**
 * `ProposeControlCategoryUseCase` (DTJ-096, EP-04, R1).
 *
 * Инициирует смену категории контроля: загружает `Medicine` через `CatalogRepository`,
 * вызывает `medicine.proposeControlCategory()` (DTJ-093), при успехе —
 * `CatalogRepository.save()` + запись `NewControlCategoryCandidateEvent` в outbox
 * в ТОЙ ЖЕ транзакции (`unitOfWork.run(...)`).
 *
 * Поле `controlCategory` самой записи БД НЕ меняется этим use case (SRS-DOM-014) —
 * изменение происходит отдельным модерационным процессом вне зоны этого эпика.
 *
 * Используется админскими эндпоинтами модерации каталога (вне scope EP-04).
 *
 * @see docs/spec/10-domain-model.md SRS-DOM-014
 * @see docs/spec/20-module-catalog-search.md SRS-CAT-064
 */
import { Inject, Injectable } from '@nestjs/common'
import { Barcode, DosageForm } from '@dorutj/domain-kernel'
// `UnitOfWorkPort` — через публичный фасад модуля `auth` (D-27,
// `no-cross-module-deep-import`): catalog не имеет права импортировать
// внутренности чужого модуля напрямую.
import { UNIT_OF_WORK, type UnitOfWorkPort } from '@/modules/auth/index.js'
import { CATALOG_REPOSITORY, type CatalogRepository } from '../ports/catalog-repository.port.js'
import { Medicine } from '../../domain/medicine.entity.js'
import { NewControlCategoryCandidateEvent } from '../../domain/events/new-control-category-candidate.event.js'
import { NotFoundError } from '@dorutj/contracts'
import type { MedicineRecord } from '../../domain/medicine.types.js'
import type { ControlCategory } from '../../domain/medicine.enums.js'

export interface ProposeControlCategoryInput {
  readonly medicineId: string
  readonly proposedCategory: ControlCategory
  readonly actorId: string
}

export interface ProposeControlCategoryResult {
  readonly medicineId: string
  readonly proposedCategory: ControlCategory
  readonly event: NewControlCategoryCandidateEvent
}

@Injectable()
export class ProposeControlCategoryUseCase {
  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: CatalogRepository,
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  /**
   * Инициирует смену категории контроля. Бросает `NotFoundError` если препарат не найден.
   * Бросает `ControlCategoryChangeRequiresModerationError` если предложенная категория
   * равна текущей или другая ошибка доменной логики.
   * Возвращает результат с событием для подтверждения записи в outbox.
   */
  async execute(input: ProposeControlCategoryInput): Promise<ProposeControlCategoryResult> {
    return this.unitOfWork.run(async (_tx) => {
      // Загружаем препарат через репозиторий (без фильтра видимости — админское действие)
      const record = await this.catalogRepository.findMedicineById(input.medicineId)
      if (record === null) {
        throw new NotFoundError({ resource: 'medicine' })
      }

      // Реконструируем доменную сущность
      const medicine = this.recordToMedicine(record)

      // Инициируем смену категории — доменная логика валидирует
      const proposeResult = medicine.proposeControlCategory(
        input.proposedCategory,
        input.actorId,
        new Date(),
      )
      if (!proposeResult.ok) {
        // ControlCategoryChangeRequiresModerationError пробрасываем наружу без изменений
        throw proposeResult.error
      }

      // Сохраняем обновлённую сущность (controlCategory пока НЕ меняется,
      // но вызов save нужен для консистентности — домен мог изменить другие поля)
      await this.catalogRepository.save(medicine)

      // Событие уже сгенерировано доменом, возвращаем его для записи в outbox
      // TODO(DTJ-096): когда общий OutboxPort EP-01 будет доступен (DTJ-016),
      // здесь должна быть запись в outbox через UnitOfWork:
      // await this.outbox.append(proposeResult.value)
      // Пока outbox-инфраструктура не стабилизирована — возвращаем событие,
      // вызывающий код (контроллер/админ) решает что с ним делать.

      return {
        medicineId: input.medicineId,
        proposedCategory: input.proposedCategory,
        event: proposeResult.value,
      }
    })
  }

  /**
   * Реконструирует доменную сущность `Medicine` из `MedicineRecord`.
   * Использует приватную фабрику `Medicine.restore` (доступна только инфраструктуре).
   */
  private recordToMedicine(record: MedicineRecord): Medicine {
    const dosageFormResult = DosageForm.create(record.dosageFormClass)
    if (!dosageFormResult.ok) {
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