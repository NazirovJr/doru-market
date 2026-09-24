/**
 * `SuggestNearestCourierUseCase` (EP-13, DTJ-314, SRS-DELIV-038) — алгоритм подбора курьера.
 * Читает, не мутирует состояние — сам НЕ создаёт офферы (DTJ-315).
 *
 * **Разделение 7 условий фильтра приемлемости между SQL и use case (проектное решение, нет
 * буквального указания в тикете, где именно проходит граница):**
 * - `CourierCandidatePort` (SQL, `PostgisCourierCandidateAdapter`) — 4 условия, естественно
 *   SQL-native: `status='active'`, `shift_status='on_shift'`, `distance <= radiusKm`,
 *   `last_location_at` не старше `locationStaleMinutes`. Интеграционно проверено на реальном
 *   Postgres (тест-план тикета).
 * - Этот use case («шаг а» SRS-DELIV-038) — 3 условия, требующие бизнес-логики/ветвления по
 *   `courierSourcingMode`, которую проще и корректнее выразить и ЮНИТ-ПРОТЕСТИРОВАТЬ в TS, чем
 *   дублировать в SQL (C15 — правило одного места истины): тенантный/chain-guard (SRS-DOM-037),
 *   cold-chain guard (SRS-DOM-038), потолок нагрузки (`MAX_CONCURRENT_ASSIGNMENTS_PER_COURIER`).
 *   `CourierCandidatePort` возвращает уже все данные, нужные для этих трёх проверок
 *   (`courierChainId`/`coldChainCertified`/`activeAssignmentsCount`), не заставляя use case
 *   делать дополнительный запрос.
 *
 * Веса/радиус/потолки — ASSUMPTION (SRS-DELIV-038, `04-SCOPE-DECISION-PIVOT.md` §7), НЕ
 * хардкод-числа в теле алгоритма (C6): читаются из ENV с именованными дефолтами ниже.
 * Per-tenant override (упомянутый текстом тикета) потребовал бы новых колонок
 * `tenant_settings` — вне `files_owned` этого тикета; ENV — единственный уровень конфигурации
 * сегодня (зафиксировано как открытый вопрос в отчёте сдачи).
 */
import { Inject, Injectable } from '@nestjs/common'
import type { GeoPoint } from '@/shared-kernel/index.js'
import {
  COURIER_CANDIDATE_PORT,
  type CourierCandidate,
  type CourierCandidatePort,
} from '../ports/courier-candidate.port.js'
import { DELIVERY_TENANCY_PORT, type DeliveryTenancyPort } from '../ports/delivery-tenancy.port.js'

/** SRS-DELIV-038 п.2, ASSUMPTION — Σ = 1. Override: `env.W_DISTANCE`/`W_WORKLOAD`/`W_RATING`. */
const DEFAULT_W_DISTANCE = 0.5
const DEFAULT_W_WORKLOAD = 0.3
const DEFAULT_W_RATING = 0.2
/** ASSUMPTION 8 — override `env.COURIER_CANDIDATE_RADIUS_KM`. */
const DEFAULT_RADIUS_KM = 5
/** ASSUMPTION 2 — override `env.MAX_CONCURRENT_ASSIGNMENTS_PER_COURIER`. */
const DEFAULT_MAX_CONCURRENT_ASSIGNMENTS = 3
/** ASSUMPTION 15 — override `env.COURIER_LOCATION_STALE_MINUTES`. */
const DEFAULT_LOCATION_STALE_MINUTES = 15
const RATING_SCALE_MAX = 5
const MIN_SCORE = 0

export interface SuggestNearestCourierInput {
  readonly tenantId: string
  /** `pharmacy_chains.id` заказа; `null` — аптека вне сети. */
  readonly pharmacyChainId: string | null
  readonly pharmacyGeoPoint: GeoPoint
  readonly requiresColdChain: boolean
}

export interface ScoredCourierCandidate {
  readonly courierId: string
  readonly courierChainId: string | null
  readonly distanceMeters: number
  readonly totalScore: number
}

@Injectable()
export class SuggestNearestCourierUseCase {
  public constructor(
    @Inject(COURIER_CANDIDATE_PORT) private readonly candidatePort: CourierCandidatePort,
    @Inject(DELIVERY_TENANCY_PORT) private readonly tenancyPort: DeliveryTenancyPort,
  ) {}

