/**
 * Тест-заглушка `NotificationDispatchProcessor` (DTJ-368) — тот же приём, что
 * `apps/api/src/modules/orders/orders.module.spec.ts` (D-EP09-16): скелет без реализации обязан
 * БРОСАТЬ явно, а не молча "обрабатывать" джобу без побочного эффекта.
 */
import { describe, expect, it } from 'vitest'
import type { Job } from 'bullmq'
import { NotificationDispatchProcessor, type NotificationDispatchJobData } from './notification-dispatch.processor.js'

describe('NotificationDispatchProcessor (DTJ-368, TODO(DTJ-370))', () => {
  it('process() бросает — обработчик логики ещё не реализован', async () => {
    const processor = new NotificationDispatchProcessor()
    const job = { id: 'job-1', data: {} } as Job<NotificationDispatchJobData>

    await expect(processor.process(job)).rejects.toThrow(/TODO\(DTJ-370\)/)
  })
})
