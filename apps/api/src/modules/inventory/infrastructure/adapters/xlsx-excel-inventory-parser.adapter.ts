/**
 * `XlsxExcelInventoryParserAdapter` (EP-05, DTJ-160, SRS-INV-012/013/014) — `exceljs`-реализация
 * `ExcelInventoryParserPort` (тот же пакет, что генератор шаблона DTJ-159 — обоснование нового
 * пакета уже дано там, не дублируется здесь по правилу тикета).
 *
 * **Определение формата — по СИГНАТУРЕ БАЙТОВ, не по заявленному `mimeType`** (см. «Что
 * сделать» DTJ-160 п.3): `.xlsx` — ZIP-архив (магические байты `PK`), браузеры/ОС присылают
 * РАЗНЫЙ `Content-Type` для одного и того же `.csv` (`text/csv`, `application/vnd.ms-excel`,
 * `text/plain` — зависит от ОС/локали), надёжнее не доверять клиенту. `mimeType` принимается
 * портом (сигнатура тикета), но не используется решающим образом — оставлен для полноты
 * интерфейса и будущей диагностики (лог при расхождении с фактическим форматом).
 *
 * **CSV — через `workbook.csv.read()` (fast-csv), не отдельный пакет** (см. «Риски» тикета:
 * `csv-parse` — запасной план, только если это не сработает на реальных файлах). Явно снимаем
 * ведущий UTF-8 BOM ПЕРЕД парсингом — собственный генератор шаблона (DTJ-159) пишет CSV именно
 * с BOM (Excel на Windows иначе портит кириллицу), `fast-csv` его не снимает сам.
 *
 * **Дата — строго `cell.effectiveType !== Date` И регекс `ДД.ММ.ГГГГ`** (SRS-INV-013): если
 * пользователь ввёл дату так, что Excel/exceljs распознал её как НАТИВНЫЙ Date-тип (несмотря на
 * `numFmt='@'` шаблона — Excel может переопределить формат при ручном вводе в некоторых
 * локалях), это уже само по себе означает «не тот формат, что ожидался» — строка отклоняется
 * `ambiguous_date_format` ДО попытки прочитать текст ячейки, парсер НЕ угадывает.
 *
 * **Штрихкод НЕ валидируется на этом уровне** (см. «Что сделать» п.5) — сохраняется как
 * есть для аудита независимо от формата (не блокирует строку, тот же принцип, что невалидный
 * EAN-13 в матчинге, SRS-DOM-076/177).
 *
 * `rawRow` (для `RejectedExcelRow`, переиспользуется DTJ-164 отчётом об ошибках) — те же
 * snake_case ключи, что `rowToPayload` REST-канала (`inventory-batch-update.controller.ts`),
 * чтобы отчёт DTJ-164 не различал две формы объекта по источнику ошибки (парсер vs use case).
 */
import { Inject, Injectable } from '@nestjs/common'
import { Readable } from 'node:stream'
import ExcelJS from 'exceljs'
import { ExcelImportRowLimitExceededError, ExcelTemplateHeaderMismatchError } from '@dorutj/contracts'
import { AppConfigService } from '@/config/app-config.service.js'
import { Money } from '@/shared-kernel/domain/value-objects/money.vo.js'
import {
  INVENTORY_IMPORT_TEMPLATE_HEADERS,
  type InventoryImportTemplateField,
} from '@/modules/inventory/infrastructure/inventory-import-template.constants.js'
import type {
  ExcelInventoryParserPort,
  ExcelInventoryParseResult,
  ParsedExcelRow,
  RejectedExcelRow,
} from '@/modules/inventory/application/ports/excel-inventory-parser.port.js'

const ZIP_MAGIC_BYTE_0 = 0x50 // 'P'
const ZIP_MAGIC_BYTE_1 = 0x4b // 'K'
const UTF8_BOM = '﻿'
const EXPIRY_DATE_PATTERN = /^(\d{2})\.(\d{2})\.(\d{4})$/
const HEADER_ROW_NUMBER = 1
const FIRST_DATA_ROW_NUMBER = 2

type HeaderColumnMap = ReadonlyMap<InventoryImportTemplateField, number>

type RowParseResult =
  | { readonly ok: true; readonly row: ParsedExcelRow }
  | { readonly ok: false; readonly errorCode: RejectedExcelRow['errorCode']; readonly reason: string }

