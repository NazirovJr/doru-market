import 'reflect-metadata'
import { HttpException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { encodeCursor } from '@dorutj/contracts'
import type { JwtClaims } from '@/modules/auth/index.js'
import { InMemoryPharmacyInventoryRepository } from '@/modules/inventory/infrastructure/adapters/in-memory-pharmacy-inventory.repository.js'
import { ListPharmacyInventoryUseCase } from '@/modules/inventory/application/use-cases/list-pharmacy-inventory.use-case.js'
import type { PharmacyInventoryListRow } from '@/modules/inventory/application/ports/pharmacy-inventory.repository.port.js'
import { InventoryListController } from './inventory-list.controller.js'

function makeRow(overrides: Partial<PharmacyInventoryListRow> = {}): PharmacyInventoryListRow {
  return {
    inventoryId: 'inv-1',
    medicineId: 'med-1',
    tradeName: 'Aspirin',
    dosageForm: 'tablets',
    dosageStrength: '500 mg',
    priceDiram: 1250,
    stockQuantity: 10,
    batchNumber: null,
    expiryDate: '2030-01-01',
    lastSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function makeClaims(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    sub: 'user-1',
    role: 'pharmacist',
    tenantId: null,
    pharmacyId: 'pharm-1',
    chainId: null,
    sessionId: 'sess-1',
    ...overrides,
  }
}

function makeController(): { controller: InventoryListController; repo: InMemoryPharmacyInventoryRepository } {
  const repo = new InMemoryPharmacyInventoryRepository()
  const controller = new InventoryListController(new ListPharmacyInventoryUseCase(repo))
  return { controller, repo }
}

interface SuccessBody {
  readonly data: readonly unknown[]
  readonly meta: { readonly pagination: { readonly nextCursor: string | null; readonly hasMore: boolean; readonly limit: number } }
}

describe('InventoryListController (DTJ-171)', () => {
  it('без pharmacyId в токене — 400 VALIDATION_ERROR', async () => {
    const { controller } = makeController()
    let caught: HttpException | undefined
    try {
      await controller.list({}, makeClaims({ pharmacyId: null }))
    } catch (error) {
      caught = error as HttpException
    }
    expect(caught).toBeInstanceOf(HttpException)
    expect(caught?.getStatus()).toBe(400)
    expect((caught?.getResponse() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR')
  })

  it('limit=101 — 400 VALIDATION_ERROR (критерий приёмки 4)', async () => {
    const { controller } = makeController()
    await expect(controller.list({ limit: '101' }, makeClaims())).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('курсор с полем v не того типа — 400 INVALID_CURSOR (критерий приёмки 4)', async () => {
    const { controller } = makeController()
    const badCursor = Buffer.from(JSON.stringify({ v: 42, id: 'x' }), 'utf-8').toString('base64url')
    await expect(controller.list({ cursor: badCursor }, makeClaims())).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    })
  })

  it('отдаёт конверт data+meta.pagination, priceDiram/lastSyncedAt сериализованы', async () => {
    const { controller, repo } = makeController()
    repo.seedListRow('pharm-1', makeRow())

    const result = (await controller.list({}, makeClaims())) as SuccessBody
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({ inventoryId: 'inv-1', priceDiram: 1250, lastSyncedAt: '2026-01-01T00:00:00.000Z' })
    expect(result.meta.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 50 })
  })

  it('чужой pharmacyId из query игнорируется — скоуп берётся из токена (критерий приёмки 2)', async () => {
    const { controller, repo } = makeController()
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'own-row' }))
    repo.seedListRow('pharm-2', makeRow({ inventoryId: 'other-row' }))

    const result = (await controller.list({ pharmacyId: 'pharm-2' }, makeClaims({ pharmacyId: 'pharm-1' }))) as SuccessBody

    expect(result.data).toHaveLength(1)
    expect((result.data[0] as { inventoryId: string }).inventoryId).toBe('own-row')
  })

  it('nextCursor декодируется обратно в валидный курсор для следующей страницы', async () => {
    const { controller, repo } = makeController()
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-1', tradeName: 'A' }))
    repo.seedListRow('pharm-1', makeRow({ inventoryId: 'inv-2', tradeName: 'B' }))

    const firstPage = (await controller.list({ limit: '1' }, makeClaims())) as SuccessBody
    expect(firstPage.meta.pagination.hasMore).toBe(true)
    const cursor = firstPage.meta.pagination.nextCursor
    expect(cursor).not.toBeNull()
    expect(cursor).toBe(encodeCursor({ v: 'A', id: 'inv-1' }))

    const secondPage = (await controller.list({ limit: '1', cursor: cursor ?? '' }, makeClaims())) as SuccessBody
    expect(secondPage.data).toHaveLength(1)
    expect((secondPage.data[0] as { inventoryId: string }).inventoryId).toBe('inv-2')
    expect(secondPage.meta.pagination.hasMore).toBe(false)
  })
})
