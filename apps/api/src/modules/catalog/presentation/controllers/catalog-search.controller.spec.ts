/**
 * Unit-тест `CatalogSearchController` (DTJ-190, EP-06, R1) — конструирует контроллер напрямую
 * (без DI-контейнера, use case'ы замокированы), проверяет ПОВЕДЕНИЕ (вход → статус/тело),
 * не факт вызова use case (см. зону DTJ-190) — тот же стиль, что `pharmacies-map.controller.spec.ts`
 * (DTJ-197), но с акцентом на форму ответа/брошенной ошибки, а не только на аргументы вызова.
 *
 * Реальный HTTP-маршрут (монтированный `CatalogModule`) — вне зоны этого юнит-теста.
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-011, 022-030, 044-048, 077)
 * @see tickets/ep05-search-map/DTJ-190.md (критерии приёмки)
 */
import { describe, expect, it, vi } from 'vitest'
import { ERROR_HTTP_STATUS, ErrorCode, ValidationError } from '@dorutj/contracts'
import { TenantContext, type TenantContextStore } from '@/common/context/tenant-context.js'
import { InternalServerErrorException } from '@nestjs/common'
import { TenantId } from '@/modules/tenancy/index.js'
import type { SearchMedicinesUseCase } from '@/modules/catalog/application/use-cases/search-medicines.use-case.js'
import type {
  SuggestMedicinesUseCase,
  SuggestMedicinesResultItem,
} from '@/modules/catalog/application/use-cases/suggest-medicines.use-case.js'
import type { SearchResultItem, SearchResultPage } from '@/modules/catalog/application/search/ports/search-provider.port.js'
import { SearchTemporarilyDegradedError } from '@/modules/catalog/domain/errors/search-temporarily-degraded.error.js'
import { SearchServiceUnavailableError } from '../errors/search-service-unavailable.error.js'
import { CatalogSearchController } from './catalog-search.controller.js'

/** Ловит исключение из `promiseFactory()` и возвращает его типизированно (без `expect.objectContaining`
 * вложенного в литерал — тот путь бьёт `@typescript-eslint/no-unsafe-assignment`, см. JSDoc теста). */
async function captureRejection(promiseFactory: () => Promise<unknown>): Promise<unknown> {
  try {
    await promiseFactory()
  } catch (error) {
    return error
  }
  throw new Error('expected promiseFactory() to reject, but it resolved')
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const RESOLVED_STORE: TenantContextStore = {
  tenantId: TENANT_ID,
  slug: 'neutral',
  chainId: null,
  isNeutral: true,
  unresolved: false,
  unresolvedReason: null,
}

function makeController(
  searchExecute: ReturnType<typeof vi.fn>,
  suggestExecute: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue([]),
): CatalogSearchController {
  return new CatalogSearchController(
    { execute: searchExecute } as unknown as SearchMedicinesUseCase,
    { execute: suggestExecute } as unknown as SuggestMedicinesUseCase,
  )
}

function makeResultItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    medicineId: 'med-1',
    tradeName: 'Цитрамон',
    innName: 'Ацетилсалициловая кислота',
    dosageForm: 'tablet',
    dosageStrength: '500 mg',
    imageUrl: null,
    isPrescriptionRequired: false,
    cheapestOffer: null,
    offersCountInRadius: 0,
    relevanceScore: 0.9,
    ...overrides,
  }
}

function makePage(items: readonly SearchResultItem[], overrides: Partial<SearchResultPage> = {}): SearchResultPage {
  return { items, nextCursor: null, hasMore: false, ...overrides }
}

