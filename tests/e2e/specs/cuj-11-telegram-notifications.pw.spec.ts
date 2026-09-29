// CUJ-11 заблокирован инфраструктурно (не багом экрана) — детали в БЛОКЕРАХ отчёта DTJ-422.
// Включение: убрать test.skip ниже, когда стенд научится перехватывать sendMessage.
import { test } from '@playwright/test'

const BLOCKER_REASON =
  'заблокировано инфраструктурно (не багом экрана) — см. JSDoc файла и БЛОКЕРЫ отчёта DTJ-422: ' +
  'TelegramNotifyProvider/worker-telegram-sender хардкодят https://api.telegram.org без ENV-конфига, ' +
  'нет seed-пользователя с telegram_chat_id (DTJ-435), нет тестового триггера повторной публикации outbox'

test.describe('CUJ-11: Telegram-уведомления вне TWA (SRS-NFR-075)', () => {
  test(
    'одно доменное событие (OrderProcessingStartedEvent, канал telegram→web_push) → ' +
      'ровно один sendMessage, notifications содержит ровно одну строку channel=telegram',
    () => {
      test.skip(true, BLOCKER_REASON)
    },
  )

  test(
    'at-least-once republish ТОГО ЖЕ доменного события не создаёт вторую строку/второй вызов ' +
      'стаба (uq_notifications_dedup, критерий приёмки №1)',
    () => {
      test.skip(true, BLOCKER_REASON)
    },
  )

  test(
    'simulateOutage() → OrderCancelledEvent доставляется фолбэком sms успешно, telegram для ' +
      'этого события — failed, сценарий не падает целиком (критерий приёмки №2)',
    () => {
      test.skip(true, BLOCKER_REASON)
    },
  )
})
