/**
 * Drizzle enum `control_category` (DTJ-091, EP-04). Значения совпадают с
 * `control_category` в `11-database-schema.md` §«ENUM-типы», D-08.
 */
import { pgEnum } from 'drizzle-orm/pg-core'

export const CONTROL_CATEGORY_VALUES = [
  'none',
  'prescription_only',
  'potent',
  'psychotropic',
  'narcotic',
] as const

export type ControlCategoryValue = (typeof CONTROL_CATEGORY_VALUES)[number]

export const controlCategoryEnum = pgEnum('control_category', CONTROL_CATEGORY_VALUES)
