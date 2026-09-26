const DEFAULT_COURIER_DEPART_SLA_MINUTES = 10 // ASSUMPTION

// Общий env-резолвер, тот же приём, что resolveOfferAcceptTimeoutSeconds.
export function resolveCourierDepartSlaMinutes(): number {
  const raw = process.env.COURIER_DEPART_SLA_MINUTES
  const parsed = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COURIER_DEPART_SLA_MINUTES
}
