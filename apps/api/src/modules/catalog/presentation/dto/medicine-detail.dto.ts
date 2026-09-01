/**
 * `MedicineDetailDto` (DTJ-095, EP-04, R1) — JSON-контракт карточки товара
 * `GET /api/v1/medicines/:id` по SRS-CAT-049.
 *
 * Контракт (SRS-CAT-049) — буквально:
 *   `{ id, tradeName, innName, dosageForm, dosageFormClass, dosageStrength,
 *      manufacturerName, manufacturerCountry, controlCategory,
 *      isPrescriptionRequired, requiresColdChain, imageUrl, description,
 *      substances, offers, hasAnalogs }`
 *
 * Конвертация domain `MedicineRecord` → DTO делается здесь, в presentation-слое
 * (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §3.2: маппер DTO↔domain живёт в presentation).
 *
 * **`imageUrl: null` плейсхолдер (SRS-CAT-007).** Given `imageUrl === null`,
 * фронтенд (`packages/ui`, EP-18) сам рендерит SVG-плейсхолдер по `dosageFormClass`.
 * Бэкенд лишь гарантирует, что `dosageFormClass` ВСЕГДА присутствует в ответе:
 *   - `dosageFormClass` обязан быть не `null` (enum `DosageFormClass` имеет `'other'`
 *     как default в БД — см. `11-database-schema.md` CHECK-инвариант).
 *   - Контроллер не подменяет его на `null`.
 *
 * **Строковые enum'ы.** `ControlCategory`/`DosageUnit`/`DosageFormClass` в `domain/medicine.enums.ts`
 * объявлены как string-enum'ы со значениями, СОВПАДАЮЩИМИ с БД (`prescription_only`,
 * `mg_per_ml`). Никакой ручной нормализации camelCase→snake_case не нужно — `enum`
 * в TypeScript со строковыми значениями напрямую сериализуется в нужную форму.
 */
import type { MedicineDetail } from '@/modules/catalog/application/use-cases/get-medicine-detail.use-case.js'

/** Формат ответа карточки товара (`{ data: MedicineDetailDto }`). */
export interface MedicineDetailResponseDto {
  readonly data: MedicineDetailDto
}

export interface MedicineDetailDto {
  readonly id: string
  readonly tradeName: string
  readonly innName: string
  readonly dosageForm: string
  readonly dosageFormClass: string
  readonly dosageStrength: string
  readonly manufacturerName: string
  readonly manufacturerCountry: string
  readonly controlCategory: string
  readonly isPrescriptionRequired: boolean
  readonly requiresColdChain: boolean
  readonly imageUrl: string | null
  readonly description: string | null
  readonly substances: readonly SubstanceSummaryDto[]
  readonly offers: readonly unknown[]
  readonly hasAnalogs: boolean
}

export interface SubstanceSummaryDto {
  readonly substanceId: string
  readonly strengthValue: number
  readonly strengthUnit: string
}

/** Конвертация `MedicineDetail` (use case) → `MedicineDetailDto` для HTTP-ответа. */
export function toMedicineDetailDto(detail: MedicineDetail): MedicineDetailDto {
  const record = detail.record
  return {
    id: record.id,
    tradeName: record.tradeName,
    innName: record.innName,
    dosageForm: record.dosageForm,
    dosageFormClass: record.dosageFormClass,
    dosageStrength: record.dosageStrength,
    manufacturerName: record.manufacturerName,
    manufacturerCountry: record.manufacturerCountry,
    // String-enum'ы `ControlCategory`/`DosageUnit` уже хранят значения в БД-форме.
    controlCategory: record.controlCategory,
    isPrescriptionRequired: record.isPrescriptionRequired,
    requiresColdChain: record.requiresColdChain,
    imageUrl: record.imageUrl,
    description: detail.description,
    substances: record.substances.map((s) => ({
      substanceId: s.substanceId,
      strengthValue: s.strengthValue,
      strengthUnit: s.strengthUnit,
    })),
    offers: detail.offers,
    hasAnalogs: detail.hasAnalogs,
  }
}