/**
 * `RefreshTokenGeneratorPort` (EP-01, DTJ-024, SRS-API-025) — порождает
 * opaque refresh-токен. Opaque = не JWT, не подлежит декодированию клиентом,
 * единственное использование — повторный POST на `/auth/refresh` (DTJ-025).
 *
 * Длина — 32 байта (256 бит) энтропии, base64url-кодирование без padding
 * (стандарт `RFC 4648 §5`). Генерируется через `crypto.randomBytes`.
 */
export const REFRESH_TOKEN_GENERATOR = Symbol.for('@dorutj/auth/refresh-token-generator')

export interface RefreshTokenGeneratorPort {
  generate(): { readonly token: string; readonly hash: string }
}
