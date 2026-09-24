/**
 * `UpdateTenantSettingsUseCase` (EP-15, DTJ-351) — `PATCH /api/v1/tenant-settings/:tenantId`
 * (`@Roles('super_admin')`).
 *
 * Валидация `patch` — Zod (`TenantSettingsPatchSchema`, `@dorutj/contracts`) вызывается ЗДЕСЬ,
 * в use case (ticket «Что сделать» п.3), не только `ZodValidationPipe` в контроллере — первая
 * невалидная запись НЕ доходит до `TenancyFacadePort.updateTenantSettings` (критерий приёмки 2:
 * `codLimitDiram=-100` → `400 VALIDATION_ERROR`, `details.field='codLimitDiram'`, БД не тронута).
 * Перевод `ZodError` → `ValidationError` с `field` из ПЕРВОГО issue — 1:1 приём
 * `catalog-search.controller.ts#parseSearchQuery` (единственный прецедент этого приёма в
 * use-case/controller-коде проекта на момент написания).
 *
 * НЕ пишет `AuditLogPort` (EP-16, DTJ-374) — этот тикет не называет аудит ни в «Что сделать»,
 * ни в критериях приёмки, а единственный существующий enum `audit_action_category`
 * (`migrations/0034_support_tickets_audit_log.sql`) не содержит категории, покрывающей
 * admin-правку `tenant_settings` (только `payment_override/return_override/
 * dispute_resolution/prescription_access/control_category_change/onboarding_decision/
 * force_cancel_order/ledger_adjustment`). Добавление новой категории — `ALTER TYPE ... ADD
 * VALUE` (нетранзакционная миграция, SRS-DB-009), вне периметра S-тикета без DB-файлов в
 * `files_owned` — см. отчёт сдачи, «НАЙДЕННЫЕ ЧУЖИЕ ПРОБЛЕМЫ».
 */
import { Inject, Injectable } from '@nestjs/common'
import { NotFoundError, ValidationError, TenantSettingsPatchSchema, type TenantSettingsPatchDto } from '@dorutj/contracts'
import {
  TENANCY_FACADE_PORT,
  type TenancyFacadePort,
  type TenantDetailView,
  type TenantSettingsPatch,
} from '../ports/tenancy-facade.port.js'

export interface UpdateTenantSettingsCommand {
  readonly tenantId: string
  /** Сырое тело запроса — валидируется ЭТИМ use case (см. JSDoc файла), не контроллером. */
  readonly rawPatch: unknown
  readonly actor: { readonly userId: string }
}

@Injectable()
export class UpdateTenantSettingsUseCase {
  public constructor(@Inject(TENANCY_FACADE_PORT) private readonly tenancyFacade: TenancyFacadePort) {}

  public async execute(command: UpdateTenantSettingsCommand): Promise<TenantDetailView> {
    const patch = parsePatch(command.rawPatch)
    const updated = await this.tenancyFacade.updateTenantSettings(command.tenantId, toPortPatch(patch), {
      userId: command.actor.userId,
    })
    if (updated === null) {
      throw new NotFoundError({ resource: 'tenant', tenantId: command.tenantId })
    }
    return updated
  }
}

/**
 * `exactOptionalPropertyTypes` — ключи с `undefined` (непереданные Zod `.optional()` поля)
 * ОПУСКАЮТСЯ целиком, а не копируются как `key: undefined` (1:1 приём `toUpsertCommand`,
 * `feature-flags.controller.ts`).
 */
function toPortPatch(patch: TenantSettingsPatchDto): TenantSettingsPatch {
  return {
    ...(patch.brandName !== undefined && { brandName: patch.brandName }),
    ...(patch.brandLogoUrl !== undefined && { brandLogoUrl: patch.brandLogoUrl }),
    ...(patch.brandPalette !== undefined && { brandPalette: patch.brandPalette }),
    ...(patch.codLimitDiram !== undefined && { codLimitDiram: patch.codLimitDiram }),
    ...(patch.holdPeriodDays !== undefined && { holdPeriodDays: patch.holdPeriodDays }),
  }
}

/** См. JSDoc файла — 1:1 приём `parseSearchQuery` (`catalog-search.controller.ts`). */
function parsePatch(rawPatch: unknown): TenantSettingsPatchDto {
  const parsed = TenantSettingsPatchSchema.safeParse(rawPatch)
  if (parsed.success) {
    return parsed.data
  }
  const firstIssue = parsed.error.issues[0]
  throw new ValidationError(firstIssue?.message ?? 'Invalid tenant settings patch', {
    field: firstIssue === undefined ? 'unknown' : firstIssue.path.join('.'),
    issues: parsed.error.issues,
  })
}
