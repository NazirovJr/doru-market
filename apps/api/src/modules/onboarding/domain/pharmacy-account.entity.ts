/**
 * `PharmacyAccount` — корень агрегата операционной точки (SRS-DOM-047..050,
 * `10-domain-model.md` §«Агрегаты и сущности»).
 *
 * Инварианты:
 * - SRS-DOM-047: `chainId` обязателен ВСЕГДА. Конструктор требует
 *   непустое значение (для соло-аптеки `SubmitPharmacyApplicationUseCase`
 *   СНАЧАЛА создаёт `PharmacyChain` через `SubmitChainApplicationUseCase`,
 *   домен просто не допускает `null`).
 * - SRS-DOM-048: `activate()` принимает `parentChainStatus: OnboardingStatus`
 *   параметром. Если `parentChainStatus ∉ {'approved','active'}` →
 *   `ParentChainNotActiveError` (422).
 * - SRS-DOM-049: `updateAddress()` на `status='active'` переводит в
 *   `'pending_review'` (НЕ тихий апдейт полей).
 * - SRS-DOM-050: `suspend(reason, actor)` — `status='suspended'`,
 *   `suspensionReason=reason`; `requestReactivation()` ТОЛЬКО из
 *   `'suspended'`, переводит в `'pending_review'`. Метод `activate()`
 *   из `'suspended'` напрямую (в обход `requestReactivation`) →
 *   `AutomaticReactivationForbiddenError`.
 * - SRS-DOM-161: причины приостановки `PharmacySuspensionReason`.
 *
 * Чистый domain (`02` §2.6): ноль I/O.
 */
import { ValidationError } from '@dorutj/contracts'
import { type OnboardingStatus, assertTransitionAllowed } from './value-objects/onboarding-status.vo.js'
import { ParentChainNotActiveError } from './errors/parent-chain-not-active.error.js'
import { AutomaticReactivationForbiddenError } from './errors/automatic-reactivation-forbidden.error.js'
import { CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE } from './pharmacy-account-entity.types.js'
import {
  PHARMACY_SUSPENSION_REASONS,
  type PharmacyAccountCreateCommand,
  type PharmacyAccountProps,
  type PharmacySuspensionReason,
} from './pharmacy-account-entity.types.js'
import { type AccountUpdate } from './value-objects/pharmacy-account-update.js'
import {
  ADDRESS_MAX_LENGTH,
  LICENSE_NUMBER_MAX_LENGTH,
  NAME_MAX_LENGTH,
  assertUpdatableStatus,
  validateCoordinates,
  validateLength,
} from './value-objects/pharmacy-account-vo.js'
import { mergeAccountUpdate } from './value-objects/pharmacy-account-update.js'

export { PHARMACY_SUSPENSION_REASONS, type PharmacySuspensionReason } from './pharmacy-account-entity.types.js'
export {
  PHARMACY_SUSPENSION_REASONS_REQUIRING_FORCE_CANCEL,
  CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE,
  type PharmacyAccountCreateCommand,
  type PharmacyAccountProps,
} from './pharmacy-account-entity.types.js'

export class PharmacyAccount {
  private constructor(public readonly props: PharmacyAccountProps) {}

  // -------- Геттеры --------
  get id(): string {
    return this.props.id
  }
  get chainId(): string {
    return this.props.chainId
  }
  get name(): string {
    return this.props.name
  }
  get addressText(): string {
    return this.props.addressText
  }
  get landmarkTj(): string | null {
    return this.props.landmarkTj
  }
  get latitude(): number {
    return this.props.latitude
  }
  get longitude(): number {
    return this.props.longitude
  }
  get phone(): string {
    return this.props.phone
  }
  /** Публичный API (camelCase): точка работает 24/7. Маппится на `pharmacies.is_24_7`. */
  get isOpen24x7(): boolean {
    return this.props.is24_7
  }
  get openingTime(): string | null {
    return this.props.openingTime
  }
  get closingTime(): string | null {
    return this.props.closingTime
  }
  get licenseNumber(): string {
    return this.props.licenseNumber
  }
  get licenseIssuingAuthority(): string | null {
    return this.props.licenseIssuingAuthority
  }
  get licenseIssueDate(): Date | null {
    return this.props.licenseIssueDate
  }
  get licenseExpiryDate(): Date | null {
    return this.props.licenseExpiryDate
  }
  get licenseScanUrl(): string | null {
    return this.props.licenseScanUrl
  }
  get pharmacistInChargeName(): string | null {
    return this.props.pharmacistInChargeName
  }
  get status(): OnboardingStatus {
    return this.props.status
  }
  get suspensionReason(): PharmacySuspensionReason | null {
    return this.props.suspensionReason
  }
  get isActive(): boolean {
    return this.props.isActive
  }
  get submittedAt(): Date | null {
    return this.props.submittedAt
  }

