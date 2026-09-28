// exceljs — уже используется inventory (xlsx-excel-inventory-parser.adapter.ts), переиспользован, не заведён заново.
import ExcelJS from 'exceljs'
import type { ReportExportColumnDto } from '@dorutj/contracts'

const SHEET_NAME = 'export'

export async function renderXlsx(rows: readonly Record<string, unknown>[], columns: readonly ReportExportColumnDto[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(SHEET_NAME)
  worksheet.columns = columns.map((column) => ({ header: column.header, key: column.key }))
  for (const row of rows) {
    worksheet.addRow(row)
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
