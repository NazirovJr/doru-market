/**
 * `SupportTicketMessage` (EP-14, DTJ-278) — дочерняя сущность агрегата `SupportTicket`, НЕ
 * корень агрегата (`10-domain-model.md` §«Value Objects»/сущности): создаётся и читается
 * ТОЛЬКО через `SupportTicket.addMessage()`/репозиторий, никогда напрямую use case'ом в обход
 * родителя.
 *
 * Домен — чистый: `now`/`id` приходят параметрами (тот же приём, что `OrderReturn`/`Order`).
 */
import { ValidationError, type UserRole } from '@dorutj/contracts'

export interface SupportTicketMessageCreateProps {
  readonly id: string
  readonly ticketId: string
  readonly authorUserId: string | null
  readonly authorRole: UserRole
  readonly body: string
}

export interface SupportTicketMessageSnapshot {
  readonly id: string
  readonly ticketId: string
  readonly authorUserId: string | null
  readonly authorRole: UserRole
  readonly body: string
  readonly createdAt: Date
}

export class SupportTicketMessage {
  readonly id: string
  readonly ticketId: string
  readonly authorUserId: string | null
  readonly authorRole: UserRole
  readonly body: string
  readonly createdAt: Date

  private constructor(snapshot: SupportTicketMessageSnapshot) {
    this.id = snapshot.id
    this.ticketId = snapshot.ticketId
    this.authorUserId = snapshot.authorUserId
    this.authorRole = snapshot.authorRole
    this.body = snapshot.body
    this.createdAt = snapshot.createdAt
  }

  static create(props: SupportTicketMessageCreateProps, now: Date): SupportTicketMessage {
    if (props.body.trim().length === 0) {
      throw new ValidationError('SupportTicketMessage body must not be empty', { ticketId: props.ticketId })
    }
    return new SupportTicketMessage({ ...props, createdAt: now })
  }

  static restore(snapshot: SupportTicketMessageSnapshot): SupportTicketMessage {
    return new SupportTicketMessage(snapshot)
  }

  toSnapshot(): SupportTicketMessageSnapshot {
    return {
      id: this.id,
      ticketId: this.ticketId,
      authorUserId: this.authorUserId,
      authorRole: this.authorRole,
      body: this.body,
      createdAt: this.createdAt,
    }
  }
}
