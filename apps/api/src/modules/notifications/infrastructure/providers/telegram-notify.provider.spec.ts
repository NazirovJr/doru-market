import { afterEach, describe, expect, it, vi } from 'vitest'
import { type AppConfigService } from '@/config/app-config.service.js'
import { type IdentityFacadePort, type NotificationRecipientProfile } from '@/modules/notifications/application/ports/identity-facade.port.js'
import { TelegramNotifyProvider } from './telegram-notify.provider.js'

function stubIdentityFacade(profile: NotificationRecipientProfile | null): IdentityFacadePort {
  return { getRecipientProfile: vi.fn().mockResolvedValue(profile) }
}

/** Тот же приём, что `StubConfig` в `telegram-auth.use-case.spec.ts` (EP-01): узкий `Pick`, каст через `unknown` (C7 — без `any`). */
class StubConfig implements Pick<AppConfigService, 'telegramBotTokenNeutral'> {
  public constructor(public telegramBotTokenNeutral: string | undefined) {}
}

function stubConfig(botToken: string | undefined): AppConfigService {
  return new StubConfig(botToken) as unknown as AppConfigService
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('TelegramNotifyProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('критерий приёмки 2 DTJ-368: без telegramChatId — { success: false }, БЕЗ сетевого вызова', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const identityFacade = stubIdentityFacade({ tenantId: 'tenant-1', telegramChatId: null, preferredLocale: 'ru' })
    const provider = new TelegramNotifyProvider(identityFacade, stubConfig('bot-token'))

    const result = await provider.send({ userId: 'user-1', channel: 'telegram', body: 'привет' })

    expect(result).toEqual({ success: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('пользователь не найден — { success: false }, БЕЗ сетевого вызова', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const identityFacade = stubIdentityFacade(null)
    const provider = new TelegramNotifyProvider(identityFacade, stubConfig('bot-token'))

    const result = await provider.send({ userId: 'user-missing', channel: 'telegram', body: 'привет' })

    expect(result).toEqual({ success: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('TELEGRAM_BOT_TOKEN_NEUTRAL не настроен — { success: false }, БЕЗ сетевого вызова', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const identityFacade = stubIdentityFacade({ tenantId: 'tenant-1', telegramChatId: 555n, preferredLocale: 'ru' })
    const provider = new TelegramNotifyProvider(identityFacade, stubConfig(undefined))

    const result = await provider.send({ userId: 'user-1', channel: 'telegram', body: 'привет' })

    expect(result).toEqual({ success: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('наличие chatId — вызывает Bot API sendMessage с корректным chat_id и текстом', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, result: { message_id: 42 } }))
    vi.stubGlobal('fetch', fetchMock)
    const identityFacade = stubIdentityFacade({ tenantId: 'tenant-1', telegramChatId: 987654321n, preferredLocale: 'ru' })
    const provider = new TelegramNotifyProvider(identityFacade, stubConfig('test-bot-token'))

    const result = await provider.send({ userId: 'user-1', channel: 'telegram', subject: 'Заказ №1', body: 'Готов к выдаче' })

    expect(result).toEqual({ success: true, providerMessageId: '42' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/bottest-bot-token/sendMessage')
    const body: unknown = JSON.parse(init.body as string)
    expect(body).toEqual({ chat_id: '987654321', text: 'Заказ №1\n\nГотов к выдаче' })
  })

  it('Bot API возвращает ok: false — { success: false }, не бросает', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { ok: false, description: 'chat not found' })))
    const identityFacade = stubIdentityFacade({ tenantId: 'tenant-1', telegramChatId: 1n, preferredLocale: 'ru' })
    const provider = new TelegramNotifyProvider(identityFacade, stubConfig('test-bot-token'))

    const result = await provider.send({ userId: 'user-1', channel: 'telegram', body: 'привет' })

    expect(result).toEqual({ success: false })
  })

  it('сетевая ошибка fetch — { success: false }, не бросает наружу', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const identityFacade = stubIdentityFacade({ tenantId: 'tenant-1', telegramChatId: 1n, preferredLocale: 'ru' })
    const provider = new TelegramNotifyProvider(identityFacade, stubConfig('test-bot-token'))

    await expect(provider.send({ userId: 'user-1', channel: 'telegram', body: 'привет' })).resolves.toEqual({ success: false })
  })
})
