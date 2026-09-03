/**
 * Агрегат `SupportTicket` (EP-14, DTJ-278, SRS-ADM-053/074/075/076/078). Самостоятельный
 * агрегат (не придаток `OrderDispute`) — живёт весь жизненный цикл `open → in_progress →
 * resolved/closed` БЕЗ участия `OrderDispute` (D-EP11-6, R3-3 за флагом
 * `disputes_workflow_enabled`).
 *
 * Домен — чистый: ноль импортов фреймворка/Drizzle/`Date.now()` (`02` §2.6). Время — параметр
 * `now: Date`, идентификатор — параметр `command.id` (тот же приём, что `OrderReturn`).
 *
 * `is_escrow_blocking` — АРХИТЕКТУРНАЯ гарантия SRS-ADM-053: конструктор `open()` физически НЕ
 * принимает такой параметр (не условная ветка, обнуляющая флаг — самого параметра НЕТ в
 * сигнатуре). Геттер `isEscrowBlocking` типизирован литералом `false` (тот же приём, что
 * `courierReturnFeeApplies: true` в DTJ-272) — невозможно вернуть иное значение без изменения
 * самого типа.
 */
import { ValidationError, type SupportTicketChannel, type SupportTicketStatus } from '@dorutj/contracts'
import type { SupportTicketCategory } from './value-objects/support-ticket-category.vo.js'
import type { SupportTicketMessage } from './support-ticket-message.entity.js'
import { InvalidTicketStatusTransitionError } from './errors/invalid-ticket-status-transition.error.js'
import { TicketAlreadyTerminalError } from './errors/ticket-already-terminal.error.js'

const MS_PER_MINUTE = 60_000
const TERMINAL_STATUS = 'closed'

/** Целевые статусы `transitionTo()` — `'open'` никогда не является целью (нет входящих рёбер, см. `02` §2.4 стиль `order.state-machine.ts`). */
type SupportTicketTransitionTarget = 'in_progress' | 'resolved' | 'closed'

const ALLOWED_TRANSITIONS: Readonly<Record<SupportTicketStatus, readonly SupportTicketTransitionTarget[]>> = {
  open: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  // Переоткрытие (SRS-ADM-076): решение оспорено первым же support_agent-комментарием.
  resolved: ['closed', 'in_progress'],
  closed: [],
}

export interface SupportTicketOpenCommand {
  readonly id: string
  readonly tenantId: string
  readonly orderId?: string
  readonly channel: SupportTicketChannel
  readonly category: SupportTicketCategory
  /** Обязателен для любого канала, кроме `'system_auto'` (SRS-ADM-074). */
  readonly createdBy?: string
  readonly description?: string
  /** `tenantSettings.supportFirstResponseSlaMinutes` — читает use case (DTJ-279), домен не знает про `tenant_settings`. */
  readonly firstResponseSlaMinutes: number
}

export interface SupportTicketSnapshot {
  readonly id: string
  readonly tenantId: string
  readonly orderId: string | null
  readonly channel: SupportTicketChannel
  readonly category: SupportTicketCategory
  readonly status: SupportTicketStatus
  readonly priority: number
  readonly createdBy: string | null
  readonly description: string | null
  readonly firstResponseDueAt: Date | null
  readonly firstRespondedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

export class SupportTicket {
  private _status: SupportTicketStatus
  private _priority: number
  private _firstRespondedAt: Date | null
  private _updatedAt: Date

  readonly id: string
  readonly tenantId: string
  readonly orderId: string | null
  readonly channel: SupportTicketChannel
  readonly category: SupportTicketCategory
  readonly createdBy: string | null
  readonly description: string | null
  readonly firstResponseDueAt: Date | null
  readonly createdAt: Date

  private constructor(snapshot: SupportTicketSnapshot) {
    this.id = snapshot.id
    this.tenantId = snapshot.tenantId
    this.orderId = snapshot.orderId
    this.channel = snapshot.channel
    this.category = snapshot.category
    this.createdBy = snapshot.createdBy
    this.description = snapshot.description
    this.firstResponseDueAt = snapshot.firstResponseDueAt
    this.createdAt = snapshot.createdAt
    this._status = snapshot.status
    this._priority = snapshot.priority
    this._firstRespondedAt = snapshot.firstRespondedAt
    this._updatedAt = snapshot.updatedAt
  }

