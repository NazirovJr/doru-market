/** Чистые функции экрана OTP вручения (DTJ-312, SRS-PHT-027/028/029) — 1:1 приём `picking.model.ts`. */

export function isOtpExpired(expiresAt: string, nowMs: number): boolean {
  return nowMs > new Date(expiresAt).getTime()
}
