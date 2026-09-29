/** Узкий порт для проверки «аптека принадлежит сети actor'а»; onboarding зависит от auth, обратный импорт дал бы цикл. */
export const PHARMACY_CHAIN_LOOKUP = Symbol.for('@dorutj/auth/pharmacy-chain-lookup')

export interface PharmacyChainLookupPort {
  /** `null` — аптеки нет либо она вне сети. */
  findChainIdByPharmacyId(pharmacyId: string): Promise<string | null>
}
