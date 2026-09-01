/**
 * `OnboardingDocumentsController` (DTJ-065) — загрузка документов для онбординга
 * (`licenseScanUrl`, `registrationCertificateUrl` и др.). `@Public()` —
 * заявитель ещё не аутентифицирован.
 *
 * Ограничения: `image/*` и `application/pdf`, ≤ 10 МБ, bucket `onboarding-docs`.
 */
import { Body, Controller, Inject, Post, UsePipes } from '@nestjs/common'
import { Public } from '@/common/decorators/public.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { ok, OnboardingDocumentUploadRequestSchema, type OnboardingDocumentUploadRequest } from '@dorutj/contracts'
import { OBJECT_STORAGE, type ObjectStoragePort } from '@/modules/onboarding/application/ports/object-storage.port.js'

const BUCKET = 'onboarding-docs'
const ALLOWED_MIME_TYPES: readonly string[] = ['image/*', 'application/pdf']
const MAX_SIZE_MB = 10
const KB_PER_MB = 1024
const BYTES_PER_KB = 1024
const BYTES_PER_MB = KB_PER_MB * BYTES_PER_KB
const MAX_SIZE_BYTES = MAX_SIZE_MB * BYTES_PER_MB

@Controller({ path: 'onboarding-documents', version: '1' })
@Public()
export class OnboardingDocumentsController {
  constructor(@Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort) {}

  @Post()
  @UsePipes(new ZodValidationPipe(OnboardingDocumentUploadRequestSchema))
  async upload(@Body() body: OnboardingDocumentUploadRequest): Promise<unknown> {
    const buffer = Buffer.from(body.base64, 'base64')
    const result = await this.objectStorage.upload(
      { buffer, mimeType: body.mimeType, sizeBytes: buffer.byteLength },
      { bucket: BUCKET, allowedMimeTypes: ALLOWED_MIME_TYPES, maxSizeBytes: MAX_SIZE_BYTES },
    )
    return ok({ url: result.url })
  }
}
