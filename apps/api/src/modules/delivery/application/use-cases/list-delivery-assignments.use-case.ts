// Дашборд диспетчера: super_admin видит всё, pharmacy_admin — только свою сеть.
import { Inject, Injectable } from '@nestjs/common'
import type { DeliveryAssignmentStatus, UserRole } from '@dorutj/contracts'
import {
  DELIVERY_ASSIGNMENT_REPOSITORY,
  type DeliveryAssignmentRepositoryPort,
} from '../ports/delivery-assignment.repository.port.js'
import { DELIVERY_ORDERS_PORT, type DeliveryOrdersPort } from '../ports/delivery-orders.port.js'
import { PHARMACY_LOOKUP_PORT, type PharmacyLookupPort } from '../ports/pharmacy-lookup.port.js'
import type { DeliveryAssignment } from '../../domain/delivery-assignment.entity.js'

export interface DispatchListActor {
  readonly role: UserRole
  readonly chainId: string | null
}

export interface ListDeliveryAssignmentsCommand {
  readonly statuses: readonly DeliveryAssignmentStatus[]
  readonly limit: number
  readonly cursor: { readonly createdAt: Date; readonly id: string } | null
  readonly actor: DispatchListActor
}

export interface DispatchAssignmentView {
  readonly id: string
  readonly orderId: string
  readonly courierId: string | null
  readonly status: DeliveryAssignmentStatus
  readonly createdAt: Date
  readonly assignedAt: Date | null
}

export interface ListDeliveryAssignmentsResult {
  readonly items: readonly DispatchAssignmentView[]
  readonly nextCursor: { readonly createdAt: Date; readonly id: string } | null
  readonly hasMore: boolean
}

@Injectable()
export class ListDeliveryAssignmentsUseCase {
  public constructor(
    @Inject(DELIVERY_ASSIGNMENT_REPOSITORY) private readonly assignments: DeliveryAssignmentRepositoryPort,
    @Inject(DELIVERY_ORDERS_PORT) private readonly orders: DeliveryOrdersPort,
    @Inject(PHARMACY_LOOKUP_PORT) private readonly pharmacies: PharmacyLookupPort,
  ) {}

  public async execute(cmd: ListDeliveryAssignmentsCommand): Promise<ListDeliveryAssignmentsResult> {
    // +1 — определение hasMore без COUNT(*), тот же приём, что courier-earnings.repository.ts.
    const raw = await this.assignments.findByStatuses({ statuses: cmd.statuses, limit: cmd.limit + 1, cursor: cmd.cursor })
    const hasMore = raw.length > cmd.limit
    const page = hasMore ? raw.slice(0, cmd.limit) : raw
    const last = page[page.length - 1]
    // pharmacy_admin: фильтрация после лимита БД (нет join с pharmacies) — страница может вернуть меньше limit.
    const scoped = cmd.actor.role === 'super_admin' ? page : await this.filterByChain(page, cmd.actor.chainId)
    return {
      items: scoped.map(toView),
      nextCursor: hasMore && last !== undefined ? { createdAt: last.toSnapshot().createdAt, id: last.id } : null,
      hasMore,
    }
  }

  // Пакетный запрос: одна выборка pharmacies по всем pharmacyId страницы, вместо findById на каждую строку.
  private async filterByChain(page: readonly DeliveryAssignment[], chainId: string | null): Promise<readonly DeliveryAssignment[]> {
    const contexts = await Promise.all(page.map((assignment) => this.orders.getDeliveryContext(assignment.orderId)))
    const pharmacyIds = [...new Set(contexts.filter((c) => c !== null).map((c) => c.pharmacyId))]
    const chainByPharmacyId = new Map((await this.pharmacies.findByIds(pharmacyIds)).map((p) => [p.id, p.chainId]))
    return page.filter((_, index) => {
      const pharmacyId = contexts[index]?.pharmacyId
      return pharmacyId !== undefined && chainByPharmacyId.get(pharmacyId) === chainId
    })
  }
}

function toView(assignment: DeliveryAssignment): DispatchAssignmentView {
  const snapshot = assignment.toSnapshot()
  return {
    id: assignment.id,
    orderId: assignment.orderId,
    courierId: assignment.courierId,
    status: assignment.status,
    createdAt: snapshot.createdAt,
    assignedAt: snapshot.assignedAt,
  }
}
