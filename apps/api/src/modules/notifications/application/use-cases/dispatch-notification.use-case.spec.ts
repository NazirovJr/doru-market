/** in_app создаётся синхронно и первым (проверка порядка вызовов, не только состояния); UNIQUE-конфликт — ответственность репозитория/провайдера. */
import { describe, expect, it, vi } from 'vitest'
import type { IdentityFacadePort, NotificationRecipientProfile } from '../ports/identity-facade.port.js'
import type { CreateNotificationInput, NotificationRecord, NotificationsRepositoryPort } from '../ports/notifications-repository.port.js'
import type { NotificationTemplatesRepositoryPort } from '../ports/notification-templates-repository.port.js'
import type { NotifyProviderPort, NotifySendResult } from '../ports/notify-provider.port.js'
import type { NotificationDispatchQueuePort } from '../ports/notification-dispatch-queue.port.js'
import type { TenantSettingsRepositoryPort } from '@/modules/tenancy/index.js'
import { NotificationTemplate } from '../../domain/notification-template.entity.js'
import { DispatchNotificationUseCase, type DispatchNotificationCommand } from './dispatch-notification.use-case.js'

const NOW = new Date('2026-01-01T00:00:00Z')

function template(): NotificationTemplate {
  return NotificationTemplate.restore({
    id: 'tpl-1',
    eventType: 'order.paid',
    channel: 'in_app',
    locale: 'ru',
    subject: null,
    body: '{{brandName}}: заказ {{orderNumber}} оплачен',
    variablesSchema: { required: ['brandName', 'orderNumber'] },
    updatedAt: NOW,
  })
}

function fakeRecord(input: CreateNotificationInput): NotificationRecord {
  return { ...input, id: 'notification-1', sentAt: null, failedReason: null, createdAt: NOW }
}

interface Spies {
  readonly getRecipientProfile: ReturnType<typeof vi.fn>
  readonly create: ReturnType<typeof vi.fn>
  readonly findByEventChannelLocale: ReturnType<typeof vi.fn>
  readonly send: ReturnType<typeof vi.fn>
  readonly findByTenantId: ReturnType<typeof vi.fn>
  readonly enqueue: ReturnType<typeof vi.fn>
}

interface Harness {
  readonly useCase: DispatchNotificationUseCase
  readonly spies: Spies
  readonly callOrder: string[]
}

function buildHarness(options?: {
  readonly profile?: NotificationRecipientProfile | null
  readonly inAppSendResult?: NotifySendResult
  readonly template?: NotificationTemplate | null
  readonly brandNameSettings?: { readonly brandName: string } | null
}): Harness {
  const callOrder: string[] = []
  const profile: NotificationRecipientProfile | null =
    options?.profile === undefined ? { tenantId: '11111111-1111-4111-8111-111111111111', telegramChatId: 555n, preferredLocale: 'ru' } : options.profile

  const getRecipientProfile = vi.fn().mockResolvedValue(profile)
  const identityFacade: IdentityFacadePort = { getRecipientProfile }

  const create = vi.fn().mockImplementation((input: CreateNotificationInput) => {
    callOrder.push('notifications.create')
    return Promise.resolve(fakeRecord(input))
  })
  const notificationsRepository: NotificationsRepositoryPort = { create, list: vi.fn() }

  const findByEventChannelLocale = vi.fn().mockResolvedValue(options?.template === undefined ? template() : options.template)
  const templatesRepository: NotificationTemplatesRepositoryPort = { findByEventChannelLocale }

  const send = vi.fn().mockImplementation(() => {
    callOrder.push('inAppProvider.send')
    return Promise.resolve(options?.inAppSendResult ?? { success: true, providerMessageId: 'notification-1' })
  })
  const inAppProvider: NotifyProviderPort = { send }

  const findByTenantId = vi
    .fn()
    .mockResolvedValue(options?.brandNameSettings === undefined ? { brandName: 'Апрель' } : options.brandNameSettings)
  const tenantSettingsRepository: TenantSettingsRepositoryPort = { findByTenantId, save: vi.fn() }

  const enqueue = vi.fn().mockImplementation(() => {
    callOrder.push('dispatchQueue.enqueue')
    return Promise.resolve()
  })
  const dispatchQueue: NotificationDispatchQueuePort = { enqueue }

  const useCase = new DispatchNotificationUseCase(
    identityFacade,
    notificationsRepository,
    templatesRepository,
    inAppProvider,
    tenantSettingsRepository,
    dispatchQueue,
  )

  return { useCase, spies: { getRecipientProfile, create, findByEventChannelLocale, send, findByTenantId, enqueue }, callOrder }
}

