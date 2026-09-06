/**
 * Тест `InventoryExcelErrorReportController` (EP-05, DTJ-164, критерии приёмки).
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { InMemoryInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryCatalogMatchQueueReadAdapter } from '@/modules/inventory/infrastructure/adapters/in-memory-catalog-match-queue-read.adapter.js'
import { InventorySyncReportQueryService } from '@/modules/inventory/application/services/inventory-sync-report-query.service.js'
import type { InventorySyncRowErrorCode } from '@/modules/inventory/application/ports/inventory-sync-batch.repository.port.js'
import { INVENTORY_IMPORT_TEMPLATE_HEADERS } from '@/modules/inventory/infrastructure/inventory-import-template.constants.js'
import type { JwtClaims } from '@/modules/auth/index.js'
import { InventoryExcelErrorReportController } from './inventory-excel-error-report.controller.js'

const NOW = new Date('2026-01-15T10:00:00.000Z')

function makeController(): {
  controller: InventoryExcelErrorReportController
  repo: InMemoryInventorySyncBatchRepository
} {
  const repo = new InMemoryInventorySyncBatchRepository()
  const reportQuery = new InventorySyncReportQueryService(repo, new InMemoryCatalogMatchQueueReadAdapter())
  return { controller: new InventoryExcelErrorReportController(reportQuery), repo }
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: 'user-1',
    role: 'pharmacy_admin',
    tenantId: null,
    pharmacyId: 'P-1',
    chainId: null,
    sessionId: 'sess-1',
    ...overrides,
  }
}

function fakeRequest(sourceUploadId: string, acceptLanguage?: string): FastifyRequest {
  return {
    params: { sourceUploadId },
    headers: acceptLanguage === undefined ? {} : { 'accept-language': acceptLanguage },
  } as unknown as FastifyRequest
}

function createReplyStub(): { reply: FastifyReply; headers: Record<string, string>; getBody: () => Buffer } {
  const headers: Record<string, string> = {}
  let body: Buffer | null = null
  const reply = {
    header(name: string, value: string) {
      headers[name] = value
      return reply
    },
    send(payload: Buffer) {
      body = payload
      return reply
    },
  } as unknown as FastifyReply
  return {
    reply,
    headers,
    getBody: () => {
      if (body === null) throw new Error('reply.send() was not called')
      return body
    },
  }
}

/** Создаёт батч + пишет N ошибок (rowIndex 0..N-1) с raw items, для сборки отчёта. */
async function seedBatchWithErrors(
  repo: InMemoryInventorySyncBatchRepository,
  input: {
    readonly pharmacyId: string
    readonly sourceUploadId: string
    readonly errorCodes: readonly InventorySyncRowErrorCode[]
  },
): Promise<string> {
  const batchId = randomUUID()
  await repo.createIfNotExists({
    id: batchId,
    pharmacyId: input.pharmacyId,
    channel: 'excel',
    syncType: 'delta',
    fullSyncSessionId: null,
    isLastPage: true,
    totalRows: input.errorCodes.length,
    note: null,
    now: NOW,
    sourceUploadId: input.sourceUploadId,
  })
  await repo.appendRawItems(
    batchId,
    input.errorCodes.map((_, rowIndex) => ({ rowIndex, payload: { internal_sku: `SKU-${String(rowIndex)}` } })),
  )
  await repo.appendErrors(
    input.errorCodes.map((errorCode, rowIndex) => ({ batchId, rowIndex, errorCode, reason: 'test' })),
  )
  return batchId
}

