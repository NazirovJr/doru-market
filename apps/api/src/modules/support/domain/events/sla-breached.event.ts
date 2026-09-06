/**
 * `SlaBreachedEvent` (EP-14, DTJ-280, SRS-ADM-076). Публикуется через `outbox` в ТОЙ ЖЕ
 * транзакции, что обновление `support_tickets.priority` (`EscalateTicketPriorityUseCase`).
 *
 * ВНИМАНИЕ (риск, зафиксированный DTJ-280 явно): SRS-ADM-076 называет это «уже существующим
 * типом события», но на момент реализации ни один модуль (в т.ч. `notifications`/EP-16 —
 * владелец `outbox`-инфраструктуры уведомлений) НЕ определяет `SlaBreachedEvent` в коде —
 * проверено (`grep -rn "SlaBreachedEvent"` по всему репозиторию содержит только doc/тикет-упоминания).
 * Форма ниже — добросовестная реконструкция из ЕДИНСТВЕННОГО источника с конкретными полями,
 * `10-domain-model.md` §«Глоссарий доменных событий» (`entityType, entityId, breachedAt,
 * slaMinutes`), согласованная с `entityType='support_ticket'` (SRS-ADM-076) и `tenantId`
 * (обязателен для outbox-строки, тот же приём, что `SupportTicketCreatedEvent`). Если владелец
 * EP-16 на момент своей реализации закрепит иную Zod-схему полей — привести ЭТОТ файл к ней, не
 * плодить вторую параллельную структуру (см. риски тикета).
 */
export interface SlaBreachedEvent {
  readonly type: 'SlaBreachedEvent'
  readonly entityType: 'support_ticket'
  readonly entityId: string
  readonly tenantId: string
  readonly breachedAt: Date
  readonly slaMinutes: number
}
