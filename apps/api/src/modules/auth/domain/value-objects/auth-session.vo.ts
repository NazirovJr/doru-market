/**
 * `AuthSession` (EP-01, DTJ-024/025, SRS-API-023/025/026/027) — доменное
 * представление материализованной сессии пользователя. Хранит
 * `refreshTokenHash` (НЕ сам refresh — opaque возвращается клиенту ОДИН
 * раз при создании).
 *
 * Чистый VO: конструктор приватный, фабрика `create(...)` (для новых сессий
 * при первом входе) или `restore(...)` (для восстановления из БД —
 * маппинг `AuthSessionRow` → VO, см. Drizzle-репозиторий в
 * `in-memory-auth-sessions.repository.ts`).
 *
 * `familyId` (SRS-DOM-172, DTJ-025) — логическая группа refresh-rotation.
 * При первом входе (DTJ-024) `familyId === id`. При refresh-rotation
 * (DTJ-025) `familyId` сохраняется при ротации refresh-токена.
 *
 * `rotatedAt` (DTJ-025, SRS-API-026) — `null` = текущее звено цепочки
 * (`refresh` валиден, можно ротировать). `NOT NULL` = прошлое звено
 * (refresh уже был использован для ротации; предъявление такого токена
 * триггерит REUSE_DETECTED, `SRS-API-027`).
 *
 * `lastSeenAt` (DTJ-026, SRS-API-030) — `now()` последнего «обращения» к
 * сессии (refresh, list, me). Изначально равен `createdAt`. На каждом
 * `RefreshTokenUseCase.rotate` обновляется. Отдаётся в `GET /auth/sessions`
 * как «когда в последний раз использовали это устройство».
 *
 * `absoluteExpiresAt` фиксируется В МОМЕНТ СОЗДАНИЯ (SRS-API-023: 30 дней),
 * НЕ продлевается при refresh — это «абсолютный» срок жизни refresh-цепочки.
 */
import { type Clock } from '@/shared-kernel/index.js'

/** 30 дней (SRS-API-023, `auth_sessions.absoluteExpiresAt`). */
export const AUTH_SESSION_ABSOLUTE_TTL_DAYS = 30
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const SECONDS_PER_DAY = SECONDS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY

interface AuthSessionProps {
  readonly id: string
  readonly tenantId: string
  readonly userId: string
  readonly familyId: string
  readonly refreshTokenHash: string
  readonly deviceLabel: string
  readonly userAgent: string
  readonly ipAddress: string
  readonly absoluteExpiresAt: Date
  readonly rotatedAt: Date | null
  readonly revokedAt: Date | null
  readonly revokeReason: string | null
  readonly lastSeenAt: Date
  readonly createdAt: Date
}

export class AuthSession {
  private constructor(public readonly props: AuthSessionProps) {}

  get id(): string {
    return this.props.id
  }
  get tenantId(): string {
    return this.props.tenantId
  }
  get userId(): string {
    return this.props.userId
  }
  get familyId(): string {
    return this.props.familyId
  }
  get refreshTokenHash(): string {
    return this.props.refreshTokenHash
  }
  get deviceLabel(): string {
    return this.props.deviceLabel
  }
  get userAgent(): string {
    return this.props.userAgent
  }
  get ipAddress(): string {
    return this.props.ipAddress
  }
  get absoluteExpiresAt(): Date {
    return this.props.absoluteExpiresAt
  }
  get rotatedAt(): Date | null {
    return this.props.rotatedAt
  }
  get revokedAt(): Date | null {
    return this.props.revokedAt
  }
  get revokeReason(): string | null {
    return this.props.revokeReason
  }
  get lastSeenAt(): Date {
    return this.props.lastSeenAt
  }
  get createdAt(): Date {
    return this.props.createdAt
  }

  /**
   * Фабрика новой сессии. `refreshTokenHash` уже посчитан вызывающим кодом
   * (`VerifyOtpUseCase`) — VO не генерирует refresh и не хеширует (C15:
   * хеширование — отдельная инфраструктурная ответственность, не VO).
   *
   * `familyId` равен `id` для первой сессии цепочки (DTJ-024 §3.6).
   * `absoluteExpiresAt = now() + 30 дней` (SRS-API-023).
   * `rotatedAt` изначально `null` — это «корень» цепочки; при refresh-rotation
   * предыдущая строка получает `rotated_at = now()`, а новая создаётся
   * с `rotated_at = null` (DTJ-025 §2.6, `revokeCurrentAndCreateNext`).
   */
  static create(params: {
    readonly id: string
    readonly tenantId: string
    readonly userId: string
    readonly refreshTokenHash: string
    readonly deviceLabel: string
    readonly userAgent: string
    readonly ipAddress: string
    readonly clock: Clock
  }): AuthSession {
    const now = params.clock.now()
    return new AuthSession({
      id: params.id,
      tenantId: params.tenantId,
      userId: params.userId,
      familyId: params.id,
      refreshTokenHash: params.refreshTokenHash,
      deviceLabel: params.deviceLabel,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      absoluteExpiresAt: shiftDateByDays(now, AUTH_SESSION_ABSOLUTE_TTL_DAYS),
      rotatedAt: null,
      revokedAt: null,
      revokeReason: null,
      lastSeenAt: now,
      createdAt: now,
    })
  }

  /**
   * Фабрика продолжения цепочки (DTJ-025 §2.6). `familyId`, `absoluteExpiresAt`
   * и `userId`/deviceLabel/userAgent/ipAddress копируются из предыдущей строки
   * — это «continuation», а не «новая сессия». `rotatedAt: null` — новая
   * строка становится текущим звеном.
   *
   * Используется ТОЛЬКО из `RefreshTokenUseCase` через
   * `AuthSessionsRepository.revokeCurrentAndCreateNext`.
   */
  static rotate(params: {
    readonly id: string
    readonly previous: AuthSession
    readonly refreshTokenHash: string
    readonly clock: Clock
  }): AuthSession {
    const now = params.clock.now()
    return new AuthSession({
      id: params.id,
      tenantId: params.previous.tenantId,
      userId: params.previous.userId,
      familyId: params.previous.familyId,
      refreshTokenHash: params.refreshTokenHash,
      deviceLabel: params.previous.deviceLabel,
      userAgent: params.previous.userAgent,
      ipAddress: params.previous.ipAddress,
      absoluteExpiresAt: params.previous.absoluteExpiresAt,
      rotatedAt: null,
      revokedAt: null,
      revokeReason: null,
      lastSeenAt: now,
      createdAt: now,
    })
  }

  /** Восстановление из БД (для Drizzle-репозитория). */
  static restore(props: AuthSessionProps): AuthSession {
    return new AuthSession(props)
  }

  isRevoked(): boolean {
    return this.props.revokedAt !== null
  }

  /** [DTJ-025] Был ли этот refresh уже использован для ротации? */
  isRotated(): boolean {
    return this.props.rotatedAt !== null
  }

  isExpired(clock: Clock): boolean {
    return clock.now().getTime() > this.props.absoluteExpiresAt.getTime()
  }
}

function shiftDateByDays(base: Date, days: number): Date {
  // eslint-disable-next-line no-restricted-globals -- арифметика над Date, не системные часы (C7, §2.6)
  return new Date(base.getTime() + days * SECONDS_PER_DAY * MS_PER_SECOND)
}
