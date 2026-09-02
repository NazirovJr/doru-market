/**
 * Unit-тест `PharmaciesMapController` (DTJ-197, EP-08, R1-6) — конструирует контроллер
 * напрямую (без DI-контейнера, use case замокирован), проверяет только логику самого
 * контроллера: маппинг `execute()`-аргументов, форма ответа, резолв `TenantId` из
 * `TenantContext`.
 *
 * Формат-валидация `bbox`/`medicineId` (`ZodValidationPipe(PharmacyMapQuerySchema)`) и
 * маршрутизация HTTP проверяются ОТДЕЛЬНО, реальным запросом через смонтированный
 * `CatalogModule` — см. `apps/api/test/integration/catalog/pharmacies-map-controller.integration.spec.ts`
 * (там же — доказательство Ж2, что маршрут реально подключён).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-052, SRS-CAT-054)
 */
import { InternalServerErrorException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import { TenantId } from '@/modules/tenancy/index.js'
import type {
  GetPharmacyMapPinsUseCase,
  MapPinDto,
} from '@/modules/catalog/application/use-cases/get-pharmacy-map-pins.use-case.js'
import { PharmaciesMapController } from './pharmacies-map.controller.js'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const RESOLVED_STORE: TenantContextStore = {
  tenantId: TENANT_ID,
  slug: 'neutral',
  chainId: null,
  isNeutral: true,
  unresolved: false,
  unresolvedReason: null,
}

function makePin(overrides: Partial<MapPinDto> = {}): MapPinDto {
  return {
    pharmacyId: 'ph-1',
    name: 'Аптека №1',
    lat: 38.5598,
    lon: 68.787,
    isOpenNow: true,
    is24x7: false,
    offer: null,
    ...overrides,
  }
}

function makeController(execute: ReturnType<typeof vi.fn>): PharmaciesMapController {
  return new PharmaciesMapController({ execute } as unknown as GetPharmacyMapPinsUseCase)
}

describe('PharmaciesMapController.getMap', () => {
  it('строит команду use case из query (bbox + tenantId), без medicineId, если он не задан', async () => {
    const execute = vi.fn().mockResolvedValue([makePin()])
    const controller = makeController(execute)
    const bbox = { lonMin: 68.78, latMin: 38.55, lonMax: 68.79, latMax: 38.56 }

    const result = await TenantContext.run(RESOLVED_STORE, () => controller.getMap({ bbox }))

    expect(execute).toHaveBeenCalledTimes(1)
    const arg = execute.mock.calls[0]?.[0] as { bbox: unknown; tenantId: TenantId; medicineId?: string }
    expect(arg.bbox).toEqual(bbox)
    expect(arg.tenantId.equals(TenantId.from(TENANT_ID))).toBe(true)
    expect('medicineId' in arg).toBe(false)
    expect(result).toEqual([
      { pharmacyId: 'ph-1', name: 'Аптека №1', lat: 38.5598, lon: 68.787, isOpenNow: true, is24x7: false, offer: null },
    ])
  })

  it('пробрасывает medicineId в команду use case, если он задан', async () => {
    const medicineId = '650e8400-e29b-41d4-a716-446655440111'
    const execute = vi.fn().mockResolvedValue([])
    const controller = makeController(execute)
    const bbox = { lonMin: 68.78, latMin: 38.55, lonMax: 68.79, latMax: 38.56 }

    await TenantContext.run(RESOLVED_STORE, () => controller.getMap({ bbox, medicineId }))

    const arg = execute.mock.calls[0]?.[0] as { medicineId?: string }
    expect(arg.medicineId).toBe(medicineId)
  })

  it('маппит offer из MapPinDto как есть в ответ (не подменяет значение)', async () => {
    const offer = { priceDiram: 1500, stockQuantity: 3, lastSyncedAt: '2026-01-01T00:00:00.000Z', isStale: false }
    const execute = vi.fn().mockResolvedValue([makePin({ offer })])
    const controller = makeController(execute)

    const result = await TenantContext.run(RESOLVED_STORE, () =>
      controller.getMap({ bbox: { lonMin: 0, latMin: 0, lonMax: 1, latMax: 1 } }),
    )

    expect(result[0]?.offer).toEqual(offer)
  })

  it('use case бросил ошибку (BboxTooLargeError) → контроллер её не глотает, пробрасывает наружу', async () => {
    const boom = new Error('bbox too large')
    const execute = vi.fn().mockRejectedValue(boom)
    const controller = makeController(execute)

    await expect(
      TenantContext.run(RESOLVED_STORE, () => controller.getMap({ bbox: { lonMin: 0, latMin: 0, lonMax: 1, latMax: 1 } })),
    ).rejects.toThrow(boom)
  })

  it('недостижимая ветка: TenantContext не резолвлен (нет middleware) → техническая 500, без "neutral"-фолбэка', async () => {
    const execute = vi.fn()
    const controller = makeController(execute)

    // Вне TenantContext.run(...) — контекст не установлен, как если бы
    // TenantResolutionMiddleware не был подключён (архитектурный дефект, не штатный случай).
    await expect(controller.getMap({ bbox: { lonMin: 0, latMin: 0, lonMax: 1, latMax: 1 } })).rejects.toThrow(
      InternalServerErrorException,
    )
    expect(execute).not.toHaveBeenCalled()
  })
})
