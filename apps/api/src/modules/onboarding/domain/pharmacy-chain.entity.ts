/**
 * `PharmacyChain` — корень агрегата юрлица-владельца 1..N аптек
 * (SRS-DOM-047, `10-domain-model.md` §«Агрегаты и сущности»).
 *
 * Инварианты (SRS-DOM-047..050, REQ-ONBOARD-8/9/11):
 * - `tinInn` обязателен (юрлицо идентифицируется ИНН).
 * - Переходы статуса — `OnboardingStatusVO.isTransitionAllowed`
 *   (граф: `draft → pending_review → ... → active | suspended | terminated`).
 * - `terminate()` разрешён из ЛЮБОГО состояния (SRS-ADM-011);
 *   `terminated` терминально НАВСЕГДА (REQ-ONBOARD-12).
 * - `isWhitelabelRequested` — флаг White-Label, не влияет на state machine.
 *
 * Чистый domain (`02` §2.6): ноль I/O, `Date.now()` не используется.
 * Время (`submittedAt`) приходит через `restore()` из инфраструктуры
 * или передаётся как `Date | null` в команде.
 */
import { ValidationError } from '@dorutj/contracts'
import { type OnboardingStatus, assertTransitionAllowed } from './value-objects/onboarding-status.vo.js'

/** Длина ИНН в символах (с запасом; строгий regex — TODO EP-01 VO). */
const TIN_INN_MIN_LENGTH = 9
const TIN_INN_MAX_LENGTH = 20
const LEGAL_ENTITY_NAME_MAX_LENGTH = 255
const DIRECTOR_NAME_MAX_LENGTH = 255

export interface PharmacyChainCreateCommand {
  readonly id: string
  readonly name: string
  readonly legalEntityName: string
  readonly tinInn: string
  readonly directorFullName: string
  readonly contactPhone: string
  readonly legalAddress: string | null
  readonly isWhitelabelRequested: boolean
}

export interface PharmacyChainProps {
  readonly id: string
  readonly name: string
  readonly legalEntityName: string
  readonly tinInn: string
  readonly directorFullName: string
  readonly contactPhone: string
  readonly legalAddress: string | null
  readonly registrationCertificateUrl: string | null
  readonly isWhitelabelRequested: boolean
  readonly isWhitelabelActive: boolean
  readonly status: OnboardingStatus
  readonly contactPhoneVerified: boolean
  readonly submittedAt: Date | null
  readonly bankAccountRef: string | null
  readonly payoutMerchantRef: string | null
}

export class PharmacyChain {
  private constructor(public readonly props: PharmacyChainProps) {}

  // -------- Геттеры (C12, immutability) --------
  get id(): string {
    return this.props.id
  }
  get name(): string {
    return this.props.name
  }
  get legalEntityName(): string {
    return this.props.legalEntityName
  }
  get tinInn(): string {
    return this.props.tinInn
  }
  get directorFullName(): string {
    return this.props.directorFullName
  }
  get contactPhone(): string {
    return this.props.contactPhone
  }
  get legalAddress(): string | null {
    return this.props.legalAddress
  }
  get registrationCertificateUrl(): string | null {
    return this.props.registrationCertificateUrl
  }
  get isWhitelabelRequested(): boolean {
    return this.props.isWhitelabelRequested
  }
  get isWhitelabelActive(): boolean {
    return this.props.isWhitelabelActive
  }
  get status(): OnboardingStatus {
    return this.props.status
  }
  get contactPhoneVerified(): boolean {
    return this.props.contactPhoneVerified
  }
  get submittedAt(): Date | null {
    return this.props.submittedAt
  }
  get bankAccountRef(): string | null {
    return this.props.bankAccountRef
  }
  get payoutMerchantRef(): string | null {
    return this.props.payoutMerchantRef
  }

  // -------- Фабрики --------

  /**
   * Создание новой заявки сети в статусе `draft`. `id` обязателен
   * (UUID через `IdGenerator` инфраструктуры, не `Math.random()`).
   *
   * Для `isWhitelabelRequested=true` `legalAddress` обязателен
   * (REQ-ONBOARD-4, `.superRefine` в zod-схеме DTJ-064).
   */
  static create(cmd: PharmacyChainCreateCommand): PharmacyChain {
    validateTinInn(cmd.tinInn)
    validateLength(cmd.legalEntityName, 'legalEntityName', LEGAL_ENTITY_NAME_MAX_LENGTH)
    validateLength(cmd.directorFullName, 'directorFullName', DIRECTOR_NAME_MAX_LENGTH)
    if (cmd.isWhitelabelRequested && (cmd.legalAddress === null || cmd.legalAddress.trim() === '')) {
      throw new ValidationError(
        'legalAddress is required when isWhitelabelRequested is true',
        { field: 'legalAddress' },
      )
    }
    return new PharmacyChain({
      id: cmd.id,
      name: cmd.legalEntityName, // `name` дублирует `legalEntityName` (per schema)
      legalEntityName: cmd.legalEntityName,
      tinInn: cmd.tinInn,
      directorFullName: cmd.directorFullName,
      contactPhone: cmd.contactPhone,
      legalAddress: cmd.legalAddress,
      registrationCertificateUrl: null,
      isWhitelabelRequested: cmd.isWhitelabelRequested,
      isWhitelabelActive: false,
      status: 'draft',
      contactPhoneVerified: false,
      submittedAt: null,
      bankAccountRef: null,
      payoutMerchantRef: null,
    })
  }

  /** Восстановление из БД через маппер. */
  static restore(props: PharmacyChainProps): PharmacyChain {
    return new PharmacyChain(props)
  }

