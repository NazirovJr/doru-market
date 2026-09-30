# apps/web

Покупательское SPA: React 19 + Vite. Поиск, аналоги, карта аптек, корзина, оформление заказа. Структура по слоям
`app → pages → features → entities → shared`, горизонтальные импорты между фичами запрещены; компоненты и токены — из
`@dorutj/ui`, строки — из `@dorutj/i18n` (tj/ru/en), цвета — только CSS-переменные `--brand-*`.

```bash
cp .env.example .env                # VITE_API_BASE_URL, VITE_TILESERVER_URL
pnpm --filter @dorutj/web dev       # vite
pnpm --filter @dorutj/web test      # vitest run
pnpm --filter @dorutj/web size-check   # бюджет размера сборки (scripts/ci/size-check.ts)
```

API — [`apps/api`](../api/README.md); экраны и сценарии — [`docs/spec/30-ux-screens-and-flows.md`](../../docs/spec/30-ux-screens-and-flows.md).