function command(overrides?: Partial<DispatchNotificationCommand>): DispatchNotificationCommand {
  return {
    userId: 'user-1',
    eventType: 'order.paid',
    sourceEventId: 'evt-1',
    channels: ['telegram', 'sms', 'web_push', 'in_app'],
    templateVariables: { orderNumber: '42' },
    ...overrides,
  }
}

describe('DispatchNotificationUseCase (DTJ-370)', () => {
  it('критерий приёмки 3 / DoD: in_app вызывается ДО постановки внешнего канала в очередь', async () => {
    const h = buildHarness()

    await h.useCase.execute(command())

    expect(h.callOrder.indexOf('inAppProvider.send')).toBeLessThan(h.callOrder.indexOf('dispatchQueue.enqueue'))
  })

  it('АС3: in_app "недоставлен" (success:false) — постановка внешнего канала в очередь ВСЁ РАВНО происходит (не блокируется результатом in_app)', async () => {
    const h = buildHarness({ inAppSendResult: { success: false } })

    const result = await h.useCase.execute(command())

    expect(result.inAppDelivered).toBe(false)
    expect(result.queuedChannel).toBe('telegram')
    expect(h.spies.enqueue).toHaveBeenCalledOnce()
  })

  it('ставит в очередь ТОЛЬКО первый по приоритету внешний канал, remainingChannels — остальные без in_app', async () => {
    const h = buildHarness()

    await h.useCase.execute(command({ channels: ['telegram', 'sms', 'web_push', 'in_app'] }))

    expect(h.spies.enqueue).toHaveBeenCalledExactlyOnceWith(
      'telegram',
      expect.objectContaining({ remainingChannels: ['sms', 'web_push'] }),
      'notification-1',
    )
  })

  it('матрица без внешних каналов (только in_app) — очередь не вызывается, queuedChannel=null', async () => {
    const h = buildHarness()

    const result = await h.useCase.execute(command({ channels: ['in_app'] }))

    expect(result.queuedChannel).toBeNull()
    expect(h.spies.enqueue).not.toHaveBeenCalled()
  })

  it('пользователь не найден — ничего не диспетчеризуется (ни in_app, ни очередь)', async () => {
    const h = buildHarness({ profile: null })

    const result = await h.useCase.execute(command())

    expect(result).toEqual({ inAppDelivered: false, queuedChannel: null })
    expect(h.spies.send).not.toHaveBeenCalled()
    expect(h.spies.enqueue).not.toHaveBeenCalled()
  })

  it('рендер получает brandName из tenant_settings + переданные templateVariables (SRS-ADM-056)', async () => {
    const h = buildHarness()

    await h.useCase.execute(command())

    expect(h.spies.send).toHaveBeenCalledExactlyOnceWith(
      'user-1',
      'in_app',
      { body: 'Апрель: заказ 42 оплачен' },
      { eventType: 'order.paid', sourceEventId: 'evt-1' },
    )
  })

  it('brandName не найден (tenant_settings отсутствуют) — используется пустая строка, не бросает', async () => {
    const h = buildHarness({ brandNameSettings: null })

    await expect(h.useCase.execute(command({ templateVariables: { orderNumber: '42' } }))).resolves.toBeDefined()
  })

  it('невалидная preferredLocale — фолбэк на "ru", не бросает', async () => {
    const h = buildHarness({ profile: { tenantId: '11111111-1111-4111-8111-111111111111', telegramChatId: null, preferredLocale: 'xx' } })

    await h.useCase.execute(command())

    expect(h.spies.findByEventChannelLocale).toHaveBeenCalledExactlyOnceWith('order.paid', 'in_app', 'ru')
  })

  it('нет шаблона in_app для (eventType, locale) — не бросает, in_app считается недоставленным, внешний канал всё равно ставится', async () => {
    const h = buildHarness({ template: null })

    const result = await h.useCase.execute(command())

    expect(result.inAppDelivered).toBe(false)
    expect(h.spies.send).not.toHaveBeenCalled()
    expect(h.spies.enqueue).toHaveBeenCalledOnce()
  })
})
