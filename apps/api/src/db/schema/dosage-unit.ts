/**
 * Drizzle enum `dosage_unit` (DTJ-091, EP-04). Значения совпадают с `dosage_unit` в
 * `11-database-schema.md` §«ENUM-типы».
 */
import { pgEnum } from 'drizzle-orm/pg-core'

export const DOSAGE_UNIT_VALUES = ['mg', 'mcg', 'g', 'ml', 'iu', 'percent', 'mg_per_ml'] as const

export type DosageUnitValue = (typeof DOSAGE_UNIT_VALUES)[number]

export const dosageUnitEnum = pgEnum('dosage_unit', DOSAGE_UNIT_VALUES)
