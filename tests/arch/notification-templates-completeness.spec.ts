/** Матрица ниже — независимая копия SRS-ADM-052, не импортирована из сида: иначе одна и та же ошибка автора осталась бы незамеченной. */
import { describe, expect, it } from 'vitest'
// eslint-disable-next-line no-restricted-imports -- tests/arch без алиаса @/
import {
  findMissingTemplateCombinations,
  formatMissingCombination,
  NOTIFICATION_TEMPLATE_SEED_ROWS,
  type NotificationEventChannelMatrixEntry,
  type NotificationTemplateSeedRow,
} from '../../apps/api/src/db/seed/notification-templates/index.js'

const LOCALES = ['tj', 'ru', 'en'] as const

const EVENT_CHANNEL_MATRIX: readonly NotificationEventChannelMatrixEntry[] = [
  { eventType: 'order.paid', channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'order.processing_started', channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'order.courier_assigned', channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'order.delivered', channels: ['telegram', 'sms', 'in_app'] },
  { eventType: 'order.cancelled', channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'order.refunded', channels: ['telegram', 'sms', 'in_app'] },
  { eventType: 'payout.status_changed', channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'prescription.needs_clarification', channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'prescription.decision', channels: ['telegram', 'in_app'] },
  { eventType: 'inventory.sync_errors', channels: ['telegram', 'web_push', 'in_app'] },
  { eventType: 'moderation.queue_digest', channels: ['telegram', 'in_app'] },
  { eventType: 'onboarding.license_expiring', channels: ['telegram', 'sms', 'web_push', 'in_app'] },
  { eventType: 'onboarding.suspended', channels: ['telegram', 'sms', 'in_app'] },
  { eventType: 'ops.sla_breached', channels: ['web_push', 'in_app'] },
  { eventType: 'billing.invoice_overdue', channels: ['telegram', 'sms', 'in_app'] },
]

describe('notification_templates — полнота матрицы SRS-ADM-052 (DTJ-369, TC-ADM-026)', () => {
  it('матрица содержит ровно 15 event_type (сверка с «Что сделать» тикета)', () => {
    expect(EVENT_CHANNEL_MATRIX.length).toBe(15)
  })

  it('сид непуст (защита от тривиально зелёного теста на пустых данных)', () => {
    expect(NOTIFICATION_TEMPLATE_SEED_ROWS.length).toBeGreaterThan(0)
  })

  it('каждая (event_type, channel) из матрицы имеет строку на ВСЕХ трёх locale', () => {
    const missing = findMissingTemplateCombinations(NOTIFICATION_TEMPLATE_SEED_ROWS, EVENT_CHANNEL_MATRIX, LOCALES)
    expect(missing.map(formatMissingCombination), 'Отсутствуют шаблоны: ' + missing.map(formatMissingCombination).join(', ')).toEqual([])
  })

  it('ни одна строка сида не содержит буквальной строки бренда (DoD DTJ-369, SRS-ADM-056)', () => {
    const offenders = NOTIFICATION_TEMPLATE_SEED_ROWS.filter(
      (row) => row.body.includes('DoruTJ') || (row.subject?.includes('DoruTJ') ?? false),
    )
    expect(offenders, JSON.stringify(offenders)).toEqual([])
  })

  it('каждая строка сида требует brandName в variablesSchema (SRS-ADM-056)', () => {
    const offenders = NOTIFICATION_TEMPLATE_SEED_ROWS.filter((row) => !row.variablesSchema.required.includes('brandName'))
    expect(offenders, JSON.stringify(offenders)).toEqual([])
  })

  describe('мета-тест: ловушка ловит собственное отсутствие (АС2 тикета, «02» §6.1)', () => {
    it('удаление одной строки сида (тестовая фикстура) — тест ПАДАЕТ с точной тройкой', () => {
      const withoutOneRow = removeOneRow(NOTIFICATION_TEMPLATE_SEED_ROWS, {
        eventType: 'order.paid',
        channel: 'telegram',
        locale: 'en',
      })
      const missing = findMissingTemplateCombinations(withoutOneRow, EVENT_CHANNEL_MATRIX, LOCALES)
      expect(missing).toEqual([{ eventType: 'order.paid', channel: 'telegram', locale: 'en' }])
      expect(formatMissingCombination(missing[0]!)).toBe('(event_type="order.paid", channel="telegram", locale="en")')
    })

    it('если ловушка перестанет ловить — этот тест сломается первым (пустой matrix даёт 0 пропусков)', () => {
      const missing = findMissingTemplateCombinations(NOTIFICATION_TEMPLATE_SEED_ROWS, [], LOCALES)
      expect(missing).toEqual([])
    })
  })
})

interface RowKey {
  readonly eventType: string
  readonly channel: string
  readonly locale: string
}

function removeOneRow(rows: readonly NotificationTemplateSeedRow[], key: RowKey): readonly NotificationTemplateSeedRow[] {
  return rows.filter((row) => !(row.eventType === key.eventType && row.channel === key.channel && row.locale === key.locale))
}