  // -------- Фабрики --------

  /**
   * Создание новой заявки точки в `draft`. `chainId` обязателен
   * (SRS-DOM-047 — соло-аптека создаётся через предварительный
   * `SubmitChainApplicationUseCase`, домен не знает про эту логику).
   */
  static create(cmd: PharmacyAccountCreateCommand): PharmacyAccount {
    if (!cmd.chainId || cmd.chainId.trim() === '') {
      throw new ValidationError('chainId is required for PharmacyAccount', { field: 'chainId' })
    }
    validateLength(cmd.name, 'name', NAME_MAX_LENGTH)
    validateLength(cmd.addressText, 'addressText', ADDRESS_MAX_LENGTH)
    validateLength(cmd.licenseNumber, 'licenseNumber', LICENSE_NUMBER_MAX_LENGTH)
    validateCoordinates(cmd.latitude, cmd.longitude)
    // `cmd.licenseExpiryDate` non-null гарантирован TS-типом; явная проверка
    // оставлена для защиты от вызова с `null as unknown as Date` (smoke-test).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime-рубеж: TS-тип `Date` (non-null) гарантирован компилятором, но обход через `null as unknown as Date` (smoke-test из внешнего контроллера) делает возможным null/undefined в рантайме; без проверки домен рухнет на `Math.abs(...)`.
    if (cmd.licenseExpiryDate === null) {
      throw new ValidationError('licenseExpiryDate is required for PharmacyAccount', {
        field: 'licenseExpiryDate',
      })
    }
    return new PharmacyAccount({
      id: cmd.id,
      chainId: cmd.chainId,
      name: cmd.name,
      addressText: cmd.addressText,
      landmarkTj: null,
      latitude: cmd.latitude,
      longitude: cmd.longitude,
      phone: cmd.phone,
      is24_7: false,
      openingTime: null,
      closingTime: null,
      licenseNumber: cmd.licenseNumber,
      licenseIssuingAuthority: null,
      licenseIssueDate: null,
      licenseExpiryDate: cmd.licenseExpiryDate,
      licenseScanUrl: null,
      pharmacistInChargeName: null,
      status: 'draft',
      suspensionReason: null,
      isActive: true,
      submittedAt: null,
    })
  }

  static restore(props: PharmacyAccountProps): PharmacyAccount {
    return new PharmacyAccount(props)
  }

  // -------- Методы-намерения --------

  /** Обновление полей заявки в `draft` или `rejected`. */
  updateApplication(update: AccountUpdate): PharmacyAccount {
    assertUpdatableStatus(this.status)
    return new PharmacyAccount({
      ...this.props,
      ...mergeAccountUpdate(this.props, update),
      submittedAt: null,
    })
  }

  /** `draft → pending_review` (REQ-ONBOARD-8, DTJ-066). */
  submitForReview(now: Date): PharmacyAccount {
    assertTransitionAllowed(this.status, 'pending_review')
    return new PharmacyAccount({ ...this.props, status: 'pending_review', submittedAt: now })
  }

  /** `pending_review → approved` (SRS-ADM-010, DTJ-068). */
  approve(actor: { readonly id: string }): PharmacyAccount {
    assertTransitionAllowed(this.status, 'approved')
    void actor
    return new PharmacyAccount({ ...this.props, status: 'approved' })
  }

  /** `pending_review → changes_requested` (SRS-ADM-011, DTJ-068). */
  requestChanges(actor: { readonly id: string }, _reason: string): PharmacyAccount {
    assertTransitionAllowed(this.status, 'changes_requested')
    void actor
    return new PharmacyAccount({ ...this.props, status: 'changes_requested' })
  }

