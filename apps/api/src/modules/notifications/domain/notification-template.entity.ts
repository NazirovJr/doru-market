/**
 * `NotificationTemplate` (DTJ-369, EP-16, SRS-ADM-054/055/056) — доменная сущность таблицы
 * `notification_templates`. Минимальный домен (без state machine): фабрика с одним инвариантом
 * (`subject` только для `channel ∈ {'email','web_push'}`, SRS-ADM-055) + чистая функция рендера.
 *
 * `render()` — простая подстановка `{{var}}` через `String.replace`, НЕ Handlebars/шаблонизатор
 * общего назначения (SRS-ADM-054: минимизация поверхности инъекций в исходящий текст). Полный
 * успех либо явная ошибка ДО отправки — частичный рендер (буквальный `{{var}}` в результате)
 * запрещён: переменные проверяются против `variablesSchema.required` ДО подстановки, а сама
 * подстановка бросает ту же ошибку на любой незаполненный плейсхолдер (defensive — ловит и
 * плейсхолдер, забытый в `variablesSchema`).
 *
 * `NotificationTemplateChannel` — СУПЕРМНОЖЕСТВО `NotificationChannel` из
 * `application/ports/notify-provider.port.ts` (DTJ-368). Тот порт умышленно ограничен 4 РЕАЛЬНО
 * подключёнными провайдерами (`telegram|sms|web_push|in_app`, БЕЗ `email` — см. его JSDoc
 * §«Реестр каналов разошёлся с `docs/spec/11-database-schema.md`»). `notification_templates` —
 * таблица ШАБЛОНОВ, а не каналов доставки: реальный Postgres ENUM `notification_channel`
 * (`db/schema/enums.schema.ts`, эта же миграция DTJ-369) СОГЛАСУЕТ оба разошедшихся источника —
 * `docs/spec/11-database-schema.md` (`telegram|sms|web_push|email`, БЕЗ `in_app`) и фактический
 * состав кода EP-16 (`telegram|sms|web_push|in_app`, БЕЗ `email`) — объединением: `in_app`
 * добавлен (иначе половина матрицы SRS-ADM-052 не имеет канала для строки — `in_app` есть
 * практически у каждого события), `email` сохранён (SRS-ADM-055 явно допускает для него
 * `subject`, «оставлен для полноты будущего расширения, не задействован в MVP-матрице»). Это
 * ТИП НЕ ДУБЛИРУЕТ `NotificationChannel` — он шире и обслуживает другую таблицу.
 */
import { ValidationError, ErrorCode } from '@dorutj/contracts'

export type NotificationTemplateChannel = 'telegram' | 'sms' | 'web_push' | 'email' | 'in_app'
export type NotificationTemplateLocale = 'tj' | 'ru' | 'en'

export const NOTIFICATION_TEMPLATE_CHANNELS: readonly NotificationTemplateChannel[] = [
  'telegram',
  'sms',
  'web_push',
  'email',
  'in_app',
]
export const NOTIFICATION_TEMPLATE_LOCALES: readonly NotificationTemplateLocale[] = ['tj', 'ru', 'en']

/** SRS-ADM-055: `subject` разрешён только для этих каналов (email subject / web push заголовок). */
const SUBJECT_ALLOWED_CHANNELS: ReadonlySet<NotificationTemplateChannel> = new Set(['email', 'web_push'])

/**
 * «Zod-подобное» JSON-описание ожидаемых переменных payload'а (SRS-ADM-054). Упрощено до списка
 * обязательных имён — ticket не даёт конкретный JSON Schema draft, а `render()` нуждается только
 * в проверке присутствия (ASSUMPTION: без проверки типа значения — все переменные рендерятся как
 * строки движком простой подстановки).
 */
export interface NotificationTemplateVariablesSchema {
  readonly required: readonly string[]
}

export interface MissingTemplateVariableDetails {
  readonly eventType: string
  readonly channel: NotificationTemplateChannel
  readonly locale: NotificationTemplateLocale
  readonly variableName: string
}

