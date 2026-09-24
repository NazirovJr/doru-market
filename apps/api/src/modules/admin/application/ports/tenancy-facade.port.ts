// tenancy не экспортирует свой класс-фасад — реализация ниже строится напрямую над TENANT_REPOSITORY.

export const TENANCY_FACADE_PORT = Symbol.for('@dorutj/admin/tenancy-facade')

export interface TenancyListCursor {
  readonly v: string
  readonly id: string
}

export interface TenancyListQuery {
  readonly limit: number
  readonly cursor?: TenancyListCursor | null
}

export interface TenantSummaryView {
  readonly id: string
  readonly slug: string
  readonly isNeutral: boolean
  readonly customDomain: string | null
  readonly brandName: string
  readonly createdAt: Date
}

export interface TenancyListPage {
  readonly items: readonly TenantSummaryView[]
  readonly nextCursor: TenancyListCursor | null
  readonly hasMore: boolean
}

export interface TenantDetailView {
  readonly id: string
  readonly slug: string
  readonly isNeutral: boolean
  readonly customDomain: string | null
  readonly brandName: string
  readonly brandLogoUrl: string | null
  readonly brandPalette: Readonly<Record<string, string>>
  readonly codLimitDiram: number
  readonly holdPeriodDays: number
}

export interface TenantSettingsPatch {
  readonly brandName?: string
  readonly brandLogoUrl?: string | null
  readonly brandPalette?: Readonly<Record<string, string>>
  readonly codLimitDiram?: number
  readonly holdPeriodDays?: number
}

export interface TenancyFacadeActor {
  readonly userId: string
}

export interface TenancyFacadePort {
  listTenants(query: TenancyListQuery): Promise<TenancyListPage>
  /** `null` — тенант с таким `id` не существует (use case мапит в `404 NOT_FOUND`). */
  getTenantById(id: string): Promise<TenantDetailView | null>
  /** `null` — тот же случай, ДО применения патча (тенант не найден, патч не применялся). */
  updateTenantSettings(tenantId: string, patch: TenantSettingsPatch, actor: TenancyFacadeActor): Promise<TenantDetailView | null>
}
