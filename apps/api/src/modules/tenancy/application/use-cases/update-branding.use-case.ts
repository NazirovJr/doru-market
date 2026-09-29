import { Inject, Injectable } from '@nestjs/common'
import {
  ForbiddenError,
  NotFoundError,
  pickEditableBrandTokens,
  UpdateBrandingRequestSchema,
  ValidationError,
  type UserRole,
} from '@dorutj/contracts'
import { BrandingAuthorizationPolicy } from '../policies/branding-authorization.policy.js'
import { TENANT_EVENT_PUBLISHER, type TenantEventPublisherPort } from '../ports/tenant-event-publisher.port.js'
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../ports/tenant-repository.port.js'
import {
  TENANT_SETTINGS_REPOSITORY,
  type TenantSettingsRepositoryPort,
} from '../ports/tenant-settings-repository.port.js'
import { TenantId } from '../../domain/value-objects/tenant-id.vo.js'

export interface UpdateBrandingCommand {
  readonly tenantId: string
  readonly rawRequest: unknown
  readonly actor: { readonly role: UserRole; readonly tenantId: string | null }
}

interface ParsedIssue {
  readonly path: readonly PropertyKey[]
  readonly code: string
  readonly keys?: readonly string[]
}

// details.field — конкретный CSS-токен: путь brandPalette.<токен> или ключ из unrecognized_keys.
function issueField(issue: ParsedIssue): string {
  const [root, token] = issue.path
  if (root === 'brandPalette' && typeof token === 'string') {
    return token
  }
  if (root === 'brandPalette' && issue.code === 'unrecognized_keys' && issue.keys?.[0] !== undefined) {
    return issue.keys[0]
  }
  return issue.path.map(String).join('.') || 'body'
}

@Injectable()
export class UpdateBrandingUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(TENANT_SETTINGS_REPOSITORY) private readonly settingsRepository: TenantSettingsRepositoryPort,
    @Inject(TENANT_EVENT_PUBLISHER) private readonly events: TenantEventPublisherPort,
  ) {}

  // Гонка двух PUT намеренно не защищена версией: побеждает последний commit — брендинг не финансовая операция.
  async execute(command: UpdateBrandingCommand): Promise<void> {
    const tenantId = TenantId.from(command.tenantId)
    const tenant = await this.tenants.findById(tenantId)
    const target = tenant === null ? null : { id: tenant.id.value, isNeutral: tenant.isNeutral }
    if (!BrandingAuthorizationPolicy.canManage(command.actor, target)) {
      throw new ForbiddenError('Branding of this tenant is not manageable by the actor', { tenantId: command.tenantId })
    }
    if (tenant === null) {
      throw new NotFoundError({ resource: 'tenant', tenantId: command.tenantId })
    }

    const request = this.parse(command.rawRequest)
    const current = tenant.settings
    const updated = tenant.updateBranding({
      brandName: request.brandName,
      brandPalette: { ...pickEditableBrandTokens(current.brandPalette), ...request.brandPalette },
      brandLogoUrl: request.logoUrl === undefined ? current.brandLogoUrl : request.logoUrl,
    })
    await this.settingsRepository.save(updated.settings, tenantId)
    await this.events.publishBrandingUpdated({
      tenantId,
      updatedFields: ['brandName', 'brandPalette', ...(request.logoUrl === undefined ? [] : ['logoUrl'])],
    })
  }

  private parse(raw: unknown): ReturnType<typeof UpdateBrandingRequestSchema.parse> {
    const parsed = UpdateBrandingRequestSchema.safeParse(raw)
    if (parsed.success) {
      return parsed.data
    }
    const first = parsed.error.issues[0]
    throw new ValidationError(first?.message ?? 'Invalid branding request', {
      field: first === undefined ? 'body' : issueField(first),
      issues: parsed.error.issues,
    })
  }
}