export class MissingTemplateVariableError extends ValidationError {
  constructor(details: MissingTemplateVariableDetails) {
    const { eventType, channel, locale, variableName } = details
    super(
      `Missing required template variable "${variableName}" for template ` +
        `(eventType="${eventType}", channel="${channel}", locale="${locale}")`,
      { ...details },
      ErrorCode.MISSING_TEMPLATE_VARIABLE,
    )
  }
}

export class InvalidTemplateSubjectChannelError extends ValidationError {
  constructor(channel: NotificationTemplateChannel) {
    super(
      `subject is only allowed for channel ∈ {${[...SUBJECT_ALLOWED_CHANNELS].join(', ')}}, got "${channel}"`,
      { channel },
      ErrorCode.INVALID_TEMPLATE_SUBJECT_CHANNEL,
    )
  }
}

export interface NotificationTemplateCreateCommand {
  readonly id: string
  readonly eventType: string
  readonly channel: NotificationTemplateChannel
  readonly locale: NotificationTemplateLocale
  readonly subject: string | null
  readonly body: string
  readonly variablesSchema: NotificationTemplateVariablesSchema
}

export interface NotificationTemplateSnapshot extends NotificationTemplateCreateCommand {
  readonly updatedAt: Date
}

export interface RenderedNotification {
  readonly subject?: string
  readonly body: string
}

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g

export class NotificationTemplate {
  private constructor(private readonly snapshot: NotificationTemplateSnapshot) {}

  /** Валидированное создание (SRS-ADM-055 инвариант). Время — явный параметр (Clock-порт вызывающей стороны, не `new Date()` здесь). */
  static create(command: NotificationTemplateCreateCommand, now: Date): NotificationTemplate {
    assertSubjectAllowedForChannel(command.subject, command.channel)
    return new NotificationTemplate({ ...command, updatedAt: now })
  }

  /** Восстановление из уже валидной строки БД — без повторной валидации инварианта (`02` §2.2). */
  static restore(snapshot: NotificationTemplateSnapshot): NotificationTemplate {
    return new NotificationTemplate(snapshot)
  }

  get id(): string {
    return this.snapshot.id
  }

  get eventType(): string {
    return this.snapshot.eventType
  }

  get channel(): NotificationTemplateChannel {
    return this.snapshot.channel
  }

  get locale(): NotificationTemplateLocale {
    return this.snapshot.locale
  }

  /**
   * Рендер: сначала проверяет ВСЕ поля `variablesSchema.required` присутствуют в `variables`
   * (SRS-ADM-054 «ДО подстановки»), затем подставляет плейсхолдеры в `body`/`subject`.
   * Бросает `MissingTemplateVariableError` вместо частичного рендера — либо полный успех, либо
   * явная ошибка ДО отправки (критерий приёмки №4 тикета).
   */
  render(variables: Readonly<Record<string, string>>): RenderedNotification {
    for (const name of this.snapshot.variablesSchema.required) {
      if (variables[name] === undefined) {
        throw this.missingVariable(name)
      }
    }
    const body = this.substitute(this.snapshot.body, variables)
    if (this.snapshot.subject === null) {
      return { body }
    }
    return { subject: this.substitute(this.snapshot.subject, variables), body }
  }

  private substitute(text: string, variables: Readonly<Record<string, string>>): string {
    return text.replace(PLACEHOLDER_PATTERN, (_match, name: string) => {
      const value = variables[name]
      if (value === undefined) {
        throw this.missingVariable(name)
      }
      return value
    })
  }

  private missingVariable(name: string): MissingTemplateVariableError {
    return new MissingTemplateVariableError({
      eventType: this.snapshot.eventType,
      channel: this.snapshot.channel,
      locale: this.snapshot.locale,
      variableName: name,
    })
  }
}

function assertSubjectAllowedForChannel(subject: string | null, channel: NotificationTemplateChannel): void {
  if (subject !== null && !SUBJECT_ALLOWED_CHANNELS.has(channel)) {
    throw new InvalidTemplateSubjectChannelError(channel)
  }
}