@Injectable()
export class XlsxExcelInventoryParserAdapter implements ExcelInventoryParserPort {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  async parse(file: Buffer, _mimeType: string): Promise<ExcelInventoryParseResult> {
    const worksheet = await this.loadWorksheet(file)
    const headerMap = this.buildHeaderColumnMap(worksheet)
    this.assertRequiredHeadersPresent(headerMap)
    const dataRows = this.collectNonEmptyDataRows(worksheet)
    this.assertWithinRowLimit(dataRows.length)
    return this.parseDataRows(dataRows, headerMap)
  }

  private async loadWorksheet(file: Buffer): Promise<ExcelJS.Worksheet> {
    if (isZipSignature(file)) {
      const workbook = new ExcelJS.Workbook()
      // Расхождение `@types/node` транзитивной зависимости `exceljs` → `fast-csv` — тот же
      // обход, что `inventory-import-template.controller.spec.ts` (DTJ-159), не ошибка кода.
      await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0])
      const worksheet = workbook.worksheets[0]
      if (worksheet === undefined) {
        throw new ExcelTemplateHeaderMismatchError({ reason: 'uploaded workbook has no worksheets' })
      }
      return worksheet
    }
    const text = file.toString('utf-8')
    const withoutBom = text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text
    const workbook = new ExcelJS.Workbook()
    return workbook.csv.read(Readable.from(withoutBom))
  }

  /** `Map<field, 1-based columnNumber>` по фактическому файлу — валидация по заголовку, не позиции. */
  private buildHeaderColumnMap(worksheet: ExcelJS.Worksheet): HeaderColumnMap {
    const columnByHeaderText = new Map<string, number>()
    worksheet.getRow(HEADER_ROW_NUMBER).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = cell.text.trim()
      if (text.length > 0) columnByHeaderText.set(text, colNumber)
    })
    const map = new Map<InventoryImportTemplateField, number>()
    for (const spec of INVENTORY_IMPORT_TEMPLATE_HEADERS) {
      const column = columnByHeaderText.get(spec.header)
      if (column !== undefined) map.set(spec.field, column)
    }
    return map
  }

  private assertRequiredHeadersPresent(headerMap: HeaderColumnMap): void {
    const missingHeaders = INVENTORY_IMPORT_TEMPLATE_HEADERS.filter(
      (spec) => spec.required && !headerMap.has(spec.field),
    ).map((spec) => spec.header)
    if (missingHeaders.length > 0) {
      throw new ExcelTemplateHeaderMismatchError({ missingHeaders })
    }
  }

  /** Пропускает полностью пустые строки (частый хвост реальных Excel-файлов), не считает их данными. */
  private collectNonEmptyDataRows(worksheet: ExcelJS.Worksheet): readonly ExcelJS.Row[] {
    const rows: ExcelJS.Row[] = []
    for (let r = FIRST_DATA_ROW_NUMBER; r <= worksheet.rowCount; r += 1) {
      const row = worksheet.getRow(r)
      if (!isRowEmpty(row)) rows.push(row)
    }
    return rows
  }

  private assertWithinRowLimit(dataRowCount: number): void {
    const maxRows = this.config.excelImportMaxRows
    if (dataRowCount > maxRows) {
      throw new ExcelImportRowLimitExceededError({ rowCount: dataRowCount, maxRows })
    }
  }

  private parseDataRows(rows: readonly ExcelJS.Row[], headerMap: HeaderColumnMap): ExcelInventoryParseResult {
    const parsedRows: ParsedExcelRow[] = []
    const rejectedRows: RejectedExcelRow[] = []
    rows.forEach((row, rowIndex) => {
      const result = parseRow(rowIndex, row, headerMap)
      if (result.ok) {
        parsedRows.push(result.row)
        return
      }
      rejectedRows.push({
        rowIndex,
        errorCode: result.errorCode,
        reason: result.reason,
        rawRow: extractRawRow(row, headerMap),
      })
    })
    return { rows: parsedRows, rejectedRows }
  }
}

function isZipSignature(file: Buffer): boolean {
  return file.length >= 2 && file[0] === ZIP_MAGIC_BYTE_0 && file[1] === ZIP_MAGIC_BYTE_1
}

function isRowEmpty(row: ExcelJS.Row): boolean {
  let empty = true
  row.eachCell({ includeEmpty: false }, () => {
    empty = false
  })
  return empty
}

function cellText(row: ExcelJS.Row, headerMap: HeaderColumnMap, field: InventoryImportTemplateField): string {
  const column = headerMap.get(field)
  if (column === undefined) return ''
  return row.getCell(column).text.trim()
}

