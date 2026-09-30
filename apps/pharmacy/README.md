# apps/pharmacy

Кабинет аптеки: терминал фармацевта (сборка заказов, возвраты), остатки и цены (массовый импорт и ручной ввод), история синхронизации. React 19 + Vite, dev-порт 5174.
Слои `app → pages → features → entities → shared`; компоненты — из `@dorutj/ui`, строки — `tj/ru/en`.

```bash
pnpm --filter @dorutj/pharmacy dev     # vite, порт 5174 задан в vite.config.ts
pnpm --filter @dorutj/pharmacy test    # vitest run
```

Требования — [`docs/spec/24-module-pharmacy-terminal.md`](../../docs/spec/24-module-pharmacy-terminal.md);
API — [`apps/api`](../api/README.md).
