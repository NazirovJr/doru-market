/**
 * Тест `InventoryExcelImportController` (EP-05, DTJ-161, критерии приёмки).
 *
 * Парсер — ЗАМОКАН (`FakeParser`, тест-план тикета: «парсер и репозитории замоканы» для
 * контроллера — реальный `exceljs`-парсинг покрыт `xlsx-excel-inventory-parser.adapter.spec.ts`,
 * DTJ-160). Репозитории/outbox — РЕАЛЬНЫЕ InMemory-адаптеры (тот же приём, что
 * `inventory-batch-update.controller.spec.ts`, DTJ-157) — даёт проверить реальное состояние
 * после вызова, не только вызовы моков.
 */
import 'reflect-metadata'
import { HttpException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { InMemoryInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryInventoryOutbox } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-outbox.js'
import { PersistInventorySyncBatchService } from '@/modules/inventory/application/services/persist-inventory-sync-batch.service.js'
import type { Clock } from '@/shared-kernel/application/ports/clock.port.js'
import type {
  ExcelInventoryParserPort,
  ExcelInventoryParseResult,
  ParsedExcelRow,
  RejectedExcelRow,
} from '@/modules/inventory/application/ports/excel-inventory-parser.port.js'
import type { JwtClaims } from '@/modules/auth/index.js'
import { InventoryExcelImportController } from './inventory-excel-import.controller.js'

class StubClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return new Date(this.fixed)
  }
}

class FakeParser implements ExcelInventoryParserPort {
  constructor(private readonly result: ExcelInventoryParseResult) {}
  parse(): Promise<ExcelInventoryParseResult> {
    return Promise.resolve(this.result)
  }
}

function makeRow(rowIndex: number): ParsedExcelRow {
  return {
    rowIndex,
    internalSku: `SKU-${String(rowIndex)}`,
    rawBarcode: null,
    rawTradeName: 'Trade',
    rawDosageForm: null,
    rawDosageStrength: null,
    rawManufacturerName: null,
    priceDiram: 1000n,
    quantity: 5,
    expiresAtIso: '2028-01-01',
    batchNumber: null,
  }
}

function makeRows(count: number): ParsedExcelRow[] {
  return Array.from({ length: count }, (_, i) => makeRow(i))
}

function makeRejectedRows(count: number): RejectedExcelRow[] {
  return Array.from({ length: count }, (_, i) => ({
    rowIndex: i,
    errorCode: 'invalid_price' as const,
    reason: 'test rejection',
    rawRow: {},
  }))
}

function fakeRequest(input: { readonly mode?: string; readonly mimetype?: string }): FastifyRequest {
  function* generate(): Generator {
    if (input.mode !== undefined) {
      yield { type: 'field', fieldname: 'mode', value: input.mode }
    }
    yield {
      type: 'file',
      fieldname: 'file',
      mimetype: input.mimetype ?? 'text/csv',
      toBuffer: () => Promise.resolve(Buffer.from('irrelevant — parser is faked')),
    }
  }
  // `for await...of` (контроллер) принимает и синхронный `Generator` — `async`/`await` здесь
  // не нужны (yield'ы синхронны), `AsyncGenerator` был бы избыточной типизацией без реальных await.
  function parts(): Generator {
    return generate()
  }
  return { parts } as unknown as FastifyRequest
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: 'user-1',
    role: 'pharmacy_admin',
    tenantId: null,
    pharmacyId: 'PHARM-1',
    chainId: null,
    sessionId: 'sess-1',
    ...overrides,
  }
}

function makeController(parseResult: ExcelInventoryParseResult): {
  controller: InventoryExcelImportController
  syncBatchRepository: InMemoryInventorySyncBatchRepository
  outbox: InMemoryInventoryOutbox
} {
  const syncBatchRepository = new InMemoryInventorySyncBatchRepository()
  const outbox = new InMemoryInventoryOutbox()
  const persistBatch = new PersistInventorySyncBatchService(syncBatchRepository, outbox)
  const clock = new StubClock(new Date('2026-01-15T10:00:00.000Z'))
  const parser = new FakeParser(parseResult)
  const controller = new InventoryExcelImportController(parser, persistBatch, syncBatchRepository, clock)
  return { controller, syncBatchRepository, outbox }
}

function extractSourceUploadId(result: unknown): string {
  return (result as { data: { sourceUploadId: string } }).data.sourceUploadId
}

