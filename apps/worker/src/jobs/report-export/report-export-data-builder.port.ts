import type { ReportExportColumnDto } from '@dorutj/contracts'

export interface ReportExportDataset {
  readonly rows: readonly Record<string, unknown>[]
  readonly columns: readonly ReportExportColumnDto[]
}

// Конкретные reportType регистрируются потребителем (TODO(DTJ-366)) — см. NullReportExportDataBuilder.
export interface ReportExportDataBuilderPort {
  build(reportType: string, params: Readonly<Record<string, unknown>>): Promise<ReportExportDataset>
}
