/**
 * `ListSessionsUseCase` (EP-01, DTJ-026, SRS-API-030) — список активных
 * устройств пользователя.
 *
 * Контракт (DTJ-026 §3.3):
 *   - Читает АКТИВНЫЕ сессии (`revoked_at IS NULL AND rotated_at IS NULL`,
 *     см. обоснование в DTJ-015 «одна строка на устройство»).
 *   - Маппит `ipAddress` через `maskIpAddress()` хелпер (SRS-API-149).
 *   - `isCurrent = (row.id === currentSessionId)` — определяется по
 *     `sessionId` из JWT (НЕ по `refreshToken`).
 *   - Возвращает `SessionSummary[]`, отсортированный по `lastSeenAt DESC`
 *     (самые свежие — сверху, для UI «активные сверху»).
 *
 * Маскирование IP (SRS-API-149) — PRESENTATION-преобразование, не
 * бизнес-правило. Тикет §3.3 явно допускает вызов из application для
 * формирования DTO. Альтернатива (вынести в presentation-маппер) —
 * допустима, но потребовала бы двойного обхода массива; применено
 * инлайном для минимизации LOC.
 *
 * Архитектура (C1, C5, C17, Ж2, Ж8):
 *   - `execute()` ≤20 LOC, делегирует `toSummary`.
 *   - 1 DI-инъекция (только `AuthSessionsRepository`).
 *   - Сортировка через `Array.prototype.sort` (immutable copy, не мутирует
 *     `readonly` результат репозитория).
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  AUTH_SESSIONS_REPOSITORY,
  type AuthSessionsRepository,
} from '@/modules/auth/application/ports/auth-sessions.repository.port.js'
import { type AuthSession } from '@/modules/auth/domain/value-objects/auth-session.vo.js'
import { maskIpAddress } from '@/modules/auth/application/utilities/mask-ip-address.js'

export interface SessionSummary {
  readonly id: string
  readonly deviceLabel: string
  /** [DTJ-026, SRS-API-149] IP с маскированным последним октетом. */
  readonly ipAddress: string
  readonly userAgent: string
  readonly lastSeenAt: Date
  readonly createdAt: Date
  readonly isCurrent: boolean
}

export interface ListSessionsInput {
  readonly userId: string
  /** Из `@CurrentUser().sessionId` (JWT claim, DTJ-022). */
  readonly currentSessionId: string
}

@Injectable()
export class ListSessionsUseCase {
  constructor(
    @Inject(AUTH_SESSIONS_REPOSITORY) private readonly authSessions: AuthSessionsRepository,
  ) {}

  async execute(input: ListSessionsInput): Promise<readonly SessionSummary[]> {
    const now = new Date()
    const sessions = await this.authSessions.findActiveByUserId(input.userId, now)
    // Сортировка по lastSeenAt DESC — самые свежие сверху (для UI).
    // `.slice()` — копия, не мутируем `readonly`-массив из репозитория.
    const sorted = sessions.slice().sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    return sorted.map((session) => this.toSummary(session, input.currentSessionId))
  }

  private toSummary(session: AuthSession, currentSessionId: string): SessionSummary {
    return {
      id: session.id,
      deviceLabel: session.deviceLabel,
      ipAddress: maskIpAddress(session.ipAddress),
      userAgent: session.userAgent,
      lastSeenAt: session.lastSeenAt,
      createdAt: session.createdAt,
      isCurrent: session.id === currentSessionId,
    }
  }
}
