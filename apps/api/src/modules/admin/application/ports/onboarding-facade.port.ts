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

// DTJ-367: поля принадлежат PharmacyAccount (EP-03/onboarding) — admin только вызывает фасад, владение проверено use case'ом.
export interface UpdatePharmacyScheduleInput {
  readonly isOpen247: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
}

export interface UpdateDeliveryZoneInput {
  readonly maxDeliveryRadiusKm: number
}

export interface PharmacyScheduleView {
  readonly id: string
  readonly isOpen247: boolean
  readonly openingTime: string | null
  readonly closingTime: string | null
}

export interface PharmacyDeliveryZoneView {
  readonly id: string
  readonly maxDeliveryRadiusKm: number
}

export type PharmacyScheduleAndZoneView = PharmacyScheduleView & Pick<PharmacyDeliveryZoneView, 'maxDeliveryRadiusKm'>

export interface OnboardingFacadePort {
  findPharmacyAccountsAny(filter: PharmacyAccountsAnyFilter, pagination: PharmacyAccountsAnyPagination): Promise<PharmacyAccountsAnyPage>
  // Несуществующая аптека — null, не throw (policy use case'а сама решает, что с этим делать).
  getPharmacyChainId(pharmacyId: string): Promise<string | null>
  // Текущие значения формы (нужны фронту ДО первого PATCH) — несуществующая аптека — null.
  getScheduleAndZone(pharmacyId: string): Promise<PharmacyScheduleAndZoneView | null>
  // Несуществующая аптека — NotFoundError (use case доходит сюда только после успешной policy-проверки владения).
  updateSchedule(pharmacyId: string, update: UpdatePharmacyScheduleInput, actor: { readonly id: string }): Promise<PharmacyScheduleView>
  updateDeliveryZone(pharmacyId: string, update: UpdateDeliveryZoneInput, actor: { readonly id: string }): Promise<PharmacyDeliveryZoneView>
}
