/** `ReportExportRendererPort` — диспетчер по `format` между `csv-renderer.ts`/`xlsx-renderer.ts` (EP-15, DTJ-361). */
import { Injectable } from '@nestjs/common'
import type { ReportExportFormat } from '@dorutj/contracts'
import type { ColumnDef, ReportExportRendererPort } from '@/modules/admin/application/ports/report-export.port.js'
import { renderCsv } from '../report-renderers/csv-renderer.js'
import { renderXlsx } from '../report-renderers/xlsx-renderer.js'

@Injectable()
export class ReportExportRendererAdapter implements ReportExportRendererPort {
  public async renderSync(rows: readonly Record<string, unknown>[], columns: readonly ColumnDef[], format: ReportExportFormat): Promise<Buffer> {
    if (format === 'xlsx') {
      return renderXlsx(rows, columns)
    }
    return renderCsv(rows, columns)
  }
}
