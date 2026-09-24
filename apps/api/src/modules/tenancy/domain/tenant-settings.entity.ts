/**
 * `TenantSettings` — value entity (`02` §2.3: без собственного жизненного цикла, полностью
 * подчинена `Tenant` агрегату; 1:1 с `tenants`). Хранит брендинг, per-tenant SLA/лимиты,
 * ссылки на секреты (НЕ сами секреты, см. `SecretsVaultPort` DTJ-058).
 *
 * Все мутации — только через методы-намерения (`updateBranding`, `setCourierSourcingMode`),
 * которые возвращают НОВЫЙ объект (immutability, C13), а не мутируют текущий. Так
 * `Tenant`-агрегат остаётся единственным местом, где собирается state, и его снимок
 * в `unitOfWork` не расходится с тем, что лежит в БД после коммита.
 *
 * Домен НЕ валидирует формат CSS-токенов в `brandPalette` — это ответственность
 * `BrandPaletteSchema` (Zod, `packages/contracts/src/tenancy.ts`, DTJ-059). Домен
 * хранит уже провалидированные значения.
 */
import { ValidationError } from '@dorutj/contracts'

const DEFAULT_COD_LIMIT_DIRAM = 50000n
const DEFAULT_HOLD_PERIOD_DAYS = 1
const DEFAULT_PICKUP_SLA_MINUTES = 7
const DEFAULT_PICKUP_SLA_BUFFER_MINUTES = 5
const DEFAULT_DELIVERY_SLA_CITY_MINUTES = 240
const DEFAULT_DELIVERY_SLA_REMOTE_MINUTES = 1440
const DEFAULT_DISPUTE_WINDOW_HOURS = 24
const DEFAULT_INVENTORY_DELTA_SLA_MINUTES = 5
const DEFAULT_RETURN_RESTOCK_MIN_REMAINING_DAYS = 30
const DEFAULT_LOCALE = 'tj'

export interface TenantSettingsBrand {
  readonly brandName: string
  readonly brandPalette: Readonly<Record<string, string>>
  readonly brandLogoUrl: string | null
}

export interface TenantSettingsBrandingUpdate {
  readonly brandName: string
  readonly brandPalette: Readonly<Record<string, string>>
  readonly brandLogoUrl: string | null
}

/**
 * ДОБАВЛЕНО (DTJ-351, EP-15) — `PATCH /tenant-settings/:id` (`super_admin`, `admin.
 * UpdateTenantSettingsUseCase`). В отличие от `TenantSettingsBrandingUpdate` (полная замена
 * трёх полей брендинга), это ЧАСТИЧНЫЙ патч: непереданное поле сохраняет текущее значение.
 * Формат HEX/значений уже провалидирован `TenantSettingsPatchSchema` (Zod,
 * `packages/contracts/src/admin/tenants.ts`) до попадания сюда — домен не переповторяет формат.
 */
export interface TenantSettingsAdminPatch {
  readonly brandName?: string
  readonly brandPalette?: Readonly<Record<string, string>>
  readonly brandLogoUrl?: string | null
  readonly codLimitDiram?: bigint
  readonly holdPeriodDays?: number
}

/**
 * Snapshot-структура всех полей `TenantSettings`. Используется как параметр
 * `restore()` и внутри `Tenant`-агрегата, чтобы не таскать 15 позиционных
 * аргументов. Поля записаны через `readonly` (C13 immutability, `02` §4).
 */
export interface TenantSettingsProps {
  readonly brandName: string
  readonly brandPalette: Readonly<Record<string, string>>
  readonly brandLogoUrl: string | null
  readonly merchantCredentialsRef: string | null
  readonly telegramBotTokenRef: string | null
  readonly codLimitDiram: bigint
  readonly holdPeriodDays: number
  readonly pickupSlaMinutes: number
  readonly pickupSlaBufferMinutes: number
  readonly deliverySlaCityMinutes: number
  readonly deliverySlaRemoteMinutes: number
  readonly disputeWindowHours: number
  readonly inventoryDeltaSlaMinutes: number
  readonly returnRestockMinRemainingDays: number
  readonly defaultLocale: string
}

export class TenantSettings {
  private constructor(public readonly props: TenantSettingsProps) {}

  /** Доступ к бренд-имени без необходимости раскрывать внутренние поля (C12). */
  get brandName(): string {
    return this.props.brandName
  }
  get brandPalette(): Readonly<Record<string, string>> {
    return this.props.brandPalette
  }
  get brandLogoUrl(): string | null {
    return this.props.brandLogoUrl
  }
  get merchantCredentialsRef(): string | null {
    return this.props.merchantCredentialsRef
  }
  get telegramBotTokenRef(): string | null {
    return this.props.telegramBotTokenRef
  }
  get codLimitDiram(): bigint {
    return this.props.codLimitDiram
  }
  get holdPeriodDays(): number {
    return this.props.holdPeriodDays
  }
  get pickupSlaMinutes(): number {
    return this.props.pickupSlaMinutes
  }
  get pickupSlaBufferMinutes(): number {
    return this.props.pickupSlaBufferMinutes
  }
  get deliverySlaCityMinutes(): number {
    return this.props.deliverySlaCityMinutes
  }
  get deliverySlaRemoteMinutes(): number {
    return this.props.deliverySlaRemoteMinutes
  }
  get disputeWindowHours(): number {
    return this.props.disputeWindowHours
  }
  get inventoryDeltaSlaMinutes(): number {
    return this.props.inventoryDeltaSlaMinutes
  }
  get returnRestockMinRemainingDays(): number {
    return this.props.returnRestockMinRemainingDays
  }
  get defaultLocale(): string {
    return this.props.defaultLocale
  }