  // -------- Методы-намерения (state machine) --------

  /** Обновление полей заявки в статусе `draft` или `rejected` (для повторной подачи). */
  updateApplication(update: {
    readonly legalEntityName?: string
    readonly directorFullName?: string
    readonly contactPhone?: string
    readonly legalAddress?: string | null
    readonly isWhitelabelRequested?: boolean
  }): PharmacyChain {
    assertUpdatableStatus(this.status)
    const merged = mergeApplicationUpdate(this.props, update)
    return new PharmacyChain({
      ...this.props,
      name: merged.legalEntityName,
      legalEntityName: merged.legalEntityName,
      directorFullName: merged.directorFullName,
      contactPhone: merged.contactPhone,
      legalAddress: merged.legalAddress,
      isWhitelabelRequested: merged.isWhitelabelRequested,
      // Переиспользование заявки (rejected → draft) сбрасывает submitted_at.
      submittedAt: null,
    })
  }

  /** Пометка `contactPhoneVerified=true` после успешной OTP-верификации. */
  markContactPhoneVerified(): PharmacyChain {
    return new PharmacyChain({ ...this.props, contactPhoneVerified: true })
  }

  /** Установка `registrationCertificateUrl` (после загрузки через `onboarding-documents`). */
  setRegistrationCertificateUrl(url: string): PharmacyChain {
    return new PharmacyChain({ ...this.props, registrationCertificateUrl: url })
  }

  /**
   * `draft → pending_review` (REQ-ONBOARD-8, SRS-ADM-008). Устанавливает
   * `submittedAt`. Вызывается `SubmitChainForReviewUseCase`.
   */
  submitForReview(now: Date): PharmacyChain {
    assertTransitionAllowed(this.status, 'pending_review')
    return new PharmacyChain({ ...this.props, status: 'pending_review', submittedAt: now })
  }

  /** `pending_review → approved` (SRS-ADM-010, DTJ-068 approve). */
  approve(actor: { readonly id: string }): PharmacyChain {
    assertTransitionAllowed(this.status, 'approved')
    void actor // actor фиксируется в onboarding_review_log, не в самой сущности
    return new PharmacyChain({ ...this.props, status: 'approved' })
  }

  /** `pending_review → changes_requested` (SRS-ADM-011, DTJ-068). `submittedAt` НЕ сбрасывается. */
  requestChanges(actor: { readonly id: string }, _reason: string): PharmacyChain {
    assertTransitionAllowed(this.status, 'changes_requested')
    void actor
    return new PharmacyChain({ ...this.props, status: 'changes_requested' })
  }

  /** `pending_review → rejected` (SRS-ADM-011, DTJ-068). Терминально (до повторной подачи). */
  reject(actor: { readonly id: string }, _reason: string): PharmacyChain {
    assertTransitionAllowed(this.status, 'rejected')
    void actor
    return new PharmacyChain({ ...this.props, status: 'rejected' })
  }

  /** `* → terminated` (SRS-ADM-011, DTJ-068). Терминально НАВСЕГДА. */
  terminate(actor: { readonly id: string }, _reason: string): PharmacyChain {
    assertTransitionAllowed(this.status, 'terminated')
    void actor
    return new PharmacyChain({ ...this.props, status: 'terminated' })
  }

  /** `suspended → pending_review` (SRS-ADM-019, DTJ-074) — `requestReactivation` для сети. */
  requestReactivation(): PharmacyChain {
    assertTransitionAllowed(this.status, 'pending_review')
    return new PharmacyChain({ ...this.props, status: 'pending_review' })
  }
}

// -------- Внутренние валидаторы --------

function validateTinInn(tin: string): void {
  if (typeof tin !== 'string' || tin.length < TIN_INN_MIN_LENGTH || tin.length > TIN_INN_MAX_LENGTH) {
    throw new ValidationError(
      `Invalid tinInn: expected length between ${String(TIN_INN_MIN_LENGTH)} and ${String(TIN_INN_MAX_LENGTH)}`,
      { field: 'tinInn' },
    )
  }
}

function validateLength(value: string, field: string, max: number): void {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new ValidationError(`Invalid ${field}: empty or exceeds ${String(max)} chars`, { field })
  }
}

function assertUpdatableStatus(status: OnboardingStatus): void {
  if (status !== 'draft' && status !== 'rejected') {
    throw new ValidationError(`Cannot update application fields when status is ${status}`, {
      field: 'status',
    })
  }
}

interface MergedApplicationUpdate {
  readonly legalEntityName: string
  readonly directorFullName: string
  readonly contactPhone: string
  readonly legalAddress: string | null
  readonly isWhitelabelRequested: boolean
}

function mergeApplicationUpdate(
  current: PharmacyChainProps,
  update: {
    readonly legalEntityName?: string
    readonly directorFullName?: string
    readonly contactPhone?: string
    readonly legalAddress?: string | null
    readonly isWhitelabelRequested?: boolean
  },
): MergedApplicationUpdate {
  const result: MergedApplicationUpdate = {
    legalEntityName: update.legalEntityName ?? current.legalEntityName,
    directorFullName: update.directorFullName ?? current.directorFullName,
    contactPhone: update.contactPhone ?? current.contactPhone,
    legalAddress: update.legalAddress ?? current.legalAddress,
    isWhitelabelRequested: update.isWhitelabelRequested ?? current.isWhitelabelRequested,
  }
  if (
    result.isWhitelabelRequested &&
    (result.legalAddress === null || result.legalAddress.trim() === '')
  ) {
    throw new ValidationError(
      'legalAddress is required when isWhitelabelRequested is true',
      { field: 'legalAddress' },
    )
  }
  return result
}
