/**
 * CI-тест полноты матрицы `notification_templates` (DTJ-369, EP-16, SRS-ADM-054, TC-ADM-026).
 *
 * «Ловушка проверяется CI, не глазами ревьюера» (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §6.1): любой
 * пропуск шаблона (забыли `en`-версию нового события, не завели канал для события) обнаруживается
 * ЗДЕСЬ, до деплоя — не в рантайме при реальной отправке (падение рендера на живом пользователе).
 *
 * `EVENT_CHANNEL_MATRIX` ниже — КОНСТАНТА-КОПИЯ таблицы `docs/spec/27-module-admin-moderation-
 * onboarding.md` §6.1 (SRS-ADM-052), НЕ импортирована из кода сида (`db/seed/notification-
 * templates/`) — намеренно: если бы тест переиспользовал ту же структуру данных, что и сид,
 * ошибка одного автора («забыл канал в обоих местах») осталась бы незамеченной. Независимая
 * копия — единственный способ поймать реальный пропуск. Риск: если архитектор добавит 15-е
 * событие в будущей редакции документа 27, этот тест НЕ поймает это автоматически (нет единого
 * источника событие↔тест, зафиксировано в «Рисках» тикета DTJ-369) — при правке §6.1 документа
 * ОБЯЗАТЕЛЬНА ручная сверка этой константы.
 *
 * Тест-себя-теста (АС2 тикета, «ловушка, которая перестала ловить, молчит об этом», риск-раздел
 * тест-плана): `describe('мета-тест...')` искусственно удаляет одну строку сида и проверяет, что
 * `findMissingTemplateCombinations` ловит именно её — не абстрактный «тест упал», а точная тройка
 * `(event_type, channel, locale)` в сообщении (TC-ADM-026).
 *
 * ЧИСТО-ФАЙЛОВЫЙ/ЧИСТО-ДАННЫЙ тест (см. `tests/arch/vitest.config.ts`) — импортирует ТОЛЬКО
 * pure-data модуль сида (`db/seed/notification-templates/index.ts`), без Drizzle/pg, без БД.
 */
import { describe, expect, it } from 'vitest'
// eslint-disable-next-line no-restricted-imports -- C16 требует алиас @/..., но этот файл живёт в tests/arch (у tests/arch/tsconfig.json нет @/-алиаса, он есть только у apps/api/tsconfig.json) — ticket DTJ-369 требует путь именно tests/arch/notification-templates-completeness.spec.ts, относительный импорт pure-data сида apps/api — единственный вариант без отдельной alias-инфраструктуры ради одного файла.
import {
  findMissingTemplateCombinations,
  formatMissingCombination,
  NOTIFICATION_TEMPLATE_SEED_ROWS,
  type NotificationEventChannelMatrixEntry,
  type NotificationTemplateSeedRow,
} from '../../apps/api/src/db/seed/notification-templates/index.js'

const LOCALES = ['tj', 'ru', 'en'] as const

/**
 * Копия таблицы SRS-ADM-052 §6.1 (`docs/spec/27-module-admin-moderation-onboarding.md`, строки
 * 585-599 на момент написания теста). 15 строк матрицы → 15 `event_type` в `notification_templates`.
 * `in_app` добавлен КАЖДОМУ событию явно (матрица: «in_app — гарантированный минимум, всегда
 * пишется, даже если остальные каналы недоступны») — включая `ops.sla_breached`, где он назван
 * в самой строке матрицы.
 */
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
    // brandName ВСЕГДА плейсхолдер {{brandName}} — буквальное "DoruTJ" в теле/subject запрещено.
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
