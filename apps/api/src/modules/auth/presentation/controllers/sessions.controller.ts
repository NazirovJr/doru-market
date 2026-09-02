/**
 * `SessionsController` (EP-01, DTJ-026, SRS-API-029/030) — 4 эндпоинта
 * self-service по управлению устройствами.
 *
 *   - `POST /api/v1/auth/logout`          — отзыв ТЕКУЩЕЙ сессии (тело: `refreshToken`).
 *   - `POST /api/v1/auth/logout-all`      — отзыв ВСЕХ сессий пользователя (без тела).
 *   - `GET  /api/v1/auth/sessions`        — список активных устройств.
 *   - `DELETE /api/v1/auth/sessions/:id`  — отзыв конкретного устройства.
 *
 * ВСЕ 4 эндпоинта требуют `AuthGuard` (DTJ-026 §3.5: «ВСЕ 4 эндпоинта
 * требуют `AuthGuard`»). Это АРХИТЕКТУРНОЕ РЕШЕНИЕ тикета: даже `logout`
 * требует access-токен, чтобы знать `currentUserId` для проверки владения.
 * Если клиент хочет logout при истёкшем access'е (но валидном refresh) —
 * обязан сначала `refresh` (DTJ-025), потом `logout`. Или просто перестать
 * использовать refresh локально (токен и так истечёт по `absoluteExpiresAt`).
 *
 * Никаких `@Roles(...)` — это self-service, доступен любой
 * аутентифицированной роли (customer/pharmacist/courier/etc.).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { isErr } from '@dorutj/domain-kernel'
// Внутренние импорты — ПРЯМО из файла (D-27: barrel — только для межмодульного).
import { AuthGuard } from '@/modules/auth/presentation/guards/auth.guard.js'
import { CurrentUser } from '@/modules/auth/presentation/decorators/current-user.decorator.js'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { type JwtClaims } from '@/modules/auth/application/ports/jwt-signer.port.js'
import { LogoutUseCase } from '@/modules/auth/application/use-cases/logout.use-case.js'
import { LogoutAllUseCase } from '@/modules/auth/application/use-cases/logout-all.use-case.js'
import { ListSessionsUseCase, type SessionSummary } from '@/modules/auth/application/use-cases/list-sessions.use-case.js'
import { RevokeSessionUseCase } from '@/modules/auth/application/use-cases/revoke-session.use-case.js'
import { type LogoutDto, logoutDtoSchema } from '@/modules/auth/presentation/dto/logout.dto.js'

const HTTP_NO_CONTENT = 204
const HTTP_OK = 200

interface SessionResponseItem {
  readonly id: string
  readonly deviceLabel: string
  readonly ipAddress: string
  readonly userAgent: string
  readonly lastSeenAt: string
  readonly createdAt: string
  readonly isCurrent: boolean
}

@Controller({ path: 'auth', version: '1' })
@UseGuards(AuthGuard)
export class SessionsController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  // eslint-disable-next-line max-params -- 4 DI-инъекции, NestJS constructor injection резолвит по позиции; единый options-объект не идиоматичен для Nest DI
  constructor(
    @Inject(LogoutUseCase) private readonly logoutUseCase: LogoutUseCase,
    @Inject(LogoutAllUseCase) private readonly logoutAllUseCase: LogoutAllUseCase,
    @Inject(ListSessionsUseCase) private readonly listSessionsUseCase: ListSessionsUseCase,
    @Inject(RevokeSessionUseCase) private readonly revokeSessionUseCase: RevokeSessionUseCase,
  ) {}

  /**
   * `POST /api/v1/auth/logout` — тело `{ refreshToken }`. 204 No Content при
   * успехе (включая идемпотентные пути «уже revoked» / «чужой refresh»).
   */
  @Post('logout')
  @HttpCode(HTTP_NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(logoutDtoSchema)) body: LogoutDto,
    @CurrentUser() user: JwtClaims,
  ): Promise<SuccessEnvelope<null> | ErrorEnvelope> {
    // `LogoutResult = Result<void, never>` — use case НИКОГДА не возвращает
    // ошибку (все нештатные пути идемпотентно `ok`, см. JSDoc LogoutUseCase),
    // поэтому err-ветка здесь была недостижимым мёртвым кодом.
    await this.logoutUseCase.execute({
      refreshToken: body.refreshToken,
      currentUserId: user.sub,
    })
    return ok(null)
  }

  /**
   * `POST /api/v1/auth/logout-all` — без тела. 204 No Content.
   */
  @Post('logout-all')
  @HttpCode(HTTP_NO_CONTENT)
  async logoutAll(@CurrentUser() user: JwtClaims): Promise<SuccessEnvelope<null> | ErrorEnvelope> {
    await this.logoutAllUseCase.execute({ userId: user.sub })
    return ok(null)
  }

  /**
   * `GET /api/v1/auth/sessions` — список активных устройств с маскированным IP.
   * `isCurrent` помечает запись, чей `id` совпадает с `sessionId` из JWT.
   */
  @Get('sessions')
  @HttpCode(HTTP_OK)
  async listSessions(
    @CurrentUser() user: JwtClaims,
  ): Promise<SuccessEnvelope<readonly SessionResponseItem[]> | ErrorEnvelope> {
    const result = await this.listSessionsUseCase.execute({
      userId: user.sub,
      currentSessionId: user.sessionId,
    })
    return ok(result.map(toResponseItem))
  }

  /**
   * `DELETE /api/v1/auth/sessions/:id` — отзыв конкретного устройства.
   * 403 `FORBIDDEN`, если сессия не принадлежит текущему пользователю.
   * 204 No Content при успехе.
   */
  @Delete('sessions/:id')
  @HttpCode(HTTP_NO_CONTENT)
  async revokeSession(
    @Param('id', new ParseUUIDPipe({ version: '4' })) sessionId: string,
    @CurrentUser() user: JwtClaims,
  ): Promise<SuccessEnvelope<null> | ErrorEnvelope> {
    const result = await this.revokeSessionUseCase.execute({
      sessionId,
      actorUserId: user.sub,
    })
    if (isErr(result)) {
      throw result.error
    }
    return ok(null)
  }
}

function toResponseItem(s: SessionSummary): SessionResponseItem {
  return {
    id: s.id,
    deviceLabel: s.deviceLabel,
    ipAddress: s.ipAddress,
    userAgent: s.userAgent,
    lastSeenAt: s.lastSeenAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    isCurrent: s.isCurrent,
  }
}
