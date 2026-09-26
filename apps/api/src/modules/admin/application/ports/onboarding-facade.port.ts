// Сужение OnboardingFacade (useExisting в admin.module.ts) до методов, нужных admin — тот же
// приём расширения чужого фасада, что getPharmacyNames (DTJ-227), не отдельный адаптер.
export const ONBOARDING_FACADE_PORT = Symbol.for('@dorutj/admin/onboarding-facade-port')

export interface PharmacyAccountsAnyFilter {
  readonly status?: string
  readonly chainId?: string
  readonly nameLike?: string
}

export interface PharmacyAccountsCursor {
  readonly v: string
  readonly id: string
}

export interface PharmacyAccountsAnyPagination {
  readonly limit: number
  readonly cursor?: PharmacyAccountsCursor | null
}

export interface PharmacyAccountAdminSummaryView {
  readonly id: string
  readonly chainId: string | null
  readonly chainName: string | null
  readonly name: string
  readonly status: string
  readonly licenseExpiryDate: Date | null
}

export interface PharmacyAccountsAnyPage {
  readonly items: readonly PharmacyAccountAdminSummaryView[]
  readonly nextCursor: PharmacyAccountsCursor | null
  readonly hasMore: boolean
}

export interface OnboardingFacadePort {
  findPharmacyAccountsAny(filter: PharmacyAccountsAnyFilter, pagination: PharmacyAccountsAnyPagination): Promise<PharmacyAccountsAnyPage>
  // Несуществующая аптека — null, не throw (policy use case'а сама решает, что с этим делать).
  getPharmacyChainId(pharmacyId: string): Promise<string | null>
}
