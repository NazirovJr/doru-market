/**
 * `assertPharmacyReportAccess`/`assertChainReportAccess` (DTJ-252, АС5) — ролевая политика ТРЁХ
 * query-классов этого тикета (`GetPharmacyPayoutsQuery`/`ExportPayoutsCsvQuery`/
 * `GetBillingInvoicesQuery`). Политика ЗДЕСЬ, не в guard/controller — тот же приём, что
 * `GetOrderLedgerQuery`/`assertOwnNetwork` (DTJ-248, `02` §3.4, «Риски» тикета: единая точка
 * политики, не разошедшаяся между слоями). Общий файл, а не 3 копии — ВСЕ три query-класса
 * проверяют БУКВАЛЬНО одно и то же «своя сеть» условие (единственная разница — допуск
 * `pharmacist`, см. АС5: `.../payouts` разрешает read-only СВОЮ аптеку, `.../billing-invoices`
 * — нет, инвойсы «сети» read-only отдельной аптеке не показываются вовсе).
 *
 * Несуществующая/чужая аптека для `pharmacy_admin`/`pharmacist` — `403`, БЕЗ подтверждения
 * существования (SRS-NFR-053 «не палим ID не-своих сетей», тот же приём, что
 * `PharmacyNotInChainScopeError`, `packages/contracts/src/domain-errors-security.ts`) — в
 * отличие от `GetOrderLedgerQuery`, где чужой ТЕНАНТ даёт `404` (там это другой конкретный
 * заказ, здесь — список под РОДИТЕЛЬСКИМ `:id`, для `super_admin` несуществующий `:id`
 * возвращает пустой список, не ошибку — типичная REST-семантика листинга под родителем).
 */
import { ForbiddenError, type UserRole } from '@dorutj/contracts'
import type { PharmacyChainLookupPort } from '@/modules/payments/application/ports/pharmacy-chain-lookup.port.js'

/** Общий вход всех трёх query'ей — актор из JWT-claims (`GetOrderLedgerController` — тот же набор полей). */
export interface PharmacyReportActor {
  readonly role: UserRole
  readonly chainId: string | null
  readonly pharmacyId: string | null
}

/** `.../payouts` (DTJ-252 АС3/АС5): `super_admin` — всегда; `pharmacy_admin` — своя сеть; `pharmacist` — ТОЛЬКО своя аптека (read-only). */
export async function assertPharmacyReportAccess(
  chainLookup: PharmacyChainLookupPort,
  pharmacyId: string,
  actor: PharmacyReportActor,
): Promise<void> {
  if (actor.role === 'pharmacist') {
    if (actor.pharmacyId !== pharmacyId) {
      throw new ForbiddenError('pharmacist may only view their own pharmacy', { pharmacyId })
    }
    return
  }
  await assertChainReportAccess(chainLookup, pharmacyId, actor)
}

/** `.../billing-invoices` (DTJ-252 п.5): `super_admin` — всегда; `pharmacy_admin` — своя сеть; НИКТО ДРУГОЙ (в т.ч. `pharmacist` — не читает инвойсы сети). */
export async function assertChainReportAccess(
  chainLookup: PharmacyChainLookupPort,
  pharmacyId: string,
  actor: Pick<PharmacyReportActor, 'role' | 'chainId'>,
): Promise<void> {
  if (actor.role === 'super_admin') {
    return
  }
  if (actor.role === 'pharmacy_admin') {
    const chainId = await chainLookup.findChainId(pharmacyId)
    if (chainId === null || actor.chainId === null || chainId !== actor.chainId) {
      throw new ForbiddenError('pharmacy does not belong to the pharmacy_admin network', { pharmacyId })
    }
    return
  }
  throw new ForbiddenError(`role "${actor.role}" is not authorized for this pharmacy report`)
}
