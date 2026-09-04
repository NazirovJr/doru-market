/**
 * Zod-схемы тел запросов модуля `delivery` (EP-13, DTJ-313, `docs/spec/25-module-courier-delivery.md`
 * §A). Единственный источник DTO-типов для последующих тикетов эпика (presentation-контроллеры,
 * DTJ-314+) — сюда, не в локальные файлы контроллеров.
 *
 * Денежные поля — целые дирамы (`*Diram`, `number` на границе JSON — правило 6 AGENTS.md, тот же
 * приём, что `orders.ts`/`inventory/batch-update.schema.ts`): `bigint` не сериализуется в JSON,
 * конвертация — исключительно в infrastructure-мапперах. Координаты — `number` (широта/долгота),
 * диапазоны — `10-domain-model.md` SRS-DOM-072 (`GeoPoint.create`). Эндпоинты без тела запроса
 * (`accept`, `claim`, `depart`, `POST /courier-shifts`, `reissue-handover-otp`) здесь не
 * представлены — им нечего валидировать.
 */
import { z } from 'zod'

const LATITUDE_MIN = -90
const LATITUDE_MAX = 90
const LONGITUDE_MIN = -180
const LONGITUDE_MAX = 180
const RATING_MIN = 1
const RATING_MAX = 5
const OTP_HANDOVER_CODE_LENGTH = 4
const DECLINE_REASON_MAX_LENGTH = 100
const NOTES_MAX_LENGTH = 1000
const REASON_MAX_LENGTH = 500

const latitudeSchema = z.number().min(LATITUDE_MIN).max(LATITUDE_MAX)
const longitudeSchema = z.number().min(LONGITUDE_MIN).max(LONGITUDE_MAX)
const diramSchema = z.number().int().nonnegative()

/** `POST /api/v1/delivery-offers/:id/decline` — SRS-DELIV-014. */
export const declineDeliveryOfferRequestSchema = z.object({
  reason: z.string().max(DECLINE_REASON_MAX_LENGTH).optional(),
})
export type DeclineDeliveryOfferRequest = z.infer<typeof declineDeliveryOfferRequestSchema>

/** `POST /api/v1/delivery-assignments/:id/assign-manual` — SRS-DELIV-033. `reason` опционален. */
export const assignManualRequestSchema = z.object({
  courierId: z.uuid(),
  reason: z.string().max(REASON_MAX_LENGTH).optional(),
})
export type AssignManualRequest = z.infer<typeof assignManualRequestSchema>

/** `POST /api/v1/delivery-assignments/:id/reassign` — SRS-DELIV-034. `reason` ОБЯЗАТЕЛЕН (в
 * отличие от `assign-manual` — переназначение уже идущей доставки требует объяснения для аудита). */
export const reassignDeliveryAssignmentRequestSchema = z.object({
  courierId: z.uuid(),
  reason: z.string().min(1).max(REASON_MAX_LENGTH),
})
export type ReassignDeliveryAssignmentRequest = z.infer<typeof reassignDeliveryAssignmentRequestSchema>

/** `POST /api/v1/delivery-assignments/:id/depart-to-customer` — SRS-DELIV-020. */
export const departToCustomerRequestSchema = z.object({
  coldChainBagConfirmed: z.boolean().optional(),
})
export type DepartToCustomerRequest = z.infer<typeof departToCustomerRequestSchema>

/** `POST /api/v1/delivery-assignments/:id/record-cash` — SRS-DELIV-021. `Idempotency-Key`
 * обязателен на транспортном уровне (SRS-API-009, doc 12) — не часть тела запроса. */
export const recordCashRequestSchema = z.object({
  collectedDiram: diramSchema,
  changeDiram: diramSchema,
})
export type RecordCashRequest = z.infer<typeof recordCashRequestSchema>

/** `POST /api/v1/delivery-assignments/:id/deliver` — SRS-DELIV-022/024. `otpCode` — 4 цифры
 * (`delivery_handover`, SRS-DOM-080). `proofPhotoUrl` — ДОПОЛНИТЕЛЬНОЕ доказательство, не замена OTP. */
export const deliverRequestSchema = z.object({
  otpCode: z.string().regex(new RegExp(`^\\d{${String(OTP_HANDOVER_CODE_LENGTH)}}$`)),
  proofPhotoUrl: z.url().optional(),
})
export type DeliverRequest = z.infer<typeof deliverRequestSchema>

/** `issueType` — SRS-DELIV-025. Общий для `report-issue` и `mark-failed`. */
export const DELIVERY_ISSUE_TYPE_VALUES = ['customer_unreachable', 'address_not_found', 'other'] as const
export type DeliveryIssueType = (typeof DELIVERY_ISSUE_TYPE_VALUES)[number]