describe('InventoryExcelErrorReportController (DTJ-164, SRS-INV-045)', () => {
  it('отчёт объединяет ошибки ДВУХ батчей (парсер-контейнер + обычный батч) одного sourceUploadId в один файл', async () => {
    const { controller, repo } = makeController()
    const sourceUploadId = randomUUID()
    await seedBatchWithErrors(repo, { pharmacyId: 'P-1', sourceUploadId, errorCodes: ['invalid_price', 'invalid_quantity'] })
    await seedBatchWithErrors(repo, { pharmacyId: 'P-1', sourceUploadId, errorCodes: ['ambiguous_date_format'] })

    const { reply, getBody } = createReplyStub()
    await controller.download(fakeRequest(sourceUploadId, 'en'), makeClaims(), reply)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(getBody() as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const worksheet = workbook.worksheets[0]
    expect(worksheet?.rowCount).toBe(4) // header + 3 error rows
  })

  it('колонка «Причина ошибки» содержит локализованный текст (Accept-Language: en → "Invalid price"), не код enum', async () => {
    const { controller, repo } = makeController()
    const sourceUploadId = randomUUID()
    await seedBatchWithErrors(repo, { pharmacyId: 'P-1', sourceUploadId, errorCodes: ['invalid_price'] })

    const { reply, getBody } = createReplyStub()
    await controller.download(fakeRequest(sourceUploadId, 'en'), makeClaims(), reply)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(getBody() as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const worksheet = workbook.worksheets[0]
    const reasonColumnIndex = INVENTORY_IMPORT_TEMPLATE_HEADERS.length + 1
    expect(worksheet?.getRow(2).getCell(reasonColumnIndex).text).toBe('Invalid price')
  })

  it('структура заголовков файла отчёта = шаблон импорта (10 колонок) + 11-я «Причина ошибки»', async () => {
    const { controller, repo } = makeController()
    const sourceUploadId = randomUUID()
    await seedBatchWithErrors(repo, { pharmacyId: 'P-1', sourceUploadId, errorCodes: ['invalid_price'] })

    const { reply, getBody } = createReplyStub()
    await controller.download(fakeRequest(sourceUploadId), makeClaims(), reply)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(getBody() as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const worksheet = workbook.worksheets[0]
    const headerRow = worksheet?.getRow(1)
    const actualHeaders = Array.from({ length: 11 }, (_, i) => headerRow?.getCell(i + 1).text)
    expect(actualHeaders.slice(0, 10)).toEqual(INVENTORY_IMPORT_TEMPLATE_HEADERS.map((spec) => spec.header))
    expect(actualHeaders[10]).toBe('Причина ошибки')
  })

  it('полностью успешный импорт (0 ошибок) даёт 404 NOT_FOUND', async () => {
    const { controller, repo } = makeController()
    const sourceUploadId = randomUUID()
    const batchId = randomUUID()
    await repo.createIfNotExists({
      id: batchId,
      pharmacyId: 'P-1',
      channel: 'excel',
      syncType: 'delta',
      fullSyncSessionId: null,
      isLastPage: true,
      totalRows: 5,
      note: null,
      now: NOW,
      sourceUploadId,
    })
    const { reply } = createReplyStub()

    let caught: HttpException | undefined
    try {
      await controller.download(fakeRequest(sourceUploadId), makeClaims(), reply)
    } catch (error) {
      caught = error as HttpException
    }
    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(404)
  })

  it('чужой sourceUploadId даёт 404 NOT_FOUND (изоляция)', async () => {
    const { controller, repo } = makeController()
    const sourceUploadId = randomUUID()
    await seedBatchWithErrors(repo, { pharmacyId: 'P-OTHER', sourceUploadId, errorCodes: ['invalid_price'] })
    const { reply } = createReplyStub()

    await expect(
      controller.download(fakeRequest(sourceUploadId), makeClaims({ role: 'pharmacy_admin', pharmacyId: 'P-1' }), reply),
    ).rejects.toBeInstanceOf(HttpException)
  })

  it('несуществующий sourceUploadId даёт 404 NOT_FOUND', async () => {
    const { controller } = makeController()
    const { reply } = createReplyStub()

    await expect(controller.download(fakeRequest(randomUUID()), makeClaims(), reply)).rejects.toBeInstanceOf(HttpException)
  })
})
