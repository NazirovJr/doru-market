/**
 * `MeController` (EP-01, DTJ-028 follow-up, SRS-API-025) — endpoint профиля
 * текущего аутентифицированного пользователя.
 *
 * `GET /api/v1/auth/me` → `200 { data: { id, role, tenantId, phoneNumber,
 * fullName, pharmacyId, chainId, telegramChatId, preferredLocale, isActive,
 * createdAt } }` или `4xx` с `error.code` (через `AllExceptionsFilter`,
 * DTJ-029).
 *
 * Защита — `@UseGuards(AuthGuard)` (НЕ `RolesGuard` — `me` доступен ЛЮБОЙ
 * аутентифицированной роли, включая `customer`).
 *
 * `tenantId`/`pharmacyId`/`chainId` в ответе берутся из БД (`User`-строка),
 * а НЕ из JWT-claims — могут быть свежее, чем claims. См. JSDoc в use case.
 *
 * `phoneNumber` в ответе — `string | null` (Telegram-путь без телефона,
 * DTJ-027). Клиент обрабатывает `null` явно.
 */
import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { AuthGuard } from '@/modules/auth/presentation/guards/auth.guard.js'
import { CurrentUser } from '@/modules/auth/presentation/decorators/current-user.decorator.js'
import { type JwtClaims } from '@/modules/auth/application/ports/jwt-signer.port.js'
import { GetMeUseCase, type GetMeResult } from '@/modules/auth/application/use-cases/get-me.use-case.js'

interface MeResponseBody {
  readonly id: string
  readonly role: string
  readonly tenantId: string | null
  readonly phoneNumber: string | null
  readonly fullName: string | null
  readonly pharmacyId: string | null
  readonly chainId: string | null
  readonly telegramChatId: string | null
  readonly preferredLocale: string
  readonly isActive: boolean
  readonly createdAt: string
}

@Controller({ path: 'auth/me', version: '1' })
@UseGuards(AuthGuard)
export class MeController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(GetMeUseCase) private readonly useCase: GetMeUseCase) {}

  @Get()
  async me(@CurrentUser() actor: JwtClaims): Promise<SuccessEnvelope<MeResponseBody> | ErrorEnvelope> {
    const result = await this.useCase.execute({ userId: actor.sub })
    if (isOk(result)) {
      return ok(toResponseBody(result.value))
    }
    throw result.error
  }
}

/** Presentation не имеет права знать `domain/user.js` напрямую — тип берём через use case. */
type MeProfile = Extract<GetMeResult, { readonly ok: true }>['value']

function toResponseBody(user: MeProfile): MeResponseBody {
  return {
    id: user.id,
    role: user.role,
    tenantId: user.tenantId,
    phoneNumber: user.phoneNumber,
    fullName: user.fullName,
    pharmacyId: user.pharmacyId,
    chainId: user.chainId,
    // `telegramChatId` — bigint в БД, в JSON сериализуется как число.
    // Клиент получит `number | null` и должен знать, что это bigint.
    telegramChatId:
      user.telegramChatId === null
        ? null
        : user.telegramChatId.toString(),
    preferredLocale: user.preferredLocale,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  }
}
