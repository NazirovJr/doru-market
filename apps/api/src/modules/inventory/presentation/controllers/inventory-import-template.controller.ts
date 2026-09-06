/**
 * `InventoryImportTemplateController` (EP-05, DTJ-159, SRS-INV-012).
 *
 * `GET /api/v1/inventory-import-template[?format=csv]` — шаблон остатков для аптек без
 * автоматизации (R1-5, Charter §5 «работает с аптеками без автоматизации»). Заголовки —
 * ЕДИНСТВЕННЫЙ источник истины `INVENTORY_IMPORT_TEMPLATE_HEADERS`
 * (`infrastructure/inventory-import-template.constants.ts`), переиспользуемый ПАРСЕРОМ
 * (DTJ-160) — правка заголовка в одном месте синхронна для генератора и валидатора.
 *
 * RBAC — та же граница, что ручной ввод/Excel-импорт (`inventory:ingest`,
 * `12-api-conventions-auth-tenancy.md` §4): `pharmacy_admin`/`super_admin`, НЕ
 * `pharmacist` (см. «Технический контекст» DTJ-162 — расхождение документов решено в
 * пользу `12`). `TenantScopeGuard` НЕ добавляется явно — зарегистрирован глобально как
 * `APP_GUARD` (`tenancy.module.ts`), применяется ко всем маршрутам автоматически.
 *
 * Ответ — файл-вложение через голый `@Res()` (БЕЗ `passthrough`): глобальный
 * `ResponseInterceptor` оборачивает обычные ответы в `{data, meta}` JSON, что несовместимо
 * с бинарным `.xlsx`/`.csv` — тот же приём, что `GetPayoutsController.export`
 * (`modules/payments/presentation/pharmacy-accounts-reports/get-payouts.controller.ts`).
 *
 * Колонка «Срок годности» форматируется как ТЕКСТ (`numFmt = '@'`), не Excel date-тип
 * (SRS-INV-013): без этого пользователь может случайно получить локализованный формат
 * (`MM/DD/YYYY`) при ручном вводе даты в Excel, что сразу даёт `ambiguous_date_format`
 * при обратном импорте (DTJ-160) — колонка-формат, а не отдельная строка-пример, т.к.
 * шаблон без строк данных: пример данных НЕ добавлен (SRS называет его необязательным
 * «дешёвым улучшением» — риск случайной повторной загрузки строки-примера как реальной
 * перевешивает пользу для шаблона без парсера, различающего примеры).
 */
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import ExcelJS from 'exceljs'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import {
  INVENTORY_IMPORT_TEMPLATE_EXPIRY_HEADER,
  INVENTORY_IMPORT_TEMPLATE_FILENAME_CSV,
  INVENTORY_IMPORT_TEMPLATE_FILENAME_XLSX,
  INVENTORY_IMPORT_TEMPLATE_HEADERS,
  INVENTORY_IMPORT_TEMPLATE_SHEET_NAME,
} from '../../infrastructure/inventory-import-template.constants.js'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const MIN_COLUMN_WIDTH = 14
const COLUMN_WIDTH_PADDING = 2
const CSV_FORMAT_QUERY_VALUE = 'csv'

/** Строит книгу с ОДНОЙ строкой заголовков — переиспользуется и `.xlsx`, и `.csv` веткой. */
export function buildInventoryImportTemplateWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(INVENTORY_IMPORT_TEMPLATE_SHEET_NAME)
  worksheet.addRow(INVENTORY_IMPORT_TEMPLATE_HEADERS.map((spec) => spec.header))
  INVENTORY_IMPORT_TEMPLATE_HEADERS.forEach((spec, index) => {
    const column = worksheet.getColumn(index + 1)
    column.width = Math.max(spec.header.length + COLUMN_WIDTH_PADDING, MIN_COLUMN_WIDTH)
    if (spec.header === INVENTORY_IMPORT_TEMPLATE_EXPIRY_HEADER) {
      column.numFmt = '@'
    }
  })
  return workbook
}

@Controller({ path: 'inventory-import-template', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacy_admin', 'super_admin')
export class InventoryImportTemplateController {
  @Get()
  async download(
    @Query('format') format: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = buildInventoryImportTemplateWorkbook()
    if (format === CSV_FORMAT_QUERY_VALUE) {
      await this.sendCsv(workbook, reply)
      return
    }
    await this.sendXlsx(workbook, reply)
  }

  private async sendXlsx(workbook: ExcelJS.Workbook, reply: FastifyReply): Promise<void> {
    const buffer = await workbook.xlsx.writeBuffer()
    reply.header('content-type', XLSX_CONTENT_TYPE)
    reply.header('content-disposition', `attachment; filename="${INVENTORY_IMPORT_TEMPLATE_FILENAME_XLSX}"`)
    reply.send(buffer)
  }

  /** UTF-8 с BOM (`formatterOptions.writeBOM`) — Excel на Windows иначе портит кириллицу. */
  private async sendCsv(workbook: ExcelJS.Workbook, reply: FastifyReply): Promise<void> {
    const buffer = await workbook.csv.writeBuffer({ formatterOptions: { writeBOM: true } })
    reply.header('content-type', CSV_CONTENT_TYPE)
    reply.header('content-disposition', `attachment; filename="${INVENTORY_IMPORT_TEMPLATE_FILENAME_CSV}"`)
    reply.send(buffer)
  }
}
