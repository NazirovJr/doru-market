/**
 * `LocalObjectStorageAdapter` (DTJ-065) — ЗАГЛУШКА-адаптер `ObjectStoragePort`
 * для development-среды. Сохраняет файлы в OS-tmpdir, возвращает `file://` URL.
 *
 * В production-сборке ЗАМЕНЯЕТСЯ MinIO/S3-адаптером (`27-module...` §11).
 */
import { randomUUID } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common'
import type { ObjectStoragePort, UploadFileInput, UploadFileOptions, UploadedFile } from '@/modules/onboarding/application/ports/object-storage.port.js'

@Injectable()
export class LocalObjectStorageAdapter implements ObjectStoragePort {
  async upload(file: UploadFileInput, options: UploadFileOptions): Promise<UploadedFile> {
    if (file.sizeBytes > options.maxSizeBytes) {
      throw new PayloadTooLargeException(`File too large: ${String(file.sizeBytes)} > ${String(options.maxSizeBytes)}`)
    }
    if (!options.allowedMimeTypes.some((allowed) => file.mimeType === allowed || matchMimeGlob(allowed, file.mimeType))) {
      throw new UnsupportedMediaTypeException(`MIME not allowed: ${file.mimeType}`)
    }
    const dir = join(tmpdir(), options.bucket)
    await mkdir(dir, { recursive: true })
    const filename = `${randomUUID()}.bin`
    const fullPath = join(dir, filename)
    await writeFile(fullPath, file.buffer)
    return { url: `file://${fullPath}` }
  }
}

/** Простая проверка `image/*` → любой `image/...`. */
function matchMimeGlob(pattern: string, actual: string): boolean {
  if (!pattern.endsWith('/*')) {
    return false
  }
  const prefix = pattern.slice(0, -1)
  return actual.startsWith(prefix)
}
