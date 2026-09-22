/**
 * `NotificationsFeedController` (DTJ-372) — `GET /api/v1/notifications`.
 *
 * Аутентифицированный пользователь любой роли получает свои уведомления через курсорную пагинацию,
 * сортировку от новых к старым, фильтр по статусу. Чужие уведомления недостижимы: `userId` берётся
 * из JWT, в query такого параметра нет вообще.
 *
 * Контроллер объявлен ЭТИМ тикетом (DTJ-372) как часть presentation-слоя `notifications` модуля.
 * Отдельный файл — соответствие разделу 0 `02-CleanArchitecture.md`.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { AuthGuard, RolesGuard, Roles } from '@/modules/auth/index.js'
import { CurrentUser, type JwtClaims } from '@/modules/auth/index.js'
import { ok, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { encodeCursor } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { cursorQuerySchema } from '@dorutj/contracts'
import { ListOwnNotificationsUseCase } from '../application/use-cases/list-own-notifications.use-case.js'
import { parseListCursor, parseStatusFilter } from './notifications-query.util.js'
import { toNotificationSummary } from './notification-summary.mapper.js'
import { USER_ROLES } from '@dorutj/contracts'

@Controller({ path: 'notifications', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...USER_ROLES)
export class NotificationsFeedController {
  public constructor(
    @Inject(ListOwnNotificationsUseCase) private readonly listOwnNotifications: ListOwnNotificationsUseCase,
  ) {}

  @Get()
  public async list(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: { limit: number; cursor?: string | undefined },
    @Query('filter[status]') statusRaw: string | undefined,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly unknown[]>> {
    const result = await this.listOwnNotifications.execute({
      actor: { userId: claims.sub, tenantId: claims.tenantId },
      statuses: parseStatusFilter(statusRaw),
      limit: query.limit,
      cursor: parseListCursor(query.cursor),
    })

    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }

    return ok(result.items.map(toNotificationSummary), { pagination: meta })
  }
}