function isNativeDateCell(row: ExcelJS.Row, headerMap: HeaderColumnMap, field: InventoryImportTemplateField): boolean {
  const column = headerMap.get(field)
  if (column === undefined) return false
  return row.getCell(column).effectiveType === ExcelJS.ValueType.Date
}

/** snake_case — см. JSDoc файла («rawRow ... те же ключи, что rowToPayload REST-канала»). */
function extractRawRow(row: ExcelJS.Row, headerMap: HeaderColumnMap): Readonly<Record<string, unknown>> {
  return {
    raw_barcode: cellText(row, headerMap, 'rawBarcode'),
    internal_sku: cellText(row, headerMap, 'internalSku'),
    raw_trade_name: cellText(row, headerMap, 'rawTradeName'),
    raw_dosage_form: cellText(row, headerMap, 'rawDosageForm'),
    raw_dosage_strength: cellText(row, headerMap, 'rawDosageStrength'),
    raw_manufacturer_name: cellText(row, headerMap, 'rawManufacturerName'),
    price_diram: cellText(row, headerMap, 'priceDiram'),
    quantity: cellText(row, headerMap, 'quantity'),
    expires_at: cellText(row, headerMap, 'expiresAtIso'),
    batch_number: cellText(row, headerMap, 'batchNumber'),
  }
}

/** Построчная валидация (SRS-INV-012/013) — первая провалившаяся проверка решает `errorCode`. */
function parseRow(rowIndex: number, row: ExcelJS.Row, headerMap: HeaderColumnMap): RowParseResult {
  const internalSku = cellText(row, headerMap, 'internalSku')
  const rawTradeName = cellText(row, headerMap, 'rawTradeName')
  const priceText = cellText(row, headerMap, 'priceDiram')
  const quantityText = cellText(row, headerMap, 'quantity')
  const expiryText = cellText(row, headerMap, 'expiresAtIso')
  if (internalSku === '' || rawTradeName === '' || priceText === '' || quantityText === '' || expiryText === '') {
    return { ok: false, errorCode: 'missing_required_field', reason: 'a required column is empty for this row' }
  }

  const priceResult = parsePriceDiram(priceText)
  if (!priceResult.ok) return priceResult

  const quantity = Number(quantityText)
  if (!Number.isInteger(quantity) || quantity < 0) {
    return { ok: false, errorCode: 'invalid_quantity', reason: `quantity must be a non-negative integer: "${quantityText}"` }
  }

  if (isNativeDateCell(row, headerMap, 'expiresAtIso')) {
    return {
      ok: false,
      errorCode: 'ambiguous_date_format',
      reason: 'expiry cell holds a native date value, expected literal text "ДД.ММ.ГГГГ"',
    }
  }
  const dateMatch = EXPIRY_DATE_PATTERN.exec(expiryText)
  if (dateMatch === null) {
    return { ok: false, errorCode: 'ambiguous_date_format', reason: `expiry date must match ДД.ММ.ГГГГ exactly: "${expiryText}"` }
  }
  const [, day, month, year] = dateMatch as unknown as readonly [string, string, string, string]

  return {
    ok: true,
    row: {
      rowIndex,
      internalSku,
      rawBarcode: cellText(row, headerMap, 'rawBarcode') || null,
      rawTradeName,
      rawDosageForm: cellText(row, headerMap, 'rawDosageForm') || null,
      rawDosageStrength: cellText(row, headerMap, 'rawDosageStrength') || null,
      rawManufacturerName: cellText(row, headerMap, 'rawManufacturerName') || null,
      priceDiram: priceResult.priceDiram,
      quantity,
      expiresAtIso: `${year}-${month}-${day}`,
      batchNumber: cellText(row, headerMap, 'batchNumber') || null,
    },
  }
}

/** `Money.fromDbDecimalTjs` (та же VO-конвертация, что БД legacy decimal) — `priceText` уже прошёл `>0`-проверку. */
function parsePriceDiram(
  priceText: string,
): { readonly ok: true; readonly priceDiram: bigint } | { readonly ok: false; readonly errorCode: 'invalid_price'; readonly reason: string } {
  const priceTjs = Number(priceText.replace(',', '.'))
  if (!Number.isFinite(priceTjs) || priceTjs <= 0) {
    return { ok: false, errorCode: 'invalid_price', reason: `price must be a positive number: "${priceText}"` }
  }
  try {
    return { ok: true, priceDiram: Money.fromDbDecimalTjs(priceTjs.toFixed(2)).diram }
  } catch {
    return { ok: false, errorCode: 'invalid_price', reason: `price could not be parsed: "${priceText}"` }
  }
}
