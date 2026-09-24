/**
 * Типы сида `notification_templates` (DTJ-369, EP-16). Переиспользует `NotificationTemplateChannel`/
 * `NotificationTemplateLocale` домена (`modules/notifications/domain/notification-template.entity.ts`)
 * ЧЕРЕЗ ОТНОСИТЕЛЬНЫЙ импорт (НЕ через алиас `@/`, СОЗНАТЕЛЬНО): этот файл и его потребители
 * (`index.ts`, `completeness.ts`, `events/*.ts`) импортируются `tests/arch/notification-templates-
 * completeness.spec.ts` — у `tests/arch/tsconfig.json` НЕТ алиаса `@/*` (только у `apps/api/
 * tsconfig.json`), относительный импорт работает в обоих контекстах одинаково. Ничего, кроме
 * `type`-импорта (стирается на компиляции) — эти файлы остаются pure-data, БЕЗ Drizzle/pg (см.
 * `seed-notification-templates.ts` — единственный файл каталога, которому разрешено их иметь).
 */
// eslint-disable-next-line no-restricted-imports -- C16 требует алиас @/..., но этот файл читается ДВУМЯ независимыми tsconfig (apps/api, где @/ определён, И tests/arch, где алиаса нет и заводить его ради одного файла непропорционально) — относительный импорт единственного источника типа канала/локали домена работает одинаково в обоих контекстах.
import type {
  NotificationTemplateChannel,
  NotificationTemplateLocale,
  NotificationTemplateVariablesSchema,
} from '../../../modules/notifications/domain/notification-template.entity.js'

export type { NotificationTemplateChannel, NotificationTemplateLocale, NotificationTemplateVariablesSchema }

/** Одна строка сида — 1:1 колонки `notification_templates` (без `id`/`updatedAt`, генерируются БД/сидом). */
export interface NotificationTemplateSeedRow {
  readonly eventType: string
  readonly channel: NotificationTemplateChannel
  readonly locale: NotificationTemplateLocale
  readonly subject: string | null
  readonly body: string
  readonly variablesSchema: NotificationTemplateVariablesSchema
}
