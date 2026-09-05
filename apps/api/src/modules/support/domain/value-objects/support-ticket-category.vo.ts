/**
 * `SupportTicketCategory` VO (EP-14, DTJ-278, `10-domain-model.md` §«Value Objects»).
 *
 * Обёртка над enum `support_ticket_category` (`db/schema/enums.schema.ts`
 * `supportTicketCategoryEnum`, уже создан миграцией `0034_support_tickets_audit_log.sql`).
 * `parse()` возвращает `Result<SupportTicketCategory, ValidationError>` — тот же стиль, что
 * `ReturnReason.parse()` (`modules/returns`, DTJ-271): невалидная категория — ожидаемый
 * пользовательский сценарий, не программная ошибка.
 */
import { ok, err, type Result } from '@dorutj/domain-kernel'
import {
  ValidationError,
  SUPPORT_TICKET_CATEGORY_VALUES,
  type SupportTicketCategory as SupportTicketCategoryValue,
} from '@dorutj/contracts'

const CATEGORY_VALUES_SET: readonly string[] = SUPPORT_TICKET_CATEGORY_VALUES

/**
 * SRS-DISP-001 / `21-module-orders-payments-escrow.md` §8.1 — категории, которые в ПОЛНОМ
 * воркфлоу спора (R3, `disputes_workflow_enabled`) обычно порождают `OrderDispute`. В R1 этот
 * метод — ТОЛЬКО информационное отображение в UI («эта категория обычно эскроу-блокирующая»),
 * НЕ используется для реального создания `OrderDispute` (домен `SupportTicket.open()` физически
 * не принимает `isEscrowBlocking`, см. `support-ticket.entity.ts`).
 */
const ESCROW_BLOCKING_ELIGIBLE_CATEGORIES: ReadonlySet<string> = new Set([
  'order_not_received',
  'payment_issue',
  'order_item_damaged_or_expired',
  'order_quality_defect',
])

export class SupportTicketCategory {
  private constructor(readonly value: SupportTicketCategoryValue) {}

  static parse(raw: string): Result<SupportTicketCategory, ValidationError> {
    if (typeof raw !== 'string' || !CATEGORY_VALUES_SET.includes(raw)) {
      return err(new ValidationError('Invalid support ticket category', { field: 'category', received: raw }))
    }
    return ok(new SupportTicketCategory(raw as SupportTicketCategoryValue))
  }

  static fromTrusted(value: SupportTicketCategoryValue): SupportTicketCategory {
    return new SupportTicketCategory(value)
  }

  isEscrowBlockingEligible(): boolean {
    return ESCROW_BLOCKING_ELIGIBLE_CATEGORIES.has(this.value)
  }

  equals(other: SupportTicketCategory): boolean {
    return this.value === other.value
  }

  toString(): string {
    return this.value
  }
}
