/**
 * `AlreadyReviewedError` (SRS-ADM-080, TC-ADM-032): гонка двух операторов,
 * одновременно открывших карточку одной заявки; второй запрос видит
 * уже изменённый `status` и получает 409 (SRS-ADM-080).
 *
 * Канонический код `ALREADY_REVIEWED` (409).
 */
import { ConflictError, ErrorCode } from '@dorutj/contracts'

export class AlreadyReviewedError extends ConflictError {
  constructor(details?: Record<string, unknown>) {
    super('Application already reviewed by another operator', details, ErrorCode.ALREADY_REVIEWED)
  }
}
