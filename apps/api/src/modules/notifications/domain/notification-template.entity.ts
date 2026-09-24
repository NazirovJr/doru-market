/** Рендер — простая подстановка без шаблонизатора: меньше поверхность инъекций; частичный рендер запрещён. */
import { ValidationError, ErrorCode } from '@dorutj/contracts'

/** Шире NotificationChannel провайдеров: включает email, которого пока нет в доставке. */
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

const SUBJECT_ALLOWED_CHANNELS: ReadonlySet<NotificationTemplateChannel> = new Set(['email', 'web_push'])

/** Только имена: render проверяет присутствие, не типы. */
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

  static create(command: NotificationTemplateCreateCommand, now: Date): NotificationTemplate {
    assertSubjectAllowedForChannel(command.subject, command.channel)
    return new NotificationTemplate({ ...command, updatedAt: now })
  }

  /** Без повторной валидации — строка уже персистентна. */
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
