/**
 * Доменная сущность `Medicine` (EP-04, DTJ-093). Корень агрегата каталога.
 *
 * Инварианты (SRS-DOM-013/014/015/016/017):
 * - `Medicine.publish()` требует `substances.length > 0` (SRS-DOM-013).
 * - `proposeControlCategory(...)` НЕ мутирует поле синхронно, возвращает событие
 *   `NewControlCategoryCandidateEvent` для модерации (SRS-DOM-014, D-08).
 * - `controlCategory ∈ {potent, psychotropic, narcotic}` требует `isPrescriptionRequired = true`
 *   (SRS-DOM-015, инвариант конструктора).
 * - `attachBarcode(...)` корректно выставляет `isGloballyIdentifiableByBarcode` (SRS-DOM-016, D-06).
 * - `psychotropic`/`narcotic` запрещены к дистанционной продаже (`canOrderRemotely() === false`).
 *
 * Чистый домен (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §2): ноль I/O, ноль `Date.now()`.
 * Время — через `Clock` порт (потребляющие use cases), ID — через `IdGenerator`.
 */
import { Barcode, Dosage, err, ok } from '@dorutj/domain-kernel'
import type { DosageForm, DosageUnit, Result } from '@dorutj/domain-kernel'
import {
  CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE,
  CONTROL_CATEGORIES_REQUIRING_MODERATION,
} from './medicine.enums.js'
import type { ControlCategory } from './medicine.enums.js'
import { ControlCategoryChangeRequiresModerationError } from './errors/control-category-change-requires-moderation.error.js'
import { InvalidMedicineStateError } from './errors/invalid-medicine-state.error.js'
import { MissingSubstancesError } from './errors/missing-substances.error.js'
import { type MedicinePublishedEvent } from './events/medicine-published.event.js'
import { type NewControlCategoryCandidateEvent } from './events/new-control-category-candidate.event.js'

interface MedicineSubstanceInput {
  readonly substanceId: string
  readonly strengthValue: number
  readonly strengthUnit: DosageUnit
}

export interface MedicineCreateCommand {
  readonly id: string
  readonly tradeName: string
  readonly innName: string
  readonly categoryId: number
  readonly dosageForm: DosageForm
  readonly dosageStrengthRaw: string
  readonly manufacturerCountry: string
  readonly manufacturerName: string
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: ControlCategory
  readonly requiresColdChain: boolean
  readonly imageUrl: string | null
  readonly descriptionTj: string | null
  readonly descriptionRu: string | null
  readonly substances: readonly MedicineSubstanceInput[]
}

export class Medicine {
  private readonly _id: string
  private readonly _tradeName: string
  private readonly _innName: string
  private readonly _categoryId: number
  private readonly _dosageForm: DosageForm
  private readonly _dosageStrengthRaw: string
  private readonly _parsedDosage: Dosage | null
  private readonly _manufacturerCountry: string
  private readonly _manufacturerName: string
  private readonly _isPrescriptionRequired: boolean
  private _controlCategory: ControlCategory
  private readonly _requiresColdChain: boolean
  private readonly _imageUrl: string | null
  private readonly _descriptionTj: string | null
  private readonly _descriptionRu: string | null
  private _barcode: Barcode | null
  private _isGloballyIdentifiableByBarcode: boolean
  private _isPublished: boolean
  private readonly _substances: Map<string, MedicineSubstanceInput>

  private constructor(cmd: MedicineCreateCommand) {
    this._id = cmd.id
    this._tradeName = cmd.tradeName
    this._innName = cmd.innName
    this._categoryId = cmd.categoryId
    this._dosageForm = cmd.dosageForm
    this._dosageStrengthRaw = cmd.dosageStrengthRaw
    this._parsedDosage = parseStrength(cmd.dosageStrengthRaw)
    this._manufacturerCountry = cmd.manufacturerCountry
    this._manufacturerName = cmd.manufacturerName
    this._isPrescriptionRequired = cmd.isPrescriptionRequired
    this._controlCategory = cmd.controlCategory
    this._requiresColdChain = cmd.requiresColdChain
    this._imageUrl = cmd.imageUrl
    this._descriptionTj = cmd.descriptionTj
    this._descriptionRu = cmd.descriptionRu
    this._barcode = null
    this._isGloballyIdentifiableByBarcode = false
    this._isPublished = false
    this._substances = new Map()
    for (const substance of cmd.substances) {
      this._substances.set(substance.substanceId, substance)
    }
  }

  /**
   * Фабрика новой записи (`isPublished = false` по умолчанию, SRS-DOM-013/015).
   * Используется сидом DTJ-098 и admin-CRUD (вне scope EP-04).
   */
  public static create(cmd: MedicineCreateCommand): Result<Medicine, InvalidMedicineStateError> {
    if (cmd.substances.length === 0) {
      return err(new InvalidMedicineStateError('at least one substance required (SRS-DOM-013)'))
    }
    if (CONTROL_CATEGORIES_REQUIRING_MODERATION.has(cmd.controlCategory) && !cmd.isPrescriptionRequired) {
      return err(
        new InvalidMedicineStateError(
          `controlCategory=${cmd.controlCategory} requires isPrescriptionRequired=true (SRS-DOM-015)`,
        ),
      )
    }
    return ok(new Medicine(cmd))
  }

