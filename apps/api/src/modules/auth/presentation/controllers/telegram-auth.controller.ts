/**
 * `TelegramAuthController` (EP-01, DTJ-027, SRS-API-031/032) — TWA-путь.
 *
 * `POST /api/v1/auth/telegram` — `{ initData: string }` → `200` пара токенов
 * или `4xx` с `error.code` (через `AllExceptionsFilter`):
 *   - `401 INVALID_TELEGRAM_INIT_DATA` — невалидная подпись.
 *   - `401 TELEGRAM_AUTH_DATE_EXPIRED` — `auth_date` старше 5 минут.
 *   - `503 SERVICE_UNAVAILABLE` (reason: `telegram_bot_not_configured`) —
 *     ENV `TELEGRAM_BOT_TOKEN_NEUTRAL` не настроен.
 *
 * `@Public()` (DTJ-022) — TWA открывается у неавторизованного пользователя
 * (это ПЕРВЫЙ вход). AuthGuard здесь не нужен.
 *
 * `ipAddress` и `userAgent` берутся из Fastify request, как в `OtpVerifyController`
 * (DTJ-024). `userAgent` особенно важен для TWA — помогает диагностировать
 * проблемы у клиента («старый TWA, новый TWA»).
 */
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common'
import { ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { Public } from '@/common/decorators/public.decorator.js'
// Внутренние импорты — ПРЯМО из файла (D-27).
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { HTTP_STATUS_OK } from '@/common/http/http-status.constants.js'
import {
  TelegramAuthUseCase,
  type TelegramAuthResult,
} from '@/modules/auth/application/use-cases/telegram-auth.use-case.js'
import {
  type TelegramAuthDto,
  telegramAuthDtoSchema,
} from '@/modules/auth/presentation/dto/telegram-auth.dto.js'

const IP_ADDRESS_PLACEHOLDER = '0.0.0.0'
const USER_AGENT_HEADER = 'user-agent'

interface FastifyLikeRequest {
  readonly ip?: string
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
}

interface TelegramAuthResponseBody {
  readonly accessToken: string
  readonly refreshToken: string
  readonly user: {
    readonly id: string
    readonly role: string
    readonly tenantId: string | null
    readonly phoneNumber: string | null
    readonly fullName: string | null
  }
  readonly telegram: {
    readonly telegramUserId: string
    readonly firstName: string
    readonly lastName: string | null
    readonly username: string | null
  }
}

@Controller({ path: 'auth', version: '1' })
export class TelegramAuthController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(TelegramAuthUseCase) private readonly useCase: TelegramAuthUseCase) {}

  @Public()
  @Post('telegram')
  @HttpCode(HTTP_STATUS_OK)
  async telegram(
    @Body(new ZodValidationPipe(telegramAuthDtoSchema)) dto: TelegramAuthDto,
    @Req() request: FastifyLikeRequest,
  ): Promise<SuccessEnvelope<TelegramAuthResponseBody> | ErrorEnvelope> {
    const ipAddress = request.ip ?? IP_ADDRESS_PLACEHOLDER
    const userAgent = extractUserAgent(request.headers[USER_AGENT_HEADER])
    const result = await this.useCase.execute({
      initData: dto.initData,
      ipAddress,
      userAgent,
    })
    if (!isOk(result)) throw result.error
    return ok(toResponseBody(result.value))
  }
}

function extractUserAgent(userAgent: string | string[] | undefined): string {
  return Array.isArray(userAgent) ? (userAgent[0] ?? '') : (userAgent ?? '')
}

function toResponseBody(value: TelegramAuthResult): TelegramAuthResponseBody {
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    // Telegram-путь ВСЕГДА имеет `phoneNumber: null` (до тех пор, пока
    // клиент не запросит phone на оформлении заказа). Возвращаем `null`,
    // НЕ пустую строку — это часть контракта API.
    user: {
      id: value.user.id,
      role: value.user.role,
      tenantId: value.user.tenantId,
      phoneNumber: value.user.phoneNumber,
      fullName: value.user.fullName,
    },
    telegram: value.telegram,
  }
}