  /** `pending_review → rejected` (SRS-ADM-011, DTJ-068). */
  reject(actor: { readonly id: string }, _reason: string): PharmacyAccount {
    assertTransitionAllowed(this.status, 'rejected')
    void actor
    return new PharmacyAccount({ ...this.props, status: 'rejected' })
  }

  /** `* → terminated` (SRS-ADM-011, DTJ-068). */
  terminate(actor: { readonly id: string }, _reason: string): PharmacyAccount {
    assertTransitionAllowed(this.status, 'terminated')
    void actor
    return new PharmacyAccount({ ...this.props, status: 'terminated' })
  }

  /**
   * `approved → active` (SRS-DOM-048). Принимает `parentChainStatus`
   * параметром — домен НЕ читает его сам (правило: `PharmacyChainStatusPort`
   * реализуется на application-слое этого же модуля).
   *
   * `parentChainStatus ∉ {'approved','active'}` → `ParentChainNotActiveError`.
   */
  activate(_actor: { readonly id: string }, parentChainStatus: OnboardingStatus): PharmacyAccount {
    if (this.status === 'suspended') {
      throw new AutomaticReactivationForbiddenError({
        pharmacyId: this.id,
        reason: 'direct_activate_from_suspended',
      })
    }
    if (!CHAIN_STATUSES_ALLOWING_PHARMACY_ACTIVE.has(parentChainStatus)) {
      throw new ParentChainNotActiveError(parentChainStatus)
    }
    assertTransitionAllowed(this.status, 'active')
    return new PharmacyAccount({ ...this.props, status: 'active' })
  }

  /**
   * `* → suspended` (SRS-DOM-050, SRS-DOM-161). `reason` — одна из
   * `PHARMACY_SUSPENSION_REASONS`. Возвращает НОВЫЙ объект с
   * `suspensionReason` (флаг `requiresForceCancelAction` вычисляется
   * в use case через `PHARMACY_SUSPENSION_REASONS_REQUIRING_FORCE_CANCEL`).
   */
  suspend(reason: PharmacySuspensionReason, _actor: { readonly id: string }): PharmacyAccount {
    void _actor
    // Рантайм-рубеж (SRS-DOM-050): `PharmacySuspensionReason` — только
    // compile-time гарантия, вызывающий код может обойти её через `as`/`any`
    // (например, DTO из HTTP-запроса после Zod validation, если схема и VO
    // разойдутся). Без явной проверки здесь `suspensionReason` мог принять
    // произвольную строку, не входящую в `PHARMACY_SUSPENSION_REASONS`.
    if (!PHARMACY_SUSPENSION_REASONS.includes(reason)) {
      throw new ValidationError(`Invalid suspension reason: ${reason}`, { field: 'reason' })
    }
    assertTransitionAllowed(this.status, 'suspended')
    return new PharmacyAccount({
      ...this.props,
      status: 'suspended',
      suspensionReason: reason,
    })
  }

  /** `suspended → pending_review` (SRS-ADM-019, DTJ-074). */
  requestReactivation(): PharmacyAccount {
    assertTransitionAllowed(this.status, 'pending_review')
    return new PharmacyAccount({ ...this.props, status: 'pending_review' })
  }

  /**
   * `active → pending_review` при изменении адреса (SRS-DOM-049).
   * `addressText`/`latitude`/`longitude` обновляются, `status`
   * переводится в `'pending_review'` для повторной верификации
   * с `review_reason='address_change'` (SRS-ADM-012).
   */
  updateAddress(update: {
    readonly addressText: string
    readonly latitude: number
    readonly longitude: number
    readonly landmarkTj?: string | null
  }): PharmacyAccount {
    if (this.props.status !== 'active') {
      throw new ValidationError(
        'updateAddress is only allowed when pharmacy is active (SRS-DOM-049)',
        { field: 'status' },
      )
    }
    validateCoordinates(update.latitude, update.longitude)
    validateLength(update.addressText, 'addressText', ADDRESS_MAX_LENGTH)
    return new PharmacyAccount({
      ...this.props,
      addressText: update.addressText,
      latitude: update.latitude,
      longitude: update.longitude,
      landmarkTj: update.landmarkTj ?? this.props.landmarkTj,
      status: 'pending_review',
      // submittedAt НЕ сбрасывается, чтобы новая карточка в очереди
      // оператора ссылалась на момент последней подачи (SLA-учёт).
    })
  }
}
