/**
 * Порт `PharmacyChainLookupPort` (DTJ-252) — минимальный доступ к `pharmacies.chain_id`, нужный
 * ТОЛЬКО ролевой авторизации `GetPharmacyPayoutsQuery`/`ExportPayoutsCsvQuery`/
 * `GetBillingInvoicesQuery` (АС5 тикета — `pharmacy_admin` видит СВОЮ сеть, `pharmacist` только
 * СВОЮ аптеку). Заведён ЭТИМ тикетом при query-классах (`02` §1.3), не при существующих
 * `PayoutScheduleRepository`/`PlatformBillingInvoiceRepository` — те два репозитория читают
 * РАЗНЫЕ таблицы (`payout_schedule`/`platform_billing_invoices`), а нужен ОБОИМ query-классам
 * ОДИН и тот же lookup над ТРЕТЬЕЙ, `pharmacies` — дублировать его в оба репозитория означало бы
 * два места, поддерживающих одну и ту же SQL-строку; общий узкий порт — меньшее зло.
 */
export const PHARMACY_CHAIN_LOOKUP = Symbol.for('@dorutj/payments/pharmacy-chain-lookup')

export interface PharmacyChainLookupPort {
  /** `pharmacies.chain_id` по `pharmacyId`. `null` — аптека не существует ИЛИ `chain_id IS NULL`. */
  findChainId(pharmacyId: string): Promise<string | null>
}
