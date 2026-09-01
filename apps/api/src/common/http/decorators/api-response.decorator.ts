/**
 * `@ApiSuccessResponse(dto)` (EP-01, DTJ-018) — вспомогательный method
 * декоратор. Контракт: устанавливает `SetMetadata` для будущей интеграции с
 * `OpenAPI`-генерацией (DTJ-021).
 *
 * На данный момент — `no-op` (метаданные устанавливаются, но не читаются).
 * DTJ-021 подключит чтение через `Reflector` и сгенерирует OpenAPI-описание
 * ответа на основе Zod-схемы.
 *
 * НЕ реализует логику самостоятельно — только metadata, как `@Roles(...)` в
 * будущем DTJ-022.
 */
import { SetMetadata } from '@nestjs/common'

export const API_SUCCESS_RESPONSE_KEY = 'api:success-response'

export interface ApiSuccessResponseMeta {
  /** Имя DTO-класса (zod-schema) для тела ответа. */
  dtoName: string
  /** HTTP-статус успешного ответа. */
  status: number
}

/** `@ApiSuccessResponse({ dtoName: 'AuthOtpResponseDto', status: 200 })` */
export const ApiSuccessResponse = (meta: ApiSuccessResponseMeta): MethodDecorator =>
  SetMetadata(API_SUCCESS_RESPONSE_KEY, meta)
