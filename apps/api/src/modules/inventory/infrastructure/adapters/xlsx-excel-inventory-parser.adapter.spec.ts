/**
 * Тест `XlsxExcelInventoryParserAdapter` (EP-05, DTJ-160, критерии приёмки).
 *
 * Фикстуры — `.xlsx`/`.csv` СОБИРАЮТСЯ В ПАМЯТИ через `exceljs`/строки (не бинарные файлы в
 * репозитории, тест-план DTJ-160). `fakeConfig` — тот же приём, что
 * `http-logger.middleware.spec.ts` (`{...} as unknown as AppConfigService`).
 */
import 'reflect-metadata'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { AppConfigService } from '@/config/app-config.service.js'
import { ExcelImportRowLimitExceededError, ExcelTemplateHeaderMismatchError } from '@dorutj/contracts'
import { INVENTORY_IMPORT_TEMPLATE_HEADERS } from '@/modules/inventory/infrastructure/inventory-import-template.constants.js'
import { XlsxExcelInventoryParserAdapter } from './xlsx-excel-inventory-parser.adapter.js'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CSV_MIME = 'text/csv'
const DEFAULT_MAX_ROWS = 20_000

function fakeConfig(maxRows: number = DEFAULT_MAX_ROWS): AppConfigService {
  return { excelImportMaxRows: maxRows } as unknown as AppConfigService
}

const HEADER_TEXTS = INVENTORY_IMPORT_TEMPLATE_HEADERS.map((spec) => spec.header)

/** Валидная строка данных — значения ПО КАНОНИЧЕСКОМУ порядку заголовков (см. `INVENTORY_IMPORT_TEMPLATE_HEADERS`). */
function validRowValues(overrides: Partial<Record<string, string>> = {}): readonly string[] {
  const base: Record<string, string> = {
    'Штрихкод (EAN-13)': '4600000000012',
    'Внутренний код (SKU)': 'SKU-1',
    'Торговое название': 'Парацетамол',
    'Форма выпуска': 'таблетки',
    'Дозировка': '500мг',
    'Производитель': 'ОАО Фарм',
    'Цена (TJS)': '12.50',
    'Остаток (шт.)': '100',
    'Партия': 'B-1',
    'Срок годности': '15.03.2028',
  }
  return HEADER_TEXTS.map((header) => overrides[header] ?? base[header] ?? '')
}

