/**
 * `CourierCandidatePort` (EP-13, DTJ-314, SRS-DELIV-038) — геозапрос кандидатов для
 * `SuggestNearestCourierUseCase`. Реализация — `PostgisCourierCandidateAdapter`
 * (infrastructure, DTJ-314): вопреки имени (сохранено из `files_owned` тикета), PostGIS
 * НЕ используется — гаверсинус на `latitude`/`longitude`, см. JSDoc адаптера и
 * `apps/api/src/modules/catalog/infrastructure/adapters/postgres-search.sql.ts` (тот же приём,
 * DTJ-185/195: `pg_available_extensions` — 0 строк для `postgis%` в образе `postgres:16`).
 *
 * **Отклонение от буквальной прозы тикета `findEligibleCandidates(pharmacyGeoPoint, tenantId,
 * requiresColdChain, courierSourcingMode)`**: параметр назван `pharmacyChainId`, не `tenantId`.
 * `couriers` не несёт колонки `tenant_id` вовсе (`db/schema/couriers.ts`) — тенантный guard
 * SRS-DOM-037 сравнивает `couriers.chain_id` с `order.pharmacy.chainId` (`pharmacy_chains.id`),
 * ТОЧНО как уже реализовано `DeliveryAssignment.assign()`/`AssignCourierCommand.
 * orderPharmacyChainId` (DTJ-313, `domain/delivery-assignment.entity.ts`) — платформенный пул
 * (`chain_id IS NULL`) в принципе не имеет `tenantId` для сравнения. Прозвище параметра в тексте
 * тикета — сокращение, не буквальная сигнатура; поведение (guard по цепочке) соответствует
 * SRS-DOM-037 и уже существующему домену 1:1.
 */
import type { GeoPoint } from '@/shared-kernel/index.js'
import type { CourierSourcingMode } from '@/modules/tenancy/index.js'

export const COURIER_CANDIDATE_PORT = Symbol.for('@dorutj/delivery/courier-candidate-port')

export interface CourierCandidateQuery {
  readonly pharmacyGeoPoint: GeoPoint
  /** `pharmacy_chains.id` заказа, чей курьер подбирается; `null` — заказ вне сети (SRS-DOM-037). */
  readonly pharmacyChainId: string | null
  readonly requiresColdChain: boolean
  readonly courierSourcingMode: CourierSourcingMode
  readonly radiusKm: number
  readonly maxConcurrentAssignments: number
  readonly locationStaleMinutes: number
}

export interface CourierCandidate {
  readonly courierId: string
  readonly courierChainId: string | null
  readonly coldChainCertified: boolean
  readonly ratingAvg: number
  readonly activeAssignmentsCount: number
  readonly distanceMeters: number
}

export interface CourierCandidatePort {
  /** Уже применены ВСЕ жёсткие фильтры приемлемости (SRS-DELIV-038 п.1) — скоринг ниже по стеку. */
  findEligibleCandidates(query: CourierCandidateQuery): Promise<readonly CourierCandidate[]>
}
