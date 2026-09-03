/**
 * Unit-тесты `verifyHmacSha256Signature` (EP-10, DTJ-239, `02` C15) — общая функция,
 * используемая ВСЕМИ тремя верификаторами (mock/Alif/DC). Покрывает оба кодирования (hex,
 * base64), совпадение/несовпадение подписи, отсутствующий секрет/подпись, невалидную строку
 * кодирования.
 */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyHmacSha256Signature, type WebhookSignatureEncoding } from './webhook-hmac-signature.util.js'

const SECRET = 'shared-test-secret'
const BODY = Buffer.from(JSON.stringify({ a: 1 }))

function sign(secret: string, body: Buffer, encoding: WebhookSignatureEncoding): string {
  return createHmac('sha256', secret).update(body).digest(encoding)
}

describe('verifyHmacSha256Signature (DTJ-239)', () => {
  it.each(['hex', 'base64'] as const)('%s: валидная подпись → true', (encoding) => {
    const signature = sign(SECRET, BODY, encoding)
    expect(verifyHmacSha256Signature({ rawBody: BODY, providedSignature: signature, secret: SECRET, encoding })).toBe(true)
  })

  it.each(['hex', 'base64'] as const)('%s: чужой секрет → false', (encoding) => {
    const signature = sign('wrong-secret', BODY, encoding)
    expect(verifyHmacSha256Signature({ rawBody: BODY, providedSignature: signature, secret: SECRET, encoding })).toBe(false)
  })

  it('secret undefined → false, не бросает', () => {
    const signature = sign(SECRET, BODY, 'hex')
    expect(verifyHmacSha256Signature({ rawBody: BODY, providedSignature: signature, secret: undefined, encoding: 'hex' })).toBe(false)
  })

  it('providedSignature undefined → false, не бросает', () => {
    expect(verifyHmacSha256Signature({ rawBody: BODY, providedSignature: undefined, secret: SECRET, encoding: 'hex' })).toBe(false)
  })

  it('изменённое тело после подписи → false (целостность)', () => {
    const signature = sign(SECRET, BODY, 'base64')
    const tampered = Buffer.from(JSON.stringify({ a: 2 }))
    expect(verifyHmacSha256Signature({ rawBody: tampered, providedSignature: signature, secret: SECRET, encoding: 'base64' })).toBe(false)
  })

  it('невалидная hex-строка не бросает (лениво декодируется в короткий буфер → длина не совпадает)', () => {
    expect(verifyHmacSha256Signature({ rawBody: BODY, providedSignature: 'not-hex-zz', secret: SECRET, encoding: 'hex' })).toBe(false)
  })
})
