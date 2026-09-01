/**
 * `TenantAlreadyProvisionedError` — попытка `ProvisionTenantUseCase` для `chainId`, для
 * которого тенант уже существует (DTJ-057 сценарий 5). HTTP 409 `CONFLICT`.
 *
 * Локальный класс модуля `tenancy` (наследует `ConflictError` из `packages/contracts`)
 * — единственная кастомизация под `chainId` в `details`, чтобы клиент мог отличить
 * «уже провизионирован» от других `409`-ошибок без разбора `message`.
 */
import { ConflictError } from '@dorutj/contracts'

export class TenantAlreadyProvisionedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Tenant already provisioned for chain', { ...(details ?? {}), reason: 'tenant_already_provisioned' })
  }
}
