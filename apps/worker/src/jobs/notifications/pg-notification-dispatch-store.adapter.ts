import { Inject, Injectable } from '@nestjs/common'
import type { Pool } from 'pg'
import type { NotificationChannel } from '@dorutj/contracts'
import { NOTIFICATIONS_DB_POOL } from './notification-dispatch.constants.js'
import type {
  CreateNotificationRowInput,
  CreateNotificationRowResult,
  NotificationDispatchStorePort,
  WorkerNotificationTemplate,
  WorkerUserProfile,
} from './notification-dispatch-store.port.js'

const GET_USER_PROFILE_QUERY = `
  SELECT tenant_id, telegram_chat_id, preferred_locale
  FROM users
  WHERE id = $1 AND deleted_at IS NULL
`

const GET_BRAND_NAME_QUERY = `SELECT brand_name FROM tenants WHERE id = $1`

const FIND_TEMPLATE_QUERY = `
  SELECT subject, body, variables_schema
  FROM notification_templates
  WHERE event_type = $1 AND channel = $2 AND locale = $3
`

const CREATE_NOTIFICATION_QUERY = `
  INSERT INTO notifications (user_id, tenant_id, channel, status, payload, event_type, source_event_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  ON CONFLICT (user_id, channel, source_event_id) DO NOTHING
  RETURNING id
`

const FIND_EXISTING_NOTIFICATION_QUERY = `
  SELECT id FROM notifications WHERE user_id = $1 AND channel = $2 AND source_event_id = $3
`

const MARK_NOTIFICATION_RESULT_QUERY = `
  UPDATE notifications
  SET status = $2, failed_reason = $3, sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END
  WHERE id = $1
`

interface UserProfileRow {
  readonly tenant_id: string
  readonly telegram_chat_id: string | null
  readonly preferred_locale: string
}

interface TemplateRow {
  readonly subject: string | null
  readonly body: string
  readonly variables_schema: { readonly required?: readonly string[] } | null
}

@Injectable()
export class PgNotificationDispatchStoreAdapter implements NotificationDispatchStorePort {
  public constructor(@Inject(NOTIFICATIONS_DB_POOL) private readonly pool: Pool) {}

  public async getUserProfile(userId: string): Promise<WorkerUserProfile | null> {
    const result = await this.pool.query<UserProfileRow>(GET_USER_PROFILE_QUERY, [userId])
    const row = result.rows[0]
    if (row === undefined) {
      return null
    }
    return {
      tenantId: row.tenant_id,
      telegramChatId: row.telegram_chat_id === null ? null : BigInt(row.telegram_chat_id),
      preferredLocale: row.preferred_locale,
    }
  }

  public async getBrandName(tenantId: string): Promise<string> {
    const result = await this.pool.query<{ readonly brand_name: string }>(GET_BRAND_NAME_QUERY, [tenantId])
    return result.rows[0]?.brand_name ?? ''
  }

  public async findTemplate(eventType: string, channel: NotificationChannel, locale: string): Promise<WorkerNotificationTemplate | null> {
    const result = await this.pool.query<TemplateRow>(FIND_TEMPLATE_QUERY, [eventType, channel, locale])
    const row = result.rows[0]
    if (row === undefined) {
      return null
    }
    return { subject: row.subject, body: row.body, requiredVariables: row.variables_schema?.required ?? [] }
  }

  public async createNotification(input: CreateNotificationRowInput): Promise<CreateNotificationRowResult> {
    const inserted = await this.pool.query<{ readonly id: string }>(CREATE_NOTIFICATION_QUERY, [
      input.userId,
      input.tenantId,
      input.channel,
      input.status,
      JSON.stringify(input.payload),
      input.eventType,
      input.sourceEventId,
    ])
    const insertedId = inserted.rows[0]?.id
    if (insertedId !== undefined) {
      return { id: insertedId, created: true }
    }
    // UNIQUE-конфликт (SRS-ADM-057) — строка уже существует (at-least-once доставка outbox).
    const existing = await this.pool.query<{ readonly id: string }>(FIND_EXISTING_NOTIFICATION_QUERY, [
      input.userId,
      input.channel,
      input.sourceEventId,
    ])
    const existingId = existing.rows[0]?.id
    if (existingId === undefined) {
      throw new Error(
        `PgNotificationDispatchStoreAdapter.createNotification(): UNIQUE-конфликт (userId=${input.userId}, ` +
          `channel=${input.channel}, sourceEventId=${input.sourceEventId}), но строка не найдена — конкурентное удаление?`,
      )
    }
    return { id: existingId, created: false }
  }

  public async markNotificationResult(id: string, status: 'sent' | 'failed', failedReason?: string): Promise<void> {
    await this.pool.query(MARK_NOTIFICATION_RESULT_QUERY, [id, status, failedReason ?? null])
  }
}
