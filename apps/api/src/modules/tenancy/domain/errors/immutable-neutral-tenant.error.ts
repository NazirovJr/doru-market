/**
 * SRS-DOM-042: нейтральный тенант единственный и неизменяемый — `Tenant.rename()` бросает
 * эту ошибку при попытке переименовать тенант с `isNeutral === true`.
 *
 * Наследует `ForbiddenTransitionError` (`packages/contracts`) — канонический код
 * `INVALID_STATE_TRANSITION` (HTTP 409) по таблице `10-domain-model.md` §«Доменные ошибки».
 */
import { ForbiddenTransitionError } from '@dorutj/contracts'

export class ImmutableNeutralTenantError extends ForbiddenTransitionError {
  constructor(details?: Record<string, unknown>) {
    super({ ...(details ?? {}), reason: 'neutral_tenant_is_immutable' })
  }
}
