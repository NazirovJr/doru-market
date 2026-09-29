/**
 * `LocalObjectStorageAdapter` (DTJ-065) — ЗАГЛУШКА-адаптер `ObjectStoragePort`
 * для development-среды. Сохраняет файлы в OS-tmpdir, возвращает `file://` URL.
 * Временные ссылки — HMAC-подпись с ключом процесса (после рестарта ссылки протухают).
 *
 * В production-сборке ЗАМЕНЯЕТСЯ MinIO/S3-адаптером (`27-module...` §11).
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common'
import type {
  ObjectStoragePort,
  OpenedObject,
  OpenTemporaryInput,
  TemporaryLink,
  TemporaryLinkInput,
  UploadFileInput,
  UploadFileOptions,
  UploadedFile,
} from '@/modules/onboarding/application/ports/object-storage.port.js'

const FILE_URL_PREFIX = 'file://'
const MS_PER_SECOND = 1000
const SIGNING_KEY_BYTES = 32
const LINK_ROUTE = '/api/v1/onboarding-documents/files'
const FALLBACK_EXTENSION = 'bin'
const FALLBACK_CONTENT_TYPE = 'application/octet-stream'
// Только безопасные для inline-показа типы; прочее (например, svg с скриптами) хранится как `.bin`.
const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  [FALLBACK_EXTENSION]: FALLBACK_CONTENT_TYPE,
}
const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{3,4}$/u

@Injectable()
export class LocalObjectStorageAdapter implements ObjectStoragePort {
  private readonly signingKey = randomBytes(SIGNING_KEY_BYTES)

  async upload(file: UploadFileInput, options: UploadFileOptions): Promise<UploadedFile> {
    if (file.sizeBytes > options.maxSizeBytes) {
      throw new PayloadTooLargeException(`File too large: ${String(file.sizeBytes)} > ${String(options.maxSizeBytes)}`)
    }
    if (!options.allowedMimeTypes.some((allowed) => file.mimeType === allowed || matchMimeGlob(allowed, file.mimeType))) {
      throw new UnsupportedMediaTypeException(`MIME not allowed: ${file.mimeType}`)
    }
    const dir = join(tmpdir(), options.bucket)
    await mkdir(dir, { recursive: true })
    const filename = `${randomUUID()}.${EXTENSION_BY_MIME[file.mimeType] ?? FALLBACK_EXTENSION}`
    const fullPath = join(dir, filename)
    await writeFile(fullPath, file.buffer)
    return { url: `${FILE_URL_PREFIX}${fullPath}` }
  }

  createTemporaryLink(input: TemporaryLinkInput): TemporaryLink | null {
    const key = this.ownedKey(input.storedUrl, input.bucket)
    if (key === null) {
      return null
    }
    const expires = Math.floor(Date.now() / MS_PER_SECOND) + input.ttlSeconds
    const signature = this.sign(input.bucket, key, expires)
    return {
      url: `${LINK_ROUTE}/${key}?expires=${String(expires)}&signature=${signature}`,
      contentType: contentTypeOf(key),
    }
  }

  async openTemporary(input: OpenTemporaryInput): Promise<OpenedObject | null> {
    if (!OBJECT_KEY_PATTERN.test(input.key) || !Number.isFinite(input.expires) || input.expires * MS_PER_SECOND < Date.now()) {
      return null
    }
    const expected = Buffer.from(this.sign(input.bucket, input.key, input.expires))
    const actual = Buffer.from(input.signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return null
    }
    try {
      const body = await readFile(join(tmpdir(), input.bucket, input.key))
      return { body, contentType: contentTypeOf(input.key) }
    } catch {
      return null
    }
  }

  // storedUrl приходит от заявителя — подписываем только файлы, лежащие ровно в каталоге нашего бакета.
  private ownedKey(storedUrl: string, bucket: string): string | null {
    if (!storedUrl.startsWith(FILE_URL_PREFIX)) {
      return null
    }
    const path = storedUrl.slice(FILE_URL_PREFIX.length)
    const key = basename(path)
    return dirname(path) === join(tmpdir(), bucket) && OBJECT_KEY_PATTERN.test(key) ? key : null
  }

  private sign(bucket: string, key: string, expires: number): string {
    return createHmac('sha256', this.signingKey).update(`${bucket}/${key}/${String(expires)}`).digest('hex')
  }
}

function contentTypeOf(key: string): string {
  return CONTENT_TYPE_BY_EXTENSION[key.slice(key.lastIndexOf('.') + 1)] ?? FALLBACK_CONTENT_TYPE
}

/** Простая проверка `image/*` → любой `image/...`. */
function matchMimeGlob(pattern: string, actual: string): boolean {
  if (!pattern.endsWith('/*')) {
    return false
  }
  const prefix = pattern.slice(0, -1)
  return actual.startsWith(prefix)
}
