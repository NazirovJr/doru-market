/**
 * Контракты `feature_flags` (EP-15, DTJ-352, SRS-ADM-028).
 *
 * `UpsertFeatureFlagSchema` — ОДНА схема для `POST /api/v1/feature-flags` (создание) И
 * `PATCH /api/v1/feature-flags/:id` (полная замена изменяемых полей): обе формы отправляют
 * ПОЛНОЕ представление флага (клиент `apps/admin` уже держит его после `GET`), не частичный
 * патч — иначе для обновления понадобился бы `findById` в `FeatureFlagsRepositoryPort`, которого
 * тикет НЕ заводит (`files_owned` — только `findByKey`/`list`/`upsert`). `superRefine` дублирует
 * `CHECK chk_feature_flags_scope_tenant` НА УРОВНЕ Zod (АС3 тикета: `400 VALIDATION_ERROR` ДО
 * `INSERT`, ошибка БД менее информативна для клиента).
 */
import { z } from 'zod'

export const FEATURE_FLAG_SCOPE_VALUES = ['global', 'tenant'] as const
export type FeatureFlagScope = (typeof FEATURE_FLAG_SCOPE_VALUES)[number]

const MIN_ROLLOUT_PERCENTAGE = 0
const MAX_ROLLOUT_PERCENTAGE = 100
const DEFAULT_ROLLOUT_PERCENTAGE = 100
const MAX_FLAG_KEY_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500

export interface FeatureFlagDto {
  readonly id: string
  readonly flagKey: string
  readonly scope: FeatureFlagScope
  readonly tenantId: string | null
  readonly isEnabled: boolean
  readonly rolloutPercentage: number
  readonly description: string | null
  readonly updatedBy: string | null
  readonly updatedAt: string
}

export const UpsertFeatureFlagSchema = z
  .object({
    flagKey: z.string().trim().min(1).max(MAX_FLAG_KEY_LENGTH),
    scope: z.enum(FEATURE_FLAG_SCOPE_VALUES),
    tenantId: z.uuid().optional(),
    isEnabled: z.boolean(),
    rolloutPercentage: z.coerce
      .number()
      .int()
      .min(MIN_ROLLOUT_PERCENTAGE)
      .max(MAX_ROLLOUT_PERCENTAGE)
      .default(DEFAULT_ROLLOUT_PERCENTAGE),
    description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'tenant' && value.tenantId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['tenantId'], message: 'tenantId is required when scope is "tenant"' })
    }
    if (value.scope === 'global' && value.tenantId !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['tenantId'], message: 'tenantId must be omitted when scope is "global"' })
    }
  })

export type UpsertFeatureFlagDto = z.infer<typeof UpsertFeatureFlagSchema>
