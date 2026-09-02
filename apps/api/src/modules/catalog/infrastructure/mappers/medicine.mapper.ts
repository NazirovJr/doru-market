/**
 * `MedicineMapper` (DTJ-092, EP-04, R1) — двусторонний маппинг DTO ↔ domain для
 * записей `medicines`.
 *
 * Это инфраструктурный код: он ЗНАЕТ про форму строки БД (`MedicineRecord`)
 * и про доменную сущность (`Medicine`), связывая их. Направление зависимостей:
 *
 *   `infrastructure` (mapper) ──▶ `domain` (entity)
 *
 * Обратной стрелки нет. `MedicineRecord` формально живёт в `domain/medicine.types.ts`,
 * но это контракт инфраструктуры (DTO), а не домен — он нужен только в сигнатурах
 * `application/ports/*.port.ts`, куда инжектируется зависимость, и в самом маппере.
 *
 * **Round-trip-инвариант.** `toDomain(toRecord(med))` восстанавливает сущность
 * с теми же `id`, `tradeName`, `innName`, `substances[]`, `controlCategory`,
 * `isPublished`, `isPrescriptionRequired`, `requiresColdChain`, `barcode`.
 * `categoryId`, `descriptionTj/Ru`, `imageUrl`, `manufacturerCountry/Name` —
 * тоже сохраняются. `dosageFormClass` восстанавливается как enum-значение.
 *
 * **Числовые поля.** `strengthValue` (NUMERIC(10,4)) приходит как строка из
 * `drizzle node-postgres`. Маппер принимает на вход `number | string` —
 * это упрощает тесты, где не нужно имитировать именно строковую форму.
 *
 * **Тест.** `medicine.mapper.spec.ts` (unit, без БД) — round-trip на фикстурах.
 */
import { Barcode, DosageForm, DosageUnit, ok, err } from '@dorutj/domain-kernel'
import type { Result } from '@dorutj/domain-kernel'
import { Medicine, type MedicineCreateCommand } from '@/modules/catalog/domain/medicine.entity.js'
import { ControlCategory, DosageFormClass } from '@/modules/catalog/domain/medicine.enums.js'
import type { MedicineRecord, MedicineSubstanceRecord } from '@/modules/catalog/domain/medicine.types.js'

/**
 * Тип-источник для маппинга: строка БД (Drizzle `$inferSelect`) или синтетическая
 * запись из теста. Все поля заданы явно — никаких `Partial<>`.
 */
export interface MedicineRowLike {
  readonly id: string
  readonly tradeName: string
  readonly innName: string
  readonly barcode: string | null
  readonly isGloballyIdentifiableByBarcode: boolean
  readonly categoryId: number
  readonly dosageForm: string
  readonly dosageFormClass: string
  readonly dosageStrength: string
  readonly manufacturerCountry: string
  readonly manufacturerName: string
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: string
  readonly isPublished: boolean
  readonly requiresColdChain: boolean
  readonly imageUrl: string | null
  readonly descriptionTj: string | null
  readonly descriptionRu: string | null
}

export interface SubstanceRowLike {
  readonly substanceId: string
  readonly strengthValue: number | string
  readonly strengthUnit: string
}

/** Восстановление доменной сущности `Medicine` из плоской записи БД. */
export function toDomain(row: MedicineRowLike, substances: readonly SubstanceRowLike[]): Medicine {
  const dosageFormClass = parseDosageFormClass(row.dosageFormClass)
  const dosageFormResult = DosageForm.create(dosageFormClass)
  if (!dosageFormResult.ok) {
    // Теоретически невозможно — `dosageFormClass` в БД прошёл CHECK-инвариант,
    // и `DosageForm.create` не имеет других путей отказа. Если сюда попали —
    // значит, кто-то записал в БД мусор; пробрасываем как ошибку.
    throw new Error(
      `Invalid dosageFormClass in row ${row.id}: ${row.dosageFormClass} (SRS-DOM-079)`,
    )
  }
  const cmd: MedicineCreateCommand & {
    readonly isPublished: boolean
    readonly barcode: Barcode | null
    readonly isGloballyIdentifiableByBarcode: boolean
  } = {
    id: row.id,
    tradeName: row.tradeName,
    innName: row.innName,
    categoryId: row.categoryId,
    dosageForm: dosageFormResult.value,
    dosageStrengthRaw: row.dosageStrength,
    manufacturerCountry: row.manufacturerCountry,
    manufacturerName: row.manufacturerName,
    isPrescriptionRequired: row.isPrescriptionRequired,
    controlCategory: parseControlCategory(row.controlCategory),
    requiresColdChain: row.requiresColdChain,
    imageUrl: row.imageUrl,
    descriptionTj: row.descriptionTj,
    descriptionRu: row.descriptionRu,
    substances: substances.map((s) => ({
      substanceId: s.substanceId,
      strengthValue: toNumber(s.strengthValue),
      strengthUnit: parseDosageUnit(s.strengthUnit),
    })),
    isPublished: row.isPublished,
    barcode: row.barcode === null ? null : Barcode.parse(row.barcode),
    isGloballyIdentifiableByBarcode: row.isGloballyIdentifiableByBarcode,
  }
  return Medicine.restore(cmd)
}

