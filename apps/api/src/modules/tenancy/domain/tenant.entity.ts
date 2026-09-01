/**
 * `Tenant` — корень агрегата (`02` §1, `10-domain-model.md` §«Tenant — domain»).
 * Содержит `TenantSettings` (value entity) + `courierSourcingMode` (не выносится в
 * `tenant_settings` — поле `tenants.courier_sourcing_mode`, см. `11-database-schema.md`
 * §13). Инварианты:
 *
 * - SRS-DOM-042: ровно один тенант `is_neutral=true`, `chain_id=NULL`; `rename()`
 *   бросает `ImmutableNeutralTenantError` для нейтрального тенанта.
 * - SRS-DOM-043: `slug` — VO `TenantSlug`, неизменяем после `create()`.
 * - SRS-DOM-044: `customDomain` уникален — проверка в репозитории (UNIQUE-индекс
 *   как последний рубеж), `attachCustomDomain()` нормализует и переводит статус
 *   в `pending_verification`.
 * - SRS-DOM-045: `courierSourcingMode` — VO-enum (см. `courier-sourcing-mode.vo.ts`).
 * - SRS-DOM-046: `tenant.settings.brandName` — ЕДИНСТВЕННЫЙ источник строки бренда,
 *   никакого хардкода «DoruTJ» в коде или UI.
 *
 * Чистый domain (`02` §2.6): нет `Date.now()`, `process.env`, I/O, ID-генерация
 * через порт `IdGenerator` (когда нужен — здесь используется UUID-строка,
 * переданная `restore()` из инфраструктуры).
 */
import { ValidationError } from '@dorutj/contracts'
import { type TenantId } from './value-objects/tenant-id.vo.js'
import { type TenantSlug } from './value-objects/tenant-slug.vo.js'
import { CourierSourcingModeVO } from './value-objects/courier-sourcing-mode.vo.js'
import type { CourierSourcingMode } from './value-objects/courier-sourcing-mode.vo.js'
import { CustomDomainStatusVO } from './value-objects/custom-domain-status.vo.js'
import type { CustomDomainStatus } from './value-objects/custom-domain-status.vo.js'
import { type TenantSettings } from './tenant-settings.entity.js'
import type { TenantSettingsBrandingUpdate } from './tenant-settings.entity.js'
import { ImmutableNeutralTenantError } from './errors/immutable-neutral-tenant.error.js'

export interface TenantCreateOptions {
  readonly chainId: TenantId | null
  readonly isNeutral: boolean
  readonly initialSettings: TenantSettings
  readonly initialCourierSourcingMode?: CourierSourcingMode
}

const NEUTRAL_SLUG_VALUE = 'neutral'

/**
 * Snapshot всех полей `Tenant` — используется в `restore()` и при построении
 * нового объекта из текущего (`{ ...this.props, ...patch }`). Избавляет от
 * конструктора с 9 позиционными аргументами (C1 `max-params`).
 */
export interface TenantProps {
  readonly id: TenantId
  readonly slug: TenantSlug
  readonly isNeutral: boolean
  readonly chainId: TenantId | null
  readonly customDomain: string | null
  readonly customDomainStatus: CustomDomainStatusVO
  readonly domainVerificationToken: string | null
  readonly settings: TenantSettings
  readonly courierSourcingMode: CourierSourcingModeVO
}

export class Tenant {
  private constructor(public readonly props: TenantProps) {}

  /** Геттеры полей (C12: `readonly public` плохо сочетается с инкапсуляцией). */
  get id(): TenantId {
    return this.props.id
  }
  get slug(): TenantSlug {
    return this.props.slug
  }
  get isNeutral(): boolean {
    return this.props.isNeutral
  }
  get chainId(): TenantId | null {
    return this.props.chainId
  }
  get customDomain(): string | null {
    return this.props.customDomain
  }
  get customDomainStatus(): CustomDomainStatusVO {
    return this.props.customDomainStatus
  }
  get domainVerificationToken(): string | null {
    return this.props.domainVerificationToken
  }
  get settings(): TenantSettings {
    return this.props.settings
  }
  get courierSourcingMode(): CourierSourcingModeVO {
    return this.props.courierSourcingMode
  }