  /** SRS-ADM-074 — `createdBy` обязателен для любого канала, кроме `system_auto`. */
  static open(command: SupportTicketOpenCommand, now: Date): SupportTicket {
    if (command.channel !== 'system_auto' && !hasNonEmptyValue(command.createdBy)) {
      throw new ValidationError('createdBy is required for non-system_auto channels (SRS-ADM-074)', {
        channel: command.channel,
      })
    }
    return new SupportTicket({
      id: command.id,
      tenantId: command.tenantId,
      orderId: command.orderId ?? null,
      channel: command.channel,
      category: command.category,
      status: 'open',
      priority: 0,
      createdBy: command.createdBy ?? null,
      description: command.description ?? null,
      firstResponseDueAt: shiftDateByMinutes(now, command.firstResponseSlaMinutes),
      firstRespondedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  static restore(snapshot: SupportTicketSnapshot): SupportTicket {
    return new SupportTicket(snapshot)
  }

  get status(): SupportTicketStatus {
    return this._status
  }

  get priority(): number {
    return this._priority
  }

  get firstRespondedAt(): Date | null {
    return this._firstRespondedAt
  }

  get updatedAt(): Date {
    return this._updatedAt
  }

  /**
   * Архитектурная гарантия SRS-ADM-053 (см. JSDoc файла) — литерал `false`, не `boolean`,
   * `readonly`-поле (не геттер — C6-стиль, эквивалент `courierReturnFeeApplies: true` DTJ-272).
   * Если R2/R3 когда-либо введёт `OpenDisputeUseCase`, он РАСШИРИТ (не перепишет) `open()` —
   * текущая сигнатура сознательно не принимает этот параметр, чтобы не оставлять скрытый
   * способ обойти гарантию в R1.
   */
  readonly isEscrowBlocking = false as const

  /**
   * `actorId` принят по буквальной сигнатуре тикета (аудит инициатора перехода), но пока НЕ
   * персистируется отдельной колонкой — `support_tickets` не несёт поля для этого (проверено
   * `11-database-schema.md`/миграция DTJ-278). Зарезервировано для будущей интеграции с
   * `audit_log` (EP-16), см. `domain-errors.ts`/`0034_support_tickets_audit_log.sql`.
   */
  transitionTo(status: SupportTicketTransitionTarget, actorId: string, now: Date): void {
    void actorId
    if (this._status === TERMINAL_STATUS) {
      throw new TicketAlreadyTerminalError(this.id)
    }
    if (!ALLOWED_TRANSITIONS[this._status].includes(status)) {
      throw new InvalidTicketStatusTransitionError(this.id, this._status, status)
    }
    this._status = status
    this._updatedAt = now
  }

  /** Идемпотентно — повторный вызов НЕ перезаписывает уже заполненное более раннее время (SRS-ADM-075). */
  recordFirstResponse(respondedAt: Date): void {
    this._firstRespondedAt ??= respondedAt
  }

  /** Вызывается джобой эскалации просрочки SLA (DTJ-280, вне периметра этой волны), не пользователем напрямую. */
  escalatePriority(): void {
    this._priority += 1
  }

  /**
   * Не мутирует статус, только применяет побочный эффект «первый ответ support_agent»
   * (SRS-ADM-075). `message` создаётся ВНЕ этого метода (`SupportTicketMessage.create()`),
   * этот метод получает уже готовый объект — персистирование самого сообщения — забота
   * репозитория/use case (вне периметра DTJ-278).
   */
  addMessage(message: SupportTicketMessage): void {
    if (message.authorRole === 'support_agent' && this._firstRespondedAt === null) {
      this.recordFirstResponse(message.createdAt)
    }
  }

  toSnapshot(): SupportTicketSnapshot {
    return {
      id: this.id,
      tenantId: this.tenantId,
      orderId: this.orderId,
      channel: this.channel,
      category: this.category,
      status: this._status,
      priority: this._priority,
      createdBy: this.createdBy,
      description: this.description,
      firstResponseDueAt: this.firstResponseDueAt,
      firstRespondedAt: this._firstRespondedAt,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    }
  }
}

function hasNonEmptyValue(value: string | undefined): value is string {
  return value !== undefined && value.length > 0
}

/**
 * Единственное место `new Date()` в этом domain-файле: чистая арифметика над УЖЕ переданным
 * `base` (из порта `Clock` через `now`-параметр use case), не системные часы (тот же приём,
 * что `shiftDateBySeconds` в `modules/auth/domain/value-objects/otp-code.vo.ts`, C7/§2.6).
 */
function shiftDateByMinutes(base: Date, minutes: number): Date {
  // eslint-disable-next-line no-restricted-globals -- чистая арифметика над Date-параметром, не системные часы (см. JSDoc функции).
  return new Date(base.getTime() + minutes * MS_PER_MINUTE)
}
