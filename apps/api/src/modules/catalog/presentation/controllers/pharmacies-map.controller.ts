/**
 * `PharmaciesMapController` (DTJ-197, EP-08 — Карта аптек, `R1-6`) —
 * `GET /api/v1/pharmacies/map?bbox=<lonMin,latMin,lonMax,latMax>&medicineId=<uuid?>`
 * (SRS-CAT-052).
 *
 * Разбор границы:
 *   - `bbox`/`medicineId` — формат-валидация через `PharmacyMapQuerySchema` (`@dorutj/contracts`,
 *     DTJ-194) с общим `ZodValidationPipe` (тот же приём, что `StaffAccountsController`/
 *     `InventoryBatchUpdateController`): невалидный `bbox` (не 4 числа, вырожденный
 *     прямоугольник) или `medicineId` не-uuid → `400 VALIDATION_ERROR` ДО вызова use case.
 *   - Площадь `bbox` (`SRS-CAT-054`) — бизнес-инвариант use case'а
 *     (`GetPharmacyMapPinsUseCase`, DTJ-196), не этого контроллера: `BboxTooLargeError`
 *     (`extends ValidationError`) долетает до клиента как `400` через глобальный
 *     `DomainExceptionFilter` без какого-либо кода здесь.
 *
 * `tenantId` — из `TenantContext` (ставит `TenantResolutionMiddleware`, глобальный
 * `TenantScopeGuard` уже гарантировал резолвленный тенант ДО того, как запрос дошёл
 * сюда — недостижимая ветка ниже страхует только от рассинхронизации контракта, а не
 * подставляет никакой смысловой fallback).
 *
 * `@Public()`: гость видит карту аптек без авторизации (`docs/spec/30-ux-screens-and-flows.md`,
 * маршрут `/map` — «гость/customer»; та же публичность, что у `CategoriesController`/
 * `MedicinesController` для остального публичного поиска R1-3/R1-6). Резолвинг тенанта
 * всё равно обязателен (`TenantScopeGuard` не пропускает нерезолвленный тенант даже для
 * `@Public()`-маршрутов).
 *
 * Тело ответа — `PharmacyMapResponseDto` (`@dorutj/contracts`) БЕЗ обёртки `{ data }`:
 * контракт `PharmacyMapResponseSchema` — плоский массив пинов (в отличие от `/categories`),
 * контроллер не изобретает свою форму (Ж12).
 *
 * @see docs/spec/20-module-catalog-search.md (SRS-CAT-052, SRS-CAT-054)
 * @see tickets/ep05-search-map/DTJ-197.md (или соответствующий тикет EP-08, если перенесён)
 */
import { Controller, Get, Inject, InternalServerErrorException, Query } from '@nestjs/common'
import { ErrorCode, PharmacyMapQuerySchema, type PharmacyMapQueryDto } from '@dorutj/contracts'
import { Public } from '@/common/decorators/public.decorator.js'
import { TenantContext } from '@/common/context/tenant-context.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { TenantId } from '@/modules/tenancy/index.js'
import { GetPharmacyMapPinsUseCase } from '@/modules/catalog/application/use-cases/get-pharmacy-map-pins.use-case.js'
import { toPharmacyMapResponseDto, type PharmacyMapResponseDto } from '../dto/pharmacy-map.dto.js'

@Controller({ path: 'pharmacies/map', version: '1' })
@Public()
export class PharmaciesMapController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `CategoriesController`/`StaffAccountsController`.
  constructor(
    @Inject(GetPharmacyMapPinsUseCase) private readonly getPharmacyMapPins: GetPharmacyMapPinsUseCase,
  ) {}

  @Get()
  async getMap(
    @Query(new ZodValidationPipe(PharmacyMapQuerySchema)) query: PharmacyMapQueryDto,
  ): Promise<PharmacyMapResponseDto> {
    const tenantId = resolveTenantId()
    const pins = await this.getPharmacyMapPins.execute({
      bbox: query.bbox,
      tenantId,
      ...(query.medicineId === undefined ? {} : { medicineId: query.medicineId }),
    })
    return toPharmacyMapResponseDto(pins)
  }
}

/**
 * Резолв `TenantId` из `TenantContext`. Глобальный `TenantScopeGuard` уже отверг запрос
 * (400/500) раньше, если тенант не резолвлен — сюда попадает только резолвленный контекст
 * с реальным UUID тенанта. Здесь НЕТ фолбэка вида «нет тенанта → строка 'neutral'» —
 * именно такой фолбэк был дефектом, который резолвит нейтральный тенант в
 * `TenantResolutionMiddleware`/`TenantContext`; контроллер не изобретает свой.
 */
function resolveTenantId(): TenantId {
  const store = TenantContext.get()
  if (store?.tenantId === undefined || store.tenantId === null) {
    // Недостижимо при корректно подключённом `TenantResolutionMiddleware` +
    // `TenantScopeGuard` (оба глобальные, стоят раньше presentation). Явный технический
    // сбой вместо тихой подстановки — рассинхронизация с гардом является дефектом,
    // а не штатным случаем.
    throw new InternalServerErrorException({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'tenant context not resolved (TenantScopeGuard should have rejected earlier)',
    })
  }
  return TenantId.from(store.tenantId)
}
