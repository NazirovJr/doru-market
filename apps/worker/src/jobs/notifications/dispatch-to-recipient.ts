/**
 * `dispatchToRecipient` (DTJ-370) — ЯДРО диспетчеризации ОДНОГО получателя со стороны apps/worker:
 * `in_app` СИНХРОННО и ПЕРВЫМ (SRS-ADM-084, тот же порядок и та же идемпотентность, что
 * `DispatchNotificationUseCase`/`InAppNotifyProvider`, apps/api), затем — ПЕРВЫЙ по приоритету
 * внешний канал в очередь `notification-dispatch`, остальные — эстафета процессора при
 * исчерпании ретраев (см. JSDoc `apps/api/.../dispatch-notification.use-case.ts`).
 *
 * НЕОБХОДИМОЕ ДУБЛИРОВАНИЕ (не рефакторинг в общий пакет): бизнес-порядок «in_app первым,
 * идемпотентно, потом один внешний канал в очередь» — то же решение, что в
 * `DispatchNotificationUseCase` (apps/api), но apps/worker не может импортировать NestJS-класс
 * apps/api напрямую (depcruise, отдельные TS-проекты монорепо) — только ДАННЫЕ и ЧИСТЫЕ функции
 * общие через `@dorutj/contracts` (`renderTemplateString`/`findMissingTemplateVariables`/матрица).
 */
import {
  findMissingTemplateVariables,
  renderTemplateString,
  type NotificationChannel,
  type NotificationDispatchJobData,
} from '@dorutj/contracts'
import type { NotificationDispatchStorePort } from './notification-dispatch-store.port.js'

const IN_APP_CHANNEL: NotificationChannel = 'in_app'
const KNOWN_LOCALES = ['tj', 'ru', 'en'] as const
const DEFAULT_LOCALE = 'ru'

export interface DispatchToRecipientInput {
  readonly userId: string
  readonly eventType: string
  readonly sourceEventId: string
  /** Полный список каналов матрицы (порядок фолбэка), включая `in_app`. */
  readonly channels: readonly NotificationChannel[]
  readonly variables: Readonly<Record<string, string>>
}

export interface DispatchToRecipientDeps {
  readonly store: NotificationDispatchStorePort
  readonly enqueue: (jobData: NotificationDispatchJobData, jobId: string) => Promise<void>
  readonly logger: { warn: (msg: string) => void; error: (msg: string) => void }
}

export async function dispatchToRecipient(deps: DispatchToRecipientDeps, input: DispatchToRecipientInput): Promise<void> {
  const profile = await deps.store.getUserProfile(input.userId)
  if (profile === null) {
    deps.logger.warn(`dispatch-to-recipient: userId=${input.userId} не найден — пропущен (eventType=${input.eventType}).`)
    return
  }

  const locale = resolveLocale(profile.preferredLocale)
  const brandName = await deps.store.getBrandName(profile.tenantId)
  const variables: Readonly<Record<string, string>> = { ...input.variables, brandName }

  await dispatchInApp({ deps, input, tenantId: profile.tenantId, locale, variables })

  const externalChannels = input.channels.filter((channel) => channel !== IN_APP_CHANNEL)
  if (externalChannels.length === 0) {
    return
  }
  const [firstChannel, ...remainingChannels] = externalChannels as [NotificationChannel, ...NotificationChannel[]]
  await enqueueChannel({ deps, input, tenantId: profile.tenantId, channel: firstChannel, remainingChannels, templateVariables: variables })
}

/** Объект-параметр (C5, `max-params` ≤3) — 5 логически неразделимых полей одного вызова. */
async function dispatchInApp(args: {
  readonly deps: DispatchToRecipientDeps
  readonly input: DispatchToRecipientInput
  readonly tenantId: string
  readonly locale: string
  readonly variables: Readonly<Record<string, string>>
}): Promise<void> {
  const { deps, input, tenantId, locale, variables } = args
  const template = await deps.store.findTemplate(input.eventType, IN_APP_CHANNEL, locale)
  if (template === null) {
    deps.logger.error(`dispatch-to-recipient: нет шаблона (eventType=${input.eventType}, channel=in_app, locale=${locale}) — in_app НЕ создан.`)
    return
  }
  const missing = findMissingTemplateVariables(template.requiredVariables, variables)
  if (missing.length > 0) {
    deps.logger.error(`dispatch-to-recipient: отсутствуют переменные шаблона in_app (${missing.join(', ')}) — in_app НЕ создан.`)
    return
  }
  const body = renderTemplateString(template.body, variables)
  // Идемпотентно (SRS-ADM-057) — `createNotification` перехватывает UNIQUE-конфликт как no-op.
  await deps.store.createNotification({
    userId: input.userId,
    tenantId,
    channel: IN_APP_CHANNEL,
    status: 'sent',
    payload: { body },
    eventType: input.eventType,
    sourceEventId: input.sourceEventId,
  })
}

/** Объект-параметр (C5, `max-params` ≤3) — 6 логически неразделимых полей одной постановки job'а. */
async function enqueueChannel(args: {
  readonly deps: DispatchToRecipientDeps
  readonly input: DispatchToRecipientInput
  readonly tenantId: string
  readonly channel: NotificationChannel
  readonly remainingChannels: readonly NotificationChannel[]
  readonly templateVariables: Readonly<Record<string, string>>
}): Promise<void> {
  const { deps, input, tenantId, channel, remainingChannels, templateVariables } = args
  const record = await deps.store.createNotification({
    userId: input.userId,
    tenantId,
    channel,
    status: 'queued',
    payload: templateVariables,
    eventType: input.eventType,
    sourceEventId: input.sourceEventId,
  })
  if (!record.created) {
    // Строка уже существовала (at-least-once outbox повторно доставил то же событие) — job на
    // этот канал уже был поставлен ранее (или обработан), повторная постановка создала бы дубль
    // отправки внешнему провайдеру (BullMQ jobId-дедупликация ниже — вторая линия защиты, не первая).
    return
  }

  const jobData: NotificationDispatchJobData = {
    notificationId: record.id,
    userId: input.userId,
    tenantId,
    channel,
    eventType: input.eventType,
    sourceEventId: input.sourceEventId,
    remainingChannels,
    templateVariables,
  }
  await deps.enqueue(jobData, record.id)
}

function resolveLocale(rawLocale: string): string {
  return (KNOWN_LOCALES as readonly string[]).includes(rawLocale) ? rawLocale : DEFAULT_LOCALE
}
