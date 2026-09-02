/**
 * `DetectStuckFullSyncSessionsUseCase` (EP-05, DTJ-152, SRS-INV-061).
 *
 * Защитная фоновая job, которая явно помечает «зависшие» full-sync
 * сессии (последняя страница `isLastPage=true` не пришла за
 * `FULL_SYNC_SESSION_TIMEOUT_MINUTES` с момента получения предыдущей
 * страницы) и публикует `FullSyncSessionStuckEvent` через
 * `InventoryOutboxPort`.
 *
 * **КРИТИЧНО:** этот use case НЕ вызывает `FullSyncCompletionPort` —
 * зануление отсутствующих позиций по неполным данным опасно
 * (DTJ-151, шаг 5). При зависании сессии уже применённые страницы
 * 1..N-1 остаются штатно применёнными; watchdog ТОЛЬКО диагностирует.
 *
 * Дедупликация — `InventoryOutboxPort.hasStuckAlert(...)` (см. тикет
 * §«Критерии приёмки» #4): повторный прогон cron НЕ дублирует событие
 * для уже заалерченной сессии в течение `FULL_SYNC_SESSION_TIMEOUT_MINUTES`.
 */
import { Inject, Injectable } from '@nestjs/common'
import {
  INVENTORY_OUTBOX,
  type InventoryOutboxPort,
} from '../ports/inventory-outbox.port.js'
import {
  INVENTORY_SYNC_BATCH_REPOSITORY,
  type InventorySyncBatchRepository,
} from '../ports/inventory-sync-batch.repository.port.js'

export interface DetectStuckFullSyncSessionsResult {
  readonly stuckSessionsCount: number
}

@Injectable()
export class DetectStuckFullSyncSessionsUseCase {
  constructor(
    @Inject(INVENTORY_SYNC_BATCH_REPOSITORY)
    private readonly syncBatchRepository: InventorySyncBatchRepository,
    @Inject(INVENTORY_OUTBOX) private readonly outbox: InventoryOutboxPort,
  ) {}

  async execute(
    olderThanMinutes: number,
  ): Promise<DetectStuckFullSyncSessionsResult> {
    const candidates = await this.syncBatchRepository.findIncompleteFullSyncSessions(
      olderThanMinutes,
    )
    // Сессии независимы (разные fullSyncSessionId, разные строки в outbox) —
    // дедуп-проверка и алерт каждой выполняются параллельно, а не
    // последовательно в цикле с await.
    const alertedFlags = await Promise.all(
      (
        candidates as readonly {
          fullSyncSessionId: string
          pharmacyId: string
          lastPageReceivedAt: Date
        }[]
      ).map(async (session) => {
        const alreadyAlerted = await this.outbox.hasStuckAlert(
          session.fullSyncSessionId,
          olderThanMinutes,
        )
        if (alreadyAlerted) return false
        this.outbox.appendStuckSession({
          eventType: 'inventory.full_sync_session.stuck',
          fullSyncSessionId: session.fullSyncSessionId,
          pharmacyId: session.pharmacyId,
          lastPageReceivedAt: session.lastPageReceivedAt,
        })
        return true
      }),
    )
    return { stuckSessionsCount: alertedFlags.filter(Boolean).length }
  }
}
