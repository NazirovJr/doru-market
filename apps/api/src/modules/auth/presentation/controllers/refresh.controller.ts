/**
 * `RefreshController` (EP-01, DTJ-025, SRS-API-026) — `POST /api/v1/auth/refresh`.
 *
 * Принимает `{ refreshToken }` → `200 { data: { accessToken, refreshToken, user } }`
 * (SRS-API-026) или `401` (`REFRESH_TOKEN_INVALID` / `REFRESH_TOKEN_REUSE_DETECTED`).
 *
 * `@Public()` (DTJ-025 §3): сам refresh-токен — механизм аутентификации этого
 * запроса, не JWT `Authorization`-заголовок.
 *
 * `tenantId` — заглушка до полного `TenantResolutionMiddleware` (EP-02);
 * параметр use case в R1 не используется (см. `RefreshTokenInput`).
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common'
import { ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { Public } from '@/common/decorators/public.decorator.js'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import {
  RefreshTokenUseCase,
  type RefreshTokenResult,
} from '@/modules/auth/application/use-cases/refresh-token.use-case.js'
import { type RefreshDto, refreshDtoSchema } from '@/modules/auth/presentation/dto/refresh.dto.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'

const IP_ADDRESS_PLACEHOLDER = '0.0.0.0'

interface FastifyLikeRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly ip?: string
}

interface RefreshResponseBody {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: {
    readonly id: string
    readonly role: string
    readonly tenantId: string | null
    readonly phoneNumber: string
    readonly fullName: string | null
  }
}

@Controller({ path: 'auth', version: '1' })
export class RefreshController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(RefreshTokenUseCase) private readonly useCase: RefreshTokenUseCase) {}

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(refreshDtoSchema)) dto: RefreshDto,
    @Req() request: FastifyLikeRequest,
  ): Promise<SuccessEnvelope<RefreshResponseBody> | ErrorEnvelope> {
    const ipAddress = request.ip ?? IP_ADDRESS_PLACEHOLDER
    const result = await this.useCase.execute({
      refreshToken: dto.refreshToken,
      ipAddress,
    })
    if (!isOk(result)) throw result.error
    return ok(toResponseBody(result.value))
  }
}

function toResponseBody(value: RefreshTokenResult): RefreshResponseBody {
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    user: {
      id: value.user.id,
      role: value.user.role,
      tenantId: value.user.tenantId,
      // Refresh (DTJ-025) перевыпускает токен для пользователя, у которого
      // `phoneNumber` мог быть null (Telegram-путь DTJ-027). В этом случае
      // возвращаем пустую строку — клиент использует `accessToken` для
      // дальнейших запросов, phone здесь — диагностический.
      phoneNumber: value.user.phoneNumber ?? '',
      fullName: value.user.fullName,
    },
  }
}
