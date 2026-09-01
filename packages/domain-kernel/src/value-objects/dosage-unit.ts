/**
 * Единицы измерения дозировки (enum, значения совпадают с `dosage_unit` в
 * `11-database-schema.md`). Сравнение единиц — только через `Dosage.isEquivalentTo`
 * (конвертация масс через bigint, без float), сравнение строкового значения enum-а —
 * антипаттерн, единицы должны сравниваться через VO.
 */
/* eslint-disable @typescript-eslint/naming-convention -- Enum-значения совпадают с `dosage_unit` в БД (11-database-schema.md). В частности `mgPerMl` хранится как `mg_per_ml` (snake_case в БД, camelCase в коде — намеренно, для именования «связки»). */
export enum DosageUnit {
  mg = 'mg',
  mcg = 'mcg',
  g = 'g',
  ml = 'ml',
  iu = 'iu',
  percent = 'percent',
  mgPerMl = 'mg_per_ml',
}
