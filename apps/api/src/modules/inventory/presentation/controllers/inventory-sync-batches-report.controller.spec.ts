/**
 * Тест `InventorySyncBatchesReportController` (EP-05, DTJ-163, критерии приёмки).
 *
 * `seedPharmacyChainId`/`seedRawItems` — test-only хелперы `InMemoryInventorySyncBatchRepository`
 * (заведены заранее для DTJ-158/163/164, см. её JSDoc).
 */
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { InMemoryInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InMemoryCatalogMatchQueueReadAdapter } from '@/modules/inventory/infrastructure/adapters/in-memory-catalog-match-queue-read.adapter.js'
import { InventorySyncReportQueryService } from '@/modules/inventory/application/services/inventory-sync-report-query.service.js'
import type { JwtClaims } from '@/modules/auth/index.js'
import { InventorySyncBatchesReportController } from './inventory-sync-batches-report.controller.js'

const NOW = new Date('2026-01-15T10:00:00.000Z')

function makeController(): {
  controller: InventorySyncBatchesReportController
  repo: InMemoryInventorySyncBatchRepository
  moderationQueue: InMemoryCatalogMatchQueueReadAdapter
} {
  const repo = new InMemoryInventorySyncBatchRepository()
  const moderationQueue = new InMemoryCatalogMatchQueueReadAdapter()
  const reportQuery = new InventorySyncReportQueryService(repo, moderationQueue)
  return { controller: new InventorySyncBatchesReportController(reportQuery), repo, moderationQueue }
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: 'user-1',
    role: 'pharmacist',
    tenantId: null,
    pharmacyId: 'P-1',
    chainId: null,
    sessionId: 'sess-1',
    ...overrides,
  }
}

async function seedBatch(
  repo: InMemoryInventorySyncBatchRepository,
  pharmacyId: string,
  now: Date = NOW,
): Promise<string> {
  const id = randomUUID()
  await repo.createIfNotExists({
    id,
    pharmacyId,
    channel: 'rest',
    syncType: 'delta',
    fullSyncSessionId: null,
    isLastPage: true,
    totalRows: 5,
    note: null,
    now,
  })
  return id
}

function extractData(result: unknown): unknown {
  return (result as { data: unknown }).data
}

function extractMeta(result: unknown): { pagination?: { hasMore: boolean; nextCursor: string | null } } {
  return (result as { meta?: { pagination?: { hasMore: boolean; nextCursor: string | null } } }).meta ?? {}
}

describe('InventorySyncBatchesReportController (DTJ-163, SRS-INV-043/044/046)', () => {
  it('курсорная пагинация: вторая страница возвращает оставшиеся без дублей/пропусков (TC-API-001)', async () => {
    const { controller, repo } = makeController()
    const ids = await Promise.all(Array.from({ length: 25 }, () => seedBatch(repo, 'P-1')))

    const page1 = await controller.list({}, makeClaims({ role: 'super_admin', pharmacyId: null }))
    const page1Items = extractData(page1) as readonly { batchId: string }[]
    const meta1 = extractMeta(page1)
    expect(page1Items).toHaveLength(20)
    expect(meta1.pagination?.hasMore).toBe(true)
    const cursor = meta1.pagination?.nextCursor ?? undefined

    const page2 = await controller.list({ cursor }, makeClaims({ role: 'super_admin', pharmacyId: null }))
    const page2Items = extractData(page2) as readonly { batchId: string }[]
    const meta2 = extractMeta(page2)
    expect(page2Items).toHaveLength(5)
    expect(meta2.pagination?.hasMore).toBe(false)

    const allIds = [...page1Items, ...page2Items].map((item) => item.batchId)
    expect(new Set(allIds).size).toBe(25)
    expect(new Set(allIds)).toEqual(new Set(ids))
  })

  it('pharmacist не может расширить скоуп через filter[pharmacyId] чужой аптеки', async () => {
    const { controller, repo } = makeController()
    await seedBatch(repo, 'P-1')
    await seedBatch(repo, 'P-OTHER')

    const result = await controller.list(
      { 'filter[pharmacyId]': 'P-OTHER' },
      makeClaims({ role: 'pharmacist', pharmacyId: 'P-1' }),
    )
    const items = extractData(result) as readonly { batchId: string }[]
    expect(items).toHaveLength(1)

    const batch = await repo.findById(items[0]?.batchId ?? '')
    expect(batch?.pharmacyId).toBe('P-1')
  })

  it('pharmacy_admin видит батчи ВСЕХ точек своей сети', async () => {
    const { controller, repo } = makeController()
    repo.seedPharmacyChainId('P-1', 'CHAIN-A')
    repo.seedPharmacyChainId('P-2', 'CHAIN-A')
    repo.seedPharmacyChainId('P-3', 'CHAIN-B')
    await seedBatch(repo, 'P-1')
    await seedBatch(repo, 'P-2')
    await seedBatch(repo, 'P-3')

    const result = await controller.list({}, makeClaims({ role: 'pharmacy_admin', pharmacyId: 'P-1', chainId: 'CHAIN-A' }))
    const items = extractData(result) as readonly { batchId: string }[]
    const pharmacyIds = await Promise.all(items.map(async (i) => (await repo.findById(i.batchId))?.pharmacyId))
    expect(pharmacyIds.sort()).toEqual(['P-1', 'P-2'])
  })

  it('построчные ошибки батча возвращаются с локализованным сообщением (Accept-Language: en)', async () => {
    const { controller, repo } = makeController()
    const batchId = await seedBatch(repo, 'P-1')
    await repo.appendErrors([{ batchId, rowIndex: 0, errorCode: 'invalid_price', reason: 'test' }])

    const result = await controller.errors(batchId, makeClaims({ role: 'pharmacist', pharmacyId: 'P-1' }), 'en')
    const errors = extractData(result) as readonly { rowIndex: number; errorCode: string; message: string }[]
    expect(errors).toEqual([expect.objectContaining({ rowIndex: 0, errorCode: 'invalid_price', message: 'Invalid price' })])
  })

  it('чужой батч в /errors даёт 404 NOT_FOUND', async () => {
    const { controller, repo } = makeController()
    const batchId = await seedBatch(repo, 'P-OTHER')

    let caught: HttpException | undefined
    try {
      await controller.errors(batchId, makeClaims({ role: 'pharmacist', pharmacyId: 'P-1' }), undefined)
    } catch (error) {
      caught = error as HttpException
    }
    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(404)
  })

  it('pending-moderation-count возвращает корректное число ожидающих записей', async () => {
    const { controller, moderationQueue } = makeController()
    moderationQueue.setPending('P-1', 7)

    const result = await controller.pendingModerationCount('P-1', makeClaims({ role: 'pharmacist', pharmacyId: 'P-1' }))
    expect(extractData(result)).toEqual({ pendingCount: 7 })
  })

  it('pending-moderation-count чужой аптеки для pharmacist даёт 404', async () => {
    const { controller, moderationQueue } = makeController()
    moderationQueue.setPending('P-OTHER', 3)

    await expect(
      controller.pendingModerationCount('P-OTHER', makeClaims({ role: 'pharmacist', pharmacyId: 'P-1' })),
    ).rejects.toBeInstanceOf(HttpException)
  })
})
