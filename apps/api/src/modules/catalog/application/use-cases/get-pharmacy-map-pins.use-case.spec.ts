/**
 * Unit-тест `GetPharmacyMapPinsUseCase` (DTJ-196, EP-08, R1).
 *
 * `PharmacyOpeningHoursPolicy` НЕ мокается здесь — use case её не вызывает, см. БЛОКЕР
 * в JSDoc `get-pharmacy-map-pins.use-case.ts` (фактический порт `PharmacyMapRepository`,
 * DTJ-194, не несёт сырых `openingTime`/`closingTime`, только уже вычисленный `isOpenNow`).
 * Тест-план DTJ-196 просил мокать `PharmacyOpeningHoursPolicy` — вместо этого здесь
 * проверяется, что `isOpenNow`/`is24x7`, отданные репозиторием, доходят до DTO без искажений
 * для всех трёх комбинаций критерия приёмки 2 (`is24x7`/закрыта/открыта).
 *
 * @see tickets/ep05-search-map/DTJ-196.md (критерии приёмки, тест-план)
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-052, SRS-CAT-054, TC-CAT-024)
 */
import { describe, expect, it, vi } from 'vitest'
import { TenantId } from '@/modules/tenancy/index.js'
import type {
  BboxQuery,
  PharmacyMapPin,
} from '../pharmacies-map/ports/pharmacy-map-repository.port.js'
import { BboxTooLargeError, GetPharmacyMapPinsUseCase, type Bbox } from './get-pharmacy-map-pins.use-case.js'

const TENANT_ID = TenantId.from('550e8400-e29b-41d4-a716-446655440000')
const MEDICINE_ID = '650e8400-e29b-41d4-a716-446655440111'

/** Малый bbox (~1 км²) около Душанбе — далеко в пределах лимита. */
const SMALL_BBOX: Bbox = { lonMin: 68.7, latMin: 38.5, lonMax: 68.71, latMax: 38.51 }

/**
 * Границы `bbox`, при которых приближённая haversine-площадь (см. `computeBboxAreaKm2`)
 * даёт РОВНО `2500.0000000000000` км² на экваторе (haversine вдоль одной параллели/меридиана
 * при `latMin=0` сводится к точной формуле `R·Δ(рад)`, без приближения) — вычислено заранее
 * (не в рантайме теста), см. отчёт сдачи DTJ-196 для деривации. `d ≈ 0.449660803` градуса —
 * ровно сторона квадрата 50×50 км.
 */
const EXACT_2500_KM2_BBOX: Bbox = { lonMin: 0, latMin: 0, lonMax: 0.44966080295936528, latMax: 0.44966080295936528 }
/** Тот же квадрат, чуть больше — площадь ≈ 2500.0005 км², должна отклоняться. */
const JUST_OVER_2500_KM2_BBOX: Bbox = { lonMin: 0, latMin: 0, lonMax: 0.44966084792544558, latMax: 0.44966084792544558 }
/** Bbox, покрывающий весь Таджикистан (те же границы, что мягкая проверка `GeoPoint`) — площадь ≈ 352780 км². */
const TAJIKISTAN_BBOX: Bbox = { lonMin: 67.3, latMin: 36.6, lonMax: 75.2, latMax: 41.1 }

function makePin(overrides: Partial<PharmacyMapPin> = {}): PharmacyMapPin {
  return {
    pharmacyId: 'ph-1',
    name: 'Аптека №1',
    lat: 38.505,
    lon: 68.705,
    isOpenNow: false,
    is24x7: false,
    offer: null,
    ...overrides,
  }
}

/**
 * Свойство типизировано как `ReturnType<typeof vi.fn>` (не через сигнатуру метода порта)
 * — тот же приём, что `DrizzleMock`/`ClockMock` в `postgres-pharmacy-map.adapter.spec.ts`,
 * иначе `@typescript-eslint/unbound-method` ругается на `expect(repository.findPinsInBbox)`.
 */
interface RepositoryMock {
  readonly findPinsInBbox: ReturnType<typeof vi.fn>
}

function makeRepository(pins: readonly PharmacyMapPin[] = []): RepositoryMock {
  return { findPinsInBbox: vi.fn(() => Promise.resolve(pins)) }
}

function makeUseCase(repository: RepositoryMock): GetPharmacyMapPinsUseCase {
  return new GetPharmacyMapPinsUseCase(
    repository as unknown as ConstructorParameters<typeof GetPharmacyMapPinsUseCase>[0],
  )
}

