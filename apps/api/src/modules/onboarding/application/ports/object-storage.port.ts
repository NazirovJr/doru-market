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

export interface ObjectStoragePort {
  upload(file: UploadFileInput, options: UploadFileOptions): Promise<UploadedFile>
}