  public async execute(input: SuggestNearestCourierInput): Promise<readonly ScoredCourierCandidate[]> {
    const courierSourcingMode = await this.tenancyPort.getCourierSourcingMode(input.tenantId)
    const radiusKm = resolveNumberEnv('COURIER_CANDIDATE_RADIUS_KM', DEFAULT_RADIUS_KM)
    const raw = await this.candidatePort.findEligibleCandidates({
      pharmacyGeoPoint: input.pharmacyGeoPoint,
      pharmacyChainId: input.pharmacyChainId,
      requiresColdChain: input.requiresColdChain,
      courierSourcingMode,
      radiusKm,
      maxConcurrentAssignments: resolveNumberEnv(
        'MAX_CONCURRENT_ASSIGNMENTS_PER_COURIER',
        DEFAULT_MAX_CONCURRENT_ASSIGNMENTS,
      ),
      locationStaleMinutes: resolveNumberEnv('COURIER_LOCATION_STALE_MINUTES', DEFAULT_LOCATION_STALE_MINUTES),
    })

    const eligible = raw.filter((candidate) => passesBusinessGuards(candidate, input, courierSourcingMode))
    const weights = {
      distance: resolveNumberEnv('W_DISTANCE', DEFAULT_W_DISTANCE),
      workload: resolveNumberEnv('W_WORKLOAD', DEFAULT_W_WORKLOAD),
      rating: resolveNumberEnv('W_RATING', DEFAULT_W_RATING),
    }
    const scored = eligible.map((candidate) => scoreCandidate(candidate, radiusKm, weights))
    return scored.sort(compareScoredCandidates)
  }
}

/**
 * «Шаг а» SRS-DELIV-038 — 3 условия, не покрытые SQL-адаптером (см. JSDoc файла): тенантный
 * guard SRS-DOM-037 (ветвление по `courierSourcingMode`, 1:1 `DeliveryAssignment.assign()`),
 * cold-chain guard SRS-DOM-038, потолок одновременных назначений.
 */
function passesBusinessGuards(
  candidate: CourierCandidate,
  input: SuggestNearestCourierInput,
  mode: 'own_fleet' | 'platform_pool' | 'hybrid',
): boolean {
  if (!passesSourcingModeGuard(candidate.courierChainId, input.pharmacyChainId, mode)) {
    return false
  }
  if (input.requiresColdChain && !candidate.coldChainCertified) {
    return false
  }
  const maxConcurrent = resolveNumberEnv('MAX_CONCURRENT_ASSIGNMENTS_PER_COURIER', DEFAULT_MAX_CONCURRENT_ASSIGNMENTS)
  return candidate.activeAssignmentsCount < maxConcurrent
}

/** SRS-DOM-037: `own_fleet` исключает пул, `platform_pool` исключает чужой флот, `hybrid` — оба. */
function passesSourcingModeGuard(
  courierChainId: string | null,
  pharmacyChainId: string | null,
  mode: 'own_fleet' | 'platform_pool' | 'hybrid',
): boolean {
  const isPoolCourier = courierChainId === null
  const isOwnFleetMatch = courierChainId !== null && courierChainId === pharmacyChainId
  if (mode === 'own_fleet') {
    return isOwnFleetMatch
  }
  if (mode === 'platform_pool') {
    return isPoolCourier
  }
  return isPoolCourier || isOwnFleetMatch
}

function scoreCandidate(
  candidate: CourierCandidate,
  radiusKm: number,
  weights: { readonly distance: number; readonly workload: number; readonly rating: number },
): ScoredCourierCandidate {
  const distanceKm = candidate.distanceMeters / 1000
  const distanceScore = Math.max(MIN_SCORE, 1 - distanceKm / radiusKm)
  const workloadScore = 1 / (1 + candidate.activeAssignmentsCount)
  const ratingScore = candidate.ratingAvg / RATING_SCALE_MAX
  const totalScore =
    weights.distance * distanceScore + weights.workload * workloadScore + weights.rating * ratingScore
  return {
    courierId: candidate.courierId,
    courierChainId: candidate.courierChainId,
    distanceMeters: candidate.distanceMeters,
    totalScore,
  }
}

/** Убыв. по `totalScore`; на точном равенстве — `own_fleet` (chainId не `null`) выше (SRS-DELIV-038 п.1). */
function compareScoredCandidates(a: ScoredCourierCandidate, b: ScoredCourierCandidate): number {
  if (a.totalScore !== b.totalScore) {
    return b.totalScore - a.totalScore
  }
  return (a.courierChainId !== null ? 0 : 1) - (b.courierChainId !== null ? 0 : 1)
}

function resolveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    return fallback
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}
