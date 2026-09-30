# Документация DoruTJ — индекс

Единственный индекс: любой файл в `docs/` (кроме `docs/history/`) обязан быть здесь — `pnpm docs:check` это проверяет.
Правила исполнителя и иерархия документов — в [`AGENTS.md`](../AGENTS.md).

## status — где мы сейчас

- [`status/state.md`](status/state.md) — текущее состояние, что дальше, известные долги; перезаписывается после каждого слияния.

## product — что и зачем

- [`product/charter.md`](product/charter.md) — устав проекта, сценарии CUJ, NFR.
- [`product/scope-r1.md`](product/scope-r1.md) — что входит в релиз R1 и что отложено.
- [`product/client-brief-original.txt`](product/client-brief-original.txt) — исходное ТЗ клиента (низший приоритет).
- [`product/design/design-brief-prompt.md`](product/design/design-brief-prompt.md) — бриф на дизайн; макеты — `product/design/claude-design-canvas/`.
- Исследования (не редактируются после написания):
  - [`product/research/00-RESEARCH-DIGEST.md`](product/research/00-RESEARCH-DIGEST.md) — сводка, 202 требования REQ-*
  - [`product/research/01-market-and-competitors.md`](product/research/01-market-and-competitors.md) — рынок и конкуренты
  - [`product/research/02-regulatory-and-compliance.md`](product/research/02-regulatory-and-compliance.md) — регуляторика
  - [`product/research/03-payments-and-escrow.md`](product/research/03-payments-and-escrow.md) — платежи и эскроу
  - [`product/research/04-pharmacy-erp-and-1c-sync.md`](product/research/04-pharmacy-erp-and-1c-sync.md) — ERP аптек и 1С
  - [`product/research/05-ai-ocr-stt-and-drug-reference.md`](product/research/05-ai-ocr-stt-and-drug-reference.md) — OCR, STT, справочники
  - [`product/research/06-ux-jtbd-and-benchmarks.md`](product/research/06-ux-jtbd-and-benchmarks.md) — UX и JTBD
  - [`product/research/07-telegram-pwa-and-delivery-ops.md`](product/research/07-telegram-pwa-and-delivery-ops.md) — Telegram, PWA, доставка
  - [`product/research/08-gap-1-monetization-commission-model.md`](product/research/08-gap-1-monetization-commission-model.md) — комиссия
  - [`product/research/08-gap-2-dispute-support-workflow.md`](product/research/08-gap-2-dispute-support-workflow.md) — споры и поддержка
  - [`product/research/08-gap-3-return-logistics-state-machine.md`](product/research/08-gap-3-return-logistics-state-machine.md) — возвраты
  - [`product/research/08-gap-4-courier-compensation-model.md`](product/research/08-gap-4-courier-compensation-model.md) — оплата курьера
  - [`product/research/08-gap-5-pharmacy-onboarding-verification.md`](product/research/08-gap-5-pharmacy-onboarding-verification.md) — онбординг аптек
- Конкурентная разведка:
  - [`product/competition/00-GO-NOGO-VERDICT.md`](product/competition/00-GO-NOGO-VERDICT.md) — итоговый вердикт
  - [`product/competition/01-threat-doru-tj.md`](product/competition/01-threat-doru-tj.md) — doru.tj
  - [`product/competition/02-threat-pharmacy-chains.md`](product/competition/02-threat-pharmacy-chains.md) — аптечные сети
  - [`product/competition/03-threat-aggregators-and-delivery.md`](product/competition/03-threat-aggregators-and-delivery.md) — агрегаторы и доставка
  - [`product/competition/04-threat-platform-entrants.md`](product/competition/04-threat-platform-entrants.md) — новые платформы
  - [`product/competition/05-demand-validation.md`](product/competition/05-demand-validation.md) — проверка спроса
  - [`product/competition/10-red-team-stop.md`](product/competition/10-red-team-stop.md) — аргументы «стоп»
  - [`product/competition/11-blue-team-build.md`](product/competition/11-blue-team-build.md) — аргументы «строить»

## spec — SRS, 1017 требований

- [`spec/00-SRS-MASTER.md`](spec/00-SRS-MASTER.md) — мастер: порядок эпиков, сквозные требования.
- [`spec/10-domain-model.md`](spec/10-domain-model.md), [`spec/11-database-schema.md`](spec/11-database-schema.md),
  [`spec/12-api-conventions-auth-tenancy.md`](spec/12-api-conventions-auth-tenancy.md) — домен, схема БД, API, auth, тенантность.
- Модули: [`20` каталог и поиск](spec/20-module-catalog-search.md), [`21` заказы, платежи, эскроу](spec/21-module-orders-payments-escrow.md),
  [`22` остатки и 1С](spec/22-module-inventory-sync-1c.md), [`23` рецепты и AI](spec/23-module-prescriptions-ai.md),
  [`24` терминал аптеки](spec/24-module-pharmacy-terminal.md), [`25` курьеры и доставка](spec/25-module-courier-delivery.md),
  [`26` мультитенантность и white-label](spec/26-module-tenancy-whitelabel.md),
  [`27` админка, модерация, онбординг](spec/27-module-admin-moderation-onboarding.md).
- [`spec/30-ux-screens-and-flows.md`](spec/30-ux-screens-and-flows.md), [`spec/31-nfr-security-testing-devops.md`](spec/31-nfr-security-testing-devops.md),
  [`spec/32-design-reference.md`](spec/32-design-reference.md) — UX, NFR и безопасность, привязка дизайна к спеке.

## architecture — как это устроено

- [`architecture/clean-architecture.md`](architecture/clean-architecture.md) — слои, пороги C1..C18.
- [`architecture/tech-baseline.md`](architecture/tech-baseline.md) — версии пакетов и состав `apps/`, `packages/`.
- [`architecture/decisions/README.md`](architecture/decisions/README.md) — индекс решений D-01..D-27 (по файлу на решение) и D-EP*.

## guides — как делать

- [`guides/developer-handbook.md`](guides/developer-handbook.md) — порядок работы над тикетом, проверки, диагностика, шпаргалка.
- [`guides/integration-tests.md`](guides/integration-tests.md) — интеграционные тесты `apps/api` и их окружение.

## runbooks — эксплуатация

- [`runbooks/production-readiness.md`](runbooks/production-readiness.md) — готовность к первому прод-релизу: безопасность, данные, наблюдаемость, порядок rolling-деплоя.

## process — как работают агенты и координатор

- [`process/coordinator.md`](process/coordinator.md) — роли, кто что решает, приёмка, эскалация.
- [`process/wave-protocol.md`](process/wave-protocol.md) — как проходит волна: ветки, порты, замок, миграции, слияние.
- [`process/executor-brief-template.md`](process/executor-brief-template.md) — шаблон брифа исполнителю.
- [`process/report-format.md`](process/report-format.md) — формат отчёта о сдаче тикета.
- [`process/lessons-learned.md`](process/lessons-learned.md) — истории, стоящие за правилами AGENTS; таблица Ж → правило.
- Локальные модели: [`process/local-models/qwen3-prompting-guide.md`](process/local-models/qwen3-prompting-guide.md),
  [`process/local-models/qwen3-analysis-2026-09-19.md`](process/local-models/qwen3-analysis-2026-09-19.md).

## history — архив, не читать для текущей работы

[`history/`](history/) — журналы состояния до 2026-09-06, брифы CTO волн 5–6 и EP-11, отчёты волн 2–3.5, устаревшие промпты.
Нужен только для раскопок «почему так решили»; файлы в индекс не входят.