  /**
   * Реконструкция из персистентного состояния (вызывается ТОЛЬКО инфраструктурным
   * маппером `medicine.mapper.ts`, `02` §2.2). НЕ выполняет валидацию — данные уже
   * прошли её на момент записи в БД.
   */
  public static restore(
    cmd: MedicineCreateCommand & {
      readonly isPublished: boolean
      readonly barcode: Barcode | null
      readonly isGloballyIdentifiableByBarcode: boolean
    },
  ): Medicine {
    const med = new Medicine(cmd)
    med._isPublished = cmd.isPublished
    med._barcode = cmd.barcode
    med._isGloballyIdentifiableByBarcode = cmd.isGloballyIdentifiableByBarcode
    return med
  }

  public getId(): string {
    return this._id
  }
  public getTradeName(): string {
    return this._tradeName
  }
  public getInnName(): string {
    return this._innName
  }
  public getCategoryId(): number {
    return this._categoryId
  }
  public getDosageForm(): DosageForm {
    return this._dosageForm
  }
  public getDosageStrengthRaw(): string {
    return this._dosageStrengthRaw
  }
  public getParsedDosage(): Dosage | null {
    return this._parsedDosage
  }
  public getManufacturerCountry(): string {
    return this._manufacturerCountry
  }
  public getManufacturerName(): string {
    return this._manufacturerName
  }
  public isPrescriptionRequired(): boolean {
    return this._isPrescriptionRequired
  }
  public getControlCategory(): ControlCategory {
    return this._controlCategory
  }
  public requiresColdChain(): boolean {
    return this._requiresColdChain
  }
  public getImageUrl(): string | null {
    return this._imageUrl
  }
  public getDescriptionTj(): string | null {
    return this._descriptionTj
  }
  public getDescriptionRu(): string | null {
    return this._descriptionRu
  }
  public getBarcode(): Barcode | null {
    return this._barcode
  }
  public isGloballyIdentifiableByBarcode(): boolean {
    return this._isGloballyIdentifiableByBarcode
  }
  public isPublished(): boolean {
    return this._isPublished
  }
  public getSubstances(): readonly MedicineSubstanceInput[] {
    return Array.from(this._substances.values())
  }

  /**
   * Добавление действующего вещества (используется до публикации, при курации черновика).
   * После публикации изменение состава запрещено (SRS-DOM-013) — инвариант контролируется
   * на уровне агрегата, не в репозитории.
   */
  public addSubstance(substanceId: string, strengthValue: number, strengthUnit: DosageUnit): void {
    if (this._isPublished) {
      throw new InvalidMedicineStateError('cannot add substances to published medicine (SRS-DOM-013)')
    }
    this._substances.set(substanceId, { substanceId, strengthValue, strengthUnit })
  }

  /** Привязка штрихкода (SRS-DOM-016, D-06). `null` raw → снимает штрихкод. */
  public attachBarcode(raw: string | null): void {
    if (raw === null) {
      this._barcode = null
      this._isGloballyIdentifiableByBarcode = false
      return
    }
    const barcode = Barcode.parse(raw)
    this._barcode = barcode
    this._isGloballyIdentifiableByBarcode = barcode.isGloballyIdentifiable()
  }

  /**
   * Публикация записи (SRS-DOM-013): переводит `isPublished = true`, требует непустое
   * множество `substances`. Возвращает доменное событие `MedicinePublishedEvent`,
   * которое use case кладёт в outbox (`02` §2.6: домен НЕ пишет в outbox).
   */
  public publish(now: Date): Result<MedicinePublishedEvent, MissingSubstancesError> {
    if (this._substances.size === 0) {
      return err(new MissingSubstancesError(`Medicine ${this._id} has no substances (SRS-DOM-013)`))
    }
    this._isPublished = true
    return ok({ medicineId: this._id, publishedAt: now.toISOString() })
  }

  /**
   * Инициирование смены категории контроля (SRS-DOM-014, D-08). НЕ мутирует поле
   * синхронно — изменение возможно ТОЛЬКО через модерационный процесс после
   * `NewControlCategoryCandidateEvent`. Прямая мутация не существует в публичном API.
   */
  public proposeControlCategory(
    proposedCategory: ControlCategory,
    actorId: string,
    now: Date,
  ): Result<NewControlCategoryCandidateEvent, ControlCategoryChangeRequiresModerationError> {
    if (this._controlCategory === proposedCategory) {
      return err(
        new ControlCategoryChangeRequiresModerationError(
          `proposed category equals current: ${proposedCategory}`,
        ),
      )
    }
    return ok({
      medicineId: this._id,
      proposedCategory,
      actorId,
      proposedAt: now.toISOString(),
    })
  }

  /**
   * Допустимо ли дистанционно заказать препарат (D-08, SRS-CAT-006). Запрет на уровне
   * ДОМЕНА, не только UI — прямой запрос `psychotropic`/`narcotic` по известному id
   * возвращает 404 (SRS-CAT-006).
   */
  public canOrderRemotely(): boolean {
    return !CONTROL_CATEGORIES_FORBIDDEN_FROM_REMOTE.has(this._controlCategory) && this._isPublished
  }

  /**
   * Прямая мутация `controlCategory` (только для модерационного слоя, EP-15, не EP-04).
   * В этом эпике недоступен.
   */
  public applyModeratedControlCategory(newCategory: ControlCategory): void {
    if (CONTROL_CATEGORIES_REQUIRING_MODERATION.has(newCategory) && !this._isPrescriptionRequired) {
      throw new InvalidMedicineStateError(
        `cannot apply controlCategory=${newCategory} without isPrescriptionRequired=true (SRS-DOM-015)`,
      )
    }
    this._controlCategory = newCategory
  }
}

function parseStrength(raw: string): Dosage | null {
  const result = Dosage.parse(raw)
  return result.ok ? result.value : null
}
