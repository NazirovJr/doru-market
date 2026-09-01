import { DomainError } from './domain-error.js'

/** SRS-DOM-013: `Medicine.publish()` бросает, если `substances.length === 0`. */
export class MissingSubstancesError extends DomainError {
  public constructor(message: string) {
    super('MISSING_SUBSTANCES', message)
  }
}
