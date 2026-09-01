/**
 * Типы DTO для `Medicine`-агрегата (DTJ-092, DTJ-096). Это DTO инфраструктуры (record
 * после маппинга из БД), а НЕ доменная сущность `Medicine` (которая создаётся в DTJ-093).
 *
 * Хранятся в `domain/` потому, что они используются в сигнатурах `application/ports/*`
 * (домен-зависимые интерфейсы). Сами мапперы DTO↔domain живут в `infrastructure/mappers/`.
 *
 * `02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.1: domain не импортирует infrastructure, но
 * может определять типы, которые инфраструктура будет мапить — это часть контракта.
 */
import type { DosageUnit } from '@dorutj/domain-kernel'
import type { ControlCategory, DosageFormClass } from './medicine.enums.js'

export interface MedicineRecord {
  readonly id: string
  readonly tradeName: string
  readonly innName: string
  readonly barcode: string | null
  readonly isGloballyIdentifiableByBarcode: boolean
  readonly categoryId: number
  readonly dosageForm: string
  readonly dosageFormClass: DosageFormClass
  readonly dosageStrength: string
  readonly manufacturerCountry: string
  readonly manufacturerName: string
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: ControlCategory
  readonly isPublished: boolean
  readonly requiresColdChain: boolean
  readonly imageUrl: string | null
  readonly descriptionTj: string | null
  readonly descriptionRu: string | null
  readonly substances: readonly MedicineSubstanceRecord[]
}

export interface MedicineSubstanceRecord {
  readonly substanceId: string
  readonly strengthValue: number
  readonly strengthUnit: DosageUnit
}

export interface SubstanceRef {
  readonly substanceId: string
  readonly innName: string
  readonly strengthValue: number
  readonly strengthUnit: string
}

export interface CategoryNode {
  readonly id: number
  readonly parentId: number | null
  readonly slug: string
  readonly nameTj: string
  readonly nameRu: string
  readonly nameEn: string
  readonly commissionCategory: 'rx' | 'otc' | 'parapharma'
  readonly sortOrder: number
  readonly isActive: boolean
  readonly children: readonly CategoryNode[]
}

/** Снимок для заказов (D-06/SRS-DOM-107): название/дозировка/Rx-флаг на момент заказа. */
export interface MedicineSnapshot {
  readonly medicineId: string
  readonly tradeName: string
  readonly innName: string
  readonly dosageForm: string
  readonly dosageStrength: string
  readonly isPrescriptionRequired: boolean
  readonly controlCategory: ControlCategory
}
