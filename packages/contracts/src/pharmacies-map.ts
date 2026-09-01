/**
 * HTTP-контракт `GET /api/v1/pharmacies/map` (DTJ-194, EP-08, SRS-CAT-052).
 *
 * Zod-схемы валидируют границу API — сериализуемые примитивы, НЕ доменные VO (`TenantId`
 * и т.п. остаются внутри `application`-порта `PharmacyMapRepository`,
 * `apps/api/src/modules/catalog/application/pharmacies-map/ports/pharmacy-map-repository.port.ts` —
 * то же разделение зон ответственности, что и у `search.ts`/`SearchProvider`, DTJ-180).
 *
 * `bbox` — query-строка `lonMin,latMin,lonMax,latMax` (SRS-CAT-052). Здесь проверяется
 * ТОЛЬКО формат (ровно 4 числа, `min < max` по каждой оси — вырожденный/перевёрнутый
 * прямоугольник отклоняется как невалидный формат). Проверка площади против
 * `BBOX_MAX_AREA_KM2` (SRS-CAT-054, объявлена в `pharmacy-map-repository.port.ts`) требует
 * геодезического расчёта и выполняется `application`-use case'ом (DTJ-196), не на границе
 * контракта — см. тест-план DTJ-194.
 */
import { z } from 'zod'

const BBOX_PARTS_COUNT = 4

/** Разобранные координаты `bbox` — порядок полей сохранён (SRS-CAT-052). */
export interface BboxCoordinates {
  readonly lonMin: number
  readonly latMin: number
  readonly lonMax: number
  readonly latMax: number
}

/** `undefined`/пустая/нечисловая строка → `null` (не `0` — иначе пропущенная координата в `bbox=1,,3,4` молча считалась бы нулём). */
function toFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') {
    return null
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/**
 * Разбирает и валидирует `bbox=lonMin,latMin,lonMax,latMax`. Негативные сценарии:
 * неверное число полей, нечисловые/пустые значения, `lonMin >= lonMax` или
 * `latMin >= latMax` (вырожденный прямоугольник) — площадь здесь не проверяется.
 */
function parseBbox(raw: string, ctx: z.RefinementCtx): BboxCoordinates | typeof z.NEVER {
  const parts = raw.split(',')
  if (parts.length !== BBOX_PARTS_COUNT) {
    ctx.addIssue({
      code: 'custom',
      message: `bbox must contain exactly ${String(BBOX_PARTS_COUNT)} comma-separated numbers: lonMin,latMin,lonMax,latMax`,
    })
    return z.NEVER
  }

  const lonMin = toFiniteNumber(parts[0])
  const latMin = toFiniteNumber(parts[1])
  const lonMax = toFiniteNumber(parts[2])
  const latMax = toFiniteNumber(parts[3])
  if (lonMin === null || latMin === null || lonMax === null || latMax === null) {
    ctx.addIssue({ code: 'custom', message: 'bbox must contain 4 numeric values' })
    return z.NEVER
  }

  if (lonMin >= lonMax || latMin >= latMax) {
    ctx.addIssue({
      code: 'custom',
      message: 'bbox is degenerate: lonMin must be < lonMax and latMin must be < latMax',
    })
    return z.NEVER
  }

  return { lonMin, latMin, lonMax, latMax }
}

/** Query-параметры `GET /api/v1/pharmacies/map` (SRS-CAT-052). */
export const PharmacyMapQuerySchema = z.object({
  bbox: z.string().transform(parseBbox),
  medicineId: z.uuid().optional(),
})
export type PharmacyMapQueryDto = z.infer<typeof PharmacyMapQuerySchema>

/** Оффер конкретного медикамента на пине (SRS-CAT-052) — присутствует только если запрошен `medicineId`. */
export const PharmacyMapPinOfferSchema = z.object({
  priceDiram: z.number().int().nonnegative(),
  stockQuantity: z.number().int().nonnegative(),
  lastSyncedAt: z.string(),
  isStale: z.boolean(),
})

/** Один пин карты аптек (SRS-CAT-052). `offer: null` — только статические данные (без `medicineId` в запросе). */
export const PharmacyMapPinSchema = z.object({
  pharmacyId: z.uuid(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  isOpenNow: z.boolean(),
  is24x7: z.boolean(),
  offer: PharmacyMapPinOfferSchema.nullable(),
})
export type PharmacyMapPinDto = z.infer<typeof PharmacyMapPinSchema>

/** Тело успешного ответа `GET /api/v1/pharmacies/map` — список пинов в границах `bbox` (SRS-CAT-052). */
export const PharmacyMapResponseSchema = z.array(PharmacyMapPinSchema)
export type PharmacyMapResponseDto = z.infer<typeof PharmacyMapResponseSchema>
