/**
 * `ZodValidationPipe` — NestJS-pipe, валидирующий тело/params/query через
 * zod-схему. Использует единый формат ошибки `VALIDATION_ERROR` (`12-api-
 * conventions...md` §2.1, DTJ-018 `DomainExceptionFilter`).
 *
 * Применяется per-route:
 * `@Body(new ZodValidationPipe(SubmitChainApplicationRequestSchema)) dto: SubmitChainApplicationRequest`.
 *
 * Единая точка для проекта (DRY): общий файл `common/` — переиспользуется
 * всеми модулями (`tenancy` уже использует Zod в `tenant-settings` — но
 * inline; `onboarding` выносит в pipe для краткости контроллера).
 */
import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common'
import { z } from 'zod'
import { ErrorCode } from '@dorutj/contracts'

@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value)
    if (result.success) {
      return result.data
    }
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    throw new BadRequestException({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: { issues },
      },
    })
  }
}
