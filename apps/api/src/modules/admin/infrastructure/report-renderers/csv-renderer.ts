// BOM — корректная кириллица при открытии в Excel на Windows.
import { renderCsvRows, type ReportExportColumnDto } from '@dorutj/contracts'

const UTF8_BOM = '﻿'

export function renderCsv(rows: readonly Record<string, unknown>[], columns: readonly ReportExportColumnDto[]): Buffer {
  return Buffer.from(UTF8_BOM + renderCsvRows(rows, columns), 'utf-8')
}
