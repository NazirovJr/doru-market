/**
 * Drizzle enum `dosage_form_class` (DTJ-091, EP-04). Значения совпадают с
 * `dosage_form_class` в `11-database-schema.md` §«ENUM-типы».
 */
import { pgEnum } from 'drizzle-orm/pg-core'

export const DOSAGE_FORM_CLASS_VALUES = [
  'tablet',
  'capsule',
  'syrup',
  'injection',
  'ointment',
  'drops',
  'inhaler',
  'suppository',
  'other',
] as const

export type DosageFormClassValue = (typeof DOSAGE_FORM_CLASS_VALUES)[number]

export const dosageFormClassEnum = pgEnum('dosage_form_class', DOSAGE_FORM_CLASS_VALUES)
