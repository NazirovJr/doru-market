/**
 * Публичные контракты модуля `catalog` для межмодульного использования (EP-04).
 * Потребители: `orders` (D-06/SRS-DOM-107 — снимок названия/дозировки на момент
 * заказа), `inventory` (EP-05, composite-матчинг D-06), `search` (EP-06, не здесь).
 *
 * Импортируются ТОЛЬКО через `@dorutj/contracts`; внутренний `@dorutj/catalog` private
 * API (`modules/catalog/**` напрямую) запрещён правилом `dependency-cruiser`
 * `no-cross-module-deep-import`.
 */

export type CatalogMedicineId = string & { readonly __brand: 'CatalogMedicineId' }
export type CatalogSubstanceId = string & { readonly __brand: 'CatalogSubstanceId' }
export type CatalogCategoryId = number & { readonly __brand: 'CatalogCategoryId' }

export const CONTROL_CATEGORY_VALUES_PUBLIC = [
  'none',
  'prescription_only',
  'potent',
  'psychotropic',
  'narcotic',
] as const
export type ControlCategoryPublic = (typeof CONTROL_CATEGORY_VALUES_PUBLIC)[number]

export interface MedicineSnapshotPublic {
  readonly medicineId: string
  readonly tradeName: string
  readonly innName: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: ControlCategoryPublic
}

export interface SubstanceRefPublic {
  readonly substanceId: string
  readonly innName: string
  readonly strengthValue: number
  readonly strengthUnit: string
}

export interface CompositeMatchInputPublic {
  readonly rawBarcode: string | null
  readonly rawTradeName: string
  readonly rawDosageForm: string | null
  readonly rawDosageStrength: string | null
  readonly rawManufacturerName: string | null
}

export type MedicineMatchResultPublic =
  | { readonly outcome: 'matched'; readonly medicineId: string; readonly matchedVia: 'barcode' | 'fuzzy' }
  | { readonly outcome: 'ambiguous'; readonly candidateIds: readonly string[] }
  | { readonly outcome: 'no_candidate' }

/** `PharmacyOffer` (SRS-CAT-011) — read-модель для результата `FindAnalogsUseCase`. */
export interface PharmacyOfferPublic {
  readonly pharmacyId: string
  readonly priceDiram: number
  readonly distanceMeters: number | null
  readonly isStale: boolean
  readonly lastSyncedAt: string | null
}

/** Дефолтный радиус поиска/карточки товара (SRS-CAT-011), в метрах. */
export const SEARCH_DEFAULT_RADIUS_METERS = 5000

/**
 * `CategoryNodePublic` (DTJ-094, SRS-CAT-004) — публичный DTO узла дерева
 * категорий, отдаваемого `GET /api/v1/categories`. Имена локализованы в виде
 * объекта `{tj,ru,en}` (Charter §5 i18n). `childrenCount` — вычисляемое поле
 * (кол-во прямых детей), не хранится в БД (SRS-CAT-004).
 *
 * Поля `commissionCategory` намеренно НЕТ — оно относится к резолвингу
 * `platform_fee` (D-03, SRS-CAT-003) и в UI дерева навигации не нужно.
 */
export interface CategoryNodePublic {
  readonly id: number
  readonly parentId: number | null
  readonly slug: string
  readonly name: { readonly tj: string; readonly ru: string; readonly en: string }
  readonly sortOrder: number
  readonly childrenCount: number
  readonly children: readonly CategoryNodePublic[]
}

/** Корень успешного ответа `GET /api/v1/categories` (SRS-API-014). */
export interface CategoryTreeResponsePublic {
  readonly data: readonly CategoryNodePublic[]
}
