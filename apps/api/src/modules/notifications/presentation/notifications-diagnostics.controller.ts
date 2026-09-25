// READ-ONLY: получатель отдаётся только по userId, телефон/имя не запрашиваются у identity вовсе — нечего маскировать сверх уже опущенного.
import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { cursorQuerySchema, encodeCursor, ok, type CursorQuery, type PaginationMeta, type SuccessEnvelope } from '@dorutj/contracts'
import { ZodValidationPipe } from '@/common/validation/zod-validation.pipe.js'
import { AuthGuard, Roles, RolesGuard } from '@/modules/auth/index.js'
import type { NotificationChannel } from '../application/ports/notify-provider.port.js'
import type { NotificationStatus, UndeliveredNotificationGroup } from '../application/ports/notifications-repository.port.js'
import { ListUndeliveredNotificationsUseCase } from '../application/use-cases/list-undelivered-notifications.use-case.js'
import { parseListCursor } from './notifications-query.util.js'

export interface UndeliveredChannelAttemptDto {
  readonly channel: NotificationChannel
  readonly status: NotificationStatus
  readonly failedReason: string | null
  readonly attemptedAt: string
}

export interface UndeliveredNotificationDto {
  readonly userId: string
  readonly tenantId: string
  readonly eventType: string
  readonly sourceEventId: string
  readonly attempts: readonly UndeliveredChannelAttemptDto[]
  readonly lastAttemptAt: string
}

@Controller({ version: '1' })
@UseGuards(AuthGuard, RolesGuard)
@Roles('super_admin')
export class NotificationsDiagnosticsController {
  public constructor(
    @Inject(ListUndeliveredNotificationsUseCase) private readonly listUndelivered: ListUndeliveredNotificationsUseCase,
  ) {}

  @Get('notifications/undelivered')
  public async list(
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ): Promise<SuccessEnvelope<readonly UndeliveredNotificationDto[]>> {
    const result = await this.listUndelivered.execute({ limit: query.limit, cursor: parseListCursor(query.cursor) })
    const meta: PaginationMeta = {
      nextCursor: result.nextCursor === null ? null : encodeCursor(result.nextCursor),
      hasMore: result.hasMore,
      limit: query.limit,
    }
    return ok(result.items.map(toUndeliveredDto), { pagination: meta })
  }
}

function toUndeliveredDto(group: UndeliveredNotificationGroup): UndeliveredNotificationDto {
  return {
    userId: group.userId,
    tenantId: group.tenantId,
    eventType: group.eventType,
    sourceEventId: group.sourceEventId,
    attempts: group.attempts.map((attempt) => ({
      channel: attempt.channel,
      status: attempt.status,
      failedReason: attempt.failedReason,
      attemptedAt: attempt.attemptedAt.toISOString(),
    })),
    lastAttemptAt: group.lastAttemptAt.toISOString(),
  }
}
