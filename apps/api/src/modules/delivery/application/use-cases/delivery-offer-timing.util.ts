const DEFAULT_OFFER_ACCEPT_TIMEOUT_SECONDS = 45 // ASSUMPTION 45с (ticket «Что сделать» п.1)

/** Общий env-резолвер таймаута оффера — используется `CreateDeliveryAssignmentUseCase` и `EscalateDeliveryOfferService`. */
export function resolveOfferAcceptTimeoutSeconds(): number {
  const raw = process.env.OFFER_ACCEPT_TIMEOUT_SECONDS
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OFFER_ACCEPT_TIMEOUT_SECONDS
}
