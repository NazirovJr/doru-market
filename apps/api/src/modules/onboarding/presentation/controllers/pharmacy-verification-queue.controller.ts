/**
 * `PharmacyVerificationQueueController` (DTJ-067) — очередь модерации
 * `super_admin` для заявок `pending_review`. Защищён `@Roles('super_admin')` +
 * permission `pharmacy-accounts:approve`.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { ok } from '@dorutj/contracts'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import {
  ListPendingVerificationsUseCase,
  type ListVerificationsInput,
} from '@/modules/onboarding/application/use-cases/list-pending-verifications.use-case.js'

const DEFAULT_LIMIT = 20
const DEFAULT_OFFSET = 0

@Controller({ path: 'admin/verifications', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class PharmacyVerificationQueueController {
  // Явный @Inject: esbuild (vitest) не эмитит `design:paramtypes` — см. DTJ-001,
  // тот же приём, что и в `CategoriesController`.
  constructor(@Inject(ListPendingVerificationsUseCase) private readonly listPendingVerifications: ListPendingVerificationsUseCase) {}

  @Get('pharmacy-chains')
  async listChains(
    @Query('status') status?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ): Promise<unknown> {
    const input: ListVerificationsInput = {
      subjectType: 'chain',
      ...(status !== undefined ? { status } : {}),
      limit: parseIntOr(limitRaw, DEFAULT_LIMIT),
      offset: parseIntOr(offsetRaw, DEFAULT_OFFSET),
    }
    const result = await this.listPendingVerifications.execute(input)
    return ok(result)
  }

  @Get('pharmacy-accounts')
  async listPharmacies(
    @Query('status') status?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ): Promise<unknown> {
    const input: ListVerificationsInput = {
      subjectType: 'pharmacy',
      ...(status !== undefined ? { status } : {}),
      limit: parseIntOr(limitRaw, DEFAULT_LIMIT),
      offset: parseIntOr(offsetRaw, DEFAULT_OFFSET),
    }
    const result = await this.listPendingVerifications.execute(input)
    return ok(result)
  }
}

function parseIntOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback
  }
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}
