/**
 * `INVENTORY_IMPORT_TEMPLATE_HEADERS` (EP-05, DTJ-159, SRS-INV-012) — единственный
 * источник истины для заголовков Excel/CSV-шаблона остатков. Дословно таблица
 * `docs/spec/22-module-inventory-sync-1c.md` §3.2 (10 колонок, порядок нормативен).
 *
 * **Общий файл для ДВУХ тикетов** (риск синхронизации, зафиксированный в DTJ-159):
 * генератор шаблона (`inventory-import-template.controller.ts`, этот тикет) И парсер
 * (`xlsx-excel-inventory-parser.adapter.ts`, DTJ-160) читают ЭТУ ЖЕ константу — правка
 * заголовка в одном месте автоматически синхронна для обоих направлений (C15/DRY).
 * Валидация — ПО ЗАГОЛОВКУ, не по позиции колонки (аптека может переставить столбцы).
 */

/** Поля, на которые матчится колонка шаблона — те же имена, что `IngestRowInput` (DTJ-148). */
export type InventoryImportTemplateField =
  | 'rawBarcode'
  | 'internalSku'
  | 'rawTradeName'
  | 'rawDosageForm'
  | 'rawDosageStrength'
  | 'rawManufacturerName'
  | 'priceDiram'
  | 'quantity'
  | 'batchNumber'
  | 'expiresAtIso'

export interface InventoryImportTemplateHeaderSpec {
  readonly header: string
  readonly required: boolean
  readonly field: InventoryImportTemplateField
}

/** Порядок — нормативный (совпадает с §3.2 module 22), НЕ переставлять без ревью обоих тикетов. */
export const INVENTORY_IMPORT_TEMPLATE_HEADERS: readonly InventoryImportTemplateHeaderSpec[] = [
  { header: 'Штрихкод (EAN-13)', required: false, field: 'rawBarcode' },
  { header: 'Внутренний код (SKU)', required: true, field: 'internalSku' },
  { header: 'Торговое название', required: true, field: 'rawTradeName' },
  { header: 'Форма выпуска', required: false, field: 'rawDosageForm' },
  { header: 'Дозировка', required: false, field: 'rawDosageStrength' },
  { header: 'Производитель', required: false, field: 'rawManufacturerName' },
  { header: 'Цена (TJS)', required: true, field: 'priceDiram' },
  { header: 'Остаток (шт.)', required: true, field: 'quantity' },
  { header: 'Партия', required: false, field: 'batchNumber' },
  { header: 'Срок годности', required: true, field: 'expiresAtIso' },
]

/** Заголовок «Срок годности» — колонка форматируется как ТЕКСТ (не Excel date), SRS-INV-013. */
export const INVENTORY_IMPORT_TEMPLATE_EXPIRY_HEADER = 'Срок годности'

export const INVENTORY_IMPORT_TEMPLATE_SHEET_NAME = 'Остатки'
export const INVENTORY_IMPORT_TEMPLATE_FILENAME_XLSX = 'doru-tj-inventory-template.xlsx'
export const INVENTORY_IMPORT_TEMPLATE_FILENAME_CSV = 'doru-tj-inventory-template.csv'
