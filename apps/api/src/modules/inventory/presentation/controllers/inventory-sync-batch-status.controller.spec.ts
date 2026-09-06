/**
 * Тест `InventorySyncBatchStatusController` (EP-05, DTJ-158, критерии приёмки).
 *
 * Покрывает:
 *   - own-аптека получает 200 с полным статусом
 *   - чужая аптека получает 404 (не 403, не раскрывает существование)
 *   - несуществующий batchId даёт 404
 *   - сетевой ключ видит батч любой точки своей сети
 *   - сетевой ключ НЕ видит батч чужой сети
 */
import { HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { InMemoryInventorySyncBatchRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-inventory-sync-batch.repository.js'
import { InventorySyncReportQueryService } from '@/modules/inventory/application/services/inventory-sync-report-query.service.js'
import { InventorySyncBatchStatusController } from './inventory-sync-batch-status.controller.js'
import type { FastifyRequestWithPrincipal } from '../guards/pharmacy-api-key.guard.js'

const NOW = new Date('2026-01-15T10:00:00.000Z')

function makeController(): {
  controller: InventorySyncBatchStatusController
  repo: InMemoryInventorySyncBatchRepository
} {
  const repo = new InMemoryInventorySyncBatchRepository()
  const reportQuery = new InventorySyncReportQueryService(repo)
  return { controller: new InventorySyncBatchStatusController(reportQuery), repo }
}

function reqFor(pharmacyId: string, chainId: string | null = null): FastifyRequestWithPrincipal {
  return { principal: { type: 'pharmacy_system', pharmacyId, chainId } } as unknown as FastifyRequestWithPrincipal
}

async function seedBatch(
  repo: InMemoryInventorySyncBatchRepository,
  input: { id: string; pharmacyId: string },
): Promise<void> {
  await repo.createIfNotExists({
    id: input.id,
    pharmacyId: input.pharmacyId,
    channel: 'rest',
    syncType: 'delta',
    fullSyncSessionId: null,
    isLastPage: true,
    totalRows: 3,
    note: null,
    now: NOW,
  })
}

describe('InventorySyncBatchStatusController (DTJ-158, SRS-INV-008)', () => {
  it('своя аптека получает 200 с полным статусом', async () => {
    const { controller, repo } = makeController()
    await seedBatch(repo, { id: 'B-1', pharmacyId: 'P-1' })
    const result = await controller.getStatus('B-1', reqFor('P-1'))
    expect(result).toMatchObject({
      data: {
        batchId: 'B-1',
        status: 'queued',
        channel: 'rest',
        syncType: 'delta',
        totalRows: 3,
        acceptedRows: 0,
        rejectedRows: 0,
        completedAt: null,
      },
    })
  })

  it('чужая аптека получает 404, не 403 (не раскрывает существование)', async () => {
    const { controller, repo } = makeController()
    await seedBatch(repo, { id: 'B-1', pharmacyId: 'P-OWNER' })
    let caught: HttpException | undefined
    try {
      await controller.getStatus('B-1', reqFor('P-OTHER'))
    } catch (e) {
      caught = e as HttpException
    }
    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND)
  })

  it('несуществующий batchId даёт 404', async () => {
    const { controller } = makeController()
    let caught: HttpException | undefined
    try {
      await controller.getStatus('does-not-exist', reqFor('P-1'))
    } catch (e) {
      caught = e as HttpException
    }
    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND)
  })

  it('сетевой ключ видит батч ЛЮБОЙ точки своей сети', async () => {
    const { controller, repo } = makeController()
    repo.seedPharmacyChainId('P-BRANCH', 'CHAIN-1')
    await seedBatch(repo, { id: 'B-1', pharmacyId: 'P-BRANCH' })
    const result = await controller.getStatus('B-1', reqFor('P-HQ', 'CHAIN-1'))
    expect(result).toMatchObject({ data: { batchId: 'B-1' } })
  })

  it('сетевой ключ НЕ видит батч чужой сети → 404', async () => {
    const { controller, repo } = makeController()
    repo.seedPharmacyChainId('P-BRANCH', 'CHAIN-OTHER')
    await seedBatch(repo, { id: 'B-1', pharmacyId: 'P-BRANCH' })
    let caught: HttpException | undefined
    try {
      await controller.getStatus('B-1', reqFor('P-HQ', 'CHAIN-1'))
    } catch (e) {
      caught = e as HttpException
    }
    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(HttpStatus.NOT_FOUND)
  })

  it('отсутствует principal → 401', async () => {
    const { controller } = makeController()
    const req = { principal: undefined } as unknown as FastifyRequestWithPrincipal
    await expect(controller.getStatus('B-1', req)).rejects.toBeInstanceOf(HttpException)
  })
})
