/**
 * `NotificationsFeedController` (DTJ-372) — `GET /api/v1/notifications`.
 *
 * Аутентифицированный пользователь любой роли получает свои уведомления через курсорную пагинацию,
 * сортировку от новых к старым, фильтр по статусу. Чужие уведомления недостижимы: `userId` берётся
 * из JWT, в query такого параметра нет вообще.
 *
 * Контроллер объявлен ЭТИМ тикетом (DTJ-372) как часть presentation-слоя `notifications` модуля.
 * Ранее контроллер был внутри `list-own-notifications.use-case.ts`, что нарушало Clean Architecture
 * (presentation внутри application). Отдельный файл — соответствие разделу 0 `02-CleanArchitecture.md`.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { AuthGuard, RolesGuard } from '@/modules/auth/index.js'
import { CurrentUser, type JwtClaims } from '@/modules/auth/index.js'
import { ok, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { encodeCursor, decodeCursor, type NotificationSummary } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { cursorQuerySchema } from '@dorutj/contracts'
import type { NotificationStatus } from '../application/ports/notifications-repository.port.js'
import { ListOwnNotificationsUseCase } from '../application/use-cases/list-own-notifications.use-case.js'

export interface ListOwnNotificationsCursor {
  readonly v: string
  readonly id: string
}

@Controller({ path: 'notifications', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
export class NotificationsFeedController {
  public constructor(
    @Inject(ListOwnNotificationsUseCase) private readonly listOwnNotifications: ListOwnNotificationsUseCase,
  ) {}

  @Get()
  public async list(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: { limit: number; cursor?: string | undefined; status?: string | undefined },
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly NotificationSummary[]>> {
    const status = query.status as NotificationStatus | undefined
    const cursor = query.cursor ? this.parseCursor(query.cursor) : null
    const result = await this.listOwnNotifications.execute({
      actor: { userId: claims.sub, tenantId: this.requireTenantId(claims) },
      status,
      limit: query.limit,
      cursor,
    })

    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }

    return ok(result.items, { pagination: meta })
  }

  private requireTenantId(claims: JwtClaims): string {
    if (claims.tenantId === null) {
      // `super_admin` не должен использовать этот эндпоинт — только tenant-scoped пользователи.
      // Это защитная проверка, так как `AuthSizePolicy` и `RolesGuard` уже фильтруют роли.
      throw new Error('notifications endpoint requires a tenant-scoped actor (super_admin is not allowed)')
    }
    return claims.tenantId
  }

  private parseCursor(raw: string): ListOwnNotificationsCursor | null {
    const decoded = decodeCursor(raw)
    if (!decoded || typeof decoded.v !== 'string' || typeof decoded.id !== 'string') {
      return null
    }
    return { v: decoded.v, id: decoded.id }
  }
}
