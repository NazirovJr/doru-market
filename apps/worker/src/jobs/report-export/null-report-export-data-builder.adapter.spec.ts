import { describe, expect, it } from 'vitest'
import { NullReportExportDataBuilder, ReportTypeNotRegisteredError } from './null-report-export-data-builder.adapter.js'

describe('NullReportExportDataBuilder', () => {
  it('build — отклоняется ReportTypeNotRegisteredError с именем reportType в сообщении', async () => {
    const builder = new NullReportExportDataBuilder()

    await expect(builder.build('pharmacy-sales', {})).rejects.toThrow(ReportTypeNotRegisteredError)
    await expect(builder.build('pharmacy-sales', {})).rejects.toThrow(/pharmacy-sales/)
  })
})
