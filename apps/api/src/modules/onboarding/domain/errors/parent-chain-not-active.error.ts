/**
 * `ParentChainNotActiveError` (SRS-DOM-048): попытка `PharmacyAccount.activate()`
 * при `parentChain.status ∉ {'approved','active'}`. Доменная защита от
 * активации аптеки, родительская сеть которой ещё не в `approved/active`.
 *
 * Наследует `ParentChainNotActiveError` из `packages/contracts` (готовый
 * класс с каноническим кодом `PARENT_CHAIN_NOT_ACTIVE` → 422 per
 * `27-module-admin-moderation-onboarding.md` SRS-ADM-013).
 */
import { ParentChainNotActiveError as ContractsParentChainNotActiveError } from '@dorutj/contracts'

export class ParentChainNotActiveError extends ContractsParentChainNotActiveError {
  constructor(parentChainStatus: string) {
    super({ parentChainStatus, reason: 'parent_chain_not_in_approved_or_active' })
  }
}
