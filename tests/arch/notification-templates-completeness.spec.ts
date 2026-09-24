/**
 * Матрица (event_type, channels) ниже — теперь ПЕРЕИСПОЛЬЗУЕТ единственный источник
 * `notification-event-matrix.ts` (DTJ-370), а НЕ независимый литерал: DTJ-370 сделал его
 * общим файлом, устранив риск рассинхронизации (DTJ-369 «Риски»). Независимость сохраняется
 * там, где она содержательна — НЕ импортирована из СИДА (`NOTIFICATION_TEMPLATE_SEED_ROWS`):
 * иначе одна и та же ошибка автора шаблонов осталась бы незамеченной.
 */
import { describe, expect, it } from 'vitest'
// eslint-disable-next-line no-restricted-imports -- tests/arch без алиаса @/
import {
  findMissingTemplateCombinations,
  formatMissingCombination,
  NOTIFICATION_TEMPLATE_SEED_ROWS,
  type NotificationEventChannelMatrixEntry,
  type NotificationTemplateSeedRow,
} from '../../apps/api/src/db/seed/notification-templates/index.js'
// eslint-disable-next-line no-restricted-imports -- tests/arch без алиаса @/
import { NOTIFICATION_EVENT_MATRIX } from '../../apps/api/src/modules/notifications/application/notification-event-matrix.js'

const LOCALES = ['tj', 'ru', 'en'] as const

const EVENT_CHANNEL_MATRIX: readonly NotificationEventChannelMatrixEntry[] = NOTIFICATION_EVENT_MATRIX.map((entry) => ({
  eventType: entry.eventType,
  channels: entry.channels,
}))

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
