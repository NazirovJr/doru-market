/**
 * Порт чтения `outbox` (02-CLEAN-ARCHITECTURE-AND-CODE.md §1.3: interface + DI-токен рядом).
 * Реализация репозитория — тикет DTJ-016 (тот же эпик), таблицы `outbox`/`processed_events`
 * создаёт он же. Здесь — только контракт + временная заглушка `NoopOutboxReaderAdapter`.
 */

export interface OutboxEventRecord {
  readonly id: string
  readonly eventType: string
  readonly payload: Record<string, unknown>
}

export const OUTBOX_READER_PORT = Symbol('OUTBOX_READER_PORT')

export interface OutboxReaderPort {
  /** Возвращает до `limit` неопубликованных строк outbox, упорядоченных по времени создания. */
  readPending(limit: number): Promise<readonly OutboxEventRecord[]>
  /** Помечает строку outbox опубликованной (`outbox.mark_processed()`, SRS-DOM-152). */
  markPublished(id: string): Promise<void>
}
