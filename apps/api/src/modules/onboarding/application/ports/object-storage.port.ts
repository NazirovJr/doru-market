/**
 * `ObjectStoragePort` (DTJ-065) — application-уровень контракт загрузки файлов.
 * Бросает `UnsupportedMediaTypeError`/`PayloadTooLargeError` при нарушении
 * ограничений, согласованных между `Upload` и адаптером.
 *
 * На момент DTJ-065 общий порт в EP-01 ещё не стабилизирован; здесь определён
 * УЗКИЙ контракт с минимальным API для онбординга. Когда EP-01 поставит общий
 * порт, ЗАМЕНИТЬ на переиспользование (правило `02` §1.2).
 */
export const OBJECT_STORAGE = Symbol.for('@dorutj/onboarding/object-storage')

export const ONBOARDING_DOCS_BUCKET = 'onboarding-docs'

export interface UploadFileInput {
  readonly buffer: Buffer
  readonly mimeType: string
  readonly sizeBytes: number
}

export interface UploadFileOptions {
  readonly bucket: string
  readonly allowedMimeTypes: readonly string[]
  readonly maxSizeBytes: number
}

export interface UploadedFile {
  readonly url: string
}

export interface TemporaryLinkInput {
  readonly storedUrl: string
  readonly bucket: string
  readonly ttlSeconds: number
}

export interface TemporaryLink {
  readonly url: string
  readonly contentType: string
}

export interface OpenTemporaryInput {
  readonly bucket: string
  readonly key: string
  readonly expires: number
  readonly signature: string
}

export interface OpenedObject {
  readonly body: Buffer
  readonly contentType: string
}

export interface ObjectStoragePort {
  upload(file: UploadFileInput, options: UploadFileOptions): Promise<UploadedFile>
  /** `null` — URL не принадлежит этому хранилищу (нельзя выдать ссылку). */
  createTemporaryLink(input: TemporaryLinkInput): TemporaryLink | null
  /** Только для адаптеров, которые сами отдают файл по подписанной ссылке; `null` — подпись неверна/истекла/файла нет. */
  openTemporary(input: OpenTemporaryInput): Promise<OpenedObject | null>
}