/** `POST /api/v1/delivery-assignments/:id/report-issue` — SRS-DELIV-025. */
export const reportDeliveryIssueRequestSchema = z.object({
  issueType: z.enum(DELIVERY_ISSUE_TYPE_VALUES),
  notes: z.string().max(NOTES_MAX_LENGTH).optional(),
})
export type ReportDeliveryIssueRequest = z.infer<typeof reportDeliveryIssueRequestSchema>

/** `POST /api/v1/delivery-assignments/:id/mark-failed` — SRS-DELIV-025/SRS-DOM-143. `'other'`
 * исключён намеренно: спека связывает порог попыток только с `customer_unreachable`/
 * `address_not_found` (SRS-DELIV-066), у `'other'` нет определённого пути эскалации до отказа. */
export const markDeliveryFailedRequestSchema = z.object({
  reason: z.enum(['customer_unreachable', 'address_not_found']),
})
export type MarkDeliveryFailedRequest = z.infer<typeof markDeliveryFailedRequestSchema>

/** `POST /api/v1/delivery-assignments/:id/refuse-at-door` — SRS-DELIV-026. */
export const refuseAtDoorRequestSchema = z.object({
  reason: z.literal('refused_at_door'),
  notes: z.string().max(NOTES_MAX_LENGTH).optional(),
})
export type RefuseAtDoorRequest = z.infer<typeof refuseAtDoorRequestSchema>

/** Одна GPS-точка курьера — SRS-DELIV-027. */
export const courierLocationPingSchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
  capturedAt: z.iso.datetime(),
  accuracyM: z.number().nonnegative().optional(),
  speedKmh: z.number().nonnegative().optional(),
})
export type CourierLocationPing = z.infer<typeof courierLocationPingSchema>

/** `POST /api/v1/courier-locations` — одиночный пинг ИЛИ батч `{ pings: [...] }` (офлайн-очередь). */
export const courierLocationRequestSchema = z.union([
  courierLocationPingSchema,
  z.object({ pings: z.array(courierLocationPingSchema).min(1) }),
])
export type CourierLocationRequest = z.infer<typeof courierLocationRequestSchema>

/** `POST /api/v1/courier-shifts/:id/end` — SRS-DELIV-029. */
export const endCourierShiftRequestSchema = z.object({
  cashSubmittedDiram: diramSchema,
})
export type EndCourierShiftRequest = z.infer<typeof endCourierShiftRequestSchema>

/** `POST /api/v1/courier-ratings` — SRS-DELIV-032. */
export const createCourierRatingRequestSchema = z.object({
  orderId: z.uuid(),
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX),
  comment: z.string().max(NOTES_MAX_LENGTH).optional(),
})
export type CreateCourierRatingRequest = z.infer<typeof createCourierRatingRequestSchema>

/** `PUT /api/v1/delivery-pricing-rules` — SRS-DELIV-036/D.6. `zoneId` отсутствует/`null` =
 * дефолтное правило тенанта вне зон. Ночной тариф — `HH:mm`, обе границы либо заданы, либо обе `null`. */
export const putDeliveryPricingRuleRequestSchema = z
  .object({
    zoneId: z.uuid().nullable().optional(),
    baseRateDiram: diramSchema,
    ratePerKmDiram: diramSchema,
    minOrderAmountDiram: diramSchema.default(0),
    freeDeliveryThresholdDiram: diramSchema.nullable().optional(),
    nightTariffStartTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    nightTariffEndTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    nightTariffExtraDiram: diramSchema.default(0),
  })
  .refine(
    (v) => (v.nightTariffStartTime === null || v.nightTariffStartTime === undefined) === (v.nightTariffEndTime === null || v.nightTariffEndTime === undefined),
    { message: 'nightTariffStartTime and nightTariffEndTime must be both set or both absent', path: ['nightTariffEndTime'] },
  )
export type PutDeliveryPricingRuleRequest = z.infer<typeof putDeliveryPricingRuleRequestSchema>

/** `POST /api/v1/delivery-zones` — создание (SRS-DELIV-036). */
export const createDeliveryZoneRequestSchema = z.object({
  name: z.string().min(1).max(100),
  centerLat: latitudeSchema,
  centerLon: longitudeSchema,
  radiusKm: z.number().positive(),
  priority: z.number().int().default(0),
  isActive: z.boolean().default(true),
})
export type CreateDeliveryZoneRequest = z.infer<typeof createDeliveryZoneRequestSchema>

/** `PATCH /api/v1/delivery-zones/:id` — частичное обновление, все поля опциональны. */
export const updateDeliveryZoneRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  centerLat: latitudeSchema.optional(),
  centerLon: longitudeSchema.optional(),
  radiusKm: z.number().positive().optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
})
export type UpdateDeliveryZoneRequest = z.infer<typeof updateDeliveryZoneRequestSchema>
