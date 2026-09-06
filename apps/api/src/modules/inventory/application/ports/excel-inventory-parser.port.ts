/**
 * Порт `ExcelInventoryParserPort` (EP-05, DTJ-160, SRS-INV-012/013/014).
 *
 * Единственное место, где байты файла (`.xlsx`/`.csv`), загруженного аптекой без
 * автоматизации, превращаются в типизированный массив строк. Валидация — ПО ЗАГОЛОВКУ
 * колонки (не по позиции, аптека может переставить столбцы), заголовки читаются из
 * `INVENTORY_IMPORT_TEMPLATE_HEADERS` (DTJ-159, единственный источник истины, риск
 * рассинхронизации между шаблоном/генератором и парсером зафиксирован там).
 *
 * Разделение ответственности (см. «Что сделать» тикета п.1): парсер знает ТОЛЬКО формат
 * файла (заголовок → примитив), не доменные инварианты — VO (`Money`/`ExpiryDate`) и
 * матчинг конструируются позже, в мапере/use case DTJ-161. `ParsedExcelRow` — плоские
 * примитивы, форма полей совпадает с `InventoryImportTemplateField` (DTJ-159).
 *
 * Два уровня ошибок:
 *   - СТРУКТУРНЫЕ (весь файл целиком, ДО построчного разбора) — бросаются как исключения
 *     (`ExcelTemplateHeaderMismatchError`/`ExcelImportRowLimitExceededError`,
 *     `@dorutj/contracts`): отсутствует обязательная колонка ИЛИ файл превышает
 *     `EXCEL_IMPORT_MAX_ROWS`.
 *   - ПОСТРОЧНЫЕ (`rejectedRows`) — одна невалидная строка НЕ блокирует остальные
 *     (частичный успех уже на уровне парсинга, SRS-INV-013 «явная ошибка лучше молчаливой
 *     порчи данных»): `missing_required_field`/`invalid_price`/`invalid_quantity`/
 *     `ambiguous_date_format` — подмножество `InventorySyncRowErrorCode`, см. её JSDoc.
 */
import type { InventorySyncRowErrorCode } from './inventory-sync-batch.repository.port.js'

export const EXCEL_INVENTORY_PARSER = Symbol.for('@dorutj/inventory/excel-inventory-parser')

/** Один УСПЕШНО распарсенный ряд — примитивы, БЕЗ VO/резолва медикамента (см. JSDoc файла). */
export interface ParsedExcelRow {
  readonly rowIndex: number
  readonly internalSku: string
  readonly rawBarcode: string | null
  readonly rawTradeName: string
  readonly rawDosageForm: string | null
  readonly rawDosageStrength: string | null
  readonly rawManufacturerName: string | null
  readonly priceDiram: bigint
  readonly quantity: number
  /** ISO `YYYY-MM-DD` — распарсено уже из строгого `ДД.ММ.ГГГГ` шаблона (SRS-INV-013). */
  readonly expiresAtIso: string
  readonly batchNumber: string | null
}

/**
 * Построчная ошибка парсинга, СО значениями исходной строки — для DTJ-164 (отчёт об
 * ошибках Excel-импорта переиспользует `rawRow` теми же ключами, что шаблон DTJ-159).
 */
export interface RejectedExcelRow {
  readonly rowIndex: number
  readonly errorCode: Extract<
    InventorySyncRowErrorCode,
    'missing_required_field' | 'invalid_price' | 'invalid_quantity' | 'ambiguous_date_format'
  >
  readonly reason: string
  readonly rawRow: Readonly<Record<string, unknown>>
}

export interface ExcelInventoryParseResult {
  readonly rows: readonly ParsedExcelRow[]
  readonly rejectedRows: readonly RejectedExcelRow[]
}

export interface ExcelInventoryParserPort {
  /**
   * `file` — сырые байты загруженного файла; `mimeType` — заявленный клиентом Content-Type
   * (адаптер определяет реальный формат по СИГНАТУРЕ байтов, не доверяя ему слепо — браузеры
   * присылают разные MIME для одного и того же `.csv`, см. JSDoc адаптера).
   *
   * Бросает `ExcelTemplateHeaderMismatchError` (отсутствует обязательная колонка) или
   * `ExcelImportRowLimitExceededError` (> `EXCEL_IMPORT_MAX_ROWS` строк данных) — обе
   * структурные, ДО построчного разбора. Построчные проблемы — в `rejectedRows` результата,
   * не бросаются.
   */
  parse(file: Buffer, mimeType: string): Promise<ExcelInventoryParseResult>
}
