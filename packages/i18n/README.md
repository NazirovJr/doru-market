# @dorutj/i18n

Словари `tj` / `ru` / `en` и форматирование: хук `useT()`, `resolveLocale`, `formatMoney`, `formatDate`, `formatNumber`,
`formatPhone`. Публичный API — `src/index.ts`, словари — `src/dictionaries/`.

- Любая пользовательская строка — через словарь; ключ добавляется **во все три** словаря (иначе тест полноты упадёт).
- Деньги форматируются из целых дирамов (1 TJS = 100 дирам).
- После правки словарей — пересобрать: `pnpm --filter @dorutj/i18n build`, иначе потребители видят старый `dist`.

```bash
pnpm --filter @dorutj/i18n test
```
