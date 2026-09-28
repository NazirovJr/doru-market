// TODO(DTJ-366): зарегистрировать реальные построители датасета (отчёты продаж/выплат аптеки) вместо этой заглушки.
import { Injectable } from '@nestjs/common'
import type { ReportExportDataBuilderPort, ReportExportDataset } from './report-export-data-builder.port.js'

export class ReportTypeNotRegisteredError extends Error {
  constructor(reportType: string) {
    super(`report-export: reportType="${reportType}" не зарегистрирован (TODO(DTJ-366))`)
    this.name = 'ReportTypeNotRegisteredError'
  }
}

@Injectable()
export class NullReportExportDataBuilder implements ReportExportDataBuilderPort {
  public build(reportType: string, _params: Readonly<Record<string, unknown>>): Promise<ReportExportDataset> {
    return Promise.reject(new ReportTypeNotRegisteredError(reportType))
  }
}
