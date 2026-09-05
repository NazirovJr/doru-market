/**
 * Расчёт НДС/итога B2B-инвойса (DTJ-251, REQ-MON-9). Целочисленная bigint-арифметика в basis
 * points (правило 6 AGENTS.md — денежные поля никогда `float`), тот же формат знаменателя
 * (10000 = 100%), что `COMMISSION_BPS_DENOMINATOR` (`apps/api/.../order-item.entity.ts`,
 * EP-09/DTJ-221).
 *
 * `bankersRoundDivide` — банковское округление (round half to even), СКОПИРОВАНО буквально из
 * `order-item.entity.ts` (см. её JSDoc: SRS-ORD-022 «банковское округление до целого дирама»).
 * Не импортировано — `apps/worker` не может импортировать `apps/api`-домен (см. JSDoc
 * `cash-commission-aggregation.util.ts`); ОДИНАКОВЫЙ алгоритм на обеих денежных операциях
 * (комиссия/НДС) — намеренная консистентность, не изобретение новой конвенции округления.
 */
const TWO = 2n
const ONE = 1n
const ZERO = 0n

function bankersRoundDivide(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  const twiceRemainder = remainder * TWO
  if (twiceRemainder < denominator) return quotient
  if (twiceRemainder > denominator) return quotient + ONE
  return quotient % TWO === ZERO ? quotient : quotient + ONE // ровно половина дирама — округление к чётному
}

/** Basis points знаменатель (100% = 10000 bps) — тот же приём, что `COMMISSION_BPS_DENOMINATOR`. */
const BASIS_POINTS_DENOMINATOR = 10_000n

/**
 * ASSUMPTION (REQ-MON-9, тикет DTJ-251 «Риски»): ставка НДС 14% помечена в источнике как
 * требующая подтверждения налоговым консультантом — именованная константа (не буквальный
 * `0.14` внутри формулы), чтобы будущее уточнение ставки требовало правки ТОЛЬКО этого
 * значения, не логики `calculateVat` (DoD тикета).
 */
export const CASH_COMMISSION_VAT_RATE_BPS = 1_400n

export interface VatCalculationResult {
  readonly vatDiram: bigint
  readonly totalDiram: bigint
}

/** `vat = round_half_to_even(subtotal × CASH_COMMISSION_VAT_RATE_BPS / 10000)`, `total = subtotal + vat`. */
export function calculateVat(subtotalDiram: bigint): VatCalculationResult {
  const vatDiram = bankersRoundDivide(subtotalDiram * CASH_COMMISSION_VAT_RATE_BPS, BASIS_POINTS_DENOMINATOR)
  return { vatDiram, totalDiram: subtotalDiram + vatDiram }
}
