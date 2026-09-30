# apps/worker

Фоновый процесс на BullMQ: релей outbox в доменные события и периодические задачи. Джобы — в `src/jobs/`
(outbox-relay, escrow-timeouts, payout, cart-cleanup, notifications, inventory-sync-*, support-sla-monitor, report-export,
audit-log-retention и др.), имена очередей — `src/queues/queue.constants.ts`.

```bash
cp .env.example .env                 # REDIS_URL, DATABASE_URL, WORKER_HEALTH_PORT, API_INTERNAL_URL, INTERNAL_API_KEY …
pnpm --filter @dorutj/worker dev     # nest start --watch
pnpm --filter @dorutj/worker test    # vitest run
```

Worker и api делят одну БД и один Redis; по тестовому Redis — [integration-tests.md](../../docs/guides/integration-tests.md).
Бизнес-логика живёт в `apps/api`, worker вызывает её через внутренний API (`API_INTERNAL_URL`).