async function buildXlsxBuffer(
  headers: readonly string[],
  rows: readonly (readonly (string | Date)[])[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Остатки')
  worksheet.addRow(headers)
  for (const row of rows) worksheet.addRow(row)
  return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>
}

function csvEscape(value: string): string {
  return value.includes(',') ? `"${value.replace(/"/g, '""')}"` : value
}

function buildCsvBuffer(headers: readonly string[], rows: readonly (readonly string[])[]): Buffer {
  const lines = [headers, ...rows].map((cols) => cols.map(csvEscape).join(','))
  return Buffer.from(lines.join('\r\n'), 'utf-8')
}

describe('XlsxExcelInventoryParserAdapter (DTJ-160, SRS-INV-012/013/014)', () => {
  it('корректный xlsx с переставленными колонками парсится верно по заголовку (SRS-INV-012)', async () => {
    const shuffledHeaders = [...HEADER_TEXTS].reverse()
    const values = validRowValues()
    const shuffledValues = shuffledHeaders.map((header) => values[HEADER_TEXTS.indexOf(header)] as string)
    const buffer = await buildXlsxBuffer(shuffledHeaders, [shuffledValues])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      internalSku: 'SKU-1',
      rawTradeName: 'Парацетамол',
      quantity: 100,
      expiresAtIso: '2028-03-15',
      batchNumber: 'B-1',
    })
    expect(result.rows[0]?.priceDiram).toBe(1250n)
  })

  it('дата в формате ДД.ММ.ГГГГ принимается, конвертируется в ISO', async () => {
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, [validRowValues({ 'Срок годности': '01.12.2030' })])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rows[0]?.expiresAtIso).toBe('2030-12-01')
  })

  it('дата в формате MM/DD/YYYY (15/03/2028) отклоняется как ambiguous_date_format (TC-INV-006), остальные строки обработаны штатно', async () => {
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, [
      validRowValues({ 'Внутренний код (SKU)': 'SKU-BAD', 'Срок годности': '15/03/2028' }),
      validRowValues({ 'Внутренний код (SKU)': 'SKU-OK' }),
    ])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([
      expect.objectContaining({ rowIndex: 0, errorCode: 'ambiguous_date_format' }),
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.internalSku).toBe('SKU-OK')
  })

  it('дата в формате ГГГГ-ММ-ДД отклоняется как ambiguous_date_format', async () => {
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, [validRowValues({ 'Срок годности': '2028-03-15' })])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([expect.objectContaining({ errorCode: 'ambiguous_date_format' })])
  })

  it('нативная Excel-дата в ячейке «Срок годности» (не текст) отклоняется как ambiguous_date_format', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Остатки')
    worksheet.addRow(HEADER_TEXTS)
    const values = validRowValues()
    worksheet.addRow(values)
    const expiryColumn = HEADER_TEXTS.indexOf('Срок годности') + 1
    worksheet.getRow(2).getCell(expiryColumn).value = new Date(2028, 2, 15)
    const buffer = await workbook.xlsx.writeBuffer()
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer as unknown as ArrayBuffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([expect.objectContaining({ errorCode: 'ambiguous_date_format' })])
  })

  it('отсутствие обязательной колонки (Остаток (шт.)) отклоняет весь файл целиком', async () => {
    const headersWithoutQuantity = HEADER_TEXTS.filter((h) => h !== 'Остаток (шт.)')
    const valuesWithoutQuantity = headersWithoutQuantity.map(
      (header) => validRowValues()[HEADER_TEXTS.indexOf(header)] as string,
    )
    const buffer = await buildXlsxBuffer(headersWithoutQuantity, [valuesWithoutQuantity])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    await expect(adapter.parse(Buffer.from(buffer), XLSX_MIME)).rejects.toThrow(ExcelTemplateHeaderMismatchError)
  })

  it('пустое обязательное поле в строке даёт missing_required_field, не блокируя остальные строки', async () => {
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, [
      validRowValues({ 'Торговое название': '' }),
      validRowValues({ 'Внутренний код (SKU)': 'SKU-OK' }),
    ])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([expect.objectContaining({ rowIndex: 0, errorCode: 'missing_required_field' })])
    expect(result.rows).toHaveLength(1)
  })

  it('цена <= 0 даёт invalid_price', async () => {
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, [validRowValues({ 'Цена (TJS)': '0' })])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([expect.objectContaining({ errorCode: 'invalid_price' })])
  })

  it('остаток отрицательный даёт invalid_quantity', async () => {
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, [validRowValues({ 'Остаток (шт.)': '-5' })])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([expect.objectContaining({ errorCode: 'invalid_quantity' })])
  })

  it('штрихкод не из 13 цифр сохраняется как есть, не блокирует строку', async () => {
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, [validRowValues({ 'Штрихкод (EAN-13)': '123' })])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(Buffer.from(buffer), XLSX_MIME)

    expect(result.rejectedRows).toEqual([])
    expect(result.rows[0]?.rawBarcode).toBe('123')
  })

  it('файл сверх EXCEL_IMPORT_MAX_ROWS отклоняется целиком', async () => {
    const rows = [validRowValues(), validRowValues(), validRowValues(), validRowValues()]
    const buffer = await buildXlsxBuffer(HEADER_TEXTS, rows)
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig(3))

    await expect(adapter.parse(Buffer.from(buffer), XLSX_MIME)).rejects.toThrow(ExcelImportRowLimitExceededError)
  })

  it('CSV-файл (с BOM, как генерирует шаблон DTJ-159) с тем же набором заголовков парсится идентично XLSX', async () => {
    const buffer = Buffer.concat([
      Buffer.from('﻿', 'utf-8'),
      buildCsvBuffer(HEADER_TEXTS, [validRowValues()]),
    ])
    const adapter = new XlsxExcelInventoryParserAdapter(fakeConfig())

    const result = await adapter.parse(buffer, CSV_MIME)

    expect(result.rejectedRows).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      internalSku: 'SKU-1',
      rawTradeName: 'Парацетамол',
      quantity: 100,
      expiresAtIso: '2028-03-15',
    })
  })
})