describe('CatalogSearchController.search', () => {
  it('happy path: text=парацетамол — вызывает use case, возвращает { data, meta.pagination } с замапленными полями', async () => {
    const item = makeResultItem()
    const execute = vi.fn().mockResolvedValue(makePage([item]))
    const controller = makeController(execute)

    const result = await TenantContext.run(RESOLVED_STORE, () =>
      controller.search({ text: 'парацетамол' }, undefined),
    )

    expect(result).toEqual({
      data: [item],
      meta: { pagination: { nextCursor: null, hasMore: false, limit: 20 } },
    })
    const command = execute.mock.calls[0]?.[0] as { text: string; tenantId: TenantId; customerId: unknown; locale: string }
    expect(command.text).toBe('парацетамол')
    expect(command.tenantId.equals(TenantId.from(TENANT_ID))).toBe(true)
    expect(command.customerId).toBeNull()
    expect(command.locale).toBe('tj')
  })

  it("AC3 (TC-CAT-077): текст без совпадений — 200 с data: [] и hasMore: false, НЕ 404", async () => {
    const execute = vi.fn().mockResolvedValue(makePage([]))
    const controller = makeController(execute)

    const result = await TenantContext.run(RESOLVED_STORE, () =>
      controller.search({ text: 'несуществующий_текст_xyz' }, undefined),
    )

    expect(result).toEqual({ data: [], meta: { pagination: { nextCursor: null, hasMore: false, limit: 20 } } })
  })

  it('AC1: radiusMeters=7000 (вне {1000,3000,5000,10000,20000}) — бросает ValidationError с details.field=radiusMeters, use case НЕ вызван', async () => {
    const execute = vi.fn()
    const controller = makeController(execute)

    const error = await captureRejection(() =>
      TenantContext.run(RESOLVED_STORE, () => controller.search({ radiusMeters: '7000' }, undefined)),
    )

    expect(error).toBeInstanceOf(ValidationError)
    const validationError = error as ValidationError
    expect(validationError.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(validationError.details?.field).toBe('radiusMeters')
    expect(execute).not.toHaveBeenCalled()
    expect(ERROR_HTTP_STATUS[ErrorCode.VALIDATION_ERROR]).toBe(400)
  })

  it('AC2: sort=distance_asc без lat/lon — бросает ValidationError с details.field=sort, use case НЕ вызван', async () => {
    const execute = vi.fn()
    const controller = makeController(execute)

    const error = await captureRejection(() =>
      TenantContext.run(RESOLVED_STORE, () => controller.search({ sort: 'distance_asc' }, undefined)),
    )

    expect(error).toBeInstanceOf(ValidationError)
    const validationError = error as ValidationError
    expect(validationError.code).toBe(ErrorCode.VALIDATION_ERROR)
    expect(validationError.details?.field).toBe('sort')
    expect(execute).not.toHaveBeenCalled()
  })

  it('sort=distance_asc С lat/lon — валидация проходит, geo и sort пробрасываются в команду use case', async () => {
    const execute = vi.fn().mockResolvedValue(makePage([]))
    const controller = makeController(execute)

    await TenantContext.run(RESOLVED_STORE, () =>
      controller.search({ sort: 'distance_asc', lat: '38.5598', lon: '68.787' }, undefined),
    )

    const command = execute.mock.calls[0]?.[0] as { sort: string; geo: { latitude: number; longitude: number } }
    expect(command.sort).toBe('distance_asc')
    expect(command.geo).toEqual({ latitude: 38.5598, longitude: 68.787 })
  })

  it('AC4 (TC-CAT-025): use case бросил SearchTemporarilyDegradedError — контроллер перебрасывает ошибку с кодом SERVICE_UNAVAILABLE (503) и details.reason', async () => {
    const execute = vi.fn().mockRejectedValue(new SearchTemporarilyDegradedError('statement_timeout'))
    const controller = makeController(execute)

    const error = await captureRejection(() =>
      TenantContext.run(RESOLVED_STORE, () => controller.search({ text: 'парацетамол' }, undefined)),
    )

    expect(error).toBeInstanceOf(SearchServiceUnavailableError)
    const unavailableError = error as SearchServiceUnavailableError
    expect(unavailableError.code).toBe(ErrorCode.SERVICE_UNAVAILABLE)
    expect(unavailableError.details?.reason).toBe('search_temporarily_degraded')
    expect(ERROR_HTTP_STATUS[ErrorCode.SERVICE_UNAVAILABLE]).toBe(503)
  })

  it('use case бросил ПРОЧУЮ ошибку (не SearchTemporarilyDegradedError) — контроллер её НЕ глотает, пробрасывает как есть', async () => {
    const boom = new Error('unexpected boom')
    const execute = vi.fn().mockRejectedValue(boom)
    const controller = makeController(execute)

    await expect(
      TenantContext.run(RESOLVED_STORE, () => controller.search({ text: 'x' }, undefined)),
    ).rejects.toThrow(boom)
  })

  it('sort НЕ передан клиентом — команда use case НЕ содержит ключ sort (use case сам выбирает дефолт для browsing, SRS-CAT-023)', async () => {
    const execute = vi.fn().mockResolvedValue(makePage([]))
    const controller = makeController(execute)

    await TenantContext.run(RESOLVED_STORE, () => controller.search({ text: '' }, undefined))

    const command = execute.mock.calls[0]?.[0] as Record<string, unknown>
    expect('sort' in command).toBe(false)
  })

  it("sort=relevance передан ЯВНО клиентом — команда use case несёт sort: 'relevance' даже без text", async () => {
    const execute = vi.fn().mockResolvedValue(makePage([]))
    const controller = makeController(execute)

    await TenantContext.run(RESOLVED_STORE, () => controller.search({ text: '', sort: 'relevance' }, undefined))

    const command = execute.mock.calls[0]?.[0] as { sort?: string }
    expect(command.sort).toBe('relevance')
  })

  it('radiusMeters задан БЕЗ lat/lon — тихо игнорируется (не ошибка), команда use case не несёт geo/radiusMeters', async () => {
    const execute = vi.fn().mockResolvedValue(makePage([]))
    const controller = makeController(execute)

    await TenantContext.run(RESOLVED_STORE, () => controller.search({ radiusMeters: '5000' }, undefined))

    const command = execute.mock.calls[0]?.[0] as Record<string, unknown>
    expect('geo' in command).toBe(false)
    // Use case (DTJ-188) сам решает, игнорировать ли radiusMeters без geo — контроллер лишь
    // передаёт распарсенное значение как есть (defensive-дубль уже реализован в use case).
  })

  it('Accept-Language: ru-RU резолвится в locale=ru', async () => {
    const execute = vi.fn().mockResolvedValue(makePage([]))
    const controller = makeController(execute)

    await TenantContext.run(RESOLVED_STORE, () => controller.search({ text: 'x' }, 'ru-RU,ru;q=0.9'))

    const command = execute.mock.calls[0]?.[0] as { locale: string }
    expect(command.locale).toBe('ru')
  })

  it('недостижимая ветка: TenantContext не резолвлен — техническая 500, use case не вызван', async () => {
    const execute = vi.fn()
    const controller = makeController(execute)

    await expect(controller.search({ text: 'x' }, undefined)).rejects.toThrow(InternalServerErrorException)
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('CatalogSearchController.suggest', () => {
  function makeMedicineItem(): SuggestMedicinesResultItem {
    return { kind: 'medicine', medicineId: 'm1', tradeName: 'Но-шпа', innName: 'дротаверин', matchedVia: 'trigram' }
  }

  it("AC (TC-CAT-021): q='но-ш' — маппит medicine-подсказку в плоский DTO без поля kind", async () => {
    const suggestExecute = vi.fn().mockResolvedValue([makeMedicineItem()])
    const controller = makeController(vi.fn(), suggestExecute)

    const result = await TenantContext.run(RESOLVED_STORE, () => controller.suggest({ q: 'но-ш' }))

    expect(result).toEqual({
      data: [{ medicineId: 'm1', tradeName: 'Но-шпа', innName: 'дротаверин', matchedVia: 'trigram' }],
    })
    expect(suggestExecute.mock.calls[0]?.[0]).toMatchObject({ prefix: 'но-ш', limit: 10 })
  })

  it("AC (TC-CAT-022): q не передан — prefix='', trending-подсказка маппится с medicineId:null/innName:null/matchedVia:'trending'", async () => {
    const suggestExecute = vi
      .fn()
      .mockResolvedValue([{ kind: 'trending', tradeName: 'парацетамол' } satisfies SuggestMedicinesResultItem])
    const controller = makeController(vi.fn(), suggestExecute)

    const result = await TenantContext.run(RESOLVED_STORE, () => controller.suggest({}))

    expect(result).toEqual({
      data: [{ medicineId: null, tradeName: 'парацетамол', innName: null, matchedVia: 'trending' }],
    })
    expect(suggestExecute.mock.calls[0]?.[0]).toMatchObject({ prefix: '' })
  })

  it('limit явно передан клиентом — пробрасывается как есть в команду use case', async () => {
    const suggestExecute = vi.fn().mockResolvedValue([])
    const controller = makeController(vi.fn(), suggestExecute)

    await TenantContext.run(RESOLVED_STORE, () => controller.suggest({ q: 'аспирин', limit: '5' }))

    expect(suggestExecute.mock.calls[0]?.[0]).toMatchObject({ limit: 5 })
  })

  it('limit=0 (невалидный, positive() отклоняет) — бросает ValidationError, use case не вызван', async () => {
    const suggestExecute = vi.fn()
    const controller = makeController(vi.fn(), suggestExecute)

    await expect(
      TenantContext.run(RESOLVED_STORE, () => controller.suggest({ q: 'x', limit: '0' })),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
    expect(suggestExecute).not.toHaveBeenCalled()
  })
})