  /**
   * Фабрика для ТОЛЬКО-что провизионированного тенанта (DTJ-057). Бренд и палитра
   * передаются как `initialBrandName` + нейтральный fallback, остальные поля —
   * пер-тенантские дефолты из `11-database-schema.md` §14.
   */
  static createForProvision(initialBrandName: string, initialPalette: Readonly<Record<string, string>>): TenantSettings {
    if (initialBrandName.length === 0) {
      throw new ValidationError('initialBrandName is required (SRS-TEN-038)', { field: 'initialBrandName' })
    }
    return new TenantSettings({
      brandName: initialBrandName,
      brandPalette: initialPalette,
      brandLogoUrl: null,
      merchantCredentialsRef: null,
      telegramBotTokenRef: null,
      codLimitDiram: DEFAULT_COD_LIMIT_DIRAM,
      holdPeriodDays: DEFAULT_HOLD_PERIOD_DAYS,
      pickupSlaMinutes: DEFAULT_PICKUP_SLA_MINUTES,
      pickupSlaBufferMinutes: DEFAULT_PICKUP_SLA_BUFFER_MINUTES,
      deliverySlaCityMinutes: DEFAULT_DELIVERY_SLA_CITY_MINUTES,
      deliverySlaRemoteMinutes: DEFAULT_DELIVERY_SLA_REMOTE_MINUTES,
      disputeWindowHours: DEFAULT_DISPUTE_WINDOW_HOURS,
      inventoryDeltaSlaMinutes: DEFAULT_INVENTORY_DELTA_SLA_MINUTES,
      returnRestockMinRemainingDays: DEFAULT_RETURN_RESTOCK_MIN_REMAINING_DAYS,
      defaultLocale: DEFAULT_LOCALE,
    })
  }

  /** Восстановление из БД (использует маппер DTJ-052). */
  static restore(props: TenantSettingsProps): TenantSettings {
    return new TenantSettings(props)
  }

  /**
   * Возвращает НОВЫЙ объект с применённым брендингом. Иммутабельность — C13
   * (`02` §4): входной объект не мутируется, чтобы в `unitOfWork` оставалась
   * согласованная ревизия.
   */
  updateBranding(update: TenantSettingsBrandingUpdate): TenantSettings {
    if (update.brandName.length === 0) {
      throw new ValidationError('brandName is required', { field: 'brandName' })
    }
    return new TenantSettings({
      brandName: update.brandName,
      brandPalette: update.brandPalette,
      brandLogoUrl: update.brandLogoUrl,
      merchantCredentialsRef: this.merchantCredentialsRef,
      telegramBotTokenRef: this.telegramBotTokenRef,
      codLimitDiram: this.codLimitDiram,
      holdPeriodDays: this.holdPeriodDays,
      pickupSlaMinutes: this.pickupSlaMinutes,
      pickupSlaBufferMinutes: this.pickupSlaBufferMinutes,
      deliverySlaCityMinutes: this.deliverySlaCityMinutes,
      deliverySlaRemoteMinutes: this.deliverySlaRemoteMinutes,
      disputeWindowHours: this.disputeWindowHours,
      inventoryDeltaSlaMinutes: this.inventoryDeltaSlaMinutes,
      returnRestockMinRemainingDays: this.returnRestockMinRemainingDays,
      defaultLocale: this.defaultLocale,
    })
  }

  /**
   * ДОБАВЛЕНО (DTJ-351) — см. JSDoc `TenantSettingsAdminPatch`. Возвращает НОВЫЙ объект
   * (immutability, C13); поля, отсутствующие в `patch`, копируются из текущего состояния.
   */
  applyAdminPatch(patch: TenantSettingsAdminPatch): TenantSettings {
    if (patch.brandName?.length === 0) {
      throw new ValidationError('brandName is required', { field: 'brandName' })
    }
    return new TenantSettings({
      ...this.props,
      brandName: patch.brandName ?? this.brandName,
      brandPalette: patch.brandPalette ?? this.brandPalette,
      brandLogoUrl: patch.brandLogoUrl !== undefined ? patch.brandLogoUrl : this.brandLogoUrl,
      codLimitDiram: patch.codLimitDiram ?? this.codLimitDiram,
      holdPeriodDays: patch.holdPeriodDays ?? this.holdPeriodDays,
    })
  }
}
