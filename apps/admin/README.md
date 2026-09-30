# apps/admin

SPA операторов платформы (`super_admin` и роли модерации): тенанты, аптеки, пользователи, заказы, финансы, поддержка, настройки.
React 19 + Vite; вход по OTP, меню собирается из `src/app/role-routes.ts`, локаль — из провайдера. Слои
`app → features → shared`; компоненты — из `@dorutj/ui`, строки — `tj/ru/en`.

```bash
pnpm --filter @dorutj/admin dev     # vite
pnpm --filter @dorutj/admin test    # vitest run
```

Требования — [`docs/spec/27-module-admin-moderation-onboarding.md`](../../docs/spec/27-module-admin-moderation-onboarding.md);
API — [`apps/api`](../api/README.md).