/** Плоский DTO инфраструктуры — то, что возвращает репозиторий. */
export function toRecord(medicine: Medicine, barcode: string | null): MedicineRecord {
  return {
    id: medicine.getId(),
    tradeName: medicine.getTradeName(),
    innName: medicine.getInnName(),
    barcode,
    isGloballyIdentifiableByBarcode: medicine.isGloballyIdentifiableByBarcode(),
    categoryId: medicine.getCategoryId(),
    dosageForm: medicine.getDosageForm().getFormClass(),
    dosageFormClass: medicine.getDosageForm().getFormClass(),
    dosageStrength: medicine.getDosageStrengthRaw(),
    manufacturerCountry: medicine.getManufacturerCountry(),
    manufacturerName: medicine.getManufacturerName(),
    isPrescriptionRequired: medicine.isPrescriptionRequired(),
    controlCategory: medicine.getControlCategory(),
    isPublished: medicine.isPublished(),
    requiresColdChain: medicine.requiresColdChain(),
    imageUrl: medicine.getImageUrl(),
    descriptionTj: medicine.getDescriptionTj(),
    descriptionRu: medicine.getDescriptionRu(),
    substances: medicine.getSubstances().map(toMedicineSubstanceRecord),
  }
}

function toMedicineSubstanceRecord(s: {
  readonly substanceId: string
  readonly strengthValue: number
  readonly strengthUnit: DosageUnit
}): MedicineSubstanceRecord {
  return {
    substanceId: s.substanceId,
    strengthValue: s.strengthValue,
    strengthUnit: s.strengthUnit,
  }
}

// ── Парсеры enum-значений БД ─────────────────────────────────────────────

function parseDosageFormClass(raw: string): DosageFormClass {
  switch (raw) {
    case 'tablet':
      return DosageFormClass.tablet
    case 'capsule':
      return DosageFormClass.capsule
    case 'syrup':
      return DosageFormClass.syrup
    case 'injection':
      return DosageFormClass.injection
    case 'ointment':
      return DosageFormClass.ointment
    case 'drops':
      return DosageFormClass.drops
    case 'inhaler':
      return DosageFormClass.inhaler
    case 'suppository':
      return DosageFormClass.suppository
    case 'other':
      return DosageFormClass.other
    default:
      throw new Error(`Unknown dosageFormClass from DB: ${raw}`)
  }
}

function parseControlCategory(raw: string): ControlCategory {
  switch (raw) {
    case 'none':
      return ControlCategory.none
    case 'prescription_only':
      return ControlCategory.prescriptionOnly
    case 'potent':
      return ControlCategory.potent
    case 'psychotropic':
      return ControlCategory.psychotropic
    case 'narcotic':
      return ControlCategory.narcotic
    default:
      throw new Error(`Unknown controlCategory from DB: ${raw}`)
  }
}

function parseDosageUnit(raw: string): DosageUnit {
  switch (raw) {
    case 'mg':
      return DosageUnit.mg
    case 'mcg':
      return DosageUnit.mcg
    case 'g':
      return DosageUnit.g
    case 'ml':
      return DosageUnit.ml
    case 'iu':
      return DosageUnit.iu
    case 'percent':
      return DosageUnit.percent
    case 'mg_per_ml':
      // `DosageUnit.mgPerMl` хранится в БД как `mg_per_ml` (snake_case);
      // ключ enum — `mgPerMl` (camelCase), см. `packages/domain-kernel`.
      return DosageUnit.mgPerMl
    default:
      throw new Error(`Unknown dosageUnit from DB: ${raw}`)
  }
}

function toNumber(raw: number | string): number {
  if (typeof raw === 'number') return raw
  // NUMERIC(10,4) из drizzle `node-postgres` приходит строкой. `parseFloat`
  // достаточно для восстановления значения; доменная валидация (>`0` и т.д.)
  // уже была выполнена при insert через CHECK-инвариант БД и `Medicine.create()`.
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Cannot parse numeric value from DB: ${raw}`)
  }
  return parsed
}

/**
 * Типобезопасная обёртка для случая, когда вызов `toDomain` нужно валидировать.
 * Сейчас `toDomain` бросает на невалидных enum-значениях (что должно быть
 * невозможно после CHECK-инвариантов БД). Возвращаем `Result`-форму — если
 * в будущем понадобится recover.
 */
export function toDomainSafe(
  row: MedicineRowLike,
  substances: readonly SubstanceRowLike[],
): Result<Medicine, Error> {
  try {
    return ok(toDomain(row, substances))
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)))
  }
}