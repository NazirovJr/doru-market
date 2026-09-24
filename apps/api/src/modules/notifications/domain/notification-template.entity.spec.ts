import { describe, expect, it } from 'vitest'
import {
  InvalidTemplateSubjectChannelError,
  MissingTemplateVariableError,
  NotificationTemplate,
  type NotificationTemplateCreateCommand,
} from './notification-template.entity.js'

// eslint-disable-next-line no-restricted-globals -- тестовая фикстура
const NOW = new Date('2026-01-01T00:00:00.000Z')

function baseCommand(overrides: Partial<NotificationTemplateCreateCommand> = {}): NotificationTemplateCreateCommand {
  return {
    id: 'a3f5e8b0-0000-4000-8000-000000000001',
    eventType: 'order.paid',
    channel: 'telegram',
    locale: 'ru',
    subject: null,
    body: '{{brandName}}: заказ №{{orderNumber}} оплачен, экономия {{savingsDiram}} дирам.',
    variablesSchema: { required: ['brandName', 'orderNumber', 'savingsDiram'] },
    ...overrides,
  }
}

describe('NotificationTemplate.create()', () => {
  it('создаёт шаблон без subject для любого канала', () => {
    const template = NotificationTemplate.create(baseCommand(), NOW)
    expect(template.channel).toBe('telegram')
  })

  it('создаёт шаблон с subject для web_push', () => {
    const template = NotificationTemplate.create(
      baseCommand({ channel: 'web_push', subject: 'Заказ оплачен' }),
      NOW,
    )
    expect(template.channel).toBe('web_push')
  })

  it('создаёт шаблон с subject для email', () => {
    expect(() => NotificationTemplate.create(baseCommand({ channel: 'email', subject: 'Тема' }), NOW)).not.toThrow()
  })

  it('SRS-ADM-055: subject для telegram — InvalidTemplateSubjectChannelError (АС3 тикета)', () => {
    expect(() => NotificationTemplate.create(baseCommand({ channel: 'telegram', subject: 'Тема' }), NOW)).toThrow(
      InvalidTemplateSubjectChannelError,
    )
  })

  it('subject для sms — InvalidTemplateSubjectChannelError', () => {
    expect(() => NotificationTemplate.create(baseCommand({ channel: 'sms', subject: 'Тема' }), NOW)).toThrow(
      InvalidTemplateSubjectChannelError,
    )
  })

  it('subject для in_app — InvalidTemplateSubjectChannelError', () => {
    expect(() => NotificationTemplate.create(baseCommand({ channel: 'in_app', subject: 'Тема' }), NOW)).toThrow(
      InvalidTemplateSubjectChannelError,
    )
  })
})

describe('NotificationTemplate.restore()', () => {
  it('восстанавливает без повторной валидации (доверие к уже персистентной строке)', () => {
    const template = NotificationTemplate.restore({ ...baseCommand({ channel: 'telegram', subject: 'x' }), updatedAt: NOW })
    expect(template.channel).toBe('telegram')
  })
})

describe('NotificationTemplate#render()', () => {
  it('полный набор переменных — успешный рендер, brandName подставлен', () => {
    const template = NotificationTemplate.create(baseCommand(), NOW)
    const result = template.render({ brandName: 'DoruTJ', orderNumber: '1042', savingsDiram: '350' })
    expect(result.body).toBe('DoruTJ: заказ №1042 оплачен, экономия 350 дирам.')
    expect(result.subject).toBeUndefined()
  })

  it('рендерит subject вместе с body, когда subject задан', () => {
    const template = NotificationTemplate.create(
      baseCommand({ channel: 'web_push', subject: 'Заказ №{{orderNumber}}' }),
      NOW,
    )
    const result = template.render({ brandName: 'DoruTJ', orderNumber: '1042', savingsDiram: '0' })
    expect(result.subject).toBe('Заказ №1042')
  })

  it('критерий приёмки №4: render({orderNumber}) без savingsDiram, требуемого variablesSchema, — MissingTemplateVariableError', () => {
    const template = NotificationTemplate.create(baseCommand(), NOW)
    expect(() => template.render({ orderNumber: 'X' })).toThrow(MissingTemplateVariableError)
  })

  it('частичный рендер запрещён — ошибка, а не текст с буквальным {{savingsDiram}}', () => {
    const template = NotificationTemplate.create(baseCommand(), NOW)
    try {
      template.render({ brandName: 'DoruTJ', orderNumber: 'X' })
      expect.fail('ожидалась MissingTemplateVariableError')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingTemplateVariableError)
      expect((error as MissingTemplateVariableError).message).not.toContain('{{savingsDiram}}')
    }
  })

  it('плейсхолдер, отсутствующий в variablesSchema.required, но встречающийся в body — тоже MissingTemplateVariableError (defensive)', () => {
    const template = NotificationTemplate.create(
      baseCommand({ body: '{{brandName}}: {{typo}}', variablesSchema: { required: ['brandName'] } }),
      NOW,
    )
    expect(() => template.render({ brandName: 'DoruTJ' })).toThrow(MissingTemplateVariableError)
  })

  it('ошибка несёт eventType/channel/locale/variableName в details (TC-ADM-026 — читаемое сообщение)', () => {
    const template = NotificationTemplate.create(baseCommand(), NOW)
    try {
      template.render({ brandName: 'DoruTJ' })
      expect.fail('ожидалась MissingTemplateVariableError')
    } catch (error) {
      const missingError = error as MissingTemplateVariableError
      expect(missingError.details).toMatchObject({
        eventType: 'order.paid',
        channel: 'telegram',
        locale: 'ru',
        variableName: 'orderNumber',
      })
    }
  })
})
