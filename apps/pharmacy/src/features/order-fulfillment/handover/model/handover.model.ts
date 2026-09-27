export function isOtpExpired(expiresAt: string, nowMs: number): boolean {
  return nowMs > new Date(expiresAt).getTime()
}
