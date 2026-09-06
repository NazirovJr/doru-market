/**
 * `InventoryExcelErrorReportController` (EP-05, DTJ-164, SRS-INV-045).
 *
 * `GET /api/v1/inventory-sync-batches/:sourceUploadId/error-report` — для Excel-канала
 * (единственного, где аптека — человек, работающий в самом Excel, DTJ-161) кабинет
 * предлагает скачать файл ТОГО ЖЕ шаблона (`INVENTORY_IMPORT_TEMPLATE_HEADERS`, DTJ-159),
 * содержащий ТОЛЬКО отклонённые строки + 11-ю колонку «Причина ошибки» (локализованный
 * `errorCode → i18n`) — аптека правит файл в Excel и загружает заново как НОВЫЙ импорт
 * (терминальные батчи неизменяемы, это не патч старого).
 *
 * Источник данных — ОБЪЕДИНЕНИЕ `inventory_sync_errors` по ВСЕМ `inventory_sync_batches`
 * одной загрузки (`InventorySyncReportQueryService.getErrorReportForActor`, DTJ-164):
 * ошибки ПАРСЕРА (синтетический контейнер DTJ-161/164) И ошибки use case (обычные батчи) —
 * см. JSDoc сервиса и `InventoryExcelImportController.persistParserErrorsContainerIfNeeded`.
 *
 * RBAC/владение — та же граница, что DTJ-163 (`pharmacy_admin`/`super_admin`, НЕ
 * `pharmacist` — этот эндпоинт про ИСПРАВЛЕНИЕ данных загрузки, а не read-only просмотр
 * истории, тот же уровень доступа, что DTJ-159/161/162). `404 NOT_FOUND` — ТРИ РАЗНЫХ случая
 * неотличимы намеренно (см. JSDoc сервиса): `sourceUploadId` не существует, принадлежит
 * чужой аптеке, ИЛИ импорт завершился без единой ошибки (АС3 — «нет смысла скачивать пустой
 * отчёт»).
 *
 * Ответ — файл-вложение через голый `@Res()` (БЕЗ `passthrough`), тот же приём, что
 * `InventoryImportTemplateController` (DTJ-159) — `ResponseInterceptor` несовместим с
 * бинарным `.xlsx`.
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Req, Res, UseGuards } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import ExcelJS from 'exceljs'
import { ErrorCode, fail } from '@dorutj/contracts'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import {
  InventorySyncReportQueryService,
  type InventoryReportActor,
  type InventorySyncRowErrorForActorResult,
} from '@/modules/inventory/application/services/inventory-sync-report-query.service.js'
import {
  INVENTORY_IMPORT_TEMPLATE_HEADERS,
  INVENTORY_IMPORT_TEMPLATE_EXPIRY_HEADER,
  INVENTORY_IMPORT_TEMPLATE_SHEET_NAME,
  type InventoryImportTemplateField,
} from '@/modules/inventory/infrastructure/inventory-import-template.constants.js'
import { resolveLocale } from '../http/resolve-locale.util.js'

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ERROR_REPORT_FILENAME = 'doru-tj-inventory-import-errors.xlsx'
const MIN_COLUMN_WIDTH = 14
const COLUMN_WIDTH_PADDING = 2
const ERROR_REASON_HEADER = 'Причина ошибки'

/** `rawRow` (DTJ-160/161) — snake_case, те же ключи, что `rowToPayload` REST-канала. */
const RAW_ROW_KEY_BY_TEMPLATE_FIELD: Readonly<Record<InventoryImportTemplateField, string>> = {
  rawBarcode: 'raw_barcode',
  internalSku: 'internal_sku',
  rawTradeName: 'raw_trade_name',
  rawDosageForm: 'raw_dosage_form',
  rawDosageStrength: 'raw_dosage_strength',
  rawManufacturerName: 'raw_manufacturer_name',
  priceDiram: 'price_diram',
  quantity: 'quantity',
  batchNumber: 'batch_number',
  expiresAtIso: 'expires_at',
}

/** Шаблон DTJ-159 + 11-я колонка «Причина ошибки» — экспортируется для теста round-trip. */
export function buildErrorReportWorkbook(rows: readonly InventorySyncRowErrorForActorResult[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(INVENTORY_IMPORT_TEMPLATE_SHEET_NAME)
  const headers = [...INVENTORY_IMPORT_TEMPLATE_HEADERS.map((spec) => spec.header), ERROR_REASON_HEADER]
  worksheet.addRow(headers)
  INVENTORY_IMPORT_TEMPLATE_HEADERS.forEach((spec, index) => {
    const column = worksheet.getColumn(index + 1)
    column.width = Math.max(spec.header.length + COLUMN_WIDTH_PADDING, MIN_COLUMN_WIDTH)
    if (spec.header === INVENTORY_IMPORT_TEMPLATE_EXPIRY_HEADER) {
      column.numFmt = '@'
    }
  })
  const reasonColumn = worksheet.getColumn(headers.length)
  reasonColumn.width = Math.max(ERROR_REASON_HEADER.length + COLUMN_WIDTH_PADDING, MIN_COLUMN_WIDTH)
  for (const row of rows) {
    worksheet.addRow([...templateValuesFromRawRow(row.rawRow), row.message])
  }
  return workbook
}

function templateValuesFromRawRow(rawRow: Readonly<Record<string, unknown>> | null): readonly unknown[] {
  return INVENTORY_IMPORT_TEMPLATE_HEADERS.map((spec) => {
    if (rawRow === null) return ''
    const key = RAW_ROW_KEY_BY_TEMPLATE_FIELD[spec.field]
    return rawRow[key] ?? ''
  })
}

function toActor(claims: JwtClaims): InventoryReportActor {
  return { role: claims.role, pharmacyId: claims.pharmacyId, chainId: claims.chainId }
}

function notFound(): HttpException {
  return new HttpException(
    fail(ErrorCode.NOT_FOUND, 'no error report available for this upload (not found, not owned, or no errors)'),
    HttpStatus.NOT_FOUND,
  )
}

@Controller({ path: 'inventory-sync-batches', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacy_admin', 'super_admin')
export class InventoryExcelErrorReportController {
  constructor(
    @Inject(InventorySyncReportQueryService)
    private readonly reportQuery: InventorySyncReportQueryService,
  ) {}

  @Get(':sourceUploadId/error-report')
  async download(@Req() request: FastifyRequest, @CurrentUser() claims: JwtClaims, @Res() reply: FastifyReply): Promise<void> {
    const sourceUploadId = (request.params as { sourceUploadId: string }).sourceUploadId
    const acceptLanguage = normalizeHeader(request.headers['accept-language'])
    const report = await this.reportQuery.getErrorReportForActor({
      sourceUploadId,
      actor: toActor(claims),
      locale: resolveLocale(acceptLanguage),
    })
    if (report === null) {
      throw notFound()
    }
    const workbook = buildErrorReportWorkbook(report.rows)
    const buffer = await workbook.xlsx.writeBuffer()
    reply.header('content-type', XLSX_CONTENT_TYPE)
    reply.header('content-disposition', `attachment; filename="${ERROR_REPORT_FILENAME}"`)
    reply.send(buffer)
  }
}

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
