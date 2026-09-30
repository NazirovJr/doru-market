import { describe, expect, it } from 'vitest'
import { LocalObjectStorageAdapter } from './local-object-storage.adapter.js'

const BUCKET = 'onboarding-docs-spec'
const OPTIONS = { bucket: BUCKET, allowedMimeTypes: ['image/*', 'application/pdf'], maxSizeBytes: 1024 }
const TTL_SECONDS = 60

function parseLink(url: string): { key: string; expires: number; signature: string } {
  const parsed = new URL(url, 'http://localhost')
  return {
    key: parsed.pathname.split('/').pop() ?? '',
    expires: Number(parsed.searchParams.get('expires')),
    signature: parsed.searchParams.get('signature') ?? '',
  }
}

async function uploadPdf(adapter: LocalObjectStorageAdapter, body = 'pdf-bytes'): Promise<string> {
  const buffer = Buffer.from(body)
  return (await adapter.upload({ buffer, mimeType: 'application/pdf', sizeBytes: buffer.byteLength }, OPTIONS)).url
}

describe('LocalObjectStorageAdapter — временные ссылки', () => {
  it('выдаёт ссылку на загруженный файл и открывает его по подписи', async () => {
    const adapter = new LocalObjectStorageAdapter()
    const storedUrl = await uploadPdf(adapter)
    const link = adapter.createTemporaryLink({ storedUrl, bucket: BUCKET, ttlSeconds: TTL_SECONDS })
    expect(link?.contentType).toBe('application/pdf')
    const opened = await adapter.openTemporary({ bucket: BUCKET, ...parseLink(link?.url ?? '') })
    expect(opened?.body.toString()).toBe('pdf-bytes')
    expect(opened?.contentType).toBe('application/pdf')
  })

  it('не подписывает URL вне своего каталога и не-file URL', () => {
    const adapter = new LocalObjectStorageAdapter()
    for (const storedUrl of ['file:///etc/passwd', 'https://example.com/a.pdf', 'javascript:alert(1)']) {
      expect(adapter.createTemporaryLink({ storedUrl, bucket: BUCKET, ttlSeconds: TTL_SECONDS })).toBeNull()
    }
  })

  it('отказывает при чужой подписи, истёкшем сроке и подделанном ключе', async () => {
    const adapter = new LocalObjectStorageAdapter()
    const link = adapter.createTemporaryLink({ storedUrl: await uploadPdf(adapter), bucket: BUCKET, ttlSeconds: TTL_SECONDS })
    const parsed = parseLink(link?.url ?? '')
    expect(await adapter.openTemporary({ bucket: BUCKET, ...parsed, signature: '0'.repeat(parsed.signature.length) })).toBeNull()
    expect(await adapter.openTemporary({ bucket: BUCKET, ...parsed, key: '../../etc/passwd' })).toBeNull()
    const expired = adapter.createTemporaryLink({ storedUrl: await uploadPdf(adapter), bucket: BUCKET, ttlSeconds: -1 })
    expect(await adapter.openTemporary({ bucket: BUCKET, ...parseLink(expired?.url ?? '') })).toBeNull()
    expect(await adapter.openTemporary({ bucket: BUCKET, ...parsed, expires: Number.NaN })).toBeNull()
  })

  it('ссылка от другого экземпляра (другой ключ подписи) не открывается', async () => {
    const issuer = new LocalObjectStorageAdapter()
    const link = issuer.createTemporaryLink({ storedUrl: await uploadPdf(issuer), bucket: BUCKET, ttlSeconds: TTL_SECONDS })
    expect(await new LocalObjectStorageAdapter().openTemporary({ bucket: BUCKET, ...parseLink(link?.url ?? '') })).toBeNull()
  })

  it('небезопасные типы (svg) хранит как octet-stream', async () => {
    const adapter = new LocalObjectStorageAdapter()
    const buffer = Buffer.from('<svg/>')
    const { url } = await adapter.upload({ buffer, mimeType: 'image/svg+xml', sizeBytes: buffer.byteLength }, OPTIONS)
    expect(adapter.createTemporaryLink({ storedUrl: url, bucket: BUCKET, ttlSeconds: TTL_SECONDS })?.contentType).toBe('application/octet-stream')
  })
})
