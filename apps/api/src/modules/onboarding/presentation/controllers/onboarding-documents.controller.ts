/**
 * `OnboardingDocumentsController` (DTJ-065) — загрузка документов для онбординга
 * (`licenseScanUrl`, `registrationCertificateUrl` и др.). `@Public()` —
 * заявитель ещё не аутентифицирован.
 *
 * Ограничения: `image/*` и `application/pdf`, ≤ 10 МБ, bucket `onboarding-docs`.
 * `GET files/:key` отдаёт файл по подписанной временной ссылке (подпись — единственный допуск).
 */
import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { Public } from '@/common/decorators/public.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { ok, OnboardingDocumentUploadRequestSchema, type OnboardingDocumentUploadRequest } from '@dorutj/contracts'
import { OBJECT_STORAGE, ONBOARDING_DOCS_BUCKET, type ObjectStoragePort } from '@/modules/onboarding/application/ports/object-storage.port.js'

const ALLOWED_MIME_TYPES: readonly string[] = ['image/*', 'application/pdf']
const MAX_SIZE_MB = 10
const KB_PER_MB = 1024
const BYTES_PER_KB = 1024
const BYTES_PER_MB = KB_PER_MB * BYTES_PER_KB
const MAX_SIZE_BYTES = MAX_SIZE_MB * BYTES_PER_MB
const DOCUMENT_CACHE_CONTROL = 'private, no-store'

@Controller({ path: 'onboarding-documents', version: '1' })
@Public()
export class OnboardingDocumentsController {
  constructor(@Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStoragePort) {}

  @Post()
  async upload(
    @Body(new ZodValidationPipe(OnboardingDocumentUploadRequestSchema)) body: OnboardingDocumentUploadRequest,
  ): Promise<unknown> {
    const buffer = Buffer.from(body.base64, 'base64')
    const result = await this.objectStorage.upload(
      { buffer, mimeType: body.mimeType, sizeBytes: buffer.byteLength },
      { bucket: ONBOARDING_DOCS_BUCKET, allowedMimeTypes: ALLOWED_MIME_TYPES, maxSizeBytes: MAX_SIZE_BYTES },
    )
    return ok({ url: result.url })
  }

  @Get('files/:key')
  async download(
    @Param('key') key: string,
    @Query() query: { readonly expires?: string; readonly signature?: string },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const opened = await this.objectStorage.openTemporary({
      bucket: ONBOARDING_DOCS_BUCKET,
      key,
      expires: Number(query.expires),
      signature: query.signature ?? '',
    })
    if (opened === null) {
      throw new NotFoundException()
    }
    reply.header('content-type', opened.contentType)
    reply.header('cache-control', DOCUMENT_CACHE_CONTROL)
    // Файл присылает заявитель: nosniff не даёт браузеру исполнить его как страницу.
    reply.header('x-content-type-options', 'nosniff')
    await reply.send(opened.body)
  }
}
