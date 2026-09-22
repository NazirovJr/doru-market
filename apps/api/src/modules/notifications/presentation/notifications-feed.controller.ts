/**
 * `NotificationsFeedController` (DTJ-372) — `GET /api/v1/notifications`.
 *
 * Аутентифицированный пользователь любой роли получает свои уведомления через курсорную пагинацию,
 * сортировку от новых к старым, фильтр по статусу. Чужие уведомления недостижимы: `userId` берётся
 * из JWT, в query такого параметра нет вообще.
 */
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import {
  cursorQuerySchema,
  encodeCursor,
  ok,
  USER_ROLES,
  type CursorQuery,
  type NotificationSummary,
  type PaginationMeta,
  type SuccessEnvelope,
} from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, CurrentUser, Roles, RolesGuard, type JwtClaims } from '@/modules/auth/index.js'
import { ListOwnNotificationsUseCase } from '../application/use-cases/list-own-notifications.use-case.js'
import { toNotificationSummary } from './notification-summary.mapper.js'
import { parseListCursor, parseStatusFilter } from './notifications-query.util.js'

@Controller({ path: 'notifications', version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(...USER_ROLES)
export class NotificationsFeedController {
  public constructor(
    @Inject(ListOwnNotificationsUseCase) private readonly listOwnNotifications: ListOwnNotificationsUseCase,
  ) {}

  @Get()
  public async list(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
    @Query('filter[status]') statusRaw: string | undefined,
    @CurrentUser() claims: JwtClaims,
  ): Promise<SuccessEnvelope<readonly NotificationSummary[]>> {
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
