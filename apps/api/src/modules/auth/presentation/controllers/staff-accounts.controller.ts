/**
 * `StaffAccountsController` (EP-01, DTJ-030, SRS-API-035) — административный
 * эндпоинт создания staff-аккаунтов.
 *
 * `POST /api/v1/staff-accounts` — `{ phone, fullName, role, pharmacyId?, chainId? }`
 *   → `201 { data: { userId, role } }` или `4xx` с `error.code` (через
 *   `AllExceptionsFilter`, DTJ-029).
 *
 * Защита (`@UseGuards(AuthGuard, RolesGuard)` + `@Roles('pharmacy_admin',
 * 'super_admin')`):
 *   - `AuthGuard` — аутентификация (валидный JWT, иначе `401 UNAUTHENTICATED`).
 *   - `RolesGuard` — ГРУБАЯ проверка роли (DTJ-022): `role` входит в
 *     `['pharmacy_admin', 'super_admin']`, иначе `403 INSUFFICIENT_ROLE`.
 *
 * ТОНКАЯ проверка прав (ownership по `chainId`) — в `StaffAccountPolicy`,
 * ВНУТРИ use case'а (SRS-API-036). Контроллер не дублирует эту логику.
 *
 * `tenantId` берётся из JWT (`actor.tenantId`), НЕ из тела запроса — иначе
 * actor мог бы создавать staff в чужом тенанте (SRS-API-045 cross-tenant
 * защита, даже в R1 placeholder'е).
 */
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ok, type ErrorEnvelope, type SuccessEnvelope } from '@dorutj/contracts'
import { isOk } from '@dorutj/domain-kernel'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard } from '@/modules/auth/presentation/guards/auth.guard.js'
import { RolesGuard } from '@/modules/auth/presentation/guards/roles.guard.js'
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator.js'
import {
  CreateStaffAccountUseCase,
  type CreateStaffAccountResult,
} from '@/modules/auth/application/use-cases/create-staff-account.use-case.js'
import {
  createStaffAccountDtoSchema,
  type CreateStaffAccountDto,
} from '@/modules/auth/presentation/dto/create-staff-account.dto.js'
import { CurrentUser } from '@/modules/auth/presentation/decorators/current-user.decorator.js'
import { type JwtClaims } from '@/modules/auth/application/ports/jwt-signer.port.js'

@Controller({ path: 'staff-accounts', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('pharmacy_admin', 'super_admin')
export class StaffAccountsController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `HealthController`.
  constructor(@Inject(CreateStaffAccountUseCase) private readonly useCase: CreateStaffAccountUseCase) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodValidationPipe(createStaffAccountDtoSchema)) dto: CreateStaffAccountDto,
    @CurrentUser() actor: JwtClaims,
  ): Promise<SuccessEnvelope<CreateStaffAccountResult> | ErrorEnvelope> {
    const result = await this.useCase.execute(actor, {
      phone: dto.phone,
      fullName: dto.fullName,
      role: dto.role,
      ...(dto.pharmacyId !== undefined ? { pharmacyId: dto.pharmacyId } : {}),
      ...(dto.chainId !== undefined ? { chainId: dto.chainId } : {}),
    })
    if (!isOk(result)) throw result.error
    return ok(result.value)
  }
}
