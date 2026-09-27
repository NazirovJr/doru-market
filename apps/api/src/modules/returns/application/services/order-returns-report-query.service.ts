import { Inject, Injectable } from '@nestjs/common'
import type { ReturnStatus, UserRole } from '@dorutj/contracts'
import {
  RETURNS_REPOSITORY,
  type OrderReturn,
  type ReturnsRepositoryPort,
} from '../ports/returns-repository.port.js'

export interface ReturnsReportActor {
  readonly role: UserRole
  readonly pharmacyId: string | null
  readonly chainId: string | null
}

export interface ListIncomingReturnsInput {
  readonly tenantId: string
  readonly actor: ReturnsReportActor
  readonly statuses: readonly ReturnStatus[]
  readonly cursor: { readonly v: string; readonly id: string } | null
  readonly limit: number
}

export interface ListIncomingReturnsResult {
  readonly items: readonly OrderReturn[]
  readonly hasMore: boolean
  readonly nextCursor: { readonly v: string; readonly id: string } | null
}

@Injectable()
export class OrderReturnsReportQueryService {
  public constructor(@Inject(RETURNS_REPOSITORY) private readonly repository: ReturnsRepositoryPort) {}

  async listIncoming(input: ListIncomingReturnsInput): Promise<ListIncomingReturnsResult> {
    const scope = resolveScope(input.actor)
    const { items, hasMore } = await this.repository.findIncoming({
      tenantId: input.tenantId,
      pharmacyId: scope.pharmacyId,
      chainId: scope.chainId,
      statuses: input.statuses,
      cursor: input.cursor,
      limit: input.limit,
    })
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem !== undefined ? { v: lastItem.requestedAt.toISOString(), id: lastItem.id } : null
    return { items, hasMore, nextCursor }
  }
}

// pharmacy_admin без сети (chainId===null) — падает на свою аптеку, тот же приём, что inventory-sync-report-query.service.ts.
function resolveScope(actor: ReturnsReportActor): { readonly pharmacyId: string | null; readonly chainId: string | null } {
  if (actor.role === 'pharmacist') {
    return { pharmacyId: actor.pharmacyId, chainId: null }
  }
  if (actor.role === 'pharmacy_admin') {
    return actor.chainId !== null ? { pharmacyId: null, chainId: actor.chainId } : { pharmacyId: actor.pharmacyId, chainId: null }
  }
  return { pharmacyId: null, chainId: null }
}
