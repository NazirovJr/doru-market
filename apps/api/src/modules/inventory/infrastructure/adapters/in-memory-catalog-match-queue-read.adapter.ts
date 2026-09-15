/**
 * InMemory-реализация `CatalogMatchQueueReadPort` (EP-05, DTJ-163) — для unit-тестов
 * (тот же приём, что остальные `InMemory*`-адаптеры модуля: конструируется напрямую `new`,
 * не через DI). `setPending`/`countPending` — простая карта `pharmacyId → count`.
 */
import { Injectable } from '@nestjs/common'
import type { CatalogMatchQueueReadPort } from '@/modules/inventory/application/ports/catalog-match-queue-read.port.js'

@Injectable()
export class InMemoryCatalogMatchQueueReadAdapter implements CatalogMatchQueueReadPort {
  private readonly pendingByPharmacyId = new Map<string, number>()

  /** Тестовый сеттер — не часть порта. */
  setPending(pharmacyId: string, pendingCount: number): void {
    this.pendingByPharmacyId.set(pharmacyId, pendingCount)
  }

  countPending(pharmacyId: string): Promise<number> {
    return Promise.resolve(this.pendingByPharmacyId.get(pharmacyId) ?? 0)
  }
}