describe('InventoryExcelImportController (DTJ-161, SRS-INV-014)', () => {
  it('2500 строк дают 3 батча с общим sourceUploadId, append_update БЕЗ fullSyncSessionId, channel=excel', async () => {
    const { controller, syncBatchRepository } = makeController({ rows: makeRows(2500), rejectedRows: [] })
    const result = await controller.import(fakeRequest({ mode: 'append_update' }), makeClaims())

    expect(result).toMatchObject({ data: { totalBatches: 3, totalRows: 2500, rejectedByParser: 0 } })
    const batches = await syncBatchRepository.findBySourceUploadId(extractSourceUploadId(result))
    expect(batches).toHaveLength(3)
    expect(batches.every((b) => b.channel === 'excel')).toBe(true)
    expect(batches.every((b) => b.fullSyncSessionId === null)).toBe(true)
    expect(batches.map((b) => b.totalRows).sort((a, b) => b - a)).toEqual([1000, 1000, 500])
  })

  it('режим full_replace: одинаковый fullSyncSessionId на все батчи, isLastPage=true только на последнем чанке', async () => {
    const { controller, syncBatchRepository } = makeController({ rows: makeRows(2500), rejectedRows: [] })
    const result = await controller.import(fakeRequest({ mode: 'full_replace' }), makeClaims())

    const sourceUploadId = extractSourceUploadId(result)
    const batches = await syncBatchRepository.findBySourceUploadId(sourceUploadId)
    expect(batches).toHaveLength(3)
    expect(batches.every((b) => b.fullSyncSessionId === sourceUploadId)).toBe(true)
    const lastPageFlags = [...batches].sort((a, b) => a.pageNumber - b.pageNumber).map((b) => b.isLastPage)
    expect(lastPageFlags).toEqual([false, false, true])
  })

  it('режим append_update НЕ выставляет fullSyncSessionId ни на одном батче', async () => {
    const { controller, syncBatchRepository } = makeController({ rows: makeRows(150), rejectedRows: [] })
    const result = await controller.import(fakeRequest({ mode: 'append_update' }), makeClaims())

    const batches = await syncBatchRepository.findBySourceUploadId(extractSourceUploadId(result))
    expect(batches.every((b) => b.fullSyncSessionId === null)).toBe(true)
    expect(batches.every((b) => b.syncType === 'delta')).toBe(true)
  })

  it('частично отклонённый парсером файл создаёт батчи только из валидных строк, rejectedByParser корректен', async () => {
    const { controller } = makeController({ rows: makeRows(2495), rejectedRows: makeRejectedRows(5) })
    const result = await controller.import(fakeRequest({ mode: 'append_update' }), makeClaims())

    expect(result).toMatchObject({ data: { totalBatches: 3, totalRows: 2495, rejectedByParser: 5 } })
  })

  it('DTJ-164: rejectedRows>0 создаёт СИНТЕТИЧЕСКИЙ parser-errors батч (channel=excel, failed_validation, totalRows=0) с теми же ошибками', async () => {
    const { controller, syncBatchRepository } = makeController({ rows: makeRows(10), rejectedRows: makeRejectedRows(2) })
    const result = await controller.import(fakeRequest({ mode: 'append_update' }), makeClaims())

    // 1 обычный батч (10 строк < 1000) + 1 синтетический контейнер.
    const batches = await syncBatchRepository.findBySourceUploadId(extractSourceUploadId(result))
    expect(batches).toHaveLength(2)
    const container = batches.find((b) => b.totalRows === 0)
    expect(container).toMatchObject({ channel: 'excel', status: 'failed_validation' })
    const containerErrors = await syncBatchRepository.findRowErrorsByBatchId(container?.id ?? '')
    expect(containerErrors).toHaveLength(2)
    expect(containerErrors.every((e) => e.errorCode === 'invalid_price')).toBe(true)
  })

  it('DTJ-164: rejectedRows=0 НЕ создаёт синтетический батч (уже покрыто предыдущими тестами — доп. явная проверка)', async () => {
    const { controller, syncBatchRepository } = makeController({ rows: makeRows(10), rejectedRows: [] })
    const result = await controller.import(fakeRequest({ mode: 'append_update' }), makeClaims())

    const batches = await syncBatchRepository.findBySourceUploadId(extractSourceUploadId(result))
    expect(batches.every((b) => b.totalRows > 0)).toBe(true)
  })

  it('полностью невалидный файл (0 валидных строк) не создаёт ни одного батча, 400 VALIDATION_ERROR', async () => {
    const { controller, outbox } = makeController({ rows: [], rejectedRows: makeRejectedRows(3) })

    await expect(controller.import(fakeRequest({ mode: 'append_update' }), makeClaims())).rejects.toBeInstanceOf(
      HttpException,
    )
    expect(outbox.batchQueuedEvents).toHaveLength(0)
  })

  it('отсутствие поля mode отклоняется 400 VALIDATION_ERROR, details.field="mode"', async () => {
    const { controller } = makeController({ rows: makeRows(1), rejectedRows: [] })

    let caught: HttpException | undefined
    try {
      await controller.import(fakeRequest({}), makeClaims())
    } catch (error) {
      caught = error as HttpException
    }

    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(400)
    const body = caught?.getResponse() as { error: { details?: { field?: string } } }
    expect(body.error.details?.field).toBe('mode')
  })

  it('PersistInventorySyncBatchService переиспользуется — один outbox queued-event на батч, не дублирует логику DTJ-157', async () => {
    const { controller, outbox } = makeController({ rows: makeRows(2500), rejectedRows: [] })
    await controller.import(fakeRequest({ mode: 'append_update' }), makeClaims())

    expect(outbox.batchQueuedEvents).toHaveLength(3)
    expect(outbox.batchQueuedEvents.every((e) => e.channel === 'excel')).toBe(true)
  })

  it('super_admin без привязанной аптеки (pharmacyId=null) получает 400 VALIDATION_ERROR', async () => {
    const { controller } = makeController({ rows: makeRows(1), rejectedRows: [] })

    await expect(
      controller.import(fakeRequest({ mode: 'append_update' }), makeClaims({ role: 'super_admin', pharmacyId: null })),
    ).rejects.toBeInstanceOf(HttpException)
  })
})
