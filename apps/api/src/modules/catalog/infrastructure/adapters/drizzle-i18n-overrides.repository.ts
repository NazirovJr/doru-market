/**
 * Drizzle-реализация `I18nOverridesRepository` (DTJ-102/103, EP-07, R1).
 *
 * Единственная продакшен-реализация порта (см. его JSDoc). Читает ТОЛЬКО
 * `i18n_overrides` (таблица заведена миграцией `0024_i18n_overrides_review_status.sql`,
 * DTJ-103) по композитному PK `(tenant_id, locale, translation_key)` — точечный
 * `SELECT ... LIMIT 1`, без N+1 (один вызов на один ключ).
 *
 * DI: явный `@Inject(DRIZZLE_DB)` — esbuild/vitest не эмитит `design:paramtypes`
 * (DTJ-001, тот же приём, что `AnalogCandidatesAdapter`/`PostgresCategoriesReadRepository`).
 */
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { DRIZZLE_DB, type DrizzleDb } from '@/infrastructure/database/drizzle.provider.js'
import { i18nOverrides } from '@/db/schema/index.js'
import {
  I18N_OVERRIDES_REPOSITORY,
  type I18nOverrideEntry,
  type I18nOverridesRepository,
} from '@/modules/catalog/application/ports/i18n-overrides.port.js'

@Injectable()
export class DrizzleI18nOverridesRepository implements I18nOverridesRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDb) {}

  async findOne(input: {
    readonly tenantId: string
    readonly locale: string
    readonly translationKey: string
  }): Promise<I18nOverrideEntry | null> {
    const rows = await this.db
      .select({ value: i18nOverrides.value, reviewStatus: i18nOverrides.reviewStatus })
      .from(i18nOverrides)
      .where(
        and(
          eq(i18nOverrides.tenantId, input.tenantId),
          eq(i18nOverrides.locale, input.locale),
          eq(i18nOverrides.translationKey, input.translationKey),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row ?? null
  }
}

/** DI-привязка: провайдер для `I18N_OVERRIDES_REPOSITORY` (D-27). */
export const I18N_OVERRIDES_REPOSITORY_PROVIDER = {
  provide: I18N_OVERRIDES_REPOSITORY,
  useClass: DrizzleI18nOverridesRepository,
} as const