describe('GetPharmacyMapPinsUseCase.execute — валидация площади bbox (SRS-CAT-054, TC-CAT-024)', () => {
  it('критерий 1: bbox покрывающий весь Таджикистан (> 2500 км²) → BboxTooLargeError', async () => {
    const repository = makeRepository()
    const useCase = makeUseCase(repository)

    await expect(
      useCase.execute({ bbox: TAJIKISTAN_BBOX, tenantId: TENANT_ID }),
    ).rejects.toThrow(BboxTooLargeError)
    expect(repository.findPinsInBbox).not.toHaveBeenCalled()
  })

  it('BboxTooLargeError несёт code=VALIDATION_ERROR и details.field=bbox (мапится в 400 на DTJ-197)', async () => {
    const useCase = makeUseCase(makeRepository())

    try {
      await useCase.execute({ bbox: TAJIKISTAN_BBOX, tenantId: TENANT_ID })
      expect.unreachable('execute() обязан бросить BboxTooLargeError')
    } catch (error) {
      expect(error).toBeInstanceOf(BboxTooLargeError)
      const bboxError = error as BboxTooLargeError
      expect(bboxError.code).toBe('VALIDATION_ERROR')
      expect(bboxError.details).toMatchObject({ field: 'bbox' })
    }
  })

  it('критерий 4: площадь РОВНО НА ГРАНИЦЕ 2500 км² → НЕ выброшена ошибка (<=, не <)', async () => {
    const repository = makeRepository()
    const useCase = makeUseCase(repository)

    await expect(
      useCase.execute({ bbox: EXACT_2500_KM2_BBOX, tenantId: TENANT_ID }),
    ).resolves.toEqual([])
    expect(repository.findPinsInBbox).toHaveBeenCalledTimes(1)
  })

  it('чуть больше границы (2500.0005 км²) → BboxTooLargeError (off-by-one зафиксирован)', async () => {
    const useCase = makeUseCase(makeRepository())

    await expect(
      useCase.execute({ bbox: JUST_OVER_2500_KM2_BBOX, tenantId: TENANT_ID }),
    ).rejects.toThrow(BboxTooLargeError)
  })

  it('bbox в пределах лимита с валидными, но экстремальными координатами → InvalidCoordinatesError, не тихий NaN', async () => {
    const useCase = makeUseCase(makeRepository())
    const invalidBbox: Bbox = { lonMin: 68.7, latMin: 38.5, lonMax: 200, latMax: 38.51 }

    await expect(useCase.execute({ bbox: invalidBbox, tenantId: TENANT_ID })).rejects.toThrow()
  })
})

describe('GetPharmacyMapPinsUseCase.execute — обогащение isOpenNow (критерий приёмки 2)', () => {
  it('is24x7=true → isOpenNow: true (переиспользование TC-CAT-020-набора комбинаций)', async () => {
    const pin = makePin({ pharmacyId: 'ph-24x7', is24x7: true, isOpenNow: true })
    const useCase = makeUseCase(makeRepository([pin]))

    const result = await useCase.execute({ bbox: SMALL_BBOX, tenantId: TENANT_ID })

    expect(result).toEqual([
      { pharmacyId: 'ph-24x7', name: 'Аптека №1', lat: 38.505, lon: 68.705, isOpenNow: true, is24x7: true, offer: null },
    ])
  })

  it('обычный режим, сейчас закрыта → isOpenNow: false', async () => {
    const pin = makePin({ pharmacyId: 'ph-closed', is24x7: false, isOpenNow: false })
    const useCase = makeUseCase(makeRepository([pin]))

    const result = await useCase.execute({ bbox: SMALL_BBOX, tenantId: TENANT_ID })

    expect(result[0]).toMatchObject({ pharmacyId: 'ph-closed', isOpenNow: false, is24x7: false })
  })

  it('обычный режим, сейчас открыта → isOpenNow: true', async () => {
    const pin = makePin({ pharmacyId: 'ph-open', is24x7: false, isOpenNow: true })
    const useCase = makeUseCase(makeRepository([pin]))

    const result = await useCase.execute({ bbox: SMALL_BBOX, tenantId: TENANT_ID })

    expect(result[0]).toMatchObject({ pharmacyId: 'ph-open', isOpenNow: true, is24x7: false })
  })

  it('3 аптеки одновременно (24x7/закрыта/открыта) → isOpenNow соответственно true, false, true', async () => {
    const pins = [
      makePin({ pharmacyId: 'a', is24x7: true, isOpenNow: true }),
      makePin({ pharmacyId: 'b', is24x7: false, isOpenNow: false }),
      makePin({ pharmacyId: 'c', is24x7: false, isOpenNow: true }),
    ]
    const useCase = makeUseCase(makeRepository(pins))

    const result = await useCase.execute({ bbox: SMALL_BBOX, tenantId: TENANT_ID })

    expect(result.map((pin) => pin.isOpenNow)).toEqual([true, false, true])
  })
})

describe('GetPharmacyMapPinsUseCase.execute — offer/medicineId (критерий приёмки 3)', () => {
  it('medicineId не передан → offer: null для всех пинов, репозиторий вызван без medicineId', async () => {
    const pins = [makePin({ pharmacyId: 'a' }), makePin({ pharmacyId: 'b' })]
    const repository = makeRepository(pins)
    const useCase = makeUseCase(repository)

    const result = await useCase.execute({ bbox: SMALL_BBOX, tenantId: TENANT_ID })

    expect(result.every((pin) => pin.offer === null)).toBe(true)
    const [query] = repository.findPinsInBbox.mock.calls[0] as [BboxQuery]
    expect(query.medicineId).toBeUndefined()
  })

  it('medicineId передан → пробрасывается в запрос репозитория, offer пина не выдумывается', async () => {
    const offer = { priceDiram: 1250, stockQuantity: 3, lastSyncedAt: '2026-08-31T03:58:00.000Z', isStale: false }
    const pin = makePin({ offer })
    const repository = makeRepository([pin])
    const useCase = makeUseCase(repository)

    const result = await useCase.execute({ bbox: SMALL_BBOX, medicineId: MEDICINE_ID, tenantId: TENANT_ID })

    expect(result[0]?.offer).toEqual(offer)
    const [query] = repository.findPinsInBbox.mock.calls[0] as [BboxQuery]
    expect(query.medicineId).toBe(MEDICINE_ID)
    expect(query.tenantId).toBe(TENANT_ID)
    expect(query).toMatchObject({
      lonMin: SMALL_BBOX.lonMin,
      latMin: SMALL_BBOX.latMin,
      lonMax: SMALL_BBOX.lonMax,
      latMax: SMALL_BBOX.latMax,
    })
  })

  it('пустой результат репозитория → пустой список пинов, не ошибка', async () => {
    const useCase = makeUseCase(makeRepository([]))

    const result = await useCase.execute({ bbox: SMALL_BBOX, tenantId: TENANT_ID })

    expect(result).toEqual([])
  })
})
