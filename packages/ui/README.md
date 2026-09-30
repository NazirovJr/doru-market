# @dorutj/ui

Единственный источник компонентов и дизайн-токенов White-Label UI: `Button`, `Input`, `Modal`, `Card`, `Badge`, `MedicineCard`,
`MapView`, `OrderTimeline` и др. (`src/components/`), брендинг (`src/branding/`), хуки, обвязка Telegram Web App (`src/twa/`).
Фронты не пишут свои аналоги — берут отсюда. Цвета — только CSS-переменные `--brand-*` (`src/tokens/`).

- `src/components/index.ts` — barrel: новые компоненты добавляются строкой, файл не переписывается (правило 8).

```bash
pnpm --filter @dorutj/ui test
pnpm --filter @dorutj/ui storybook   # Storybook на порту 6006
```
