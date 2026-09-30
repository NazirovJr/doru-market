const MS_PER_MINUTE = 60_000

export function minutesSince(isoTimestamp: string, nowMs: number): number {
  const elapsedMs = nowMs - new Date(isoTimestamp).getTime()
  return Math.max(1, Math.floor(elapsedMs / MS_PER_MINUTE))
}
