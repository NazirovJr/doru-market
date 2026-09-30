# @dorutj/contracts

Единый источник контрактов между backend и фронтами: коды ошибок (`ErrorCode`, доменные ошибки по областям), permission-строки
RBAC, cursor-пагинация, конверты ответов и доменных событий, Zod-схемы API по областям (catalog, orders, payments, inventory,
onboarding, delivery, admin, analytics и др.). Публичный API — `src/index.ts`.

- Пакет без рантайм-логики приложения: никаких обращений к сети, БД и `process.env`.
- Новый код ошибки или permission добавляется здесь и сразу во все словари i18n `tj/ru/en`.
- После правки — пересобрать: `pnpm --filter @dorutj/contracts build` (потребители видят `dist`).

```bash
pnpm --filter @dorutj/contracts test
pnpm --filter @dorutj/contracts build
```
