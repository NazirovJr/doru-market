import { Injectable } from '@nestjs/common'
import type { OutboxEventRecord, OutboxReaderPort } from './outbox-reader.port.js'

/**
 * Временная заглушка `OutboxReaderPort` до готовности DTJ-016 (таблицы `outbox`/`processed_events`
 * ещё не существуют). Всегда возвращает пустой список — джоба работает по расписанию, ничего не
 * публикует. УДАЛИТЬ этот файл и заменить реальным Drizzle-адаптером при мерже DTJ-016 (C8 —
 * не оставлять мёртвый код после замены, см. «Риски» тикета DTJ-002).
 */
@Injectable()
export class NoopOutboxReaderAdapter implements OutboxReaderPort {
  readPending(_limit: number): Promise<readonly OutboxEventRecord[]> {
    return Promise.resolve([])
  }

  markPublished(_id: string): Promise<void> {
    return Promise.resolve()
  }
}