  /**
   * Фабрика создания. Инвариант SRS-DOM-042 проверяется здесь: `isNeutral=true`
   * требует `chainId=null`. Параметр `id` — обязателен (UUID v7 через `IdGenerator`
   * из инфраструктуры, не `Math.random()`/`Date.now()`).
   *
   * `@param initialSettings` уже сконструирован через `TenantSettings.createForProvision`,
   * чтобы не дублировать default-логику здесь.
   */
  static create(id: TenantId, slug: TenantSlug, options: TenantCreateOptions): Tenant {
    if (options.isNeutral && options.chainId !== null) {
      throw new ValidationError('Neutral tenant must not have a chain_id (SRS-DOM-042)', { field: 'chainId' })
    }
    if (!options.isNeutral && options.chainId === null) {
      throw new ValidationError('Non-neutral tenant must have a chain_id', { field: 'chainId' })
    }
    if (options.isNeutral && slug.value !== NEUTRAL_SLUG_VALUE) {
      throw new ValidationError('Neutral tenant slug must be "neutral" (SRS-DOM-042)', { field: 'slug' })
    }
    return new Tenant({
      id,
      slug,
      isNeutral: options.isNeutral,
      chainId: options.chainId,
      customDomain: null,
      customDomainStatus: CustomDomainStatusVO.none(),
      domainVerificationToken: null,
      settings: options.initialSettings,
      courierSourcingMode: CourierSourcingModeVO.parse(options.initialCourierSourcingMode ?? 'platform_pool'),
    })
  }

  /** Восстановление из БД через маппер (DTJ-052). */
  static restore(props: {
    id: TenantId
    slug: TenantSlug
    isNeutral: boolean
    chainId: TenantId | null
    customDomain: string | null
    customDomainStatus: CustomDomainStatus
    domainVerificationToken: string | null
    settings: TenantSettings
    courierSourcingMode: CourierSourcingMode
  }): Tenant {
    return new Tenant({
      id: props.id,
      slug: props.slug,
      isNeutral: props.isNeutral,
      chainId: props.chainId,
      customDomain: props.customDomain,
      customDomainStatus: CustomDomainStatusVO.parse(props.customDomainStatus),
      domainVerificationToken: props.domainVerificationToken,
      settings: props.settings,
      courierSourcingMode: CourierSourcingModeVO.parse(props.courierSourcingMode),
    })
  }

  /**
   * SRS-DOM-042: нейтральный тенант нельзя переименовать. Для НЕнейтральных
   * тенантов сейчас `rename` НЕ открыт (slug — неизменяемое поле после `create()`,
   * SRS-DOM-043), но метод оставлен с явной проверкой, чтобы при будущем
   * пересмотре SRS-DOM-043 логика была в одном месте, а не разбросана.
   */
  rename(_newSlug: TenantSlug): this {
    if (this.isNeutral) {
      throw new ImmutableNeutralTenantError({ tenantId: this.id.value })
    }
    // Сейчас — no-op (slug неизменяем), оставлено как семантический якорь.
    return this
  }

  /**
   * SRS-DOM-044 + `26-module-tenancy-whitelabel.md` §12 п.3: нормализует домен
   * (lower-case, без trailing dot), переводит `customDomainStatus` в
   * `pending_verification`. Уникальность проверяет РЕПОЗИТОРИЙ (UNIQUE-индекс БД —
   * последний рубеж; DuplicateCustomDomainError бросается репозиторием при
   * нарушении).
   */
  attachCustomDomain(domain: string, verificationToken: string): Tenant {
    if (this.isNeutral) {
      throw new ImmutableNeutralTenantError({ tenantId: this.id.value, reason: 'cannot_attach_domain_to_neutral' })
    }
    const normalized = normalizeDomain(domain)
    return new Tenant({ ...this.props, customDomain: normalized, customDomainStatus: CustomDomainStatusVO.pending(), domainVerificationToken: verificationToken })
  }

  /**
   * Внутренний переход статуса верификации (вызывается из фоновой job DTJ-061
   * после успешной DNS-проверки). Не публичный use case — только инфраструктура.
   */
  markDomainVerified(): Tenant {
    if (this.customDomain === null) {
      throw new ValidationError('No custom domain attached', { field: 'customDomain' })
    }
    return new Tenant({ ...this.props, customDomainStatus: CustomDomainStatusVO.verified() })
  }

  /**
   * Отвязка custom_domain (например, при отзыве White-Label, SRS-TEN-035).
   * Возвращает НОВЫЙ объект (immutability, C13).
   */
  detachCustomDomain(): Tenant {
    if (this.isNeutral) {
      return this
    }
    return new Tenant({
      ...this.props,
      customDomain: null,
      customDomainStatus: CustomDomainStatusVO.none(),
      domainVerificationToken: null,
    })
  }

  /** SRS-DOM-045: переключение режима поиска курьеров. */
  setCourierSourcingMode(mode: CourierSourcingModeVO): Tenant {
    return new Tenant({ ...this.props, courierSourcingMode: mode })
  }

  /**
   * Применяет обновление брендинга к `settings` (делегирует, т.к. `settings` —
   * value entity с собственной иммутабельной мутацией). Возвращает НОВЫЙ объект.
   */
  updateBranding(update: TenantSettingsBrandingUpdate): Tenant {
    return new Tenant({ ...this.props, settings: this.settings.updateBranding(update) })
  }
}

/** Нормализация домена: lower-case, trim, без trailing dot (DNS-конвенция). */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/u, '')
}
