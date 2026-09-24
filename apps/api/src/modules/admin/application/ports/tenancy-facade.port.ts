/**
 * `TenancyFacadePort` (EP-15, DTJ-351) — узкий application-порт `admin` над модулем `tenancy`.
 *
 * `tenancy` НЕ экспортирует собственный класс-фасад (в отличие от `OnboardingFacade`/
 * `ORDERS_FACADE`/`PAYMENTS_FACADE`, см. JSDoc `admin.module.ts`) — только доменные классы и
 * репозиторные порты (`TENANT_REPOSITORY`/`TENANT_SETTINGS_REPOSITORY`, `modules/tenancy/
 * index.ts`). Реализация этого порта (`infrastructure/adapters/tenancy-facade.adapter.ts`)
 * поэтому строится НАПРЯМУЮ над `TENANT_REPOSITORY` — тот же приём, что `orders.
 * TenancyFacadeAdapter`/`payments` уже применяют для того же модуля (см. их JSDoc): НЕ
 * `useExisting` на чужой класс, а собственный `Injectable`-адаптер, `useClass` в
 * `admin.module.ts`.
 *
 * Три метода — РОВНО то, что нужно тикету DTJ-351 (Interface Segregation, DoD тикета):
 * список тенантов, деталь одного, патч настроек. Ничего из `Tenant`/`TenantSettings` сверх
 * полей, которые реально показывает/редактирует экран `apps/admin`.
 */

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

/** Только поля, реально патчащиеся этим тикетом (`TenantSettingsPatchSchema`, `@dorutj/contracts`). */
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
